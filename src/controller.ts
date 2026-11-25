import { validateSettings, type Settings } from './config.ts';

export interface Driver {
  render(settings: Settings): Promise<void>;
  present(): Promise<void>;
  dispose?(): void;
}
export interface RequestRecord {
  id: number;
  settings: Settings;
  plannedAt: number | null;
  requestedAt: number;
  issuanceDelayMs: number | null;
  startedAt: number | null;
  completedAt: number | null;
  presentationCompletedAt: number | null;
  displayedAt: number | null;
  discardedAt: number | null;
  responseAt: number | null;
  responseMs: number | null;
  status: 'pending' | 'running' | 'displayed' | 'discarded' | 'error' | 'timeout';
  reason: string | null;
}
type Job = { record: RequestRecord; resolve: (v: RequestRecord) => void };
const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** One active + one replaceable pending job. GPU work is never physically cancelled. */
export class RenderController {
  readonly history: RequestRecord[] = [];
  maxPendingObserved = 0;
  private latest = 0;
  private active = false;
  private pending: Job | null = null;
  private poisoned = false;
  private readonly driver: Driver;
  private readonly frame: () => Promise<void>;
  private readonly onRequest: () => void;
  private readonly onDisplay: (record: RequestRecord) => void;

  constructor(driver: Driver, options: {
    frame?: () => Promise<void>;
    onRequest?: () => void;
    onDisplay?: (record: RequestRecord) => void;
  } = {}) {
    this.driver = driver;
    this.frame = options.frame ?? nextFrame;
    this.onRequest = options.onRequest ?? (() => {});
    this.onDisplay = options.onDisplay ?? (() => {});
  }

  request(input: Settings, plannedAt: number | null = null): Promise<RequestRecord> {
    const settings = validateSettings(input);
    const requestedAt = performance.now();
    const record: RequestRecord = {
      id: ++this.latest, settings, plannedAt, requestedAt,
      issuanceDelayMs: plannedAt === null ? null : requestedAt - plannedAt,
      startedAt: null, completedAt: null, presentationCompletedAt: null,
      displayedAt: null, discardedAt: null, responseAt: null, responseMs: null,
      status: 'pending', reason: null,
    };
    this.history.push(record);
    // Hide the old canvas synchronously, including while a previous GPU blit drains.
    this.onRequest();
    return new Promise((resolve) => {
      const job = { record, resolve };
      if (this.active) {
        if (this.pending) this.discard(this.pending, 'superseded-pending');
        this.pending = job;
        this.maxPendingObserved = Math.max(this.maxPendingObserved, 1);
      } else void this.run(job);
    });
  }

  private discard(job: Job, reason: string): void {
    job.record.status = 'discarded';
    job.record.reason = reason;
    job.record.discardedAt = performance.now();
    job.resolve(job.record);
  }

  private async run(job: Job): Promise<void> {
    this.active = true;
    const r = job.record;
    r.status = 'running';
    r.startedAt = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (this.poisoned) throw new Error('Renderer unavailable after a previous device failure; reload required.');
      const expiry = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Draw exceeded 5000ms.')),
          Math.max(0, r.requestedAt + 5000 - performance.now()));
      });
      const step = <T>(operation: Promise<T>): Promise<T> => Promise.race([operation, expiry]);
      await step(this.driver.render(r.settings));
      r.completedAt = performance.now();
      if (r.id !== this.latest) { this.discard(job, 'superseded-active'); return; }
      await step(this.driver.present());
      r.presentationCompletedAt = performance.now();
      await step(this.frame());
      if (r.id !== this.latest) { this.discard(job, 'superseded-before-visibility'); return; }
      // Visibility is committed only after GPU completion and a fresh ID check.
      r.displayedAt = performance.now();
      this.onDisplay(r);
      await step(this.frame());
      r.responseAt = performance.now();
      r.responseMs = r.responseAt - r.requestedAt;
      r.status = 'displayed';
      job.resolve(r);
    } catch (error) {
      r.reason = error instanceof Error ? error.message : 'Unknown rendering error';
      r.status = /5000|timeout/i.test(r.reason) ? 'timeout' : 'error';
      if (r.status === 'timeout') {
        this.poisoned = true;
        // No more jobs are submitted to a timed-out device. GL disposal is not
        // a claim that already submitted GPU commands were physically stopped.
        this.driver.dispose?.();
      }
      r.responseAt = performance.now();
      job.resolve(r);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      this.active = false;
      const pending = this.pending;
      this.pending = null;
      if (pending) void this.run(pending);
    }
  }
}
