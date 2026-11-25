// One complete binary64 Julia frame. The owner terminates the Worker to interrupt any orbit in flight.
import { colorizeArtField, type DisplayPaletteId } from '../art/palette.ts';
import { fillRows, juliaSettings, type FaultOptions } from '../product/kernel.ts';
import type { JuliaNumericalSettings } from '../framing/contract.ts';

export type MarbleCommand = {
  type: 'render'; id: number; settings: JuliaNumericalSettings; palette: DisplayPaletteId; faults?: FaultOptions;
} | { type: 'release'; gate: 'start' | 'completion'; id: number };
export type MarbleReply = { id: number; rgba: ArrayBuffer };

const scope = self as unknown as {
  onmessage: (event: MessageEvent<MarbleCommand>) => void;
  postMessage(message: MarbleReply, transfer: Transferable[]): void;
};

let held: { id: number; gate: 'start' | 'completion'; release: () => void } | null = null;
const research = false;

function render(job: Extract<MarbleCommand, {type: 'render'}>): void {
  const faults = research ? job.faults : undefined;
  if (faults?.throwWorker) throw new Error('Injected tour Worker error');
  if (faults?.hangWorker) return;
  const settings = juliaSettings(job.settings);
  const field = new Uint16Array(settings.width * settings.height);
  fillRows(field, settings, 0, settings.height);
  const rgba = faults?.invalidResponse ? new ArrayBuffer(1)
    : colorizeArtField(field, settings, job.palette).buffer as ArrayBuffer;
  const deliver = () => scope.postMessage({id: job.id, rgba}, [rgba]);
  if (faults?.holdCompletion) held = {id: job.id, gate: 'completion', release: deliver};
  else deliver();
}

scope.onmessage = ({data}) => {
  if (data.type === 'release') {
    if (research && held && data.id === held.id && data.gate === held.gate) {
      const action = held.release;
      held = null;
      action();
    }
    return;
  }
  if (research && data.faults?.holdStart) held = {id: data.id, gate: 'start', release: () => render(data)};
  else render(data);
};
