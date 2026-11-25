/** The deliberately small, versioned configuration contract. */
export type RendererId = 'cpu-worker' | 'webgl2';
export type PaletteId = 'lagoon' | 'ember';
export type Complex = { re: number; im: number };
export type Viewport = { reMin: number; reMax: number; imMin: number; imMax: number };

export interface Settings {
  schemaVersion: 1;
  renderer: { id: RendererId; version: '1.0.0'; precision: 'float64' | 'highp-float32' };
  c: Complex;
  viewport: Viewport;
  width: number;
  height: number;
  maxIterations: number;
  escapeRadius: 2;
  pixelSampling: 'center-top-left-y-up';
  palette: { id: PaletteId; version: '1.0.0' };
}

export const PRESETS: readonly Complex[] = Object.freeze([
  Object.freeze({ re: 0, im: 0 }),
  Object.freeze({ re: -1, im: 0 }),
  Object.freeze({ re: 1, im: 0 }),
  Object.freeze({ re: -0.8, im: 0.156 }),
  Object.freeze({ re: 0.285, im: 0.01 }),
]);

const SETTINGS_KEYS = [
  'schemaVersion', 'renderer', 'c', 'viewport', 'width', 'height',
  'maxIterations', 'escapeRadius', 'pixelSampling', 'palette',
];

function objectWithKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label}: object required`);
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
    throw new Error(`${label}: unexpected or missing fields`);
  }
  return record;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}: finite number required`);
  }
  return value;
}

function integer(value: unknown, min: number, max: number, label: string): number {
  const result = finite(value, label);
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new Error(`${label}: integer in [${min}, ${max}] required`);
  }
  return result;
}

/** Reject invalid inputs before a renderer sees them; never clamp or round. */
export function validateSettings(input: unknown): Settings {
  const record = objectWithKeys(input, SETTINGS_KEYS, 'settings');
  if (record.schemaVersion !== 1) throw new Error('schemaVersion: unsupported');
  const renderer = objectWithKeys(record.renderer, ['id', 'version', 'precision'], 'renderer');
  if (renderer.id !== 'cpu-worker' && renderer.id !== 'webgl2') throw new Error('renderer.id: unsupported');
  if (renderer.version !== '1.0.0') throw new Error('renderer.version: unsupported');
  const precision = renderer.id === 'cpu-worker' ? 'float64' : 'highp-float32';
  if (renderer.precision !== precision) throw new Error('renderer.precision: does not match renderer');

  const cInput = objectWithKeys(record.c, ['re', 'im'], 'c');
  const c = { re: finite(cInput.re, 'c.re'), im: finite(cInput.im, 'c.im') };
  if (Math.hypot(c.re, c.im) > 2) throw new Error('c: |c| must be at most 2');

  const v = objectWithKeys(record.viewport, ['reMin', 'reMax', 'imMin', 'imMax'], 'viewport');
  if (v.reMin !== -1.6 || v.reMax !== 1.6 || v.imMin !== -1.6 || v.imMax !== 1.6) {
    throw new Error('viewport: settings v1 requires [-1.6, 1.6] on both axes');
  }
  const width = integer(record.width, 1, 768, 'width');
  const height = integer(record.height, 1, 768, 'height');
  if (width !== height) throw new Error('dimensions: square aspect ratio required');
  const maxIterations = integer(record.maxIterations, 0, 512, 'maxIterations');
  if (record.escapeRadius !== 2) throw new Error('escapeRadius: must be 2');
  if (record.pixelSampling !== 'center-top-left-y-up') throw new Error('pixelSampling: unsupported');
  const palette = objectWithKeys(record.palette, ['id', 'version'], 'palette');
  if (palette.id !== 'lagoon' && palette.id !== 'ember') throw new Error('palette.id: unsupported');
  if (palette.version !== '1.0.0') throw new Error('palette.version: unsupported');

  return {
    schemaVersion: 1,
    renderer: { id: renderer.id, version: '1.0.0', precision },
    c,
    viewport: { reMin: -1.6, reMax: 1.6, imMin: -1.6, imMax: 1.6 },
    width, height, maxIterations,
    escapeRadius: 2,
    pixelSampling: 'center-top-left-y-up',
    palette: { id: palette.id, version: '1.0.0' },
  };
}

export function makeSettings(
  renderer: RendererId,
  c: Complex,
  width = 256,
  maxIterations = 128,
  palette: PaletteId = 'lagoon',
): Settings {
  return validateSettings({
    schemaVersion: 1,
    renderer: {
      id: renderer,
      version: '1.0.0',
      precision: renderer === 'cpu-worker' ? 'float64' : 'highp-float32',
    },
    c,
    viewport: { reMin: -1.6, reMax: 1.6, imMin: -1.6, imMax: 1.6 },
    width, height: width, maxIterations,
    escapeRadius: 2,
    pixelSampling: 'center-top-left-y-up',
    palette: { id: palette, version: '1.0.0' },
  });
}

export function parseSettings(json: string): Settings {
  return validateSettings(JSON.parse(json));
}

export function serializeSettings(settings: Settings): string {
  return JSON.stringify(validateSettings(settings), null, 2);
}
