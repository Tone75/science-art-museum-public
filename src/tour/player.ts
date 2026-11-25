import { LIVE_WORKS, type LiveWorkId } from '../art/works.ts';
import { cloneProductView, toNumericalSettings, type ProductView } from '../framing/contract.ts';
import { defaultWorkView } from '../framing/state.ts';
import { WATCHDOG_MS, type FaultOptions } from '../product/kernel.ts';
import { ARRIVAL_MS, SETTLE_MS, marbleC } from './marble.ts';
import type { MarbleCommand, MarbleReply } from './marble-worker.ts';
import { HOLD_MS, APPROACH_MS, DETAIL_MS, STOP_MS, TOUR_MS, locateScene, type TourPhase } from './route.ts';

export type TourFrame = {
  workId: LiveWorkId; view: ProductView; rendering: 'overview' | 'numerical';
  timeMs: number; sequence: number; width: number; height: number; maxIterations: number;
};
export type TourSnapshot = {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
  phase: TourPhase;
  displayed: TourFrame | null;
  elapsedMs: number;
  durationMs: number;
  reducedMotion: boolean;
  error: string | null;
  pausedBy: 'visitor' | 'hidden' | null;
};

const FRAME_INTERVAL_MS = 1000 / 24;
const MAX_STEP_MS = 125;
const SIZES = [144, 192, 256, 384, 512] as const;
const INITIAL_TIER = 3;
const PHASE_ENDS: Record<TourPhase, number> = {
  overview: HOLD_MS, approach: HOLD_MS + APPROACH_MS, detail: HOLD_MS + APPROACH_MS + DETAIL_MS, passage: STOP_MS,
};
type Job = { id: number; frame: TourFrame; issuedAt: number };

