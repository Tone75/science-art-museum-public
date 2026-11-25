import { CHUNK_ROWS, assertBufferBudget, fillRows, juliaSettings, numericKey, validIdentity } from './kernel.ts';
import type { CalculateCommand, WorkerCommand, WorkerResponse, Identity } from './kernel.ts';

const scope = self as unknown as { postMessage: (value: WorkerResponse, transfer?: Transferable[]) => void; onmessage: ((event: MessageEvent<unknown>) => void) | null };
type Job = { command: CalculateCommand; field: Uint16Array; row: number; timer: ReturnType<typeof setTimeout> | null; heldStart: boolean; heldCompletion: boolean };
let job: Job | null = null;
function identity(c: Identity): Identity { return { jobId: c.jobId, requestId: c.requestId, epoch: c.epoch, numericKey: c.numericKey }; }
function send(type: WorkerResponse['type'], c: Identity, row: number, timerScheduled: boolean, counts?: ArrayBuffer): void {
  const message: WorkerResponse = { ...identity(c), protocolVersion: 1, type, rows: row, timerScheduled };
  if (counts) message.counts = counts;
  scope.postMessage(message, counts ? [counts] : []);
}
function complete(current: Job): void {
  if (job !== current) return;
  if (current.command.faults.holdCompletion) { current.heldCompletion = true; send('ready', current.command, current.row, false); return; }
  const buffer = current.command.faults.invalidResponse ? new ArrayBuffer(2) : current.field.buffer as ArrayBuffer;
  job = null;
  send('complete', current.command, current.row, false, buffer);
}
function schedule(current: Job): void {
  if (job !== current || current.heldStart || current.command.faults.hangWorker) return;
  current.timer = setTimeout(() => {
    current.timer = null;
    if (job !== current) return;
    if (current.command.faults.throwWorker) throw new Error('Injected product Worker exception.');
    const start = current.row;
    const end = Math.min(start + CHUNK_ROWS, current.command.settings.height);
    fillRows(current.field, current.command.settings, start, end);
    current.row = end;
    // The first completed chunk proves real numerical execution before a stop test.
    if (start === 0) send('progress', current.command, end, end < current.command.settings.height);
    if (end === current.command.settings.height) complete(current);
    else schedule(current);
  }, 0);
}
scope.onmessage = (event) => {
  const raw = event.data;
  if (typeof raw !== 'object' || raw === null || !validIdentity(raw)) throw new Error('Invalid product worker command identity.');
  const command = raw as WorkerCommand;
  if (command.protocolVersion !== 1) throw new Error('Invalid product worker protocol.');
  if (command.type === 'calculate') {
    if (job) throw new Error('Product worker already has an active job.');
    const settings = juliaSettings(command.settings);
    if (numericKey(settings) !== command.numericKey) throw new Error('Worker settings/key mismatch.');
    assertBufferBudget(settings.width * settings.height * 2);
    const field = new Uint16Array(settings.width * settings.height);
    job = { command: { ...command, settings }, field, row: 0, timer: null, heldStart: !!command.faults.holdStart, heldCompletion: false };
    send('started', command, 0, !job.heldStart && !command.faults.hangWorker);
    schedule(job);
    return;
  }
  if (!['cancel', 'release-start', 'release-completion'].includes(command.type)) throw new Error('Invalid product worker command type.');
  const current = job;
  if (command.type === 'cancel') {
    if (current && current.command.jobId === command.jobId && current.command.epoch === command.epoch) {
      if (current.timer !== null) clearTimeout(current.timer);
      job = null;
      // No scheduled numerical work and no retained field remain when this acknowledgement is sent.
      send('cancelled', command, current.row, false);
    } else send('cancelled', command, 0, false); // Already finished or obsolete, never cancel a different job.
  } else if (current && current.command.jobId === command.jobId && current.command.epoch === command.epoch) {
    if (command.type === 'release-start' && current.heldStart) { current.heldStart = false; schedule(current); }
    if (command.type === 'release-completion' && current.heldCompletion) { current.command.faults.holdCompletion = false; current.heldCompletion = false; complete(current); }
  }
};
