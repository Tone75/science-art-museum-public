import { makeSettings, validateSettings } from '../config.ts';
import type { Settings, PaletteId } from '../config.ts';
import type { NumericalSettings } from '../numerics/contract.ts';
import { fromLegacySettings } from '../numerics/legacy.ts';
import { colorizeNumericalField } from '../numerics/palette.ts';
import { UNESCAPED } from '../numerics/engine.ts';
import { assertBufferBudget, BUFFER_BUDGET_BYTES, CANCEL_CONFIRMATION_MS, WATCHDOG_MS, PRODUCT_RENDERER_VERSION, juliaSettings, numericKey, validIdentity } from './kernel.ts';
import type { FaultOptions, WorkerResponse, CalculateCommand, Identity } from './kernel.ts';
import { validateProductView, cloneProductView, toNumericalSettings, type ProductView, type ViewStage, type JuliaNumericalSettings } from '../framing/contract.ts';
import { colorizeArtField, legacyBasePalette, validateDisplayPalette, type DisplayPaletteId } from '../art/palette.ts';

export type ProductStatus = 'idle' | 'rendering' | 'displayed' | 'stopped' | 'error' | 'left';
export type Stage = 'preview' | 'full' | 'inspection' | ViewStage;
type StageRecord = { jobId: number; stage: Stage; numericKey: string; requestedAt: number; startedAt: number | null; firstProgressAt: number | null; completedAt: number | null; paintedAt: number | null; displayedAt: number | null; cancelRequestedAt: number | null; cancelledAt: number | null; rowsCompleted: number; status: string };
export type RequestRecord = { id: number; epoch: number; settings: Settings | null; numerical?: JuliaNumericalSettings; view?: ProductView | null; targetStage?: Stage; requestedAt: number; status: string; stages: StageRecord[]; previewDisplayedAt: number | null; intermediateDisplayedAt?: number | null; finalDisplayedAt?: number | null; displayedAt: number | null; error?: string };
type EventRecord = { type: string; at: number; epoch: number; requestId?: number; jobId?: number; detail?: unknown };
type Counts = { worker: number; active: number; pending: number; timers: number; managedBufferBytes: number };
type Resources = Counts & { mainTimers: number; workerYieldTimers: number; max: Counts; numericalComputations: number; canvasPaints: number; records: number; events: number; limits: { bufferBytes: number; history: number; events: number; watchdogMs: number } };
export type ProductSnapshot = {
  version: string; status: ProductStatus; epoch: number; desiredSettings: Settings | null; displayedSettings: Settings | null;
  displayedRequestId: number | null; displayedEpoch: number | null; displayedQuality: 'preview' | 'full' | null;
  desiredView: ProductView | null; displayedView: ProductView | null; desiredNumerical: JuliaNumericalSettings | null; displayedNumerical: JuliaNumericalSettings | null; displayedStage: ViewStage | null;
  displayedNumericKey: string | null; resources: Resources; records: RequestRecord[]; events: EventRecord[]; error: string | null;
  active: null | { jobId: number; requestId: number; epoch: number; numericKey: string; stage: Stage; rowsCompleted: number; cancelRequested: boolean };
  pendingRequestId: number | null; faults: FaultOptions;
};
type Request = { id: number; settings: Settings | null; numerical: JuliaNumericalSettings; view: ProductView | null; palette: PaletteId; targetStage: Stage; progressive: boolean; fresh: boolean; record: RequestRecord };
type RetainedFrame = { window: number; field: Uint16Array; rgba: Uint8ClampedArray; settings: Settings | null; numerical: JuliaNumericalSettings; view: ProductView | null; stage: Stage; requestId: number; epoch: number; paintedAt: number; displayedAt: number };
/** Presentation extension only; numerical and legacy Settings contracts remain unchanged. */
export type ProductViewColorizer = (field: Uint16Array, settings: NumericalSettings, palette: DisplayPaletteId) => Uint8ClampedArray;
export type ProductColorizer = (field: Uint16Array, settings: NumericalSettings, palette: PaletteId) => Uint8ClampedArray;
type Active = Identity & { ownerId: number; settings: NumericalSettings; legacySettings: Settings | null; stage: Stage; record: StageRecord; cancelRequested: boolean; watchdog: ReturnType<typeof setTimeout>; cancelTimer: ReturnType<typeof setTimeout> | null; workerYieldTimer: number; resolve?: (field: Uint16Array) => void; reject?: (error: Error) => void };
let globalEpoch = 0;

