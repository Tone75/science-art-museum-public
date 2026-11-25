/** Versioned numerical contract, independent of the exhibition's Settings v1. */
export const NUMERICAL_CONTRACT_VERSION = 'SAM-003-N-v1' as const;

export type NumericComplex = { re: number; im: number };
export type NumericViewport = { reMin: number; reMax: number; imMin: number; imMax: number };

type NumericalBase = {
  contractVersion: typeof NUMERICAL_CONTRACT_VERSION;
  precision: 'float64';
  width: number;
  height: number;
  maxIterations: number;
  escapeRadius: 2;
  pixelSampling: 'center-top-left-y-up';
  viewport: NumericViewport;
};

/** Julia pixels supply z0; Mandelbrot pixels supply c and always start at z0 = 0. */
export type NumericalSettings =
  | (NumericalBase & { mode: 'julia'; c: NumericComplex })
  | (NumericalBase & { mode: 'mandelbrot' });

const COMMON_KEYS = [
  'contractVersion', 'mode', 'precision', 'width', 'height', 'maxIterations',
  'escapeRadius', 'pixelSampling', 'viewport',
] as const;

function objectWithKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label}: object required`);
  }
  const record = value as Record<string, unknown>;
  // Also reject symbol and non-enumerable extras on non-JSON callers.
  if (Reflect.ownKeys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
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

function viewportFrom(input: unknown): NumericViewport {
  const record = objectWithKeys(input, ['reMin', 'reMax', 'imMin', 'imMax'], 'viewport');
  const viewport: NumericViewport = {
    reMin: finite(record.reMin, 'viewport.reMin'),
    reMax: finite(record.reMax, 'viewport.reMax'),
    imMin: finite(record.imMin, 'viewport.imMin'),
    imMax: finite(record.imMax, 'viewport.imMax'),
  };
  for (const value of Object.values(viewport)) {
    if (value < -4 || value > 4) throw new Error('viewport: endpoints must be in [-4, 4]');
  }
  const reSpan = viewport.reMax - viewport.reMin;
  const imSpan = viewport.imMax - viewport.imMin;
  if (reSpan < 0.25 || reSpan > 8 || imSpan < 0.25 || imSpan > 8) {
    throw new Error('viewport: each ascending axis span must be in [0.25, 8]');
  }
  return viewport;
}

/** Validate completely before any field allocation; do not clamp or coerce. */
export function validateNumericalSettings(input: unknown): NumericalSettings {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('numerical settings: object required');
  }
  const mode = (input as Record<string, unknown>).mode;
  if (mode !== 'julia' && mode !== 'mandelbrot') throw new Error('mode: unsupported');
  const record = objectWithKeys(input, mode === 'julia' ? [...COMMON_KEYS, 'c'] : COMMON_KEYS, 'numerical settings');
  if (record.contractVersion !== NUMERICAL_CONTRACT_VERSION) throw new Error('contractVersion: unsupported');
  if (record.precision !== 'float64') throw new Error('precision: must be float64');
  const width = integer(record.width, 1, 768, 'width');
  const height = integer(record.height, 1, 768, 'height');
  const maxIterations = integer(record.maxIterations, 0, 512, 'maxIterations');
  if (record.escapeRadius !== 2) throw new Error('escapeRadius: must be 2');
  if (record.pixelSampling !== 'center-top-left-y-up') throw new Error('pixelSampling: unsupported');
  const viewport = viewportFrom(record.viewport);
  const base: NumericalBase = {
    contractVersion: NUMERICAL_CONTRACT_VERSION,
    precision: 'float64', width, height, maxIterations,
    escapeRadius: 2, pixelSampling: 'center-top-left-y-up', viewport,
  };
  if (mode === 'mandelbrot') return { ...base, mode };

  const cInput = objectWithKeys(record.c, ['re', 'im'], 'c');
  const c = { re: finite(cInput.re, 'c.re'), im: finite(cInput.im, 'c.im') };
  if (Math.hypot(c.re, c.im) > 2) throw new Error('c: Julia |c| must be at most 2');
  return { ...base, mode, c };
}

/** A numeric configuration exchange, not the product's future save format. */
export function serializeNumericalSettings(input: unknown): string {
  return JSON.stringify(validateNumericalSettings(input), null, 2);
}

export function parseNumericalSettings(json: string): NumericalSettings {
  if (typeof json !== 'string') throw new Error('numerical settings JSON: string required');
  return validateNumericalSettings(JSON.parse(json));
}
