/** Continuous interaction coordinates; distinct from the map's pixel centers. */
export type ParameterC = { re: number; im: number };
export type ContentRect = { left: number; top: number; width: number; height: number };
export const INITIAL_SELECTION = Object.freeze({
  c: Object.freeze({ re: -0.8, im: 0.156 }), palette: 'lagoon' as const, quality: 'preview' as const,
});
export const PARAMETER_VIEWPORT = Object.freeze({ reMin: -2, reMax: 1, imMin: -1, imMax: 1 });
const zero = (x: number): number => Object.is(x, -0) ? 0 : x;
function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name}は有限の数値で入力してください。`);
  return zero(value);
}
function planePoint(input: unknown): ParameterC {
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || Reflect.ownKeys(input).length !== 2 || !Object.hasOwn(input, 're') || !Object.hasOwn(input, 'im')) {
    throw new Error('cは実部と虚部の組で指定してください。');
  }
  const v = input as ParameterC;
  const c = { re: finite(v.re, '実部'), im: finite(v.im, '虚部') };
  if (c.re < -2 || c.re > 1 || c.im < -1 || c.im > 1) throw new Error('地図の範囲（実部−2〜1、虚部−1〜1）の点を選んでください。');
  return c;
}
/** Canonical c retains its Number values; never quantize, clamp or reconstruct from captions. */
export function validateParameter(input: unknown): ParameterC {
  const c = planePoint(input);
  if (Math.hypot(c.re, c.im) > 2) throw new Error('この展示では |c|≤2 の点を選べます。集合への所属を判定する制限ではありません。');
  return c;
}
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function parseParameterDraft(real: string, imaginary: string): ParameterC {
  if (typeof real !== 'string' || typeof imaginary !== 'string') throw new Error('実部・虚部を数値で入力してください。');
  const re = real.trim(), im = imaginary.trim();
  if (!re || !im) throw new Error('実部・虚部の両方を入力してください。');
  if (!DECIMAL.test(re) || !DECIMAL.test(im)) throw new Error('実部・虚部は十進数で入力してください。');
  return validateParameter({ re: Number(re), im: Number(im) });
}
function unit(value: number, name: string): number {
  const n = finite(value, name);
  if (n < 0 || n > 1) throw new Error('地図の内側を選んでください。');
  return n;
}
/** Geometric conversion only. Rectangle corners outside |c|≤2 remain valid geometry fixtures. */
export function planeFromUnit(u: number, v: number): ParameterC {
  return { re: zero(-2 + 3 * unit(u, 'u')), im: zero(1 - 2 * unit(v, 'v')) };
}
/** Selection additionally enforces the supported Julia parameter domain. */
export function fromUnit(u: number, v: number): ParameterC { return validateParameter(planeFromUnit(u, v)); }
/** Inverse geometric conversion; domain membership is checked separately when committing input. */
export function toUnit(input: ParameterC): { u: number; v: number } {
  const c = planePoint(input);
  return { u: (c.re + 2) / 3, v: (1 - c.im) / 2 };
}
function rectangle(input: ContentRect): ContentRect {
  if (typeof input !== 'object' || input === null) throw new Error('地図の表示領域を確認できません。');
  const rect = { left: finite(input.left, '地図位置'), top: finite(input.top, '地図位置'), width: finite(input.width, '地図幅'), height: finite(input.height, '地図高さ') };
  if (rect.width <= 0 || rect.height <= 0) throw new Error('地図の表示領域を確認できません。');
  return rect;
}
export function pointerToPlane(clientX: number, clientY: number, content: ContentRect): ParameterC {
  const r = rectangle(content);
  return planeFromUnit((finite(clientX, 'pointerX') - r.left) / r.width, (finite(clientY, 'pointerY') - r.top) / r.height);
}
export function pointerToParameter(clientX: number, clientY: number, content: ContentRect): ParameterC {
  return validateParameter(pointerToPlane(clientX, clientY, content));
}
/** Returns geometric screen position for the same unrounded c. */
export function parameterToClient(c: ParameterC, content: ContentRect): { x: number; y: number } {
  const r = rectangle(content), uv = toUnit(c);
  return { x: r.left + uv.u * r.width, y: r.top + uv.v * r.height };
}
/** Remove layout border/padding after rendered scale. DPR is deliberately not multiplied. */
export function getContentRect(element: HTMLElement): ContentRect {
  const r = element.getBoundingClientRect(), style = getComputedStyle(element);
  const px = (value: string): number => { const n = Number.parseFloat(value); if (!Number.isFinite(n) || n < 0) throw new Error('地図のCSS寸法を確認できません。'); return n; };
  const bl = px(style.borderLeftWidth), br = px(style.borderRightWidth), bt = px(style.borderTopWidth), bb = px(style.borderBottomWidth);
  const pl = px(style.paddingLeft), pr = px(style.paddingRight), pt = px(style.paddingTop), pb = px(style.paddingBottom);
  const w = px(style.width), h = px(style.height);
  const borderWidth = style.boxSizing === 'border-box' ? w : w + pl + pr + bl + br;
  const borderHeight = style.boxSizing === 'border-box' ? h : h + pt + pb + bt + bb;
  if (borderWidth <= 0 || borderHeight <= 0) throw new Error('地図の表示領域を確認できません。');
  const sx = r.width / borderWidth, sy = r.height / borderHeight;
  const transform = style.transform;
  if (transform && transform !== 'none') {
    const matrix = new DOMMatrixReadOnly(transform);
    if (matrix.b !== 0 || matrix.c !== 0 || !matrix.is2D || matrix.a <= 0 || matrix.d <= 0) throw new Error('回転・反転した地図の操作は未対応です。');
  }
  return rectangle({ left: r.left + (bl + pl) * sx, top: r.top + (bt + pt) * sy,
    width: (borderWidth - bl - br - pl - pr) * sx, height: (borderHeight - bt - bb - pt - pb) * sy });
}
export function arrowParameter(input: ParameterC, key: string, shift = false): ParameterC {
  const c = validateParameter(input), step = shift ? 0.1 : 0.01;
  if (key === 'ArrowLeft') return validateParameter({ re: c.re - step, im: c.im });
  if (key === 'ArrowRight') return validateParameter({ re: c.re + step, im: c.im });
  if (key === 'ArrowUp') return validateParameter({ re: c.re, im: c.im + step });
  if (key === 'ArrowDown') return validateParameter({ re: c.re, im: c.im - step });
  throw new Error('対応していない地図キーです。');
}
