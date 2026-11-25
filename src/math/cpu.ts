import { validateSettings } from '../config.ts';
import type { Settings, Viewport } from '../config.ts';

/** Distinct from every permitted escape iteration, including N = 512. */
export const SENTINEL = 65535;

function iterate(re: number, im: number, cRe: number, cIm: number, maxIterations: number): number | null {
  let x = re;
  let y = im;
  for (let n = 0; n <= maxIterations; n += 1) {
    if (x * x + y * y > 4) return n;
    if (n === maxIterations) break;
    const nextX = x * x - y * y + cRe;
    y = 2 * x * y + cIm;
    x = nextX;
  }
  return null;
}

/** First strict escape at n = 0..N; finite non-escape is represented by null. */
export function escapeCount(re: number, im: number, cRe: number, cIm: number, maxIterations: number): number | null {
  if (![re, im, cRe, cIm].every(Number.isFinite)) throw new Error('orbit: finite inputs required');
  if (Math.hypot(cRe, cIm) > 2) throw new Error('orbit: |c| must be at most 2');
  if (!Number.isInteger(maxIterations) || maxIterations < 0 || maxIterations > 512) {
    throw new Error('orbit: maxIterations must be an integer in [0, 512]');
  }
  return iterate(re, im, cRe, cIm, maxIterations);
}

/** Top-left array origin, pixel centers, imaginary coordinate increases upward. */
export function pixelCenter(i: number, j: number, width: number, height: number, viewport: Viewport): { re: number; im: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width !== height) {
    throw new Error('coordinates: positive square dimensions required');
  }
  if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || j < 0 || i >= width || j >= height) {
    throw new Error('coordinates: pixel index outside drawing buffer');
  }
  if (![viewport.reMin, viewport.reMax, viewport.imMin, viewport.imMax].every(Number.isFinite)
    || viewport.reMin >= viewport.reMax || viewport.imMin >= viewport.imMax) {
    throw new Error('coordinates: valid finite viewport required');
  }
  return {
    re: viewport.reMin + ((i + 0.5) / width) * (viewport.reMax - viewport.reMin),
    im: viewport.imMax - ((j + 0.5) / height) * (viewport.imMax - viewport.imMin),
  };
}

/** Always compute a fresh field. Color and display operations are separate. */
export function computeField(input: Settings): Uint16Array {
  const settings = validateSettings(input);
  const { width, height, viewport, c, maxIterations } = settings;
  const result = new Uint16Array(width * height);
  // Coordinates use exactly the same pixel-center expression as pixelCenter.
  // Inline it here to avoid per-pixel validation in the worker's hot loop.
  for (let j = 0; j < height; j += 1) {
    const im = viewport.imMax - ((j + 0.5) / height) * (viewport.imMax - viewport.imMin);
    for (let i = 0; i < width; i += 1) {
      const re = viewport.reMin + ((i + 0.5) / width) * (viewport.reMax - viewport.reMin);
      result[j * width + i] = iterate(re, im, c.re, c.im, maxIterations) ?? SENTINEL;
    }
  }
  return result;
}
