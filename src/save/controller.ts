import { cloneProductView, toNumericalSettings, type ProductView } from '../framing/contract.ts';
import type { NumericalSettings } from '../numerics/contract.ts';
import { ARTWORK_SCHEMA, MAX_ARTWORK_BYTES, artworkId, definitionFromView, definitionJson, fieldBytes, parseArtworkJson, serializeArtwork, sha256, verifyDefinition, definitionToView, type SavedArtwork } from './schema.ts';

export const IO_TIMEOUT_MS = 5000;
export const MAX_PNG_BYTES = 8 * 1024 * 1024;
export const PNG_ENCODER_RESERVATION_BYTES = 16 * 1024 * 1024;
export const READ_RESERVATION_BYTES = 4 * MAX_ARTWORK_BYTES;
export const SAVE_MANAGED_LIMIT_BYTES = 64 * 1024 * 1024;
export type SaveCaptureState = {
  canonical: ProductView; displayed: ProductView | null; numerical: NumericalSettings | null;
  requestId: number | null; latestRequestId: number | null; epoch: number | null;
  stage: string | null; status: string; route: string; studioOpen: boolean; visible: boolean;
  draftApplied: boolean; gestureActive: boolean; active: number; pending: number;
  canvas: HTMLCanvasElement; workId: string | null; getField: () => Uint16Array | null;
};
export type ArtworkIOFaults = { holdEncode?: boolean; holdRead?: boolean; failEncode?: boolean; failRead?: boolean };
export type SavedSnapshotSummary = { id: string; view: ProductView; workId: string | null; requestId: number; epoch: number; pngBytes: number; jsonBytes: number; integrity: SavedArtwork['integrity'] };
type Event = { type: string; at: number; saveGeneration: number; loadGeneration: number; detail?: unknown };
type VerificationWork = { generation:number;field:Uint16Array|null;rgba:Uint8ClampedArray<ArrayBuffer>|null;bytes:Uint8Array<ArrayBuffer>|null };
type CaptureWork = { field: Uint16Array | null; rgba: Uint8ClampedArray<ArrayBuffer> | null; bytes: Uint8Array<ArrayBuffer> | null; canvas: HTMLCanvasElement | null; blob: Blob | null; digestReservation: number };
type Gate = { kind: 'encode' | 'read'; generation: number; resolve: () => void; reject: (e: Error) => void; reservation: number };
type ReadTask = { generation: number; reader: FileReader; reservation: number; aborted: boolean };
type Bundle = { artifact: SavedArtwork; view: ProductView; png: Blob; json: Blob };
export type ArtworkIOOptions = {
  getCaptureState: () => SaveCaptureState;
  getRecoveryView: () => ProductView | null;
  applyCandidate: (view: ProductView) => Promise<void>;
  restorePrevious: (view: ProductView) => Promise<void> | void;
  cancelCandidate?: () => void;
  getBaseResources: () => { managedBufferBytes: number };
  onChange?: () => void;
  audit?: boolean;
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const cancelled = () => Error('処理を取り消しました。');
const message = (e: unknown): string => e instanceof Error ? e.message : '作品ファイルを処理できませんでした。';
function freeze<T>(input: T): T { if (input && typeof input === 'object') { for (const value of Object.values(input)) freeze(value); Object.freeze(input); } return input; }
/** One immutable save pair, bounded local IO, and generation-checked import. No network/storage. */
export class ArtworkIOController {
  private options: ArtworkIOOptions;
  private saveGeneration = 0; private loadGeneration = 0;
  private saveStatus: 'idle' | 'capturing' | 'encoding' | 'ready' | 'error' = 'idle';
  private loadStatus: 'idle' | 'reading' | 'applying' | 'restoring' | 'applied' | 'rejected' | 'cancelled' | 'error' = 'idle';
  private statusMessage = '確定した作品をPNGと設定で残せます。';
  private bundle: Bundle | null = null;
  private captureWork: CaptureWork | null = null;
  private captureRunning = false;
  private innerCaptures=0;
  private nativeEncoders = 0;
  private readTasks = new Set<ReadTask>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private urls = new Map<'png' | 'json', { url: string; timer: ReturnType<typeof setTimeout> }>();
  private gates = new Set<Gate>();
  private events: Event[] = [];
  private maxManagedBytes = 0;
  private verificationReservations=new Map<number,number>();
  private verificationWork:VerificationWork|null=null;
  private readProcessing=new Set<number>();
  private readStartedAt=new Map<number,number>();
  private faults: ArtworkIOFaults = {};
  private encodeAbort: AbortController | null = null;
  private loadAbort: AbortController | null = null;
  private appliedGeneration: number | null = null;
  private recovery: ProductView | null = null;

  constructor(options: ArtworkIOOptions) { this.options = options; }
  private event(type: string, detail?: unknown): void { this.events.push({ type, at: performance.now(), saveGeneration: this.saveGeneration, loadGeneration: this.loadGeneration, ...(detail === undefined ? {} : { detail }) }); if (this.events.length > 512) this.events.splice(0, this.events.length - 512); }
  private changed(): void { this.maxManagedBytes = Math.max(this.maxManagedBytes, this.resources().managedBufferBytes); this.options.onChange?.(); }
  private reason(state: SaveCaptureState): string | null {
    if (state.route !== 'julia' || !state.studioOpen || !state.visible) return '作品を開き、確定像を表示してください。';
    if (!state.draftApplied) return '編集中のcを適用するか、適用済みの値へ戻してください。';
    if (state.gestureActive) return '操作を終え、確定像の表示を待ってください。';
    if (state.status === 'stopped') return '再計算して、確定像を表示してください。';
    if (state.status !== 'displayed' || state.active || state.pending || state.stage !== 'final') return '描画が終わり、確定像になるまで待ってください。';
    if (!state.displayed || !state.numerical || state.requestId === null || state.epoch === null || state.requestId !== state.latestRequestId) return '最新の確定像を表示してください。';
    const view = cloneProductView(state.canonical);
    if (!same(view, cloneProductView(state.displayed)) || !same(toNumericalSettings(view,'final'), state.numerical)) return '現在の設定に対応する確定像を待ってください。';
    if (state.canvas.width !== view.resolution || state.canvas.height !== view.resolution) return '確定解像度の表示を待ってください。';
    return null;
  }
  canCapture(): { allowed: boolean; reason: string | null } {
    try { if(this.verificationReservations.size)return{allowed:false,reason:'前の作品照合が終わるまで待ってください。'}; if (['reading','applying','restoring'].includes(this.loadStatus))return{allowed:false,reason:'設定の読込が終わるまで待ってください。'}; if (this.captureRunning || this.innerCaptures || this.nativeEncoders) return { allowed: false, reason: '前の画像処理が終わるまで待ってください。' }; const reason = this.reason(this.options.getCaptureState()); return { allowed: reason === null, reason }; }
    catch (e) { return { allowed: false, reason: message(e) }; }
  }
  private assertBudget(additional = 0): void {
    const total = this.options.getBaseResources().managedBufferBytes + this.resources().managedBufferBytes + additional;
    if (!Number.isFinite(total) || total > SAVE_MANAGED_LIMIT_BYTES) throw Error('一時資源の上限を超えるため処理できません。');
  }
  private clearBundle(): void { this.revokeAll(); this.bundle = null; }
  private closeCapture(): void { const work=this.captureWork;if(work){if(work.canvas){work.canvas.width=0;work.canvas.height=0;}work.field=null;work.rgba=null;work.bytes=null;work.canvas=null;work.blob=null;work.digestReservation=0;}this.captureWork=null; }
  private captureBuffers(state:SaveCaptureState,view:ProductView):CaptureWork {
    const field=state.getField(),pixels=view.resolution*view.resolution;if(!field||field.length!==pixels)throw Error('表示の数値fieldを取得できませんでした。');
    const rgba=state.canvas.getContext('2d')!.getImageData(0,0,view.resolution,view.resolution).data;
    const canvas=document.createElement('canvas');canvas.width=view.resolution;canvas.height=view.resolution;
    const context=canvas.getContext('2d',{alpha:false});if(!context)throw Error('一時画像を作成できませんでした。');context.putImageData(new ImageData(rgba,view.resolution,view.resolution),0,0);
    return{field,rgba,bytes:fieldBytes(field),canvas,blob:null,digestReservation:pixels*6};
  }
  private later(callback: () => void, ms: number): ReturnType<typeof setTimeout> { const timer = setTimeout(() => { this.timers.delete(timer); callback(); this.changed(); }, ms); this.timers.add(timer); return timer; }
  private clearTimer(timer: ReturnType<typeof setTimeout>): void { clearTimeout(timer); this.timers.delete(timer); }
  private async bounded<T>(operation: Promise<T>, signal: AbortSignal, kind: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
    try { return await Promise.race([operation, new Promise<never>((_, reject) => { abort = () => reject(cancelled()); if (signal.aborted) { abort(); return; } signal.addEventListener('abort', abort, { once: true }); timer = this.later(() => { this.event(`${kind}-timeout`, { limitMs: IO_TIMEOUT_MS }); reject(Error(`${kind === 'encode' ? 'PNG生成' : kind === 'render' ? '再描画' : kind === 'verification' ? '作品照合' : 'ファイル読込'}が5000msを超えました。もう一度お試しください。`)); }, IO_TIMEOUT_MS); })]); }
    finally { if (timer) this.clearTimer(timer); if (abort) signal.removeEventListener('abort', abort); }
  }
  private async gate(kind: 'encode' | 'read', generation: number, reservation: number, signal: AbortSignal): Promise<void> {
    const key = kind === 'encode' ? 'holdEncode' : 'holdRead'; if (!this.faults[key]) return;
    if(kind==='read'&&[...this.gates].some(g=>g.kind==='read'))throw Error('遅延読込は一件までです。');
    this.faults[key] = false;
    await new Promise<void>((resolve, reject) => { let timer:ReturnType<typeof setTimeout>|undefined;
      const clean=()=>{if(timer)this.clearTimer(timer);signal.removeEventListener('abort',aborted);this.gates.delete(gate);};
      const gate: Gate = { kind, generation, reservation, resolve: () => { clean();this.event(`${kind}-delivery-released`,{generation,discarded:signal.aborted||generation!==(kind==='read'?this.loadGeneration:this.saveGeneration),injected:true});resolve(); }, reject: e => { clean();reject(e); } }; const aborted = () => gate.reject(cancelled());
      this.gates.add(gate);
      // A read-delivery fault may outlive cancellation so a later file genuinely
      // reaches acceptance first. Only one such raw payload is retained, with its
      // own original-deadline watchdog. Normal FileReader still aborts physically.
      if(kind==='encode')signal.addEventListener('abort',aborted,{once:true});
      else timer=this.later(()=>{this.event('read-timeout',{generation,limitMs:IO_TIMEOUT_MS,method:'held-delivery-original-deadline'});gate.reject(Error('ファイル読込が5000msを超えました。'));},Math.max(0,(this.readStartedAt.get(generation)??performance.now())+IO_TIMEOUT_MS-performance.now()));
      this.event(`${kind}-held`, { generation, injected: true }); this.changed(); });
  }
  private png(canvas: HTMLCanvasElement, generation: number, signal: AbortSignal): Promise<Blob> {
    this.nativeEncoders++; this.event('encode-started'); this.changed();
    return new Promise((resolve, reject) => { try { canvas.toBlob(blob => { this.nativeEncoders--; this.event('encode-native-completed', { generation, discarded: signal.aborted || generation !== this.saveGeneration, bytes: blob?.size ?? null }); this.changed();
      if (signal.aborted || generation !== this.saveGeneration) { reject(cancelled()); return; }
      if (!blob || blob.type !== 'image/png' || blob.size > MAX_PNG_BYTES) { reject(Error('PNGを生成できないか、画像の一時上限を超えました。')); return; }
      resolve(blob); }, 'image/png'); } catch (e) { this.nativeEncoders--; this.changed(); reject(e); } });
  }
  async capture(): Promise<SavedSnapshotSummary> { return this.captureArtwork(); }
  async captureArtwork(): Promise<SavedSnapshotSummary> {
    const state = this.options.getCaptureState(), allowed = this.canCapture();
    if (!allowed.allowed) { this.statusMessage = allowed.reason!; this.event('capture-rejected', { reason: allowed.reason }); this.changed(); throw Error(allowed.reason!); }
    const reason = this.reason(state); if (reason) throw Error(reason);
    const view = cloneProductView(state.canonical), pixels = view.resolution * view.resolution;
    try{this.assertBudget(pixels * 18 + PNG_ENCODER_RESERVATION_BYTES + MAX_ARTWORK_BYTES);}catch(e){this.saveStatus=this.bundle?'ready':'error';this.statusMessage=message(e);this.event('capture-rejected',{reason:this.statusMessage});this.changed();throw e;}
    const generation = ++this.saveGeneration; this.encodeAbort?.abort(); const abort = this.encodeAbort = new AbortController();
    this.clearBundle(); this.saveStatus = 'capturing'; this.captureRunning = true; this.statusMessage = 'この確定像から、画像と設定を用意しています。';
    this.event('capture-started', { generation, view, requestId: state.requestId, epoch: state.epoch });
    try {
      this.captureWork=this.captureBuffers(state,view);
      const canvas=this.captureWork.canvas!;
      this.assertBudget(); this.changed();
      this.innerCaptures++;const operation = (async () => {try{
        const work = this.captureWork!;
        const definition = definitionFromView(view), integrity = { definitionSha256: await sha256(new TextEncoder().encode(definitionJson(definition))), fieldSha256: await sha256(work.bytes!), rgbaSha256: await sha256(work.rgba!) };
        if (abort.signal.aborted || generation !== this.saveGeneration) throw cancelled();
        work.field = null; work.bytes = null; work.digestReservation = 0;
        const artifact = freeze<SavedArtwork>({ schemaVersion: ARTWORK_SCHEMA, artworkId: artworkId(integrity), definition, integrity,
          reference: { workId: state.workId }, provenance: { sourceCommit: null }, execution: { requestId: state.requestId!, epoch: state.epoch! } });
        if (this.faults.failEncode) { this.faults.failEncode = false; throw Error('テスト専用にPNG生成失敗を注入しました。'); }
        this.saveStatus='encoding';this.changed();work.blob = await this.png(canvas,generation,abort.signal);
        await this.gate('encode',generation,0,abort.signal);
        if (abort.signal.aborted || generation !== this.saveGeneration) throw cancelled();
        const json = new Blob([serializeArtwork(artifact)],{type:'application/json'});
        this.bundle = { artifact, view: freeze(cloneProductView(view)), png: work.blob, json };
        this.closeCapture(); this.assertBudget(); this.saveStatus = 'ready'; this.statusMessage = 'この一枚の画像と設定を、それぞれ取得できます。'; this.event('capture-ready', { id: artifact.artworkId, view, integrity }); return this.savedSummary()!;
      }finally{this.innerCaptures--;this.changed();}})();
      return await this.bounded(operation,abort.signal,'encode');
    } catch (e) { if (generation === this.saveGeneration) { this.saveStatus = 'error'; this.statusMessage = message(e); this.bundle = null; } this.event('capture-failed', { generation, message: message(e) }); abort.abort(); throw e; }
    finally { if (generation === this.saveGeneration || this.captureRunning) this.closeCapture(); this.captureRunning = false; if (this.encodeAbort === abort) this.encodeAbort = null; this.changed(); }
  }
  /** Public name requested by the UI, with the private work slot kept separate. */
  async captureSnapshot(): Promise<SavedSnapshotSummary> { return this.captureArtwork(); }
  private savedSummary(): SavedSnapshotSummary | null { const b = this.bundle; return b ? { id: b.artifact.artworkId, view: cloneProductView(b.view), workId: b.artifact.reference.workId, requestId: b.artifact.execution.requestId, epoch: b.artifact.execution.epoch, pngBytes: b.png.size, jsonBytes: b.json.size, integrity: { ...b.artifact.integrity } } : null; }
  clearSnapshot():void{this.saveGeneration++;this.encodeAbort?.abort();this.encodeAbort=null;this.clearBundle();this.saveStatus='idle';this.statusMessage='保存対象を解除しました。確定した表示から作り直せます。';this.event('snapshot-cleared');this.changed();}
  download(kind: 'png' | 'json'): void {
    if (kind !== 'png' && kind !== 'json') throw Error('ファイル形式を確認してください。');
    const bundle = this.bundle; if (!bundle || this.saveStatus !== 'ready') throw Error('画像と設定の準備を待ってください。');
    this.revoke(kind); const blob = kind === 'png' ? bundle.png : bundle.json, url = URL.createObjectURL(blob), timer = this.later(() => this.revoke(kind),1000);
    this.urls.set(kind,{url,timer}); this.event('url-created',{kind,id:bundle.artifact.artworkId});
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${bundle.artifact.artworkId}.${kind}`; document.body.append(anchor); anchor.click(); anchor.remove();
    this.statusMessage = `${kind === 'png' ? 'PNG画像' : '設定JSON'}の取得を開始しました。端末での保存先はブラウザで確認してください。`; this.event('download-started',{kind,id:bundle.artifact.artworkId}); this.changed();
  }
  private revoke(kind: 'png' | 'json'): void { const value = this.urls.get(kind); if (!value) return; this.clearTimer(value.timer); URL.revokeObjectURL(value.url); this.urls.delete(kind); this.event('url-revoked',{kind}); this.changed(); }
  private revokeAll(): void { for (const kind of [...this.urls.keys()]) this.revoke(kind); }
  private readFile(file: File, generation: number, signal: AbortSignal): Promise<string> {
    return new Promise((resolve,reject) => { const reader = new FileReader(), task: ReadTask = { generation, reader, reservation: 0, aborted:false }; this.readTasks.add(task); this.event('read-started',{generation,size:file.size}); this.changed();
      const finish = () => { this.readTasks.delete(task); signal.removeEventListener('abort',abort); this.changed(); };
      const abort = () => { task.aborted = true; if (reader.readyState === FileReader.LOADING) reader.abort(); finish(); reject(cancelled()); };
      signal.addEventListener('abort',abort,{once:true});
      reader.onload = () => { const result = reader.result; finish(); this.event('read-native-completed',{generation,discarded:signal.aborted||generation!==this.loadGeneration}); if (signal.aborted||generation!==this.loadGeneration) {reject(cancelled());return;} if(typeof result!=='string'){reject(Error('JSONテキストを読み込めませんでした。'));return;} resolve(result); };
      reader.onerror = () => { finish(); reject(Error('ファイルを読み込めませんでした。')); }; reader.onabort = () => { finish(); reject(cancelled()); };
      try { reader.readAsText(file,'UTF-8'); } catch(e) { finish(); reject(e); }
    });
  }
  private currentLoad(generation:number,signal:AbortSignal):void { if(signal.aborted||generation!==this.loadGeneration)throw cancelled(); }
  private clearVerificationPayload(generation:number):void {
    const work=this.verificationWork;if(work?.generation!==generation)return;
    work.field=null;work.rgba=null;work.bytes=null;
  }
  private verificationBuffers(state:SaveCaptureState,generation:number):VerificationWork {
    const field=state.getField(),pixels=state.canvas.width*state.canvas.height;
    if(!field||field.length!==pixels)throw Error('再計算の数値fieldを取得できませんでした。');
    const rgba=state.canvas.getContext('2d')!.getImageData(0,0,state.canvas.width,state.canvas.height).data;
    return{generation,field,rgba,bytes:fieldBytes(field)};
  }
  private async verifyRendered(artifact:SavedArtwork,state:SaveCaptureState,generation:number,signal:AbortSignal):Promise<void>{
    if(this.verificationReservations.size)throw Error('前の作品照合が終わるまで待ってください。');
    const reservation=state.canvas.width*state.canvas.height*16;this.assertBudget(reservation);
    const work=this.verificationBuffers(state,generation);this.verificationWork=work;this.verificationReservations.set(generation,reservation);
    this.event('verification-native-started',{generation,reservationBytes:reservation});this.changed();
    const producer=(async()=>{try{
      const fieldHash=await sha256(work.bytes!);this.currentLoad(generation,signal);
      const rgbaHash=await sha256(work.rgba!);this.currentLoad(generation,signal);
      if(fieldHash!==artifact.integrity.fieldSha256||rgbaHash!==artifact.integrity.rgbaSha256)throw Error('再計算の数値または画像が保存設定の照合情報と一致しません。');
      this.event('verification-match',{generation,fieldSha256:fieldHash,rgbaSha256:rgbaHash});
    }finally{
      this.clearVerificationPayload(generation);this.verificationReservations.delete(generation);if(this.verificationWork===work)this.verificationWork=null;
      this.event('verification-native-settled',{generation,discarded:signal.aborted||generation!==this.loadGeneration});this.changed();
    }})();
    try{await this.bounded(producer,signal,'verification');}
    finally{this.clearVerificationPayload(generation);this.changed();}
  }
  async importFile(file: File): Promise<{ status: 'applied' | 'rejected' | 'cancelled' | 'error'; artifact?: SavedArtwork; message?: string }> {
    const previous=this.recovery,wasApplied=this.appliedGeneration!==null;
    this.interruptImport('new-file'); const generation = this.loadGeneration, abort = this.loadAbort = new AbortController();
    if(wasApplied&&previous){this.options.cancelCandidate?.();try{await this.options.restorePrevious(cloneProductView(previous));}catch(e){this.event('rollback-render-failed',{message:message(e)});}if(generation!==this.loadGeneration)return{status:'cancelled',message:'新しい操作を保持しました。'};}
    if(this.verificationReservations.size){this.loadStatus='rejected';this.statusMessage='前の作品照合の終了を待ち、設定ファイルを選び直してください。';this.event('import-rejected',{generation,reason:'verification-still-native-pending'});this.changed();return{status:'rejected',message:this.statusMessage};}
    if (!(file instanceof Blob) || file.size > MAX_ARTWORK_BYTES || file.size < 1) { this.loadStatus='rejected';this.statusMessage='1〜64KiBの設定JSONを選んでください。';this.event('import-rejected',{generation,reason:'size',size:file?.size??null});this.changed();return{status:'rejected',message:this.statusMessage}; }
    if(this.readProcessing.size>=2){this.loadStatus='rejected';this.statusMessage='前のファイル処理が終わるまで待ってください。';this.event('import-rejected',{generation,reason:'bounded-read-slots'});this.changed();return{status:'rejected',message:this.statusMessage};}try{this.assertBudget(READ_RESERVATION_BYTES);}catch(e){this.loadStatus='rejected';this.statusMessage=message(e);this.event('import-rejected',{generation,reason:'resource-budget'});this.changed();return{status:'rejected',message:this.statusMessage};} this.loadStatus='reading';this.statusMessage='設定ファイルを確認しています…';this.changed();
    let applied=false;
    try {
      this.readProcessing.add(generation);this.readStartedAt.set(generation,performance.now());this.changed();
      const operation=(async()=>{try{let text=await this.readFile(file,generation,abort.signal);await this.gate('read',generation,0,abort.signal);this.currentLoad(generation,abort.signal);if(this.faults.failRead){this.faults.failRead=false;throw Error('テスト専用にファイル読込失敗を注入しました。');}
        const artifact=await verifyDefinition(parseArtworkJson(text));text='';this.currentLoad(generation,abort.signal);return artifact;}finally{this.readProcessing.delete(generation);this.readStartedAt.delete(generation);this.changed();}})();
      const artifact=await this.bounded(operation,abort.signal,'read');this.currentLoad(generation,abort.signal);
      this.recovery=this.options.getRecoveryView();this.recovery=this.recovery?cloneProductView(this.recovery):null;this.loadStatus='applying';this.appliedGeneration=generation;applied=true;this.event('import-applying',{generation,id:artifact.artworkId,view:definitionToView(artifact.definition)});this.changed();
      await this.bounded(this.options.applyCandidate(definitionToView(artifact.definition)),abort.signal,'render');this.currentLoad(generation,abort.signal);
      const state=this.options.getCaptureState(),reason=this.reason(state);if(reason)throw Error(reason);
      if(!same(cloneProductView(state.canonical),definitionToView(artifact.definition)))throw Error('読込後の設定が作品定義と一致しません。');
      await this.verifyRendered(artifact,state,generation,abort.signal);this.currentLoad(generation,abort.signal);
      this.loadStatus='applied';this.statusMessage='設定を読み込み、同じ仕様で作品を再計算しました。';this.appliedGeneration=null;this.recovery=null;this.event('import-verified',{generation,id:artifact.artworkId,fieldSha256:artifact.integrity.fieldSha256,rgbaSha256:artifact.integrity.rgbaSha256});this.changed();return{status:'applied',artifact};
    } catch(e) {
      const current=generation===this.loadGeneration&&!abort.signal.aborted;
      if(!current){this.event('import-discarded',{generation,reason:message(e)});return{status:'cancelled',message:message(e)};}
      abort.abort();
      if(applied&&this.recovery){this.loadStatus='restoring';this.changed();this.event('import-rollback',{generation,view:this.recovery});try{await this.options.restorePrevious(cloneProductView(this.recovery));}catch(restoreError){this.event('rollback-render-failed',{message:message(restoreError)});}}
      if(generation!==this.loadGeneration){this.event('rollback-discarded',{generation});return{status:'cancelled',message:'新しい操作を保持しました。'};}this.appliedGeneration=null;this.recovery=null;this.loadStatus=applied?'error':'rejected';this.statusMessage=applied?`${message(e)} 元の有効な設定へ戻しました。必要なら再計算してください。`:message(e);this.event('import-failed',{generation,applied,message:message(e)});this.changed();return{status:this.loadStatus,message:this.statusMessage};
    } finally { this.clearVerificationPayload(generation);if(this.loadAbort===abort)this.loadAbort=null;this.changed(); }
  }
  interruptImport(reason='edit'): void { const wasActive=this.loadStatus==='reading'||this.loadStatus==='applying'||this.loadStatus==='restoring';const oldGeneration=this.loadGeneration;this.loadGeneration++;this.loadAbort?.abort();this.loadAbort=null;this.clearVerificationPayload(oldGeneration);if(reason!=='new-file')for(const gate of [...this.gates])if(gate.kind==='read')gate.reject(cancelled());if(wasActive){this.loadStatus='cancelled';this.statusMessage='設定の読込を取り消しました。';}this.appliedGeneration=null;this.recovery=null;this.event('load-generation-invalidated',{reason});this.changed(); }
  async cancelImport(reason='cancel'):Promise<void>{const previous=this.recovery,wasApplied=this.appliedGeneration!==null;this.interruptImport(reason);this.loadStatus='cancelled';this.statusMessage='設定の読込を取り消しました。最後の有効な作品を保持しています。';if(wasApplied){this.options.cancelCandidate?.();if(previous)try{await this.options.restorePrevious(cloneProductView(previous));}catch(e){this.event('rollback-render-failed',{message:message(e)});}}this.changed();}
  leave():void{const previous=this.recovery,wasApplied=this.appliedGeneration!==null;this.interruptImport('leave');if(wasApplied&&previous){this.options.cancelCandidate?.();void Promise.resolve(this.options.restorePrevious(cloneProductView(previous))).catch(e=>this.event('rollback-render-failed',{message:message(e)}));}this.saveGeneration++;this.encodeAbort?.abort();this.encodeAbort=null;this.clearBundle();this.saveStatus='idle';this.event('leave');this.changed();}
  configureFaults(input:ArtworkIOFaults):void{if(!this.options.audit)throw Error('Test injection requires audit mode.');if(Object.keys(input).some(k=>!['holdEncode','holdRead','failEncode','failRead'].includes(k))||Object.values(input).some(v=>typeof v!=='boolean'))throw Error('Unsupported IO test fault.');if(input.holdRead&&[...this.gates].some(g=>g.kind==='read'))throw Error('Delayed read slot already occupied.');this.faults={...this.faults,...input};this.event('faults',{...input,injected:true});}
  release(kind:'encode'|'read'):void{if(!this.options.audit)throw Error('Test injection requires audit mode.');for(const gate of [...this.gates])if(gate.kind===kind)gate.resolve();this.changed();}
  resources(){const c=this.captureWork;const bytes=(this.bundle?.png.size??0)+(this.bundle?.json.size??0)+(c?.field?.byteLength??0)+(c?.rgba?.byteLength??0)+(c?.bytes?.byteLength??0)+(c?.canvas?c.canvas.width*c.canvas.height*4:0)+(c?.blob?.size??0)+(c?.digestReservation??0)+[...this.verificationReservations.values()].reduce((n,b)=>n+b,0)+this.readProcessing.size*READ_RESERVATION_BYTES+this.nativeEncoders*PNG_ENCODER_RESERVATION_BYTES+[...this.readTasks].reduce((n,t)=>n+t.reservation,0)+[...this.gates].reduce((n,g)=>n+g.reservation,0);return{managedBufferBytes:bytes,peakManagedBufferBytes:Math.max(this.maxManagedBytes,bytes),snapshotCount:Number(this.bundle!==null),objectUrls:this.urls.size,timers:this.timers.size,verificationOperations:this.verificationReservations.size,verificationPayloadBytes:(this.verificationWork?.field?.byteLength??0)+(this.verificationWork?.rgba?.byteLength??0)+(this.verificationWork?.bytes?.byteLength??0),verificationNativeReservationBytes:[...this.verificationReservations.values()].reduce((n,b)=>n+b,0),encodeJobs:this.nativeEncoders,captureOperations:this.innerCaptures,readJobs:this.readTasks.size,heldJobs:this.gates.size,temporaryCanvases:Number(!!c?.canvas),limits:{managedBufferBytes:SAVE_MANAGED_LIMIT_BYTES,pngBytes:MAX_PNG_BYTES,pngEncoderReservationBytes:PNG_ENCODER_RESERVATION_BYTES,jsonBytes:MAX_ARTWORK_BYTES,jobMs:IO_TIMEOUT_MS},kind:'IO-owned bytes/reservations only; not browser whole heap/GPU memory'};}
  snapshot(){return{saveStatus:this.saveStatus,loadStatus:this.loadStatus,message:this.statusMessage,saved:this.savedSummary(),saveGeneration:this.saveGeneration,loadGeneration:this.loadGeneration,resources:this.resources(),events:this.events.map(e=>({...e})),faults:this.options.audit?{...this.faults}:null};}
}
