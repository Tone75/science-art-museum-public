import { validateNumericalSettings } from '../numerics/contract.ts';
import type { NumericalSettings } from '../numerics/contract.ts';
import { UNESCAPED } from '../numerics/engine.ts';

export const PRODUCT_RENDERER_VERSION = '1.0.0';
export const CHUNK_ROWS = 16;
export const BUFFER_BUDGET_BYTES = 64 * 1024 * 1024;
export const WATCHDOG_MS = 5000;
export const CANCEL_CONFIRMATION_MS = 200;

export function juliaSettings(input: unknown): NumericalSettings & { mode: 'julia' } {
  const settings = validateNumericalSettings(input);
  if (settings.mode !== 'julia') throw new Error('Product renderer supports Julia mode only.');
  return settings;
}

export function numericKey(input: unknown): string {
  const s = juliaSettings(input);
  return JSON.stringify([s.contractVersion, s.mode, s.precision, s.width, s.height, s.maxIterations,
    s.escapeRadius, s.pixelSampling, s.viewport.reMin, s.viewport.reMax, s.viewport.imMin, s.viewport.imMax, s.c.re, s.c.im]);
}

export function assertBufferBudget(bytes: number): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > BUFFER_BUDGET_BYTES) {
    throw new Error('Managed buffer budget exceeded (64 MiB).');
  }
}

/** Fill whole-image rows with global indices, without constructing a tile viewport. */
export function fillRows(field: Uint16Array, input: unknown, startRow: number, endRow: number): void {
  const s = juliaSettings(input);
  if (!(field instanceof Uint16Array) || field.length !== s.width * s.height
    || !Number.isInteger(startRow) || !Number.isInteger(endRow) || startRow < 0 || endRow < startRow || endRow > s.height) {
    throw new Error('Invalid global row interval or field buffer.');
  }
  for (let j = startRow; j < endRow; j++) {
    const im = s.viewport.imMax - ((j + 0.5) / s.height) * (s.viewport.imMax - s.viewport.imMin);
    for (let i = 0; i < s.width; i++) {
      const re = s.viewport.reMin + ((i + 0.5) / s.width) * (s.viewport.reMax - s.viewport.reMin);
      let x = re, y = im, result = UNESCAPED;
      for (let n = 0; n <= s.maxIterations; n++) {
        if (x * x + y * y > 4) { result = n; break; }
        if (n === s.maxIterations) break;
        const nextX = x * x - y * y + s.c.re;
        y = 2 * x * y + s.c.im;
        x = nextX;
      }
      field[j * s.width + i] = result;
    }
  }
}

export type FaultOptions = {
  holdStart?: boolean; holdCompletion?: boolean; invalidResponse?: boolean; throwWorker?: boolean; hangWorker?: boolean;
};
export type Identity = { jobId: number; requestId: number; epoch: number; numericKey: string };
export type CalculateCommand = Identity & { type: 'calculate'; protocolVersion: 1; settings: NumericalSettings; faults: FaultOptions };
export type ControlCommand = Identity & { type: 'cancel' | 'release-start' | 'release-completion'; protocolVersion: 1 };
export type WorkerCommand = CalculateCommand | ControlCommand;
export type WorkerResponse = Identity & { protocolVersion: 1; type: 'started' | 'progress' | 'ready' | 'cancelled' | 'complete'; rows: number; timerScheduled: boolean; counts?: ArrayBuffer };

export function validIdentity(input: unknown): input is Identity {
  if (typeof input !== 'object' || input === null) return false;
  const value = input as Record<string, unknown>;
  return ['jobId', 'requestId', 'epoch'].every(k => Number.isSafeInteger(value[k]) && (value[k] as number) > 0)
    && typeof value.numericKey === 'string' && value.numericKey.length > 0;
}
