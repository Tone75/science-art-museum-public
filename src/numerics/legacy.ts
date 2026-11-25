import { validateSettings } from '../config.ts';
import { validateNumericalSettings } from './contract.ts';
import type { NumericalSettings } from './contract.ts';

/** Explicit adapter; the strict legacy schema and normal exhibition stay unchanged. */
export function fromLegacySettings(input: unknown): NumericalSettings {
  const settings = validateSettings(input);
  if (settings.renderer.id !== 'cpu-worker') throw new Error('legacy adapter: cpu-worker settings required');
  return validateNumericalSettings({
    contractVersion: 'SAM-003-N-v1',
    mode: 'julia',
    precision: 'float64',
    width: settings.width,
    height: settings.height,
    maxIterations: settings.maxIterations,
    escapeRadius: settings.escapeRadius,
    pixelSampling: settings.pixelSampling,
    viewport: { ...settings.viewport },
    c: { ...settings.c },
  });
}
