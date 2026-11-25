import { museumShell } from './journey/shell.ts';
import './museum.css';
import './tour/room.css';
import { GuidedTour } from './tour/player.ts';
import { updateTourControls } from './tour/controls.ts';
import type { Settings } from './config.ts';
import { validateProductView, cloneProductView, toNumericalSettings, type ProductView } from './framing/contract.ts';
import { zoomViewport, panByFraction, panFromDrag, viewportSpan, viewportCenter, clientToPlane, pointToClient } from './framing/coordinates.ts';
import { defaultWorkView, updateProductView, restoreProductComposition, INITIAL_PRODUCT_VIEWPORT } from './framing/state.ts';
import { validateNumericalSettings, type NumericalSettings, type NumericViewport } from './numerics/contract.ts';
import { ProductRenderer } from './product/renderer.ts';
import { UX_PRESETS, type Quality } from './ux-state.ts';
import { validateParameter, parseParameterDraft, pointerToPlane, pointerToParameter, parameterToClient, getContentRect, toUnit, arrowParameter, type ContentRect, type ParameterC } from './parameter/coordinates.ts';
import { ParameterMap } from './parameter/map.ts';
import { LIVE_WORKS, INITIAL_WORK, ART_WORK_VERSION, type LiveWorkId } from './art/works.ts';
import { DISPLAY_PALETTES, ART_DISPLAY_VERSION, colorizeArtField, validateDisplayPalette, type DisplayPaletteId } from './art/palette.ts';
import { ART_CACHE_UPPER_BYTES } from './art/integrity.ts';
import { ArtworkIOController, type SaveCaptureState } from './save/controller.ts';

type Route = 'gallery' | 'julia' | 'tour';
type Status = 'idle' | 'rendering' | 'displayed' | 'stopped' | 'input-error' | 'render-error';
type AuditEvent = { type: string; id: number | null; epoch: number; at: number; [key: string]: unknown };
const root = document.querySelector<HTMLElement>('#app')!;
const auditEnabled = false;
root.innerHTML = museumShell;

const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = element<HTMLCanvasElement>('art-canvas');
const placeholder = element('art-placeholder');
const statusElement = element('ux-status');
const saveDialog = element<HTMLDialogElement>('save-dialog');
let route: Route = location.hash === '#/julia' ? 'julia' : 'gallery';
let status: Status = 'idle';
let presetIndex = 1;
let selectedWorkId: string | null = INITIAL_WORK.id;
let originView = defaultWorkView(INITIAL_WORK.id);
let requestedWork: LiveWorkId | null = null;
let journeyGeneration = 0;
let studioOpen = false;
let palette: DisplayPaletteId = INITIAL_WORK.palette;
let paintedStyle: { palette: DisplayPaletteId; version: string } | null = null;
let quality: Quality = INITIAL_WORK.quality;
let appliedC: ParameterC = validateParameter(INITIAL_WORK.c);
let draft = { re: String(appliedC.re), im: String(appliedC.im) };
let parameterRevision = 0;
let lastParameterSource = 'initial';
let parameterRejection: string | null = null;
let parameterRejectionKind: 'input' | 'asset' | null = null;
let parameterMap: ParameterMap | null = null;
let canonicalView: ProductView = defaultWorkView(INITIAL_WORK.id);
let desiredSettings = toNumericalSettings(canonicalView, 'final');
let displayedSettings: Extract<NumericalSettings,{mode:'julia'}> | null = null;
let displayedStage: 'intermediate' | 'final' | null = null;
let framingRejection: string | null = null;
let viewRevision = 0;
let lastViewSource = 'initial';
let displayedRequestId: number | null = null;
let displayedEpoch: number | null = null;
let displayedQuality: Quality | null = null;
let numericHash: string | null = null;
let imageIdentity = '';
let inputFailed = false;
let renderer: ProductRenderer | null = null;
let artworkIO: ArtworkIOController | null = null;
let artworkApplying = false;
let mutatingForArtworkIO = false;
let artworkApplySerial = 0;
const artworkWaiters = new Map<number,{resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
let artworkLocalMessage = '';
let hasImportNotice = false;
let artworkSaveMessage = '';
let captureNoticeRevision = 0;
let failNextArtworkCandidate = false;
let draftPending = false;
type RecoveryMetadata = {view:ProductView;originView:ProductView;workId:string|null;draft:{re:string;im:string};draftPending:boolean;disclosures:{explanation:boolean;displayOptions:boolean;math:boolean};hadFinalImage:boolean;parameterState:{rejection:string|null;kind:'input'|'asset'|null;text:string;state:string};framingState:{rejection:string|null;text:string;state:string}};
// A tour is a separate room. Keep only editor metadata, never a second Worker, field or saved file.
type ParkedEdit = { metadata: RecoveryMetadata; parameterDetailsOpen: boolean };
const parkedEdits: ParkedEdit[] = [];
let startTourRequested = false;
let incomingScene: { workId: LiveWorkId; view: ProductView } | null = null;
let restoringEdit: ParkedEdit | null = null;
let lastStableArtwork: RecoveryMetadata | null = null;
let importRecovery: RecoveryMetadata | null = null;
const events: AuditEvent[] = [];
const event = (type: string, extra: Record<string, unknown> = {}): void => {
  if (auditEnabled) { events.push({ type, epoch: renderer?.snapshot().epoch ?? 0, id: displayedRequestId, at: performance.now(), ...extra }); if (events.length > 4096) events.splice(0, events.length - 4096); }
};
const cLabel = (input: { c: ParameterC }): string => `${input.c.re} ${input.c.im < 0 ? '−' : '+'} ${Math.abs(input.c.im)}i`;
const presetName = (settings: { c: ParameterC }): string => LIVE_WORKS.find((w) => w.c.re === settings.c.re && w.c.im === settings.c.im)?.title ?? `c≈${Number(settings.c.re.toPrecision(6))} ${settings.c.im < 0 ? '−' : '+'} ${Number(Math.abs(settings.c.im).toPrecision(6))}i`;
const paletteLabel = (id: DisplayPaletteId): string => DISPLAY_PALETTES.find(p => p.id === id)!.note;
const paletteName = (): string => paletteLabel(paintedStyle?.palette ?? palette);
const sameViewport = (a: NumericViewport, b: NumericViewport): boolean => ['reMin','reMax','imMin','imMax'].every(k => a[k as keyof NumericViewport] === b[k as keyof NumericViewport]);
const sameView = (a: ProductView | null, b: ProductView | null): boolean => a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b);
const viewportLabel = (v: NumericViewport): string => `実部 ${Number(v.reMin.toPrecision(6))} … ${Number(v.reMax.toPrecision(6))} ／虚部 ${Number(v.imMin.toPrecision(6))} … ${Number(v.imMax.toPrecision(6))}`;
function interruptArtworkForEdit(): void {
  artworkIO?.interruptImport();
  if(artworkApplying){artworkApplying=false;artworkApplySerial++;}
  artworkLocalMessage='';
  hasImportNotice = false;
}
function assignCanonical(input: ProductView): void {
  if (!mutatingForArtworkIO) interruptArtworkForEdit();
  canonicalView = validateProductView(input); appliedC = { ...canonicalView.c }; palette = canonicalView.displayPalette;
  quality = canonicalView.resolution === 768 ? 'full' : 'preview'; desiredSettings = toNumericalSettings(canonicalView, 'final');
}

