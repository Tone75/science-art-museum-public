/** Independent test oracle: no runtime imports from production numerical or validation code. */
import type { NumericalSettings } from '../src/numerics/contract.ts';

type Point = { re: number; im: number };

function finitePoint(value: unknown): Point {
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Reflect.ownKeys(value).length !== 2 || !Object.hasOwn(value, 're') || !Object.hasOwn(value, 'im')) {
    throw new Error('reference: complex pair required');
  }
  const point = value as Point;
  if (typeof point.re !== 'number' || typeof point.im !== 'number'
    || !Number.isFinite(point.re) || !Number.isFinite(point.im)) throw new Error('reference: finite complex pair required');
  return point;
}

function iterations(N: number): void {
  if (!Number.isInteger(N) || N < 0 || N > 512) throw new Error('reference: invalid iteration limit');
}

/** Deliberately different magnitude test, state representation, update order and loop. */
function orbit(parameter: Point, initial: Point, N: number): number | null {
  let state: [number, number] = [initial.re, initial.im];
  let step = 0;
  while (true) {
    if (Math.hypot(...state) > 2) return step;
    if (step >= N) return null;
    const [real, imaginary] = state;
    state = [real ** 2 - imaginary ** 2 + parameter.re, imaginary * real * 2 + parameter.im];
    step += 1;
  }
}

export function referenceJulia(c: Point, z0: Point, N: number): number | null {
  const parameter = finitePoint(c);
  const initial = finitePoint(z0);
  iterations(N);
  if (Math.hypot(parameter.re, parameter.im) > 2) throw new Error('reference: Julia parameter outside contract');
  return orbit(parameter, initial, N);
}

/** Mandelbrot parameters outside |c|=2 remain valid; its initial value is always zero. */
export function referenceMandelbrot(c: Point, N: number): number | null {
  const parameter = finitePoint(c);
  iterations(N);
  return orbit(parameter, { re: 0, im: 0 }, N);
}

function referenceCoordinateInput(i: number, j: number, input: NumericalSettings): void {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('reference: settings required');
  const required = ['contractVersion', 'mode', 'precision', 'width', 'height', 'maxIterations', 'escapeRadius', 'pixelSampling', 'viewport'];
  if (input.mode === 'julia') required.push('c');
  if (Reflect.ownKeys(input).length !== required.length || required.some((key) => !Object.hasOwn(input, key))) {
    throw new Error('reference: settings keys');
  }
  if (input.contractVersion !== 'SAM-003-N-v1' || !['julia', 'mandelbrot'].includes(input.mode)
    || input.precision !== 'float64' || input.escapeRadius !== 2 || input.pixelSampling !== 'center-top-left-y-up') {
    throw new Error('reference: unsupported contract');
  }
  for (const size of [input.width, input.height]) {
    if (!Number.isInteger(size) || size < 1 || size > 768) throw new Error('reference: invalid dimensions');
  }
  iterations(input.maxIterations);
  if (input.mode === 'julia' && Math.hypot(...Object.values(finitePoint(input.c))) > 2) throw new Error('reference: Julia c range');
  const v = input.viewport;
  if (typeof v !== 'object' || v === null || Array.isArray(v)
    || Reflect.ownKeys(v).length !== 4 || ['reMin', 'reMax', 'imMin', 'imMax'].some((key) => !Object.hasOwn(v, key))) {
    throw new Error('reference: viewport required');
  }
  if (Object.values(v).some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < -4 || value > 4)) {
    throw new Error('reference: viewport endpoints');
  }
  for (const span of [v.reMax - v.reMin, v.imMax - v.imMin]) {
    if (span < 0.25 || span > 8) throw new Error('reference: viewport span');
  }
  if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= input.width || j >= input.height) {
    throw new Error('reference: invalid pixel index');
  }
}

/** Independent operation order, using the actual drawing-buffer pixel center. */
export function referenceCoordinate(i: number, j: number, settings: NumericalSettings): Point {
  referenceCoordinateInput(i, j, settings);
  const v = settings.viewport;
  return {
    re: v.reMin + (v.reMax - v.reMin) * (i + 0.5) / settings.width,
    im: v.imMax - (v.imMax - v.imMin) * (j + 0.5) / settings.height,
  };
}
