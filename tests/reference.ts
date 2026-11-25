/** Independent test reference. No imports from production math or color code. */
import type { Settings } from '../src/config.ts';

export interface AnalyticCase {
  name: string;
  re: number;
  im: number;
  c: { re: number; im: number };
  N: number;
  expected: number | null;
}

export const ANALYTIC_CASES: readonly AnalyticCase[] = [
  { name: 'c=0 critical fixed orbit', re: 0, im: 0, c: { re: 0, im: 0 }, N: 256, expected: null },
  { name: 'c=-1 critical two-cycle', re: 0, im: 0, c: { re: -1, im: 0 }, N: 256, expected: null },
  { name: 'c=1 escapes exactly at N=3', re: 0, im: 0, c: { re: 1, im: 0 }, N: 3, expected: 3 },
  { name: 'c=1 remains unescaped through N=2', re: 0, im: 0, c: { re: 1, im: 0 }, N: 2, expected: null },
  { name: 'c=-2 radius equality orbit 0,-2,2,2', re: 0, im: 0, c: { re: -2, im: 0 }, N: 256, expected: null },
  { name: 'c=0 unit fixed point', re: 1, im: 0, c: { re: 0, im: 0 }, N: 512, expected: null },
  { name: 'strict radius equality at n=0', re: 2, im: 0, c: { re: 0, im: 0 }, N: 0, expected: null },
  { name: 'radius initial point escapes at n=1=N', re: 2, im: 0, c: { re: 0, im: 0 }, N: 1, expected: 1 },
  { name: 'initially outside escapes at n=0', re: 3, im: 0, c: { re: 0, im: 0 }, N: 0, expected: 0 },
  { name: 'n=0 interior is unescaped', re: 0, im: 0, c: { re: 1, im: 0 }, N: 0, expected: null },
  { name: 'imaginary radius equality', re: 0, im: 2, c: { re: 0, im: 0 }, N: 1, expected: 1 },
  { name: 'negative radius equality', re: -2, im: 0, c: { re: 0, im: 0 }, N: 1, expected: 1 },
];

/** Explicit state-vector update and magnitude rather than production squared test. */
export function referenceEscape(re: number, im: number, cRe: number, cIm: number, maxIterations: number): number | null {
  if (![re, im, cRe, cIm].every(Number.isFinite) || Math.hypot(cRe, cIm) > 2
    || !Number.isInteger(maxIterations) || maxIterations < 0 || maxIterations > 512) {
    throw new Error('reference: invalid orbit input');
  }
  let state = [re, im];
  let n = 0;
  while (true) {
    if (Math.hypot(state[0]!, state[1]!) > 2) return n;
    if (n >= maxIterations) return null;
    const [real, imaginary] = state as [number, number];
    state = [real ** 2 - imaginary ** 2 + cRe, imaginary * real * 2 + cIm];
    n += 1;
  }
}

/** Independent coordinate expression at the actual selected drawing-buffer pixel. */
export function referencePixel(i: number, j: number, settings: Settings): { re: number; im: number } {
  const { viewport: v, width, height } = settings;
  return {
    re: v.reMin + (v.reMax - v.reMin) * (i + 0.5) / width,
    im: v.imMax - (v.imMax - v.imMin) * (j + 0.5) / height,
  };
}