async function hashCounts(counts: Uint16Array): Promise<string> {
  const buffer = new ArrayBuffer(counts.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < counts.length; i++) view.setUint16(i * 2, counts[i]!, true);
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function setStatus(next: Status, message: string): void {
  status = next;
  statusElement.dataset.state = next;
  statusElement.textContent = message;
  const retry = element('retry');
  const hideRetry = next !== 'input-error' && next !== 'render-error';
  if (hideRetry && document.activeElement === retry) {
    const target = element('recalculate');
    target.focus();
    target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    event('focus-recovery', { target: target.id, reason: 'retry-hidden', nextStatus: next });
  }
  retry.hidden = hideRetry;
  const stop = element<HTMLButtonElement>('stop-render');
  // Keep the stop operation focusable after activation; aria-disabled avoids losing focus.
  stop.disabled = false;
  stop.setAttribute('aria-disabled', String(next !== 'rendering'));
  syncArtworkControls();
}
function hideImage(message: string): void {
  canvas.style.visibility = 'hidden';
  placeholder.hidden = false;
  placeholder.textContent = message;
}
function controls(): void {
  const startingWork = LIVE_WORKS.find(work => work.id === selectedWorkId);
  element('exhibit').dataset.workId = startingWork?.id ?? '';
  element('live-work-title').textContent = startingWork?.title ?? '読み込んだ作品';
  element('parameter-restore').textContent = startingWork ? '作品の初期状態へ戻す' : '読込時の設定へ戻す';
  for (let i = 0; i < 3; i++) element(`preset-${i}`).setAttribute('aria-pressed', String(i === presetIndex));
  for (const entry of DISPLAY_PALETTES) element(`palette-${entry.id}`).setAttribute('aria-pressed', String(entry.id === palette));
  for (const value of ['preview', 'full']) element(`quality-${value}`).setAttribute('aria-pressed', String(value === quality));
  for (const value of [128,256,512]) element(`iteration-${value}`).setAttribute('aria-pressed', String(value === canonicalView.maxIterations));
  element('requested-settings').textContent = `選択：${presetName(canonicalView)} / ${paletteLabel(palette)} / 確定 ${canonicalView.resolution}²・N${canonicalView.maxIterations}${activePointer || panPointer ? '（操作中は途中像 256²・N128）' : ''}`;
  element('selected-c').textContent = cLabel(canonicalView); element('parameter-applied-c').textContent = cLabel(canonicalView);
  element('selected-viewport').textContent = `${viewportLabel(canonicalView.viewport)} ／N${canonicalView.maxIterations}`;
  const span = viewportSpan(canonicalView.viewport); element('zoom-level').textContent = sameViewport(canonicalView.viewport, INITIAL_PRODUCT_VIEWPORT) ? '全景' : `${Number((3.2/span).toPrecision(3))}×`;
  const zoomReasons:string[]=[];
  for (const [id,direction] of [['zoom-in','in'],['zoom-out','out']] as const) {
    let reason: string | null = null;try { zoomViewport(canonicalView.viewport,direction); } catch(error) { reason=error instanceof Error?error.message:'この拡大段階は選べません'; }
    const button=element<HTMLButtonElement>(id);button.setAttribute('aria-disabled',String(reason!==null));button.title=reason??'';if(reason)zoomReasons.push(reason);
  }
  element('zoom-limit-reason').textContent=zoomReasons.join(' ');
  canvas.setAttribute('aria-label',`Julia像。構図をドラッグまたは矢印で移動。${viewportLabel(canonicalView.viewport)}`);
  updateMarker(); candidateMarker();
  syncArtworkControls();
}
function syncRendererState(): void {
  if (!renderer) return;
  const state=renderer.snapshot();
  settleArtworkWaiters();
  if(route!=='julia'||!studioOpen){hideImage('庭に入ると、選択した条件で景色を描きます。');setStatus('idle','設定を保持しています。庭に入ると描画を再開します。');return;}
  if(inputFailed)return;
  const checked=state.displayedNumerical?validateNumericalSettings(state.displayedNumerical):null;displayedSettings=checked?.mode==='julia'?checked:null;
  displayedRequestId=state.displayedRequestId;displayedEpoch=state.displayedEpoch;displayedStage=state.displayedStage;
  displayedQuality=displayedSettings?.width===768?'full':displayedSettings?'preview':null;
  if(state.displayedView)paintedStyle={palette:state.displayedView.displayPalette,version:ART_DISPLAY_VERSION};
  if(displayedSettings&&displayedSettings.mode==='julia'){
    const identity=`${displayedEpoch}:${displayedRequestId}:${displayedStage}:${JSON.stringify(displayedSettings)}`;
    if(identity!==imageIdentity){numericHash=null;imageIdentity=identity;}
    canvas.dataset.requestId=String(displayedRequestId);canvas.dataset.epoch=String(displayedEpoch);canvas.dataset.quality=displayedQuality??'';canvas.dataset.stage=displayedStage??'';canvas.style.visibility='visible';placeholder.hidden=true;
    const latestId=state.records.at(-1)?.id??null;const current=displayedRequestId===latestId&&sameView(state.displayedView,canonicalView);
    const stage=displayedStage==='final'?'確定像':'途中像';
    const composition = sameViewport(displayedSettings.viewport, INITIAL_PRODUCT_VIEWPORT) ? '全景' : '選んだ構図';
    element('display-settings').textContent = current
      ? `表示中：${composition} ／ ${paletteName()} ／ ${stage}`
      : `前の表示：c = ${cLabel(displayedSettings)} ／ ${paletteName()} ／ ${stage}（範囲と反復上限は描画の設定へ）`;
    element('shown-c').textContent=`${cLabel(displayedSettings)}（${stage}）`;
    element('shown-viewport').textContent=`${viewportLabel(displayedSettings.viewport)} ／実N${displayedSettings.maxIterations}（選択N${canonicalView.maxIterations}）`;
  }else{hideImage(state.status==='error'?'描画を完了できませんでした':state.status==='stopped'?'計算を停止しました':'選択した条件を描いています…');element('display-settings').textContent='選択した条件はまだ未表示です。';element('shown-c').textContent='未表示';element('shown-viewport').textContent='未表示';}
  if(state.status==='rendering')setStatus('rendering',displayedStage==='intermediate'?'途中像を表示中。選択した反復上限・解像度の確定像は計算中です。':'描画中…停止や次の操作を受け付けます。');
  else if(state.status==='displayed')setStatus('displayed',displayedStage==='intermediate'?'離すと選択した条件で仕上げます。':'');
  else if(state.status==='stopped')setStatus('stopped','停止しました。表示済みの画像がある場合は、その条件を下に示しています。再計算で再開できます。');
  else if(state.status==='error')setStatus('render-error','描画を完了できませんでした。「もう一度描く」で再開できます。');
  else setStatus('idle','形や構図を選ぶか、再計算で景色を描けます。');
  scheduleDragDrain();schedulePanDrain();
  rememberStableArtwork();syncArtworkControls();
}
function ensureRenderer(): ProductRenderer {
  if(!renderer)renderer=new ProductRenderer(canvas,{audit:auditEnabled,onChange:syncRendererState,
    viewColorizer:(field,settings,style)=>{const rgba=colorizeArtField(field,settings,style);paintedStyle={palette:style,version:ART_DISPLAY_VERSION};return rgba;}});
  return renderer;
}
function requestCurrent(fresh=false,intermediateOnly=false):number|null {
  inputFailed=false;desiredSettings=toNumericalSettings(canonicalView,'final');controls();
  try{return ensureRenderer().requestView(canonicalView,{fresh,stage:intermediateOnly?'intermediate':'final'});}
  catch(error){inputError(error instanceof Error?error.message:'入力を確認してください');return null;}
}

function inputError(message: string): void {
  inputFailed = true;
  renderer?.stop();
  hideImage('選択を反映できませんでした');
  setStatus('input-error', `${message}。形を選び直すか、もう一度描いてください。`);
  element('display-settings').textContent = '入力を確認しています。前の画像は、新しい条件の結果として表示していません。';
  element('shown-c').textContent = '未表示（入力確認中）';
  event('input-error', { injected: auditEnabled });
}
function stopRendering(): void {
  cancelArtworkImport('読込を中止しました。元の作品設定を保持しています。再計算で表示へ戻れます。');
  finishDrag('stop', false); finishPan('stop', false);
  renderer?.stop();
  event('user-stop');
  syncRendererState();
}
function leaveStudio(): void {
  journeyGeneration++;
  cancelArtworkImport('設定の読込を中止しました。元の作品設定を保持しています。');
  artworkIO?.leave();
  artworkLocalMessage = artworkSaveMessage = '';
  hasImportNotice = false;
  if (saveDialog.open) saveDialog.close();
  finishDrag('gallery-exit', false);
  finishPan('gallery-exit', false);
  renderer?.leave();
  displayedSettings = null;
  displayedRequestId = displayedEpoch = null;
  displayedQuality = displayedStage = null;
  numericHash = null;
  imageIdentity = '';
  hideImage('庭に入ると、選択した条件で景色を描きます。');
  setStatus('idle', '設定を保持しています。庭に入ると描画を再開します。');
}

function updateRoute(focus: boolean): void {
  const previous = route;
  const hash = location.hash;
  route = hash === '#/julia' ? 'julia' : hash === '#/tour' ? 'tour' : 'gallery';
  // A history visit or reload does not start a second unattended lap.
  if (route === 'tour' && !startTourRequested && previous !== 'tour') {
    history.replaceState(null, '', '#/gallery');
    route = 'gallery';
  }
  if (previous === 'tour' && route !== 'tour') tour.stop();
  if (previous === 'julia' && route !== 'julia') leaveStudio();
  element('gallery').hidden = route !== 'gallery';
  element('exhibit').hidden = route !== 'julia';
  element('tour').hidden = route !== 'tour';
  document.body.dataset.museumRoute = route;
  if (route === 'tour') {
    if (startTourRequested) {
      startTourRequested = false;
      tour.start();
    }
    if (focus) element('tour-title').focus({preventScroll:true});
  } else if (route === 'julia') {
    if (incomingScene) {
      const scene = incomingScene;
      incomingScene = null;
      chooseWork(scene.workId, scene.view);
    } else if (restoringEdit) {
      const edit = restoringEdit;
      restoringEdit = null;
      clearSelectedArtwork();
      restoreMetadata(edit.metadata);
      element<HTMLDetailsElement>('parameter-details').open = edit.parameterDetailsOpen;
      requestCurrent(true);
      event('tour-edit-restored');
    } else if (requestedWork || !studioOpen) {
      const id = requestedWork ?? INITIAL_WORK.id;
      requestedWork = null;
      chooseWork(id);
    } else if (previous !== 'julia' || !renderer || status === 'idle') {
      requestCurrent(true);
    }
    if (focus) element('live-work-title').focus({ preventScroll: true });
  } else {
    element('resume-line').hidden = !studioOpen;
    element('resume-label').textContent = element('live-work-title').textContent + (draftPending ? ' ・ 未適用の入力あり' : '');
    if (focus) element(previous === 'tour' ? 'tour-start' : studioOpen ? 'resume-work' : 'work-tide').focus({ preventScroll: true });
  }
  element('restore-edit').hidden = element('gallery-restore-edit').hidden = parkedEdits.length === 0;
  if (focus || route === 'julia') window.scrollTo({ top: 0, behavior: 'instant' });
  event('route', { route });
}

type ParameterOptions = { fresh?: boolean; progressive?: boolean; exactSettings?: Settings; restore?: boolean; issuedAt?: number; previewOnly?: boolean };
function syncDraftInputs(resetPending = true): void {
  if (resetPending) draftPending = false;
  element<HTMLInputElement>('parameter-re').value = draft.re;
  element<HTMLInputElement>('parameter-im').value = draft.im;
}
function rejectParameter(reason: string, source: string, issuedAt = performance.now()): null {
  parameterRejection = reason;
  parameterRejectionKind = reason.startsWith('地図を利用できるまで') ? 'asset' : 'input';
  const target = element('parameter-status');
  target.dataset.state = 'rejected';
  target.textContent = `${reason}。最後の有効なc・要求・画像は保持しています。`;
  event('parameter-rejected', { source, reason, issuedAt, c: { ...appliedC }, revision: parameterRevision });
  return null;
}
/** Every accepted c input reaches this single validation and rendering entry. */
function commitParameter(input: unknown, source: string, options: ParameterOptions = {}): number | null {
  const issuedAt=options.issuedAt??performance.now();let candidate:ParameterC;let next:ProductView;
  try{candidate=validateParameter(input);next=options.restore?cloneProductView(originView):updateProductView(canonicalView,{c:candidate});}
  catch(error){return rejectParameter(error instanceof Error?error.message:'cの入力を確認してください',source,issuedAt);}
  if(!source.startsWith('drag')&&activePointer)finishDrag(`interrupted-${source}`,false);
  if(panPointer)finishPan(`interrupted-${source}`,false);
  assignCanonical(next);if(options.restore){framingRejection=null;element('framing-status').dataset.state='applied';element('framing-status').textContent='選んだ作品の初期状態に戻しました。';}presetIndex=UX_PRESETS.findIndex(p=>p.c.re===appliedC.re&&p.c.im===appliedC.im);
  draft={re:String(appliedC.re),im:String(appliedC.im)};parameterRejection=null;parameterRejectionKind=null;lastParameterSource=source;parameterRevision++;viewRevision++;lastViewSource=source;inputFailed=false;
  syncDraftInputs();controls();const target=element('parameter-status');target.dataset.state='applied';target.textContent=options.restore?'選んだ作品の形・色・構図・反復上限・解像度を初期状態に戻しました。':'このcを適用しました。構図・反復上限・解像度・配色は保持しています。';
  let id:number|null=null;if(route==='julia'&&studioOpen)id=requestCurrent(!!options.fresh,!!options.previewOnly);
  event('parameter-applied',{source,issuedAt,c:{...appliedC},revision:parameterRevision,requestId:id,restore:!!options.restore,view:cloneProductView(canonicalView)});return id;
}

function updateMarker(): void {
  const marker = element('parameter-marker');
  if (parameterMap?.snapshot().status !== 'ready') { marker.hidden = true; return; }
  const mapCanvas = element<HTMLCanvasElement>('parameter-map');
  try {
    const frame = element('parameter-map-frame');
    const point = parameterToClient(appliedC, getContentRect(mapCanvas));
    const bounds = frame.getBoundingClientRect();
    const scaleX = bounds.width / frame.offsetWidth;
    const scaleY = bounds.height / frame.offsetHeight;
    if (!(scaleX > 0 && scaleY > 0)) { marker.hidden = true; return; }
    marker.style.left = `${(point.x - bounds.left) / scaleX - frame.clientLeft}px`;
    marker.style.top = `${(point.y - bounds.top) / scaleY - frame.clientTop}px`;
    marker.hidden = false;
    mapCanvas.setAttribute('aria-label', `固定Mandelbrotパラメータ地図。適用済みc=${cLabel(desiredSettings)}。矢印で移動できます`);
  } catch { marker.hidden = true; } // Hidden Gallery has no CSS coordinate rectangle.
}
function syncMapState(): void {
  const state = parameterMap?.snapshot(); if (!state) return;
  const mapCanvas = element<HTMLCanvasElement>('parameter-map');
  const placeholder = element('parameter-map-placeholder');
  mapCanvas.style.visibility = state.status === 'ready' ? 'visible' : 'hidden';
  mapCanvas.setAttribute('aria-disabled', String(state.status !== 'ready'));
  placeholder.hidden = state.status === 'ready';
  placeholder.textContent = state.status === 'error'
    ? '地図を利用できません。数値入力やプリセットは使用できます。'
    : '固定地図を読み込んでいます…';
  const retryMap = element('parameter-map-retry');
  const retryFocused = document.activeElement === retryMap;
  if (state.status === 'ready' && retryFocused) {
    mapCanvas.focus({ preventScroll: true });
    mapCanvas.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    event('focus-recovery', { target: mapCanvas.id, reason: 'map-retry-completed' });
  }
  // A loading retry stays focusable until it either succeeds or exposes its error again.
  retryMap.hidden = state.status !== 'error' && !(state.status === 'loading' && retryFocused);
  retryMap.setAttribute('aria-disabled', String(state.status === 'loading'));
  element('parameter-map-frame').dataset.state = state.status;
  if (state.status === 'ready' && (element('parameter-status').dataset.state === 'map-error' || parameterRejectionKind === 'asset')) {
    const target = element('parameter-status');
    if (parameterRejectionKind === 'input' && parameterRejection) {
      target.dataset.state = 'rejected'; target.textContent = `${parameterRejection}。最後の有効なc・要求・画像は保持しています。`;
    } else {
      parameterRejection = null; parameterRejectionKind = null;
      target.dataset.state = 'applied'; target.textContent = '地図を利用できます。適用済みcを保持しています。';
    }
  }
  if (state.status === 'error') {
    element('parameter-status').dataset.state = 'map-error';
    element('parameter-status').textContent = `地図の読込・検証に失敗しました。${state.error ?? ''} 最後の有効なcは保持しています。地図を読み直すか、数値入力・プリセットを使ってください。`;
  }
  updateMarker();
}
const observedRenderPeak = {worker:0, active:0, pending:0, timers:0, managedBufferBytes:0};
function baseResourceSnapshot() {
  const r = renderer?.resourceSnapshot();
  const m = parameterMap?.snapshot().resources;
  const zero = { worker: 0, workers: 0, active: 0, pending: 0, timers: 0, managedBufferBytes: 0 };
  const guided = tour.resources();
  const manual = r ?? zero;
  const worker = manual.worker + guided.worker;
  const active = manual.active + guided.active;
  const pending = manual.pending + guided.pending;
  const mapBytes = m?.managedBufferBytes ?? 0;
  const mapTimers = m?.timers ?? 0;
  const mapPeakTimers = (parameterMap?.snapshot().loadCount ?? 0) > 0 ? 1 : 0;
  const peakMapBytes = m?.peakManagedBufferBytes ?? 0;
  const rendererBytes = manual.managedBufferBytes + guided.managedBufferBytes;
  const rendererTimers = manual.timers + guided.timers;
  const combined = {worker, active, pending, timers:rendererTimers, managedBufferBytes:rendererBytes};
  for (const key of Object.keys(combined) as (keyof typeof combined)[]) {
    observedRenderPeak[key] = Math.max(observedRenderPeak[key], r?.max[key] ?? 0, combined[key]);
  }
  return {
    ...manual, worker, workers:worker, active, pending, tourResources:guided,
    timers: rendererTimers + mapTimers, juliaTimers: manual.timers, mapTimers,
    managedBufferBytes: rendererBytes + mapBytes + ART_CACHE_UPPER_BYTES,
    juliaManagedBufferBytes: r?.managedBufferBytes ?? 0, mapManagedBufferBytes: mapBytes,
    mapBaselineBytes: m?.baselineBytes ?? 0,
    max: { ...observedRenderPeak, workers:observedRenderPeak.worker, timers:observedRenderPeak.timers + mapPeakTimers,
      managedBufferBytes: observedRenderPeak.managedBufferBytes + peakMapBytes + ART_CACHE_UPPER_BYTES },
    rawCandidates:Number(dragCandidate!==null)+Number(panCandidate!==null), queuedGestureDrains:Number(dragDrainQueued)+Number(panDrainQueued),
    mapResources: m ?? null, artCacheBudgetBytes: ART_CACHE_UPPER_BYTES, budgetKind: 'Conservative all-six PNG encoded+decoded image cache plus palette LUT; not browser heap measurement',
  };
}
function combinedResourceSnapshot() {
  const base = baseResourceSnapshot(), extra = artworkIO?.snapshot().resources;
  const ioBytes = extra?.managedBufferBytes ?? 0, waiterTimers = artworkWaiters.size, ioTimers = extra?.timers ?? 0;
  return { ...base, timers:base.timers+waiterTimers+ioTimers, artworkWaiterTimers:waiterTimers, managedBufferBytes: base.managedBufferBytes + ioBytes,
    max: { ...base.max, timers:base.max.timers+waiterTimers+ioTimers, managedBufferBytes: base.max.managedBufferBytes + (extra?.peakManagedBufferBytes ?? ioBytes) }, artworkIO: extra ?? null };
}
function settleArtworkWaiters(): void {
  if (!renderer || artworkWaiters.size === 0) return;
  const state = renderer.snapshot();
  for (const [id, waiter] of artworkWaiters) {
    const record = state.records.find(r=>r.id===id);
    if (record?.status === 'running') continue;
    clearTimeout(waiter.timer); artworkWaiters.delete(id);
    if (record?.status === 'displayed' && state.displayedStage === 'final' && state.displayedRequestId === id
      && state.displayedRequestId === state.records.at(-1)?.id && sameView(state.displayedView,canonicalView)) waiter.resolve();
    else waiter.reject(new Error('作品の読込描画は中断されたか、完了できませんでした。'));
  }
}
function waitForArtworkRequest(id:number): Promise<void> {
  if (artworkWaiters.size >= 1) return Promise.reject(new Error('前の読込描画の終了を待ってください。'));
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{artworkWaiters.delete(id);if(renderer?.snapshot().records.at(-1)?.id===id)renderer.stop();reject(new Error('作品の読込描画が5000msを超えました。'));syncArtworkControls();},5000);
    artworkWaiters.set(id,{resolve,reject,timer});settleArtworkWaiters();
  });
}
function cancelArtworkImport(message:string): void {
  const loading = artworkIO?.snapshot().loadStatus;
  const applying = artworkApplying || loading==='applying' || loading==='restoring', backup = importRecovery;
  artworkIO?.interruptImport();
  if (applying) {
    artworkApplySerial++; artworkApplying=false;
    if (backup) restoreMetadata(backup);
    renderer?.stop(); settleArtworkWaiters(); artworkLocalMessage=message;
  }
}
async function applyImportedView(input:ProductView):Promise<void> {
  const token=++artworkApplySerial;artworkApplying=true;artworkLocalMessage='設定候補を描画・照合しています。まだ読込完了ではありません。';
  finishDrag('artwork-import',false);finishPan('artwork-import',false);
  try {
    mutatingForArtworkIO=true;
    try {
      assignCanonical(input);draft={re:String(appliedC.re),im:String(appliedC.im)};syncDraftInputs();inputFailed=false;parameterRejection=null;parameterRejectionKind=null;framingRejection=null;parameterRevision++;lastParameterSource='artwork-import-candidate';
      element('parameter-status').dataset.state='candidate';element('parameter-status').textContent='設定候補のcを反映しています。再計算と照合が終わるまで読込完了ではありません。';element('framing-status').dataset.state='candidate';element('framing-status').textContent='設定候補の構図を描いています。まだ保存対象にはできません。';
      presetIndex=UX_PRESETS.findIndex(p=>p.c.re===appliedC.re&&p.c.im===appliedC.im);studioOpen=true;
      viewRevision++;lastViewSource='artwork-import';
      controls();const injectFailure=failNextArtworkCandidate;failNextArtworkCandidate=false;
      if(injectFailure){ensureRenderer().configureFaults({throwWorker:true});event('artwork-render-failure-injected',{injected:true});}
      const id=requestCurrent(true);if(injectFailure)ensureRenderer().configureFaults({throwWorker:false});
      if(id===null)throw new Error('読込候補を描画できませんでした。');
      mutatingForArtworkIO=false;
      await waitForArtworkRequest(id);
      if(token!==artworkApplySerial)throw new Error('新しい操作により読込候補を取り消しました。');
    } finally {mutatingForArtworkIO=false;}
  } finally {if(token===artworkApplySerial)artworkApplying=false;}
}
async function restorePreviousArtwork(view:ProductView):Promise<void> {
  const token=++artworkApplySerial;artworkApplying=true;artworkLocalMessage='読込を完了できませんでした。前の有効な作品を描き直しています。';
  try {
    const backup=importRecovery??recoveryMetadata(view);restoreMetadata({...backup,view:cloneProductView(view)});
    if(!backup.hadFinalImage){renderer?.stop();hideImage('初期の作品設定を保持しました。再計算して画像を用意できます。');setStatus('stopped','読込を完了できませんでした。初期設定から再計算できます。');return;}
    mutatingForArtworkIO=true;let id:number|null;
    try{id=requestCurrent(true);}finally{mutatingForArtworkIO=false;}
    if(id===null)throw new Error('元の設定を保持しました。明示的な再計算で戻れます。');
    await waitForArtworkRequest(id);
  } finally {if(token===artworkApplySerial)artworkApplying=false;}
}
function captureState(): SaveCaptureState {
  const state = renderer?.snapshot();
  return { canonical: cloneProductView(canonicalView), displayed: state?.displayedView ?? null,
    numerical: state?.displayedNumerical ?? null, requestId: state?.displayedRequestId ?? null,
    latestRequestId: state?.records.at(-1)?.id ?? null, epoch: state?.displayedEpoch ?? null,
    stage: state?.displayedStage ?? null, status, route, studioOpen,
    visible: canvas.style.visibility === 'visible' && route === 'julia' && studioOpen,
    draftApplied: !draftPending, gestureActive: activePointer !== null || panPointer !== null,
    active: state?.resources.active ?? 0, pending: state?.resources.pending ?? 0,
    canvas, workId: selectedWorkId, getField: () => renderer?.numericalSnapshot() ?? null };
}
function recoveryMetadata(view: ProductView): RecoveryMetadata {
  return { view: cloneProductView(view), originView: cloneProductView(originView), workId: selectedWorkId, hadFinalImage:renderer?.snapshot().displayedStage==='final'&&renderer?.snapshot().status==='displayed'&&sameView(renderer?.snapshot().displayedView??null,view), draft: { ...draft }, draftPending,
    disclosures: { explanation: element<HTMLDetailsElement>('explanation').open, displayOptions: element<HTMLDetailsElement>('display-options').open, math: element<HTMLDetailsElement>('math-details').open },
    parameterState:{rejection:parameterRejection,kind:parameterRejectionKind,text:element('parameter-status').textContent??'',state:element('parameter-status').dataset.state??''},framingState:{rejection:framingRejection,text:element('framing-status').textContent??'',state:element('framing-status').dataset.state??''} };
}
function rememberStableArtwork(): void {
  if (artworkApplying || artworkIO?.snapshot().loadStatus==='applying' || artworkIO?.snapshot().loadStatus==='restoring') return;
  const state = renderer?.snapshot();
  if (route === 'julia' && studioOpen && state?.status === 'displayed' && state.displayedStage === 'final'
    && sameView(state.displayedView, canonicalView) && state.displayedRequestId === state.records.at(-1)?.id) lastStableArtwork = recoveryMetadata(canonicalView);
}
function restoreMetadata(meta: RecoveryMetadata): void {
  const wasMutating = mutatingForArtworkIO; mutatingForArtworkIO = true;
  try {
    assignCanonical(meta.view); selectedWorkId = meta.workId; originView = cloneProductView(meta.originView); draft = { ...meta.draft }; draftPending = meta.draftPending;
    syncDraftInputs(false); element<HTMLDetailsElement>('explanation').open = meta.disclosures.explanation;
    element<HTMLDetailsElement>('display-options').open = meta.disclosures.displayOptions; element<HTMLDetailsElement>('math-details').open = meta.disclosures.math;
    parameterRejection=meta.parameterState.rejection;parameterRejectionKind=meta.parameterState.kind;element('parameter-status').textContent=meta.parameterState.text;element('parameter-status').dataset.state=meta.parameterState.state;
    framingRejection=meta.framingState.rejection;element('framing-status').textContent=meta.framingState.text;element('framing-status').dataset.state=meta.framingState.state;parameterRevision++;viewRevision++;lastParameterSource='artwork-rollback';lastViewSource='artwork-rollback';
    presetIndex = UX_PRESETS.findIndex(p=>p.c.re===appliedC.re&&p.c.im===appliedC.im); controls();
  } finally { mutatingForArtworkIO = wasMutating; }
}
function syncArtworkControls(): void {
  if (!artworkIO) return;
  element('draft-notice').hidden = !draftPending;
  const io = artworkIO.snapshot(), gate = artworkIO.canCapture(), saved = io.saved;
  const work = LIVE_WORKS.find(item => item.id === selectedWorkId);
  element('live-work-title').textContent = io.loadStatus === 'applying' ? '設定を読み込み中' : work?.title ?? '読み込んだ作品';
  const busySave = io.saveStatus === 'capturing' || io.saveStatus === 'encoding';
  element('save-entry').textContent = saved ? '保存対象を開く' : busySave ? '画像を用意しています' : '作品を保存';
  element('save-entry').setAttribute('aria-disabled', String(!saved && !busySave && !gate.allowed));
  element('save-eligibility').textContent = gate.allowed || busySave ? '' : gate.reason;
  const retainedOtherView = saved !== null && !sameView(saved.view, canonicalView);
  const note = element('saved-target-note');
  note.hidden = !retainedOtherView;
  note.textContent = retainedOtherView ? '先ほど選んだ一枚を保持しています。' : '';

  // Describe the immutable pair, including after the visitor has edited the live work.
  if (saved) {
    const source = LIVE_WORKS.find(item => item.id === saved.workId);
    const title = source?.title ?? '読み込んだ作品';
    const composition = sameViewport(saved.view.viewport, INITIAL_PRODUCT_VIEWPORT) ? '全景' : '選んだ構図';
    const side = saved.view.resolution;
    element('save-settings').textContent = `${title} · ${composition} · ${paletteLabel(saved.view.displayPalette)}\n${side} × ${side} px　反復上限 ${saved.view.maxIterations}`;
  } else {
    element('save-settings').textContent = '';
  }
  element('save-target-note').textContent = retainedOtherView
    ? '編集中の設定が変わりました。ここで取得するのは、先ほど選んだ一枚です。' : '';
  element('save-status').textContent = busySave ? '画像と設定を用意しています…' : artworkSaveMessage;
  for (const id of ['save-png','save-json']) element<HTMLButtonElement>(id).disabled = !saved || io.saveStatus !== 'ready';
  element('save-capture').setAttribute('aria-disabled',String(!gate.allowed || busySave));
  element('save-capture-reason').textContent = !busySave && saved ? gate.reason : '';
  element<HTMLButtonElement>('save-release').disabled = !saved && !busySave;
  const loading = io.loadStatus === 'reading' || io.loadStatus === 'applying' || io.loadStatus === 'restoring';
  element('load-cancel').hidden = !loading;
  const loadLabels:Record<string,string>={idle:'',reading:'設定ファイルを確認しています…',applying:'設定候補を再計算・照合しています。まだ読込完了ではありません。',restoring:'読込を完了できず、前の有効な作品へ戻しています。',applied:'読み込んだ作品から編集しています。',cancelled:'設定の読込を取り消しました。新しい操作を優先します。',rejected:'設定ファイルを受け入れられませんでした。最後の有効な作品を保持しています。',error:'読込を完了できませんでした。保持した設定から再計算できます。'};
  element('load-state').textContent = artworkLocalMessage || (hasImportNotice ? loadLabels[io.loadStatus] : '');
}
function parameterSnapshot() {
  let rect: ReturnType<typeof getContentRect> | null = null;
  let client: ReturnType<typeof parameterToClient> | null = null;
  let actualMarkerCenter: { x: number; y: number } | null = null;
  try {
    rect = getContentRect(element('parameter-map'));
    client = parameterToClient(appliedC, rect);
    const bounds = element('parameter-marker').getBoundingClientRect();
    if (!element('parameter-marker').hidden) actualMarkerCenter = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  } catch { /* Gallery/failed assets have no interactive content box. */ }
  return { c: { ...appliedC }, draft: { ...draft }, revision: parameterRevision, source: lastParameterSource,
    rejection: parameterRejection, unit: toUnit(appliedC), contentRect: rect, markerClient: client, actualMarkerCenter,
    map: parameterMap?.snapshot() ?? null, resources: combinedResourceSnapshot() };
}
const mapCanvas = element<HTMLCanvasElement>('parameter-map');
type DragCandidate = { c: ParameterC; issuedAt: number; source: string; serial: number };
let activePointer: { id: number; kind: string; startedAt: number; moved: boolean } | null = null;
let dragCandidate: DragCandidate | null = null;
let candidateSerial = 0;
let dragDrainQueued = false;
let dragSession = 0;
let compatibilityClick: { pointerId: number; x: number; y: number; at: number } | null = null;
function dragSnapshot() { return { active: activePointer ? { ...activePointer } : null, candidate: dragCandidate ? { ...dragCandidate, c: { ...dragCandidate.c } } : null, session: dragSession, drainQueued: dragDrainQueued, selectedQuality: quality, effectiveQuality: renderer?.snapshot().displayedStage??null, selectedN: canonicalView.maxIterations, selectedResolution: canonicalView.resolution }; }
function candidateMarker(): void {
  const marker = element('parameter-candidate-marker'), text = element('parameter-pending');
  if (!activePointer || !dragCandidate || parameterMap?.snapshot().status !== 'ready') { marker.hidden = true; text.hidden = true; return; }
  try {
    const point = parameterToClient(dragCandidate.c, getContentRect(mapCanvas)), frame = element('parameter-map-frame'), bounds = frame.getBoundingClientRect();
    marker.style.left = `${(point.x - bounds.left) / (bounds.width / frame.offsetWidth) - frame.clientLeft}px`;
    marker.style.top = `${(point.y - bounds.top) / (bounds.height / frame.offsetHeight) - frame.clientTop}px`;
    marker.hidden = false; text.hidden = false;
    text.textContent = `指先の候補：${dragCandidate.c.re} ${dragCandidate.c.im < 0 ? '−' : '+'} ${Math.abs(dragCandidate.c.im)}i。次のプレビューへ反映します。`;
  } catch { marker.hidden = true; text.hidden = true; }
}
function scheduleDragDrain(): void {
  if (!activePointer || !dragCandidate || dragDrainQueued || route !== 'julia' || !studioOpen) return;
  const state = renderer?.snapshot();
  if (state?.status === 'rendering' || state?.active) return;
  dragDrainQueued = true;
  queueMicrotask(() => {
    dragDrainQueued = false;
    if (!activePointer || !dragCandidate || route !== 'julia' || !studioOpen) return;
    const state = renderer?.snapshot();
    if (state?.status === 'rendering' || state?.active) return;
    const next = dragCandidate; dragCandidate = null; candidateMarker();
    event('drag-canonical', { session: dragSession, serial: next.serial, c: next.c, issuedAt: next.issuedAt });
    commitParameter(next.c, 'drag-preview', { previewOnly: true, issuedAt: next.issuedAt });
  });
}
function offerPointer(x: number, y: number, source: string, issuedAt: number): ParameterC | null {
  if (parameterMap?.snapshot().status !== 'ready') { rejectParameter('地図を利用できるまで選択できません', source, issuedAt); return null; }
  try {
    const c = pointerToParameter(x, y, getContentRect(mapCanvas));
    dragCandidate = { c, issuedAt, source, serial: ++candidateSerial };
    event('drag-candidate', { session: dragSession, ...dragCandidate }); candidateMarker(); scheduleDragDrain(); return c;
  } catch (error) {
    dragCandidate = null; candidateMarker();
    rejectParameter(error instanceof Error ? error.message : '地図内の点を選んでください', source, issuedAt); return null;
  }
}
function finishDrag(reason: string, renderFinal = true, final?: { x: number; y: number; at: number }): void {
  const pointer = activePointer; if (!pointer) return;
  let candidate: ParameterC | null = null;
  if (final) {
    try { candidate = pointerToParameter(final.x, final.y, getContentRect(mapCanvas)); }
    catch (error) { rejectParameter(error instanceof Error ? error.message : '地図内の点を選んでください', 'drag-end', final.at); }
  }
  activePointer = null; dragCandidate = null; dragDrainQueued = false; candidateMarker();
  try { if (mapCanvas.hasPointerCapture(pointer.id)) mapCanvas.releasePointerCapture(pointer.id); } catch { /* Synthetic pointer has no capture. */ }
  event('drag-end', { session: dragSession, reason, pointerId: pointer.id, c: candidate ?? { ...appliedC }, renderFinal, issuedAt: final?.at ?? performance.now() });
  if (renderFinal && route === 'julia' && studioOpen) {
    if (candidate === null && parameterRejection) {
      // Finish the last valid numerical state without erasing the invalid-operation reason.
      requestCurrent();
    } else {
      commitParameter(candidate ?? appliedC, pointer.moved ? 'drag-final' : pointer.kind === 'touch' ? 'tap' : 'click', { issuedAt: final?.at ?? performance.now() });
    }
  }
}
mapCanvas.addEventListener('pointerdown', e => {
  if (e.button !== 0 || !e.isPrimary || route !== 'julia' || !studioOpen) return;
  finishDrag('replaced', false); finishPan('c-map',false);
  interruptArtworkForEdit();
  activePointer = { id: e.pointerId, kind: e.pointerType, startedAt: performance.now(), moved: false }; dragSession++;
  compatibilityClick = null; mapCanvas.focus({ preventScroll: true });
  try { mapCanvas.setPointerCapture(e.pointerId); } catch { /* Synthetic events have no native active pointer. */ }
  event('drag-start', { session: dragSession, pointerId: e.pointerId });
  offerPointer(e.clientX, e.clientY, 'drag-start', performance.now());
});
mapCanvas.addEventListener('pointermove', e => {
  if (!activePointer || activePointer.id !== e.pointerId) return;
  if (e.buttons === 0) { finishDrag('buttons-release'); return; }
  activePointer.moved = true;
  offerPointer(e.clientX, e.clientY, 'drag-move', performance.now());
});
mapCanvas.addEventListener('pointerup', e => {
  if (!activePointer || e.pointerId !== activePointer.id || e.button !== 0) return;
  compatibilityClick = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, at: e.timeStamp };
  finishDrag('pointerup', true, { x: e.clientX, y: e.clientY, at: performance.now() });
});
mapCanvas.addEventListener('pointercancel', () => finishDrag('pointercancel'));
mapCanvas.addEventListener('lostpointercapture', () => finishDrag('lostpointercapture'));
window.addEventListener('pointerup', e => { if (activePointer?.id === e.pointerId) finishDrag('outside-release', true, { x: e.clientX, y: e.clientY, at: performance.now() }); });
window.addEventListener('blur', () => finishDrag('window-blur'));
mapCanvas.addEventListener('click', e => {
  const previous = compatibilityClick; compatibilityClick = null;
  const samePointer = (e as PointerEvent).pointerId === previous?.pointerId;
  const legacyCompatibilityPoint = previous && Math.abs(e.clientX - previous.x) <= 1 && Math.abs(e.clientY - previous.y) <= 1;
  if (previous && (samePointer || legacyCompatibilityPoint) && e.timeStamp >= previous.at && e.timeStamp - previous.at < 1000) return;
  try { commitParameter(pointerToParameter(e.clientX, e.clientY, getContentRect(mapCanvas)), 'click', { issuedAt: performance.now() }); }
  catch (error) { rejectParameter(error instanceof Error ? error.message : '地図内の点を選んでください', 'click'); }
});
mapCanvas.addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const issuedAt = performance.now();
  if (parameterMap?.snapshot().status !== 'ready') { rejectParameter('地図を利用できるまで矢印選択はできません', 'keyboard', issuedAt); return; }
  try { commitParameter(arrowParameter(appliedC, e.key, e.shiftKey), 'keyboard', { issuedAt }); }
  catch (error) { rejectParameter(error instanceof Error ? error.message : 'この方向には移動できません', 'keyboard', issuedAt); }
});
for (const component of ['re', 'im'] as const) element<HTMLInputElement>(`parameter-${component}`).addEventListener('input', e => {
  draft = { ...draft, [component]: (e.target as HTMLInputElement).value };
  draftPending = true; interruptArtworkForEdit(); syncArtworkControls();
  event('parameter-draft', { component, draft: { ...draft }, revision: parameterRevision });
});
element('parameter-form').addEventListener('submit', e => {
  e.preventDefault(); const issuedAt = performance.now();
  try { commitParameter(parseParameterDraft(draft.re, draft.im), 'numeric', { issuedAt }); }
  catch (error) { rejectParameter(error instanceof Error ? error.message : '数値を入力してください', 'numeric', issuedAt); }
});
element('parameter-restore').addEventListener('click', () => commitParameter(originView.c, 'restore', {restore: true}));
element('parameter-map-retry').addEventListener('click', () => { if (parameterMap?.snapshot().status === 'error') void parameterMap.retry(); });
const mapResizeObserver = new ResizeObserver(() => updateMarker());