/** Product path only. The old lab renderer/controller/worker remain independent. */
export class ProductRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly onChange?: (snapshot: ProductSnapshot) => void;
  private readonly audit: boolean;
  private readonly colorizer: ProductColorizer;
  private readonly viewColorizer: ProductViewColorizer;
  private worker: Worker | null = null;
  private epoch = 0;
  private serial = 0;
  private jobSerial = 0;
  private status: ProductStatus = 'idle';
  private desired: Request | null = null;
  private active: Active | null = null;
  private pending: Request | null = null;
  private presentationFrame: number | null = null;
  private field: Uint16Array | null = null;
  private fieldSettings: NumericalSettings | null = null;
  private displayedSettings: Settings | null = null;
  private displayedView: ProductView | null = null;
  private displayedNumerical: JuliaNumericalSettings | null = null;
  private displayedStage: ViewStage | null = null;
  private displayedRequestId: number | null = null;
  private displayedEpoch: number | null = null;
  private displayedQuality: 'preview' | 'full' | null = null;
  private displayedNumericKey: string | null = null;
  private inspectionPalette: PaletteId = 'lagoon';
  private rgbaReservation = 0;
  private error: string | null = null;
  private faults: FaultOptions = {};
  private records: RequestRecord[] = [];
  private events: EventRecord[] = [];
  private numericalComputations = 0;
  private canvasPaints = 0;
  private maximum: Counts = { worker: 0, active: 0, pending: 0, timers: 0, managedBufferBytes: 0 };
  private disposed = false;
  private requestWaiters = new Map<number, { promise: Promise<RequestRecord>; resolve: (record: RequestRecord) => void }>();
  private presentationReject: ((error: Error) => void) | null = null;
  private retention: { startAt: number; excluded?: { re: number; im: number }[]; excludedViewports?: ProductView['viewport'][] } | null = null;
  private retainedFrames = new Map<number, RetainedFrame>();
  private retentionPresentationBytes = 0;
  private retentionExportBytes = 0;

  constructor(canvas: HTMLCanvasElement, options: { onChange?: (snapshot: ProductSnapshot) => void; audit?: boolean; colorizer?: ProductColorizer; viewColorizer?: ProductViewColorizer } = {}) {
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas2D unavailable.');
    this.canvas = canvas; this.context = context; this.onChange = options.onChange; this.audit = !!options.audit;
    this.colorizer = options.colorizer ?? colorizeNumericalField;
    this.viewColorizer = options.viewColorizer ?? colorizeArtField;
    this.observeResources();
  }

  request(input: Settings, options: { fresh?: boolean; progressive?: boolean } = {}): number {
    this.requireAlive();
    // The old v1 gate and old two-palette semantics remain unchanged.
    const settings = validateSettings(input);
    if (settings.renderer.id !== 'cpu-worker') throw new Error('Product renderer requires cpu-worker settings.');
    const full = settings.width === 768 && settings.height === 768 && settings.maxIterations === 512;
    return this.submit(settings, null, juliaSettings(fromLegacySettings(settings)), settings.palette.id,
      full ? 'full' : 'preview', options.progressive !== false && full, !!options.fresh);
  }

  /** Normal product request; never routes through the audit inspection API. */
  requestView(input: unknown, options: { fresh?: boolean; progressive?: boolean; stage?: ViewStage } = {}): number {
    this.requireAlive();
    const view = validateProductView(input), stage = options.stage ?? 'final';
    if (stage !== 'intermediate' && stage !== 'final') throw new Error('Invalid product view stage.');
    const target = toNumericalSettings(view, stage);
    const progressive = stage === 'final' && options.progressive !== false
      && numericKey(target) !== numericKey(toNumericalSettings(view, 'intermediate'));
    return this.submit(null, view, target, legacyBasePalette(view.displayPalette), stage, progressive, !!options.fresh);
  }

  private submit(settings: Settings | null, view: ProductView | null, numerical: JuliaNumericalSettings,
    palette: PaletteId, targetStage: Stage, progressive: boolean, fresh: boolean): number {
    this.reserveCheck(numerical);
    if (this.status === 'error') this.shutdownWorker('explicit-retry');
    this.error = null; this.cancelPresentation();
    const previous = this.desired;
    const record: RequestRecord = { id: ++this.serial, epoch: this.epoch, settings, numerical, view, targetStage,
      requestedAt: performance.now(), status: 'running', stages: [], previewDisplayedAt: null,
      intermediateDisplayedAt: null, finalDisplayedAt: null, displayedAt: null };
    const request: Request = { id: record.id, settings, numerical, view, palette, targetStage, progressive, fresh, record };
    this.records.push(record); this.trim(); this.desired = request; this.status = 'rendering';
    this.event('request', request.id, undefined, { settings, numerical, view, targetStage, progressive, fresh });
    if (previous && previous.record.status === 'running') { previous.record.status = 'superseded'; this.event('supersede', previous.id); }
    if (this.active) {
      const sameTarget = previous && numericKey(previous.numerical) === numericKey(numerical)
        && previous.targetStage === targetStage && Boolean(previous.view) === Boolean(view);
      if (!fresh && sameTarget && !this.active.cancelRequested) {
        const prior = this.active.ownerId; this.active.ownerId = request.id;
        record.epoch = this.active.epoch; record.stages.push(this.active.record);
        this.event('rebind-numerical-job', request.id, this.active.jobId, { previousRequestId: prior });
        const previewKey = progressive ? numericKey(this.intermediateFor(request).numerical) : null;
        if (this.field && this.fieldSettings && (numericKey(this.fieldSettings) === numericKey(numerical)
          || numericKey(this.fieldSettings) === previewKey)) this.publishCached(request, false);
        this.notify(); return request.id;
      }
      if (this.pending) { this.pending.record.status = 'superseded'; this.event('pending-replaced', this.pending.id); }
      this.pending = request; this.cancelActive('superseded'); this.observeResources(); this.notify(); return request.id;
    }
    this.begin(request); this.notify(); return request.id;
  }

  retry(): number {
    const r = this.desired;
    if (!r) throw new Error('No valid request to recompute.');
    return r.view ? this.requestView(r.view, { fresh: true, progressive: r.progressive, stage: r.targetStage as ViewStage })
      : this.request(r.settings!, { fresh: true, progressive: r.progressive });
  }

  stop(): void {
    this.requireAlive();
    const at = performance.now(); this.cancelPresentation();
    if (this.pending) { this.pending.record.status = 'stopped'; this.pending = null; }
    if (this.desired?.record.status === 'running') this.desired.record.status = 'stopped';
    const inspection = this.active?.stage === 'inspection' ? this.records.find(r => r.id === this.active!.ownerId) : null;
    if (inspection) inspection.status = 'stopped';
    this.status = 'stopped'; this.event('stop-requested', this.desired?.id, this.active?.jobId, { at });
    this.cancelActive('user-stop'); this.event('stop-visible', this.desired?.id, undefined, { requestedAt: at });
    this.notify();
  }

  leave(): void {
    if (this.disposed) return;
    this.cancelPresentation();
    if (this.desired?.record.status === 'running') this.desired.record.status = 'stopped';
    if (this.pending) this.pending.record.status = 'stopped';
    this.pending = null;
    this.shutdownWorker('gallery-exit');
    this.field = null; this.fieldSettings = null; this.displayedSettings = null;
    this.displayedView = null; this.displayedNumerical = null; this.displayedStage = null; this.displayedRequestId = null;
    this.displayedEpoch = null; this.displayedQuality = null; this.displayedNumericKey = null;
    this.canvas.width = 0; this.canvas.height = 0; this.rgbaReservation = 0;
    this.retention = null; this.retainedFrames.clear(); this.retentionPresentationBytes = 0; this.retentionExportBytes = 0;
    this.status = 'left'; this.event('leave'); this.notify();
  }

  dispose(): void { this.leave(); this.disposed = true; }

  numericalSnapshot(): Uint16Array | null { return this.field?.slice() ?? null; }
  numericSnapshot(): Uint16Array | null { return this.numericalSnapshot(); }

  /** Recolor the displayed field, including while stopped; never dispatch numerical work. */
  repaint(palette: PaletteId = 'lagoon'): boolean {
    this.requireAlive();
    if (palette !== 'lagoon' && palette !== 'ember') throw new Error('Unsupported legacy palette.');
    if (this.desired?.view) throw new Error('Use repaintViewPalette for a product view.');
    if (this.desired?.settings) {
      this.desired.settings = validateSettings({ ...this.desired.settings, palette: { id: palette, version: '1.0.0' } });
      this.desired.record.settings = this.desired.settings;
    }
    if (!this.field || !this.fieldSettings || !this.displayedSettings
      || numericKey(this.fieldSettings) !== this.displayedNumericKey) return false;
    this.paint(this.field, this.fieldSettings, palette);
    this.displayedSettings = validateSettings({ ...this.displayedSettings, palette: { id: palette, version: '1.0.0' } });
    this.event('display-repaint', this.displayedRequestId ?? undefined, undefined,
      { settings: this.displayedSettings, numericKey: this.displayedNumericKey, additionalNumericalJobs: 0 });
    this.notify();
    return true;
  }

  /** Display-only style update, including during stopped/pending states. */
  repaintViewPalette(input: unknown): boolean {
    this.requireAlive(); const palette = validateDisplayPalette(input);
    if (this.desired?.view) {
      this.desired.view = validateProductView({ ...this.desired.view, displayPalette: palette });
      this.desired.record.view = this.desired.view; this.desired.palette = legacyBasePalette(palette);
    }
    if (!this.field || !this.fieldSettings || !this.displayedView
      || numericKey(this.fieldSettings) !== this.displayedNumericKey) return false;
    this.paint(this.field, this.fieldSettings, legacyBasePalette(palette), palette);
    this.displayedView = validateProductView({ ...this.displayedView, displayPalette: palette });
    this.event('display-repaint', this.displayedRequestId ?? undefined, undefined,
      { numerical: this.displayedNumerical, view: this.displayedView, stage: this.displayedStage,
        numericKey: this.displayedNumericKey, additionalNumericalJobs: 0 });
    this.notify(); return true;
  }

  /** Audit-only O(1) immutable references; no copy/hash/readback in the response window. */
  auditConfigureRetention(startAt: number, excluded: { re: number; im: number }[]): void {
    this.requireAudit();
    if (!Number.isFinite(startAt) || !Array.isArray(excluded) || excluded.length !== 2
      || excluded.some(c => !c || !Number.isFinite(c.re) || !Number.isFinite(c.im))) throw new Error('Invalid fixed retention window.');
    this.retainedFrames.clear(); this.retentionExportBytes = 0; this.retention = { startAt, excluded: excluded.map(c => ({ ...c })) };
  }
  auditConfigureViewRetention(startAt: number, excluded: ProductView['viewport'][]): void {
    this.requireAudit();
    if (!Number.isFinite(startAt) || !Array.isArray(excluded) || excluded.length !== 2) throw new Error('Invalid view retention window.');
    const checked = excluded.map(viewport => validateProductView({ schemaVersion: 'SAM-006-B-view-v1', c: { re: 0, im: 0 }, viewport, maxIterations: 128, resolution: 256, displayPalette: 'lagoon' }).viewport);
    this.retainedFrames.clear(); this.retentionExportBytes = 0; this.retention = { startAt, excludedViewports: checked };
  }
  auditExportFrames(): RetainedFrame[] {
    this.requireAudit();
    if (this.retentionExportBytes !== 0) throw new Error('Retained frames already exported; clear before exporting again.');
    this.retention = null;
    this.retentionExportBytes = [...this.retainedFrames.values()].reduce((n, r) => n + r.field.byteLength + r.rgba.byteLength, 0);
    this.observeResources(); assertBufferBudget(this.resourceSnapshot().managedBufferBytes);
    return [...this.retainedFrames.values()].map(r => ({ ...r, field: r.field.slice(), rgba: r.rgba.slice(),
      settings: r.settings ? validateSettings(r.settings) : null, numerical: juliaSettings(r.numerical), view: r.view ? cloneProductView(r.view) : null }));
  }
  auditClearFrames(): void { this.requireAudit(); this.retention = null; this.retainedFrames.clear(); this.retentionExportBytes = 0; this.observeResources(); }

  /** One bounded, one-shot completion promise per request; no polling or image inspection. */
  waitForRequest(id: number): Promise<RequestRecord> {
    this.requireAudit();
    const record = this.records.find(r => r.id === id);
    if (!record) return Promise.reject(new Error('Unknown request.'));
    if (record.status !== 'running') return Promise.resolve({ ...record, stages: record.stages.map(s => ({ ...s })) });
    const existing = this.requestWaiters.get(id);
    if (existing) return existing.promise;
    if (this.requestWaiters.size >= 16) return Promise.reject(new Error('Audit waiter limit exceeded (16).'));
    let complete!: (record: RequestRecord) => void;
    const promise = new Promise<RequestRecord>(resolve => { complete = resolve; });
    this.requestWaiters.set(id, { promise, resolve: complete });
    return promise;
  }

  /** Audit-only rectangular fixture path, using the very same Worker and paint function. */
  inspectAndPresent(input: NumericalSettings, palette: PaletteId = 'lagoon'): Promise<Uint16Array> {
    this.requireAudit(); this.requireAlive();
    const settings = juliaSettings(input);
    if (palette !== 'lagoon' && palette !== 'ember') throw new Error('Unsupported palette.');
    if (this.active || this.pending || this.presentationFrame !== null) throw new Error('Inspection renderer is busy.');
    this.reserveCheck(settings); this.inspectionPalette = palette; this.status = 'rendering'; this.error = null;
    const id = ++this.serial;
    const record: RequestRecord = { id, epoch: this.epoch, settings: null, requestedAt: performance.now(), status: 'running', stages: [], previewDisplayedAt: null, displayedAt: null };
    this.records.push(record); this.trim();
    return new Promise((resolve, reject) => { this.startJob(id, settings, null, 'inspection', record, resolve, reject); });
  }
  inspect(input: NumericalSettings): Promise<Uint16Array> { return this.inspectAndPresent(input); }

  recolorInspection(palette: PaletteId): void {
    this.requireAudit();
    if (!this.field || !this.fieldSettings || this.active) throw new Error('No completed inspection field.');
    if (palette !== 'lagoon' && palette !== 'ember') throw new Error('Unsupported palette.');
    this.inspectionPalette = palette; this.paint(this.field, this.fieldSettings, palette);
    this.event('inspection-recolor', undefined, undefined, { palette });
  }

  configureFaults(input: FaultOptions): void {
    this.requireAudit();
    if (typeof input !== 'object' || input === null || Array.isArray(input)
      || Object.keys(input).some(k => !['holdStart', 'holdCompletion', 'invalidResponse', 'throwWorker', 'hangWorker'].includes(k))
      || Object.values(input).some(v => typeof v !== 'boolean')) throw new Error('Invalid audit fault configuration.');
    this.faults = { ...input }; this.event('fault-configuration', undefined, undefined, { ...input });
  }
  release(which: 'start' | 'completion'): void {
    this.requireAudit();
    if (which !== 'start' && which !== 'completion') throw new Error('Unknown synchronization gate.');
    const a = this.active;
    if (a) { this.worker?.postMessage({ ...this.identity(a), type: which === 'start' ? 'release-start' : 'release-completion', protocolVersion: 1 }); this.event('gate-release', a.ownerId, a.jobId, { which }); }
  }
  releaseGate(which: 'start' | 'completion'): void { this.release(which); }
  auditInjectResponse(input: unknown): void { this.requireAudit(); this.response(input); }
  auditBudgetRequest(bytes: number): void { this.requireAudit(); assertBufferBudget(bytes); }

  snapshot(): ProductSnapshot {
    return {
      version: PRODUCT_RENDERER_VERSION, status: this.status, epoch: this.epoch,
      desiredSettings: this.desired?.settings ? validateSettings(this.desired.settings) : null,
      desiredView: this.desired?.view ? cloneProductView(this.desired.view) : null, displayedView: this.displayedView ? cloneProductView(this.displayedView) : null,
      desiredNumerical: this.desired ? juliaSettings(this.desired.numerical) : null, displayedNumerical: this.displayedNumerical ? juliaSettings(this.displayedNumerical) : null, displayedStage: this.displayedStage,
      displayedSettings: this.displayedSettings ? validateSettings(this.displayedSettings) : null,
      displayedRequestId: this.displayedRequestId, displayedEpoch: this.displayedEpoch, displayedQuality: this.displayedQuality,
      displayedNumericKey: this.displayedNumericKey, resources: this.resourceSnapshot(),
      records: this.records.map(r => ({ ...r, stages: r.stages.map(s => ({ ...s })) })), events: this.events.map(e => ({ ...e })),
      error: this.error,
      active: this.active ? { jobId: this.active.jobId, requestId: this.active.ownerId, epoch: this.active.epoch, numericKey: this.active.numericKey, stage: this.active.stage, rowsCompleted: this.active.record.rowsCompleted, cancelRequested: this.active.cancelRequested } : null,
      pendingRequestId: this.pending?.id ?? null, faults: { ...this.faults },
    };
  }

  private intermediateFor(request: Request): { numerical: JuliaNumericalSettings; legacy: Settings | null; stage: Stage } {
    if (request.view) return { numerical: toNumericalSettings(request.view, 'intermediate'), legacy: null, stage: 'intermediate' };
    const legacy = makeSettings('cpu-worker', request.settings!.c, 256, 128, request.palette);
    return { numerical: juliaSettings(fromLegacySettings(legacy)), legacy, stage: 'preview' };
  }

  private begin(request: Request): void {
    if (this.desired !== request || this.status === 'stopped' || this.status === 'left') return;
    if (!request.fresh && this.field && this.fieldSettings && numericKey(this.fieldSettings) === numericKey(request.numerical)) {
      this.publishCached(request, true); return;
    }
    if (request.progressive) {
      const preview = this.intermediateFor(request);
      if (!request.fresh && this.field && this.fieldSettings && numericKey(this.fieldSettings) === numericKey(preview.numerical)) {
        this.publishCached(request, false, () => this.startTarget(request));
      } else this.startJob(request.id, preview.numerical, preview.legacy, preview.stage, request.record);
    } else this.startTarget(request);
  }

  private startTarget(request: Request): void {
    if (this.desired !== request || this.status !== 'rendering' || this.active) return;
    this.startJob(request.id, request.numerical, request.settings, request.targetStage, request.record);
  }

  private startJob(id: number, settings: NumericalSettings, legacy: Settings | null, stage: Stage, request: RequestRecord,
    resolve?: (field: Uint16Array) => void, reject?: (error: Error) => void): void {
    this.reserveCheck(settings); this.ensureWorker();
    const jobId = ++this.jobSerial;
    const record: StageRecord = { jobId, stage, numericKey: numericKey(settings), requestedAt: performance.now(), startedAt: null, firstProgressAt: null, completedAt: null, paintedAt: null, displayedAt: null, cancelRequestedAt: null, cancelledAt: null, rowsCompleted: 0, status: 'running' };
    request.epoch = this.epoch; request.stages.push(record);
    const watchdog = setTimeout(() => this.fail('Product calculation exceeded 5000 ms.'), WATCHDOG_MS);
    this.active = { jobId, requestId: id, ownerId: id, epoch: this.epoch, numericKey: record.numericKey, settings, legacySettings: legacy, stage, record, cancelRequested: false, watchdog, cancelTimer: null, workerYieldTimer: 0, resolve, reject };
    const message: CalculateCommand = { ...this.identity(this.active), protocolVersion: 1, type: 'calculate', settings, faults: this.audit ? { ...this.faults } : {} };
    this.numericalComputations++; this.event('dispatch', id, jobId, { stage, settings, numericKey: record.numericKey });
    this.observeResources(); this.worker!.postMessage(message); this.notify();
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.epoch = ++globalEpoch;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const worker = this.worker;
    this.worker.onmessage = event => { if (this.worker === worker) { try { this.response(event.data); } catch { this.fail('Product response or presentation failed.'); } } };
    this.worker.onerror = event => { event.preventDefault(); if (this.worker === worker) this.fail('Product Worker failed.'); };
    this.worker.onmessageerror = () => { if (this.worker === worker) this.fail('Product Worker message decoding failed.'); };
    this.event('worker-created'); this.observeResources();
  }

  private response(raw: unknown): void {
    if (!validIdentity(raw) || typeof raw !== 'object' || raw === null) { this.fail('Invalid Worker response identity.'); return; }
    const response = raw as WorkerResponse;
    // Old generations are never allowed to touch the current field or metadata.
    if (response.epoch !== this.epoch) { this.event('discard-old-epoch', response.requestId, response.jobId, { receivedEpoch: response.epoch }); return; }
    const a = this.active;
    if (!a || response.jobId !== a.jobId) {
      if (response.jobId <= this.jobSerial) { this.event('discard-old-job', response.requestId, response.jobId); return; }
      this.fail('Unknown Worker response job.'); return;
    }
    if (response.protocolVersion !== 1 || response.requestId !== a.requestId || response.numericKey !== a.numericKey
      || !['started', 'progress', 'ready', 'cancelled', 'complete'].includes(response.type)
      || !Number.isInteger(response.rows) || response.rows < 0 || response.rows > a.settings.height
      || typeof response.timerScheduled !== 'boolean'
      || Object.keys(response).some(k => !['protocolVersion', 'type', 'jobId', 'requestId', 'epoch', 'numericKey', 'rows', 'timerScheduled', 'counts'].includes(k))) {
      this.fail('Worker response metadata mismatch.'); return;
    }
    a.workerYieldTimer = Number(response.timerScheduled);
    a.record.rowsCompleted = response.rows;
    if (response.type === 'started') {
      if (a.record.startedAt !== null || response.rows !== 0 || response.counts !== undefined) { this.fail('Invalid Worker start response.'); return; }
      a.record.startedAt = performance.now(); this.event('started', a.ownerId, a.jobId, { stage: a.stage }); this.observeResources(); this.notify(); return;
    }
    if (a.record.startedAt === null) { this.fail('Worker result arrived before start.'); return; }
    if (response.type === 'progress') { if (response.rows <= 0 || response.counts !== undefined) { this.fail('Invalid Worker progress.'); return; } a.record.firstProgressAt ??= performance.now(); this.observeResources(); return; }
    if (response.type === 'ready') { if (response.rows !== a.settings.height || response.timerScheduled || response.counts !== undefined) { this.fail('Invalid completion gate.'); return; } this.event('completion-ready', a.ownerId, a.jobId); this.observeResources(); this.notify(); return; }
    if (response.type === 'cancelled') {
      if (!a.cancelRequested || response.timerScheduled || response.counts !== undefined) { this.fail('Unexpected Worker cancellation.'); return; }
      a.record.cancelledAt = performance.now(); a.record.status = 'cancelled';
      this.event('cancel-confirmed', a.ownerId, a.jobId, { method: 'worker-ack-after-clearing-chunk-timer-and-field', rowsCompleted: response.rows });
      a.reject?.(new Error('Inspection cancelled.')); this.clearActive(); this.startPending(); this.notify(); return;
    }
    if (!(response.counts instanceof ArrayBuffer) || response.counts.byteLength !== a.settings.width * a.settings.height * 2
      || response.rows !== a.settings.height || response.timerScheduled) { this.fail('Worker field length mismatch.'); return; }
    const field = new Uint16Array(response.counts);
    for (const value of field) if (value !== UNESCAPED && value > a.settings.maxIterations) { this.fail('Worker count outside numerical contract.'); return; }
    a.record.completedAt = performance.now(); this.event('completed', a.ownerId, a.jobId, { stage: a.stage });
    this.clearActive();
    if (a.cancelRequested || (a.stage !== 'inspection' && (this.desired?.id !== a.ownerId || this.status !== 'rendering'))) {
      a.record.status = 'discarded'; a.record.cancelledAt = performance.now();
      this.event('discard-completed', a.ownerId, a.jobId, { stopConfirmedBy: 'worker-complete-with-no-further-job' });
      a.reject?.(new Error('Inspection cancelled.')); this.startPending(); this.notify(); return;
    }
    this.field = field; this.fieldSettings = a.settings;
    if (a.stage === 'inspection') {
      try { this.paint(field, a.settings, this.inspectionPalette); }
      catch (error) { a.reject?.(error instanceof Error ? error : new Error('Inspection presentation failed.')); throw error; }
      a.record.paintedAt = performance.now();
      this.presentationReject = error => { const record = this.records.find(r => r.id === a.ownerId); if (record) record.status = 'stopped'; a.reject?.(error); };
      this.presentationFrame = requestAnimationFrame(() => { this.presentationFrame = null; this.presentationReject = null; a.record.displayedAt = performance.now(); a.record.status = 'displayed'; const record = this.records.find(r => r.id === a.ownerId); if (record) { record.displayedAt = a.record.displayedAt; record.status = 'displayed'; } this.status = 'displayed'; this.notify(); a.resolve?.(field); });
      this.observeResources(); return;
    }
    const request = this.desired!;
    const displayed = a.legacySettings ? { ...a.legacySettings, palette: { id: request.palette, version: '1.0.0' as const } } : null;
    const intermediate = a.stage === 'preview' || a.stage === 'intermediate';
    this.publish(request, juliaSettings(a.settings), displayed, a.stage, a.record, intermediate && request.progressive ? () => this.startTarget(request) : undefined);
  }

  private publish(request: Request, numerical: JuliaNumericalSettings, legacy: Settings | null, stage: Stage, record: StageRecord | null, next?: () => void): void {
    if (this.desired !== request || !this.field || !this.fieldSettings) return;
    const rgba = this.paint(this.field, this.fieldSettings, request.palette, request.view?.displayPalette);
    const paintedAt = performance.now();
    const retained = this.retention && (stage === 'preview' || stage === 'intermediate')
      ? { field: this.field, rgba, settings: legacy ? validateSettings(legacy) : null, numerical: juliaSettings(numerical), view: request.view ? cloneProductView(request.view) : null, stage, requestId: request.id, epoch: this.epoch, paintedAt } : null;
    this.retentionPresentationBytes = retained ? rgba.byteLength : 0;
    this.displayedSettings = legacy ? validateSettings(legacy) : null;
    this.displayedView = request.view ? cloneProductView(request.view) : null;
    this.displayedNumerical = juliaSettings(numerical);
    this.displayedStage = request.view ? stage as ViewStage : null;
    this.displayedRequestId = request.id; this.displayedEpoch = this.epoch;
    this.displayedQuality = stage === 'full' ? 'full' : 'preview'; this.displayedNumericKey = numericKey(this.fieldSettings);
    if (record) record.paintedAt = paintedAt;
    this.event('paint', request.id, record?.jobId, { settings: legacy, numerical, view: this.displayedView, stage,
      quality: this.displayedQuality, numericKey: this.displayedNumericKey, reusedField: !record, paintedAt });
    this.notify();
    this.presentationFrame = requestAnimationFrame(() => {
      this.presentationFrame = null; this.retentionPresentationBytes = 0;
      if (this.desired !== request || this.status !== 'rendering') { this.event('discard-presentation-opportunity', request.id, record?.jobId); return; }
      const at = performance.now();
      if (retained && this.retention) {
        const elapsed = at - this.retention.startAt, window = elapsed === 2000 ? 3 : Math.floor(elapsed / 500);
        const near = (a: number, b: number) => Math.abs(a - b) <= 8 * Number.EPSILON * Math.max(1, Math.abs(b));
        const excludedC = this.retention.excluded?.some(c => near(c.re, retained.numerical.c.re) && near(c.im, retained.numerical.c.im));
        const excludedView = this.retention.excludedViewports?.some(v => (['reMin', 'reMax', 'imMin', 'imMax'] as const).every(k => near(v[k], retained.numerical.viewport[k])));
        if (elapsed >= 0 && elapsed <= 2000 && window >= 0 && window < 4 && !excludedC && !excludedView && !this.retainedFrames.has(window)) this.retainedFrames.set(window, { ...retained, window, displayedAt: at });
      }
      if (record) { record.displayedAt = at; record.status = 'displayed'; }
      if (stage === 'preview' || stage === 'intermediate') { request.record.previewDisplayedAt = at; request.record.intermediateDisplayedAt = at; }
      if (stage === 'final') request.record.finalDisplayedAt = at;
      this.event('display-opportunity', request.id, record?.jobId, { stage, settings: legacy, numerical,
        view: request.view ? cloneProductView(request.view) : null, displayedAt: at, paintedAt });
      if (next) next();
      else { request.record.displayedAt = at; request.record.status = 'displayed'; this.status = 'displayed'; this.notify(); }
      this.observeResources();
    });
    this.observeResources();
  }

  private publishCached(request: Request, final: boolean, next?: () => void): void {
    if (!this.field || !this.fieldSettings) return;
    const numerical = juliaSettings(this.fieldSettings);
    const legacy = request.settings ? makeSettings('cpu-worker', request.settings.c, numerical.width, numerical.maxIterations, request.palette) : null;
    const stage: Stage = request.view ? (final ? request.targetStage : 'intermediate')
      : numerical.width === 768 && numerical.maxIterations === 512 ? 'full' : 'preview';
    if (!final && !next && this.active) {
      this.paint(this.field, this.fieldSettings, request.palette, request.view?.displayPalette);
      this.displayedSettings = legacy; this.displayedNumerical = numerical; this.displayedView = request.view ? cloneProductView(request.view) : null;
      this.displayedStage = request.view ? (numericKey(numerical) === numericKey(request.numerical) ? request.targetStage as ViewStage : 'intermediate') : null; this.displayedRequestId = request.id; this.displayedEpoch = this.epoch;
      this.displayedQuality = stage === 'full' ? 'full' : 'preview'; this.event('recolor-running-preview', request.id, this.active.jobId); this.notify(); return;
    }
    this.publish(request, numerical, legacy, stage, null, final ? undefined : next);
  }

  private paint(field: Uint16Array, settings: NumericalSettings, palette: PaletteId, viewPalette?: DisplayPaletteId): Uint8ClampedArray {
    this.rgbaReservation = field.length * 8; this.observeResources();
    try {
      assertBufferBudget(this.resourceSnapshot().managedBufferBytes);
      const rgba = viewPalette ? this.viewColorizer(field, settings, viewPalette) : this.colorizer(field, settings, palette);
      if (!(rgba instanceof Uint8ClampedArray) || rgba.length !== field.length * 4) throw new Error('Presentation RGBA length mismatch.');
      const image = new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, settings.width, settings.height);
      this.canvas.width = settings.width; this.canvas.height = settings.height;
      this.context.putImageData(image, 0, 0); this.canvasPaints++; this.observeResources();
      return rgba;
    } finally { this.rgbaReservation = 0; }
  }

  private cancelActive(reason: string): void {
    const a = this.active;
    if (!a || a.cancelRequested) return;
    a.cancelRequested = true; a.record.cancelRequestedAt = performance.now();
    this.event('cancel-requested', a.ownerId, a.jobId, { reason });
    this.worker?.postMessage({ ...this.identity(a), type: 'cancel', protocolVersion: 1 });
    a.cancelTimer = setTimeout(() => {
      if (this.active !== a) return;
      a.record.cancelledAt = performance.now(); a.record.status = 'terminated';
      this.event('cancel-confirmed', a.ownerId, a.jobId, { method: 'Worker.terminate-after-cancel-deadline' });
      this.shutdownWorker('cancel-deadline'); this.startPending(); this.notify();
    }, CANCEL_CONFIRMATION_MS - 10);
    this.observeResources();
  }

  private startPending(): void {
    if (this.active) return;
    const next = this.pending; this.pending = null;
    if (next && this.desired === next && this.status === 'rendering') this.begin(next);
    this.observeResources();
  }
  private clearActive(): void {
    if (this.active) { clearTimeout(this.active.watchdog); if (this.active.cancelTimer !== null) clearTimeout(this.active.cancelTimer); }
    this.active = null; this.observeResources();
  }
  private cancelPresentation(): void {
    if (this.presentationFrame !== null) cancelAnimationFrame(this.presentationFrame);
    this.presentationFrame = null;
    this.retentionPresentationBytes = 0;
    const reject = this.presentationReject; this.presentationReject = null; reject?.(new Error('Inspection presentation cancelled.'));
  }
  private shutdownWorker(reason: string): void {
    const a = this.active;
    if (a) { a.record.status = 'terminated'; a.record.cancelledAt = performance.now(); const record = this.records.find(r => r.id === a.ownerId); if (record?.status === 'running') record.status = 'stopped'; a.reject?.(new Error(reason)); }
    this.clearActive();
    if (this.worker) { this.worker.terminate(); this.worker = null; this.event('worker-terminated', a?.ownerId, a?.jobId, { reason }); }
    this.observeResources();
  }
  private fail(message: string): void {
    this.cancelPresentation(); this.error = message;
    if (this.desired) { this.desired.record.status = 'error'; this.desired.record.error = message; }
    if (this.pending) { this.pending.record.status = 'error'; this.pending = null; }
    this.status = 'error'; this.event('error', this.desired?.id, this.active?.jobId, { message });
    this.shutdownWorker(message); this.notify();
  }
  private reserveCheck(settings: NumericalSettings): void {
    const s = juliaSettings(settings);
    // Worst managed transition: old field/canvas + incoming field + RGBA/ImageData + new canvas.
    assertBufferBudget((this.field?.byteLength ?? 0) + this.canvas.width * this.canvas.height * 4 + s.width * s.height * 14
      + this.retentionPresentationBytes + this.retentionExportBytes + [...this.retainedFrames.values()].reduce((n, r) => n + r.field.byteLength + r.rgba.byteLength, 0));
  }
  private identity(a: Identity): Identity { return { jobId: a.jobId, requestId: a.requestId, epoch: a.epoch, numericKey: a.numericKey }; }
  resourceSnapshot(): Resources & { workers: number; waiters: number; max: Counts & { workers: number } } {
    const mainTimers = Number(this.active !== null) + Number(this.active?.cancelTimer != null) + Number(this.presentationFrame !== null);
    const workerYieldTimers = this.active?.workerYieldTimer ?? 0;
    const current = {
      worker: Number(this.worker !== null), active: Number(this.active !== null), pending: Number(this.pending !== null), timers: mainTimers + workerYieldTimers,
      managedBufferBytes: (this.field?.byteLength ?? 0) + (this.active ? this.active.settings.width * this.active.settings.height * 2 : 0)
        + this.rgbaReservation + this.canvas.width * this.canvas.height * 4 + this.retentionPresentationBytes + this.retentionExportBytes
        + [...this.retainedFrames.values()].reduce((n, r) => n + r.field.byteLength + r.rgba.byteLength, 0),
    };
    return { ...current, workers: current.worker, waiters: this.requestWaiters.size, mainTimers, workerYieldTimers, max: { ...this.maximum, workers: this.maximum.worker }, numericalComputations: this.numericalComputations, canvasPaints: this.canvasPaints,
      records: this.records.length, events: this.events.length,
      limits: { bufferBytes: BUFFER_BUDGET_BYTES, history: this.audit ? 512 : 64, events: this.audit ? 4096 : 512, watchdogMs: WATCHDOG_MS } };
  }
  private observeResources(): void {
    const current = this.resourceSnapshot();
    for (const key of ['worker', 'active', 'pending', 'timers', 'managedBufferBytes'] as const) this.maximum[key] = Math.max(this.maximum[key], current[key]);
  }
  private event(type: string, requestId?: number, jobId?: number, detail?: unknown): void {
    this.events.push({ type, at: performance.now(), epoch: this.epoch, ...(requestId ? { requestId } : {}), ...(jobId ? { jobId } : {}), ...(detail !== undefined ? { detail } : {}) }); this.trim();
  }
  private trim(): void { if (this.records.length > (this.audit ? 512 : 64)) this.records.splice(0, this.records.length - (this.audit ? 512 : 64)); if (this.events.length > (this.audit ? 4096 : 512)) this.events.splice(0, this.events.length - (this.audit ? 4096 : 512)); }
  private notify(): void {
    this.observeResources();
    for (const [id, waiter] of this.requestWaiters) {
      const record = this.records.find(r => r.id === id);
      if (!record || record.status !== 'running') {
        this.requestWaiters.delete(id);
        if (record) waiter.resolve({ ...record, stages: record.stages.map(s => ({ ...s })) });
      }
    }
    this.onChange?.(this.snapshot());
  }
  private requireAlive(): void { if (this.disposed) throw new Error('Product renderer disposed.'); }
  private requireAudit(): void { if (!this.audit) throw new Error('Audit-only operation unavailable.'); }
}