/** Paint and publish a complete frame together. The studio reads only published parameters. */
export class GuidedTour {
  private readonly stage: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly changed: (snapshot: TourSnapshot) => void;
  private readonly audit: boolean;
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)');
  private status: TourSnapshot['status'] = 'idle';
  private phase: TourPhase = 'overview';
  private displayed: TourFrame | null = null;
  private error: string | null = null;
  private pausedBy: TourSnapshot['pausedBy'] = null;
  private elapsed = 0;
  private tickAt = 0;
  private generation = 0;
  private timer: number | null = null;
  private watchdog: number | null = null;
  private image: HTMLImageElement | null = null;
  private imageWork: LiveWorkId | null = null;
  private loadingImage: HTMLImageElement | null = null;
  private worker: Worker | null = null;
  private job: Job | null = null;
  private nextFaults: FaultOptions = {};
  private started = 0;
  private completed = 0;
  private sequence = 0;
  private tier = INITIAL_TIER;
  private fast = 0;
  private slow = 0;
  private lastRenderMs = 0;
  private maxActive = 0;

  constructor(canvas: HTMLCanvasElement, onChange: (snapshot: TourSnapshot) => void, options: {audit?: boolean} = {}) {
    this.stage = canvas;
    canvas.width = canvas.height = 0;
    const context = canvas.getContext('2d', {alpha: false});
    if (!context) throw new Error('鑑賞画面を開けませんでした。');
    this.context = context;
    this.changed = onChange;
    this.audit = !!options.audit;
    document.addEventListener('visibilitychange', this.visibilityChanged);
    this.motion.addEventListener('change', this.motionChanged);
  }

  snapshot(): TourSnapshot {
    const shown = this.displayed;
    return {
      status: this.status, phase: this.phase, elapsedMs: this.visibleTime(), durationMs: TOUR_MS,
      reducedMotion: this.motion.matches, pausedBy: this.pausedBy, error: this.error,
      displayed: shown && {...shown, view: cloneProductView(shown.view)},
    };
  }

  start(): void {
    // A diagnostic fault configured before entry belongs to the first numerical request.
    const faults = this.nextFaults;
    this.reset();
    this.nextFaults = faults;
    this.started = this.completed = this.sequence = this.maxActive = 0;
    this.lastRenderMs = 0;
    this.tier = INITIAL_TIER;
    this.play();
  }

  pause(): void { this.suspend('visitor'); }

  resume(): void {
    if (this.status === 'paused' || this.status === 'error') this.play();
  }

  stop(): void {
    this.reset();
    this.notify();
  }

  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.motion.removeEventListener('change', this.motionChanged);
  }

  private play(): void {
    this.pausedBy = null;
    this.error = null;
    this.status = 'playing';
    if (document.hidden) { this.suspend('hidden'); return; }
    this.tickAt = performance.now();
    const {stop} = locateScene(this.elapsed);
    if (!this.image || this.imageWork !== stop.workId) { this.loadImage(stop.workId); return; }
    if (this.displayed?.workId !== stop.workId && !this.paintPrint()) return;
    this.notify();
    this.schedule();
  }

  private reset(): void {
    this.cancelWork();
    this.image = this.loadingImage = null;
    this.imageWork = null;
    this.nextFaults = {};
    this.displayed = null;
    this.elapsed = 0;
    this.phase = 'overview';
    this.status = 'idle';
    this.pausedBy = this.error = null;
    this.fast = this.slow = 0;
    this.stage.width = this.stage.height = 0;
  }

  private suspend(reason: TourSnapshot['pausedBy']): void {
    if (this.status !== 'playing' && this.status !== 'loading') return;
    this.elapsed = this.visibleTime();
    this.cancelWork();
    this.status = 'paused';
    this.pausedBy = reason;
    this.notify();
  }

  private readonly visibilityChanged = () => {
    if (document.hidden) this.suspend('hidden');
  };

  private readonly motionChanged = () => {
    if (this.status === 'playing') {
      this.cancelWork();
      // A motion preference change starts from what is on glass, including a still held mid-work.
      this.elapsed = this.displayed?.timeMs ?? this.elapsed;
      this.tickAt = performance.now();
      this.schedule();
    }
    this.notify();
  };

  private cancelWork(): void {
    ++this.generation;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.timer = this.watchdog = null;
    if (this.loadingImage) {
      this.loadingImage.onload = this.loadingImage.onerror = null;
      this.loadingImage.removeAttribute('src');
      this.loadingImage = null;
    }
    this.releaseWorker();
  }

  private releaseWorker(): void {
    if (this.worker) {
      this.worker.onmessage = this.worker.onerror = this.worker.onmessageerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.job = null;
  }

  private fail(message: string): void {
    this.cancelWork();
    this.status = 'error';
    this.error = message;
    this.notify();
  }

  private loadImage(id: LiveWorkId): void {
    this.releaseWorker();
    const work = LIVE_WORKS.find(item => item.id === id)!;
    const generation = this.generation;
    this.status = 'loading';
    this.image = null;
    this.imageWork = null;
    const image = new Image();
    this.loadingImage = image;
    const current = () => generation === this.generation && this.loadingImage === image;
    const fail = () => {
      if (current()) this.fail('作品画像を読み込めませんでした。');
    };
    image.onerror = fail;
    image.onload = () => {
      if (!current()) return;
      if (image.naturalWidth !== work.width || image.naturalHeight !== work.height) { fail(); return; }
      image.onload = image.onerror = null;
      if (this.watchdog !== null) clearTimeout(this.watchdog);
      this.watchdog = null;
      this.loadingImage = null;
      this.image = image;
      this.imageWork = id;
      if (document.hidden) { this.suspend('hidden'); return; }
      this.play();
    };
    this.watchdog = window.setTimeout(fail, WATCHDOG_MS);
    image.src = work.image;
    this.notify();
  }

  private paintPrint(): boolean {
    const workId = this.imageWork!;
    const view = defaultWorkView(workId);
    try {
      this.resize(view.resolution);
      this.context.drawImage(this.image!, 0, 0);
    } catch {
      // Resizing can already have cleared the visible bitmap. Do not offer a stale handoff.
      this.displayed = null;
      this.fail('鑑賞画面に作品を表示できませんでした。');
      return false;
    }
    this.displayed = {workId, view, rendering: 'overview', timeMs: this.elapsed, sequence: ++this.sequence,
      width: view.resolution, height: view.resolution, maxIterations: view.maxIterations};
    this.phase = locateScene(this.elapsed).phase;
    return true;
  }

  private resize(side: number): void {
    if (this.stage.width !== side) this.stage.width = this.stage.height = side;
  }

  private request(timeMs: number): void {
    const {stop, within} = locateScene(timeMs);
    const view = defaultWorkView(stop.workId);
    view.c = marbleC(stop.workId, within);
    const side = SIZES[this.tier];
    const settings = {...toNumericalSettings(view), width: side, height: side};
    const frame: TourFrame = {workId: stop.workId, view, rendering: 'numerical', timeMs, sequence: this.sequence + 1,
      width: side, height: side, maxIterations: settings.maxIterations};
    try {
      if (!this.worker) {
        const worker = new Worker(new URL('./marble-worker.ts', import.meta.url), {type: 'module'});
        const generation = this.generation;
        const current = () => this.worker === worker && this.generation === generation;
        worker.onmessage = (event: MessageEvent<MarbleReply>) => {
          if (current()) this.receive(event.data);
        };
        worker.onerror = event => {
          event.preventDefault();
          if (current()) this.fail('この場面を描けませんでした。');
        };
        worker.onmessageerror = () => { if (current()) this.fail('描画結果を受け取れませんでした。'); };
        this.worker = worker;
      }
      const id = ++this.started;
      const command: MarbleCommand = {type: 'render', id, settings, palette: view.displayPalette};
      if (this.audit) command.faults = this.nextFaults;
      this.nextFaults = {};
      this.job = {id, frame, issuedAt: performance.now()};
      this.maxActive = 1;
      const active = this.job;
      this.watchdog = window.setTimeout(() => {
        if (this.job === active) this.fail('描画が時間内に終わりませんでした。再試行できます。');
      }, WATCHDOG_MS);
      this.worker.postMessage(command);
    } catch { this.fail('この場面の描画を開始できませんでした。'); }
  }

  private receive(reply: MarbleReply): void {
    const job = this.job;
    if (!job || this.status !== 'playing' || reply?.id !== job.id) return;
    if (document.hidden) { this.suspend('hidden'); return; }
    const {frame, issuedAt} = job;
    if (!(reply.rgba instanceof ArrayBuffer) || reply.rgba.byteLength !== frame.width * frame.height * 4) {
      this.fail('描画結果の大きさが一致しません。'); return;
    }
    if (this.watchdog !== null) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.job = null;
    try {
      this.resize(frame.width);
      this.context.putImageData(new ImageData(new Uint8ClampedArray(reply.rgba), frame.width, frame.height), 0, 0);
    } catch {
      this.displayed = null;
      this.fail('鑑賞画面に描画できませんでした。');
      return;
    }
    this.elapsed = frame.timeMs;
    this.displayed = frame;
    this.sequence = frame.sequence;
    this.completed++;
    this.tickAt = issuedAt;
    this.lastRenderMs = performance.now() - issuedAt;
    this.adjustQuality(this.lastRenderMs);
    const phase = locateScene(this.elapsed).phase;
    if (phase !== this.phase) { this.phase = phase; this.notify(); }
    this.schedule();
  }

  // Hysteresis avoids repeated density changes when a boundary takes a little longer to draw.
  private adjustQuality(cost: number): void {
    this.fast = cost < FRAME_INTERVAL_MS * .48 ? this.fast + 1 : 0;
    this.slow = cost > FRAME_INTERVAL_MS * .95 ? this.slow + 1 : 0;
    if (this.slow >= 3 && this.tier > 0) { this.tier--; this.slow = this.fast = 0; }
    if (this.fast >= 32 && this.tier < SIZES.length - 1) { this.tier++; this.fast = this.slow = 0; }
  }

  private visibleTime(): number {
    if (this.status !== 'playing' || this.timer === null) return this.elapsed;
    const {index, within} = locateScene(this.elapsed);
    let end: number;
    if (this.motion.matches) end = index * STOP_MS + PHASE_ENDS[this.phase];
    else if (within < ARRIVAL_MS) end = index * STOP_MS + ARRIVAL_MS;
    else if (within >= STOP_MS - SETTLE_MS) end = (index + 1) * STOP_MS;
    else return this.elapsed;
    return Math.min(end, this.elapsed + Math.max(0, performance.now() - this.tickAt));
  }

  private schedule(): void {
    if (this.status !== 'playing' || this.job || this.timer !== null) return;
    const quiet = this.motion.matches;
    const {index, within} = locateScene(this.elapsed);
    // A still print needs only a wake-up at the next meaningful point, never an idle render loop.
    const atArrival = within < ARRIVAL_MS;
    const atSettle = within >= STOP_MS - SETTLE_MS;
    const waiting = quiet || atArrival || atSettle;
    const roomEnd = quiet ? PHASE_ENDS[this.phase] : atArrival ? ARRIVAL_MS : STOP_MS;
    const end = index * STOP_MS + roomEnd;
    const generation = this.generation;
    const delay = waiting ? Math.max(1, end - this.elapsed) : Math.max(0, FRAME_INTERVAL_MS - (performance.now() - this.tickAt));
    this.timer = window.setTimeout(() => {
      if (generation !== this.generation || this.status !== 'playing') return;
      this.timer = null;
      if (document.hidden) { this.suspend('hidden'); return; }
      const now = performance.now();
      const next = waiting ? end : Math.min(index * STOP_MS + STOP_MS - SETTLE_MS,
        this.elapsed + Math.min(MAX_STEP_MS, Math.max(0, now - this.tickAt)));
      if (next >= TOUR_MS) {
        this.elapsed = TOUR_MS;
        this.releaseWorker();
        if (!this.paintPrint()) return;
        this.status = 'ended';
        this.image = null;
        this.imageWork = null;
        this.notify();
      } else if (locateScene(next).stop.workId !== this.imageWork) {
        this.elapsed = next;
        this.loadImage(locateScene(next).stop.workId);
      } else if (quiet) {
        this.elapsed = next;
        this.phase = locateScene(next).phase;
        this.tickAt = now;
        this.notify();
        this.schedule();
      } else if (atArrival || next === index * STOP_MS + STOP_MS - SETTLE_MS) {
        this.elapsed = next;
        this.tickAt = now;
        if (!atArrival) {
          this.releaseWorker();
          if (!this.paintPrint()) return;
          this.notify();
        }
        this.schedule();
      } else this.request(next);
    }, delay);
  }

  private notify(): void { this.changed(this.snapshot()); }

  resources() {
    const side = this.job?.frame.width ?? 0;
    const imageBytes = this.image || this.loadingImage ? 768 * 768 * 4 : 0;
    return {
      worker: Number(!!this.worker), active: Number(!!this.job), pending: 0,
      timers: Number(this.timer !== null) + Number(this.watchdog !== null),
      managedBufferBytes: this.stage.width * this.stage.height * 4 + imageBytes + side * side * 6,
    };
  }

  diagnostics() {
    const usage = this.resources();
    return {generation: this.generation, ...usage, scheduled: this.timer !== null, refining: !!this.job,
      framesRequested: this.started, framesPainted: this.completed, lastRenderMs: this.lastRenderMs,
      maxActive: this.maxActive, maxWorker: this.maxActive, maxPending: 0, targetSize: SIZES[this.tier]};
  }

  configureFaults(options: FaultOptions): void {
    if (!this.audit) throw new Error('巡回の検査モードが必要です。');
    this.nextFaults = {...options};
  }

  release(gate: 'start' | 'completion'): void {
    if (!this.audit) throw new Error('巡回の検査モードが必要です。');
    if (this.job) this.worker?.postMessage({type: 'release', id: this.job.id, gate} satisfies MarbleCommand);
  }
}
