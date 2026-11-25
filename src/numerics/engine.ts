import { validateNumericalSettings } from './contract.ts';
import type { NumericalSettings, NumericComplex } from './contract.ts';

/** Reserved for finite non-escape; distinct from every permitted n, including 512. */
export const UNESCAPED = 65535;

function finiteComplex(input: NumericComplex, label: string): NumericComplex {
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || Reflect.ownKeys(input).length !== 2 || !Object.hasOwn(input, 're') || !Object.hasOwn(input, 'im')
    || typeof input.re !== 'number' || typeof input.im !== 'number'
    || !Number.isFinite(input.re) || !Number.isFinite(input.im)) {
    throw new Error(`${label}: finite complex pair required`);
  }
  return { re: input.re, im: input.im };
}

function iterationLimit(input: number): number {
  if (!Number.isInteger(input) || input < 0 || input > 512) {
    throw new Error('maxIterations: integer in [0, 512] required');
  }
  return input;
}

/** Shared arithmetic only: callers establish the different mode domains. */
function firstEscape(zRe: number, zIm: number, cRe: number, cIm: number, limit: number): number | null {
  let x = zRe;
  let y = zIm;
  for (let n = 0; n <= limit; n += 1) {
    if (x * x + y * y > 4) return n;
    if (n === limit) break;
    // Keep the existing CPU renderer's Number operation order in the overlap.
    const nextX = x * x - y * y + cRe;
    y = 2 * x * y + cIm;
    x = nextX;
  }
  return null;
}

/** Fixed Julia c; z0 may be any finite initial value, including outside R = 2. */
export function juliaEscape(c: NumericComplex, z0: NumericComplex, maxIterations: number): number | null {
  const parameter = finiteComplex(c, 'Julia c');
  const initial = finiteComplex(z0, 'Julia z0');
  const limit = iterationLimit(maxIterations);
  if (Math.hypot(parameter.re, parameter.im) > 2) throw new Error('Julia c: |c| must be at most 2');
  return firstEscape(initial.re, initial.im, parameter.re, parameter.im, limit);
}

/** Parameter-plane orbit: c is finite, z0 = 0; |c| > 2 is valid here. */
export function mandelbrotEscape(c: NumericComplex, maxIterations: number): number | null {
  const parameter = finiteComplex(c, 'Mandelbrot c');
  const limit = iterationLimit(maxIterations);
  return firstEscape(0, 0, parameter.re, parameter.im, limit);
}

/** Top-left array origin; pixel centers; positive imaginary direction is upward. */
export function coordinateAt(i: number, j: number, input: NumericalSettings): NumericComplex {
  const settings = validateNumericalSettings(input);
  if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= settings.width || j >= settings.height) {
    throw new Error('coordinates: pixel index outside drawing buffer');
  }
  const { viewport, width, height } = settings;
  return {
    re: viewport.reMin + ((i + 0.5) / width) * (viewport.reMax - viewport.reMin),
    im: viewport.imMax - ((j + 0.5) / height) * (viewport.imMax - viewport.imMin),
  };
}

/** Fresh row-major numerical field. Buffer aspect and viewport aspect are independent. */
export function computeNumericalField(input: unknown): Uint16Array {
  const settings = validateNumericalSettings(input);
  const { width, height, maxIterations, viewport } = settings;
  // No field buffer is allocated until the complete mode-specific input is valid.
  const field = new Uint16Array(width * height);
  const cRe = settings.mode === 'julia' ? settings.c.re : 0;
  const cIm = settings.mode === 'julia' ? settings.c.im : 0;
  for (let j = 0; j < height; j += 1) {
    const im = viewport.imMax - ((j + 0.5) / height) * (viewport.imMax - viewport.imMin);
    for (let i = 0; i < width; i += 1) {
      const re = viewport.reMin + ((i + 0.5) / width) * (viewport.reMax - viewport.reMin);
      const count = settings.mode === 'julia'
        ? firstEscape(re, im, cRe, cIm, maxIterations)
        : firstEscape(0, 0, re, im, maxIterations);
      field[j * width + i] = count ?? UNESCAPED;
    }
  }
  return field;
}