window.addEventListener('resize', updateMarker);

type PanCandidate = { viewport: NumericViewport; issuedAt: number; serial: number };
let panPointer: { id: number; start: {x:number;y:number}; viewport: NumericViewport; startedAt:number } | null = null;
let panCandidate: PanCandidate | null = null;
let panDrainQueued = false;
let panSerial = 0;
let panSession = 0;
function panSnapshot() { return { active:panPointer?{...panPointer,start:{...panPointer.start},viewport:{...panPointer.viewport}}:null,candidate:panCandidate?{...panCandidate,viewport:{...panCandidate.viewport}}:null,drainQueued:panDrainQueued,session:panSession }; }
function rejectFraming(reason:string,source:string,issuedAt=performance.now()):null {
  framingRejection=reason;const target=element('framing-status');target.dataset.state='rejected';target.textContent=`${reason}。最後の有効な構図と表示条件を保持しています。`;
  event('framing-rejected',{source,reason,issuedAt,view:cloneProductView(canonicalView),revision:viewRevision});return null;
}
function commitViewport(input:NumericViewport,source:string,options:{issuedAt?:number;intermediateOnly?:boolean;preserveReason?:boolean}={}):number|null {
  const issuedAt=options.issuedAt??performance.now();let next:ProductView;
  try{next=updateProductView(canonicalView,{viewport:input});}catch(error){return rejectFraming(error instanceof Error?error.message:'構図の範囲を確認してください',source,issuedAt);}
  if(activePointer)finishDrag(`interrupted-${source}`,false);
  assignCanonical(next);viewRevision++;lastViewSource=source;
  if(!options.preserveReason){framingRejection=null;element('framing-status').dataset.state='applied';element('framing-status').textContent=source==='composition-reset'?'構図を全景へ戻しました。形・色・反復上限・解像度は保持しています。':'構図だけを変更しました。形・色・反復上限・解像度は保持しています。';}
  const id=route==='julia'&&studioOpen?requestCurrent(false,!!options.intermediateOnly):null;controls();
  event('view-applied',{source,issuedAt,view:cloneProductView(canonicalView),revision:viewRevision,requestId:id,stage:options.intermediateOnly?'intermediate':'final'});return id;
}
function schedulePanDrain():void {
  if(!panPointer||!panCandidate||panDrainQueued||route!=='julia'||!studioOpen)return;
  const state=renderer?.snapshot();if(state?.status==='rendering'||state?.active)return;
  panDrainQueued=true;queueMicrotask(()=>{panDrainQueued=false;if(!panPointer||!panCandidate||route!=='julia'||!studioOpen)return;const state=renderer?.snapshot();if(state?.status==='rendering'||state?.active)return;const next=panCandidate;panCandidate=null;event('pan-canonical',{session:panSession,serial:next.serial,viewport:next.viewport,issuedAt:next.issuedAt});commitViewport(next.viewport,'pan-intermediate',{issuedAt:next.issuedAt,intermediateOnly:true});});
}
function panCandidateAt(x:number,y:number):NumericViewport {
  if(!panPointer)throw new Error('構図の操作を始めてください');const rect=getContentRect(canvas);
  if(x<rect.left||x>rect.left+rect.width||y<rect.top||y>rect.top+rect.height)throw new Error('像の外側では構図を変更しません');
  return panFromDrag(panPointer.viewport,panPointer.start,{x,y},rect);
}
function offerPan(x:number,y:number,issuedAt:number):void {
  try{panCandidate={viewport:panCandidateAt(x,y),issuedAt,serial:++panSerial};event('pan-candidate',{session:panSession,...panCandidate});schedulePanDrain();}
  catch(error){panCandidate=null;rejectFraming(error instanceof Error?error.message:'構図の範囲を確認してください','pan-candidate',issuedAt);}
}
function finishPan(reason:string,renderFinal=true,final?:{x:number;y:number;at:number}):void {
  const pointer=panPointer;if(!pointer)return;let target:NumericViewport|null=null;
  if(final){try{target=panCandidateAt(final.x,final.y);}catch(error){rejectFraming(error instanceof Error?error.message:'像の内側を選んでください','pan-end',final.at);}}
  panPointer=null;panCandidate=null;panDrainQueued=false;
  try{if(canvas.hasPointerCapture(pointer.id))canvas.releasePointerCapture(pointer.id);}catch{/* Synthetic pointer has no native capture. */}
  event('pan-end',{session:panSession,reason,pointerId:pointer.id,renderFinal,viewport:target??{...canonicalView.viewport},issuedAt:final?.at??performance.now()});
  if(renderFinal&&route==='julia'&&studioOpen)commitViewport(target??canonicalView.viewport,'pan-final',{issuedAt:final?.at??performance.now(),preserveReason:target===null&&framingRejection!==null});
}
canvas.addEventListener('pointerdown',e=>{
  if(e.button!==0||!e.isPrimary||route!=='julia'||!studioOpen||!displayedSettings)return;
  if(!sameViewport(displayedSettings.viewport,canonicalView.viewport)){rejectFraming('新しい構図を描いています。表示された構図から移動できます','pan-start');return;}
  interruptArtworkForEdit();
  finishDrag('julia-pan',false);finishPan('replaced',false);canvas.focus({preventScroll:true});
  panPointer={id:e.pointerId,start:{x:e.clientX,y:e.clientY},viewport:{...canonicalView.viewport},startedAt:performance.now()};panSession++;
  try{canvas.setPointerCapture(e.pointerId);}catch{/* Synthetic pointer has no native capture. */}
  event('pan-start',{session:panSession,pointerId:e.pointerId,view:cloneProductView(canonicalView)});offerPan(e.clientX,e.clientY,performance.now());
});
canvas.addEventListener('pointermove',e=>{if(panPointer?.id!==e.pointerId)return;if(e.buttons===0){finishPan('buttons-release');return;}offerPan(e.clientX,e.clientY,performance.now());});
canvas.addEventListener('pointerup',e=>{if(panPointer?.id===e.pointerId&&e.button===0)finishPan('pointerup',true,{x:e.clientX,y:e.clientY,at:performance.now()});});
canvas.addEventListener('pointercancel',()=>finishPan('pointercancel'));
canvas.addEventListener('lostpointercapture',()=>finishPan('lostpointercapture'));
window.addEventListener('pointerup',e=>{if(panPointer?.id===e.pointerId)finishPan('outside-release',true,{x:e.clientX,y:e.clientY,at:performance.now()});});
window.addEventListener('blur',()=>finishPan('window-blur'));
function panStep(re:number,im:number,source:string):void {
  finishDrag(source,false);finishPan(source,false);
  try{commitViewport(panByFraction(canonicalView.viewport,re,im),source);}catch(error){rejectFraming(error instanceof Error?error.message:'この方向へは移動できません',source);}
}
for(const [id,re,im]of [['pan-left',-1/8,0],['pan-right',1/8,0],['pan-up',0,1/8],['pan-down',0,-1/8]] as const)element(id).addEventListener('click',()=>panStep(re,im,id));
canvas.addEventListener('keydown',e=>{const move:Record<string,[number,number]>={ArrowLeft:[-1/8,0],ArrowRight:[1/8,0],ArrowUp:[0,1/8],ArrowDown:[0,-1/8]};const value=move[e.key];if(!value)return;e.preventDefault();panStep(value[0],value[1],'pan-keyboard');});
for(const [id,direction]of [['zoom-in','in'],['zoom-out','out']] as const)element(id).addEventListener('click',()=>{
  const issuedAt=performance.now();finishDrag('zoom',false);finishPan('zoom',false);try{commitViewport(zoomViewport(canonicalView.viewport,direction),'zoom-'+direction,{issuedAt});}catch(error){rejectFraming(error instanceof Error?error.message:'この拡大段階は選べません','zoom-'+direction,issuedAt);}
});
element('reset-composition').addEventListener('click',()=>{finishDrag('composition-reset',false);finishPan('composition-reset',false);commitViewport(restoreProductComposition(canonicalView).viewport,'composition-reset');});

