import type { NumericalSettings } from '../numerics/contract.ts';

/** Precomputed Mandelbrot field; never recomputed on UI selection. */
export const PARAMETER_MAP_SETTINGS: NumericalSettings = Object.freeze({
  contractVersion: 'SAM-003-N-v1', mode: 'mandelbrot', precision: 'float64',
  width: 288, height: 192, maxIterations: 128, escapeRadius: 2,
  pixelSampling: 'center-top-left-y-up',
  viewport: Object.freeze({ reMin: -2, reMax: 1, imMin: -1, imMax: 1 }),
});
export const MAP_GENERATOR_VERSION = 'SAM-005-map-generator-v1';
export const MAP_ASSET_VERSION = 'SAM-005-fixed-mandelbrot-v1';
export const MAP_PALETTE = Object.freeze({ id: 'lagoon' as const, version: '1.0.0' });
export const MAP_PIXELS = 288 * 192;
export const MAP_FIELD_BYTES = MAP_PIXELS * 2;
export const MAP_RGBA_BYTES = MAP_PIXELS * 4;
export const MAP_CACHE_BASELINE_BYTES = MAP_FIELD_BYTES + MAP_RGBA_BYTES * 2;
export const MAP_MANIFEST_URL = '/parameter-map/manifest.json';
