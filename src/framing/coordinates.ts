import type { NumericComplex, NumericViewport } from '../numerics/contract.ts';
import { validateProductViewport, ZOOM_SPANS } from './contract.ts';
export type ViewContentRect = { left: number; top: number; width: number; height: number };
function finite(n: unknown): number { if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('有限の座標を指定してください。'); return n; }
function rect(input: ViewContentRect): ViewContentRect {
  const r = { left: finite(input.left), top: finite(input.top), width: finite(input.width), height: finite(input.height) };
  if (r.width <= 0 || r.height <= 0) throw new Error('作品の表示寸法を確認できません。'); return r;
}
export function viewportCenter(input: NumericViewport): NumericComplex { const v = validateProductViewport(input); return { re: (v.reMin + v.reMax) / 2, im: (v.imMin + v.imMax) / 2 }; }
export function viewportSpan(input: NumericViewport): number { const v = validateProductViewport(input); return v.reMax - v.reMin; }
export function zoomViewport(input: NumericViewport, direction: 'in' | 'out'): NumericViewport {
  const v = validateProductViewport(input), center = viewportCenter(v), current = viewportSpan(v);
  if (direction !== 'in' && direction !== 'out') throw new Error('拡大方向を確認してください。');
  const tolerance = 8 * Number.EPSILON * Math.max(1, current);
  const next = direction === 'in' ? ZOOM_SPANS.find(s => s < current - tolerance) : [...ZOOM_SPANS].reverse().find(s => s > current + tolerance);
  if (next === undefined) throw new Error(direction === 'in' ? 'これ以上の拡大はできません（最小幅0.25）。' : 'これ以上は引けません（最大幅3.2）。');
  return validateProductViewport({ reMin: center.re - next / 2, reMax: center.re + next / 2, imMin: center.im - next / 2, imMax: center.im + next / 2 });
}
export function panViewport(input: NumericViewport, deltaRe: number, deltaIm: number): NumericViewport {
  const v = validateProductViewport(input), re = finite(deltaRe), im = finite(deltaIm);
  return validateProductViewport({ reMin: v.reMin + re, reMax: v.reMax + re, imMin: v.imMin + im, imMax: v.imMax + im });
}
export function panByFraction(input: NumericViewport, reFraction: number, imFraction: number): NumericViewport { return panViewport(input, viewportSpan(input) * finite(reFraction), viewportSpan(input) * finite(imFraction)); }
export function panFromDrag(input: NumericViewport, start: { x: number; y: number }, end: { x: number; y: number }, content: ViewContentRect): NumericViewport {
  const r = rect(content), span = viewportSpan(input);
  return panViewport(input, -(finite(end.x) - finite(start.x)) / r.width * span, (finite(end.y) - finite(start.y)) / r.height * span);
}
/** Continuous interaction coordinates; separate from numerical pixel-center sampling. */
export function planeFromUnit(input: NumericViewport, u: number, v: number): NumericComplex {
  const p = validateProductViewport(input), x = finite(u), y = finite(v);
  if (x < 0 || x > 1 || y < 0 || y > 1) throw new Error('作品の内側を選んでください。');
  return { re: p.reMin + x * (p.reMax - p.reMin), im: p.imMax - y * (p.imMax - p.imMin) };
}
export function clientToPlane(input: NumericViewport, x: number, y: number, content: ViewContentRect): NumericComplex { const r = rect(content); return planeFromUnit(input, (finite(x) - r.left) / r.width, (finite(y) - r.top) / r.height); }
export function pointToClient(input: NumericViewport, point: NumericComplex, content: ViewContentRect): { x: number; y: number } {
  const v = validateProductViewport(input), r = rect(content), re = finite(point.re), im = finite(point.im);
  return { x: r.left + (re - v.reMin) / (v.reMax - v.reMin) * r.width, y: r.top + (v.imMax - im) / (v.imMax - v.imMin) * r.height };
}