function clearSelectedArtwork(): void {
  journeyGeneration++;
  cancelArtworkImport('作品を切り替えたため、設定の読込を中止しました。');
  artworkIO?.leave();
  artworkLocalMessage = artworkSaveMessage = '';
  hasImportNotice = false;
  lastStableArtwork = importRecovery = null;
  finishDrag('work-selection', false);
  finishPan('work-selection', false);
  renderer?.leave();
}

function chooseWork(id: string, initialView?: ProductView): number | null {
  const work = LIVE_WORKS.find(w => w.id === id);
  if (!work) throw new Error('Unknown work');
  clearSelectedArtwork();
  selectedWorkId = work.id;
  originView = defaultWorkView(work.id);
  assignCanonical(initialView ?? originView);
  studioOpen = true;
  framingRejection = null;
  element('framing-status').dataset.state = 'applied';
  element('framing-status').textContent = '';
  const requestId = commitParameter(canonicalView.c, 'work-selection');
  event('work-selection', { workId: id, requestId, palette, quality, c: { ...canonicalView.c } });
  return requestId;
}

function enterStudio(work: LiveWorkId | null): void {
  requestedWork = work;
  history.pushState(null, '', '#/julia');
  updateRoute(true);
}

const tour = new GuidedTour(element<HTMLCanvasElement>('tour-canvas'), state => {
  if (route === 'tour') updateTourControls(state, studioOpen);
}, {audit:auditEnabled});

