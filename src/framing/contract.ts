import { validateNumericalSettings, type NumericComplex, type NumericViewport, type NumericalSettings } from '../numerics/contract.ts';
import { validateDisplayPalette, type DisplayPaletteId } from '../art/palette.ts';
import { validateParameter } from '../parameter/coordinates.ts';

export const PRODUCT_VIEW_VERSION = 'SAM-006-B-view-v1' as const;
export const INITIAL_VIEWPORT: Readonly<NumericViewport> = Object.freeze({ reMin: -1.6, reMax: 1.6, imMin: -1.6, imMax: 1.6 });
export const ZOOM_SPANS = Object.freeze([3.2, 1.6, .8, .4, .25] as const);
export type ViewStage = 'intermediate' | 'final';
export type JuliaNumericalSettings = NumericalSettings & { mode: 'julia' };
export type ProductView = {
  schemaVersion: typeof PRODUCT_VIEW_VERSION;
  c: NumericComplex;
  viewport: NumericViewport;
  maxIterations: 128 | 256 | 512;
  resolution: 256 | 768;
  displayPalette: DisplayPaletteId;
};
function exactObject(input: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Reflect.ownKeys(input).length !== keys.length || keys.some(k => !Object.hasOwn(input, k))) throw new Error(`${label}: unexpected or missing fields`);
  return input as Record<string, unknown>;
}
function finite(input: unknown, label: string): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) throw new Error(`${label}: finite number required`);
  return input;
}
/** Product bounds are deliberately narrower than the independently validated numerical API. */
export function validateProductViewport(input: unknown): NumericViewport {
  const v = exactObject(input, ['reMin', 'reMax', 'imMin', 'imMax'], 'viewport');
  const result = { reMin: finite(v.reMin, 'reMin'), reMax: finite(v.reMax, 'reMax'), imMin: finite(v.imMin, 'imMin'), imMax: finite(v.imMax, 'imMax') };
  if (Object.values(result).some(n => n < -4 || n > 4)) throw new Error('構図の端点は−4〜4の範囲です。');
  const sx = result.reMax - result.reMin, sy = result.imMax - result.imMin;
  if (sx < .25 || sx > 3.2 || sy < .25 || sy > 3.2) throw new Error('構図の幅は0.25〜3.2の範囲です。');
  // An additive pan can produce one-ulp differences between axis spans. Accept that
  // representational equality only; keep endpoints untouched, with strict outer bounds.
  if (Math.abs(sx - sy) > 8 * Number.EPSILON * Math.max(1, Math.abs(sx), Math.abs(sy))) throw new Error('構図は正方形で指定してください。');
  return result;
}
export function validateProductView(input: unknown): ProductView {
  const v = exactObject(input, ['schemaVersion', 'c', 'viewport', 'maxIterations', 'resolution', 'displayPalette'], 'product view');
  if (v.schemaVersion !== PRODUCT_VIEW_VERSION) throw new Error('product view: unsupported schema');
  const c = exactObject(v.c, ['re', 'im'], 'c');
  const value = validateParameter({ re: finite(c.re, 'c.re'), im: finite(c.im, 'c.im') });
  if (v.maxIterations !== 128 && v.maxIterations !== 256 && v.maxIterations !== 512) throw new Error('反復上限は128・256・512から選んでください。');
  if (v.resolution !== 256 && v.resolution !== 768) throw new Error('確定解像度は256・768から選んでください。');
  const result: ProductView = { schemaVersion: PRODUCT_VIEW_VERSION, c: value, viewport: validateProductViewport(v.viewport), maxIterations: v.maxIterations, resolution: v.resolution, displayPalette: validateDisplayPalette(v.displayPalette) };
  // The unchanged numerical validator remains the final adapter gate.
  validateNumericalSettings(numericalObject(result, 'final'));
  return result;
}
export function cloneProductView(input: unknown): ProductView { return validateProductView(input); }
function numericalObject(view: ProductView, stage: ViewStage): JuliaNumericalSettings {
  return { contractVersion: 'SAM-003-N-v1', mode: 'julia', precision: 'float64', c: { ...view.c }, viewport: { ...view.viewport }, width: stage === 'intermediate' ? 256 : view.resolution, height: stage === 'intermediate' ? 256 : view.resolution, maxIterations: stage === 'intermediate' ? Math.min(view.maxIterations, 128) : view.maxIterations, escapeRadius: 2, pixelSampling: 'center-top-left-y-up' };
}
export function toNumericalSettings(input: unknown, stage: ViewStage = 'final'): JuliaNumericalSettings {
  if (stage !== 'intermediate' && stage !== 'final') throw new Error('view stage: unsupported');
  return validateNumericalSettings(numericalObject(validateProductView(input), stage)) as JuliaNumericalSettings;
}