element('tour-start').addEventListener('click', () => {
  if (route !== 'gallery') return;
  startTourRequested = true;
  history.pushState({tourFromGallery:true}, '', '#/tour');
  updateRoute(true);
});
element('tour-pause').addEventListener('click', () => {
  const {status} = tour.snapshot();
  if (status === 'paused' || status === 'error') tour.resume();
  else tour.pause();
});
element('tour-replay').addEventListener('click', () => {
  tour.start();
  element('tour-pause').focus({preventScroll:true});
});
element('tour-exit').addEventListener('click', () => {
  if (route !== 'tour') return;
  if (history.state?.tourFromGallery) history.back();
  else {
    history.replaceState(null, '', '#/gallery');
    updateRoute(true);
  }
});
function openEditorFromTour(): void {
  history.replaceState(null, '', '#/julia');
  updateRoute(true);
}
element('tour-return').addEventListener('click', () => {
  if (route === 'tour' && studioOpen) openEditorFromTour();
});
element('tour-takeover').addEventListener('click', () => {
  const frame = tour.snapshot().displayed;
  if (route !== 'tour' || !frame) return;
  if (studioOpen) parkedEdits.push({metadata:recoveryMetadata(canonicalView),
    parameterDetailsOpen:element<HTMLDetailsElement>('parameter-details').open});
  incomingScene = {workId:frame.workId,view:cloneProductView(frame.view)};
  openEditorFromTour();
});
function restoreParkedEdit(): void {
  const edit = parkedEdits.pop();
  if (!edit) return;
  restoringEdit = edit;
  if (route === 'gallery') enterStudio(null);
  else updateRoute(true);
}
element('restore-edit').addEventListener('click', restoreParkedEdit);
element('gallery-restore-edit').addEventListener('click', restoreParkedEdit);

for (const work of LIVE_WORKS) {
  const choice = element(`work-${work.id}`);
  choice.addEventListener('click', () => enterStudio(work.id));
  const image = choice.querySelector('img')!;
  const errorNote = element(`work-image-error-${work.id}`);
  const retry = element(`work-image-retry-${work.id}`);
  const imageFailed = () => { errorNote.hidden = false; image.style.visibility = 'hidden'; };
  image.addEventListener('error', imageFailed);
  image.addEventListener('load', () => {
    if (document.activeElement === retry) choice.focus({preventScroll:true});
    errorNote.hidden = true;
    image.style.visibility = 'visible';
  });
  if (image.complete && image.naturalWidth === 0) imageFailed();
  retry.addEventListener('click', () => { image.src = work.image; });
}
element('resume-work').addEventListener('click', () => enterStudio(null));
for (let i = 0; i < 3; i++) element(`preset-${i}`).addEventListener('click', () => { commitParameter(UX_PRESETS[i]!.c, 'preset'); });
for (const entry of DISPLAY_PALETTES) element(`palette-${entry.id}`).addEventListener('click',()=>{
  const value = entry.id;
  finishDrag('palette-change',false);finishPan('palette-change',false);assignCanonical(updateProductView(canonicalView,{displayPalette:value}));viewRevision++;lastViewSource='palette';renderer?.repaintViewPalette(value);controls();event('display-palette',{palette,displayVersion:ART_DISPLAY_VERSION,view:cloneProductView(canonicalView)});
});
for(const value of ['preview','full'] as const)element(`quality-${value}`).addEventListener('click',()=>{
  finishDrag('resolution-change',false);finishPan('resolution-change',false);assignCanonical(updateProductView(canonicalView,{resolution:value==='full'?768:256}));viewRevision++;lastViewSource='resolution';requestCurrent();event('resolution-selection',{view:cloneProductView(canonicalView)});
});
for(const value of [128,256,512] as const)element(`iteration-${value}`).addEventListener('click',()=>{
  finishDrag('iteration-change',false);finishPan('iteration-change',false);assignCanonical(updateProductView(canonicalView,{maxIterations:value}));viewRevision++;lastViewSource='iterations';requestCurrent();event('iteration-selection',{view:cloneProductView(canonicalView)});
});
element('stop-render').addEventListener('click', () => { if (status === 'rendering') stopRendering(); });
element('recalculate').addEventListener('click', () => { interruptArtworkForEdit(); finishDrag('recalculate', false); finishPan('recalculate',false); requestCurrent(true); });
element('retry').addEventListener('click', () => { interruptArtworkForEdit(); finishDrag('retry', false); finishPan('retry',false); requestCurrent(true); });
// Artwork save/load handlers are installed below after all gesture state exists.
document.querySelector<HTMLAnchorElement>('.skip-link')!.addEventListener('click', (event) => {
  event.preventDefault();
  element('main-content').focus({ preventScroll: true });
  element('main-content').scrollIntoView({ block: 'start', behavior: 'instant' });
});
window.addEventListener('hashchange', () => updateRoute(true));
let editorStoppedBeforeCache = false;
window.addEventListener('pagehide', event => {
  editorStoppedBeforeCache = route === 'julia' && status === 'stopped';
  if (event.persisted) tour.pause();
  else tour.dispose();
  journeyGeneration++;
  cancelArtworkImport('画面を閉じたため、設定の読込を中止しました。');
  artworkIO?.leave();
  finishDrag('pagehide', false);
  finishPan('pagehide', false);
  renderer?.dispose();
  renderer = null;
  parameterMap?.dispose();
  parameterMap = null;
  mapResizeObserver.disconnect();
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  // The browser preserved the document and the draft. Its released Worker and map need a fresh session.
  openParameterMap();
  if (route === 'julia' && studioOpen) {
    if (editorStoppedBeforeCache) setStatus('stopped', '計算を停止しています。再計算すると構図を表示します。');
    else requestCurrent(true);
  }
});
artworkIO = new ArtworkIOController({
  audit: auditEnabled,
  getCaptureState: captureState,
  getBaseResources: baseResourceSnapshot,
  getRecoveryView: () => {
    rememberStableArtwork();
    const old=lastStableArtwork??recoveryMetadata(canonicalView);
    importRecovery=old?{...old,view:cloneProductView(old.view),draft:{...old.draft},disclosures:{...old.disclosures},parameterState:{...old.parameterState},framingState:{...old.framingState}}:null;
    return importRecovery?cloneProductView(importRecovery.view):null;
  },
  applyCandidate: applyImportedView,
  restorePrevious: restorePreviousArtwork,
  onChange: () => {syncArtworkControls();}
});
async function takeArtworkSnapshot():Promise<void> {
  const routeVersion = journeyGeneration;
  const revision = ++captureNoticeRevision;
  artworkSaveMessage = '';
  try {
    await artworkIO!.capture();
  } catch (error) {
    if (routeVersion !== journeyGeneration || revision !== captureNoticeRevision) return;
    artworkSaveMessage = error instanceof Error ? error.message : 'この表示から画像を用意できませんでした。';
  }
  syncArtworkControls();
}
element('save-entry').addEventListener('click',()=>{
  const io=artworkIO!.snapshot(),pending=io.saveStatus==='capturing'||io.saveStatus==='encoding';
  if(!io.saved&&!pending)void takeArtworkSnapshot();
  if(!saveDialog.open)saveDialog.showModal();element('save-close').focus();syncArtworkControls();
});
element('save-capture').addEventListener('click',()=>{
  if(artworkIO!.canCapture().allowed)void takeArtworkSnapshot();else syncArtworkControls();
});
for(const kind of ['png','json'] as const)element(`save-${kind}`).addEventListener('click',()=>{
  try{artworkIO!.download(kind);artworkSaveMessage=`${kind==='png'?'PNG画像':'設定JSON'}の取得を開始しました。端末での保存先はブラウザで確認してください。`;}catch(error){artworkSaveMessage=error instanceof Error?error.message:'取得を開始できませんでした。';}
  syncArtworkControls();
});
element('save-release').addEventListener('click',()=>{captureNoticeRevision++;artworkIO!.clearSnapshot();artworkSaveMessage='保存対象を解放しました。今の確定表示から作り直せます。';syncArtworkControls();});
element('save-close').addEventListener('click',()=>saveDialog.close());
saveDialog.addEventListener('close',()=>{if(route==='julia')element('save-entry').focus({preventScroll:true});});
const artworkInput=element<HTMLInputElement>('artwork-file');
element('load-entry').addEventListener('click',()=>{
  cancelArtworkImport('前の読込を中止しました。');hasImportNotice=true;artworkInput.value='';artworkInput.click();
});
element('load-cancel').addEventListener('click',()=>{
  cancelArtworkImport('読込を中止しました。元の作品設定を保持しています。');artworkIO!.cancelImport();syncArtworkControls();element('load-entry').focus({preventScroll:true});
});
artworkInput.addEventListener('cancel',()=>{artworkLocalMessage='';hasImportNotice=true;artworkIO!.cancelImport();syncArtworkControls();});
artworkInput.addEventListener('change',()=>{
  const file=artworkInput.files?.[0];if(!file){artworkIO!.cancelImport();syncArtworkControls();return;}
  artworkLocalMessage='';
  hasImportNotice = true;
  const generation = journeyGeneration;
  void artworkIO!.importFile(file).then(result=>{
    if (generation !== journeyGeneration) return;
    if(result.status==='applied'){artworkLocalMessage='設定を読み込み、同じ構図の確定像を再計算しました。';parameterRejection=null;parameterRejectionKind=null;framingRejection=null;element('parameter-status').dataset.state='applied';element('parameter-status').textContent='設定JSONのcを反映しました。構図・反復上限・解像度・配色も保存時の値です。';element('framing-status').dataset.state='applied';element('framing-status').textContent='保存時の構図を再計算しました。構図を戻す操作はviewportだけを全景へ戻します。';const referenced=LIVE_WORKS.find(w=>w.id===result.artifact?.reference.workId);selectedWorkId=result.artifact?.reference.workId ?? null;originView=referenced ? defaultWorkView(referenced.id) : cloneProductView(canonicalView);controls();rememberStableArtwork();if(route==='julia'){element('live-work-title').setAttribute('tabindex','-1');element('live-work-title').focus({preventScroll:true});element('live-work-title').scrollIntoView({block:'nearest',behavior:'instant'});}}
    else if(result.status==='rejected'||result.status==='error'){artworkLocalMessage=result.message??artworkIO!.snapshot().message;if(route==='julia')element('load-entry').focus({preventScroll:true});}
    syncArtworkControls();
  }).catch(error=>{if (generation!==journeyGeneration) return;artworkLocalMessage=error instanceof Error?error.message:'読込を完了できませんでした。元の作品を再計算できます。';syncArtworkControls();});
});
function openParameterMap(): void {
  parameterMap = new ParameterMap(mapCanvas, {onChange:syncMapState});
  mapResizeObserver.observe(mapCanvas);
  void parameterMap.load();
}
syncDraftInputs();
openParameterMap();
controls();
hideImage('庭に入ると、ここに景色が生まれます。');
updateRoute(false);
