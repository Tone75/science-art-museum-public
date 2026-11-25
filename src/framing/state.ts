import { LIVE_WORKS } from '../art/works.ts';
import { validateProductView, type ProductView } from './contract.ts';

export const INITIAL_PRODUCT_VIEWPORT = Object.freeze({ reMin: -1.6, reMax: 1.6, imMin: -1.6, imMax: 1.6 });
/** Work selection, unlike an individual control, deliberately restores the complete work default. */
export function defaultWorkView(id: string): ProductView {
  const work = LIVE_WORKS.find(w => w.id === id);
  if (!work) throw new Error('作品を確認してください。');
  return validateProductView({ schemaVersion: 'SAM-006-B-view-v1', c: work.c, viewport: INITIAL_PRODUCT_VIEWPORT,
    maxIterations: 512, resolution: 768, displayPalette: work.palette });
}
/** All independent controls retain fields not explicitly changed. No coercion, rounding or clamp. */
export function updateProductView(input: ProductView, patch: Partial<ProductView>): ProductView {
  return validateProductView({ ...validateProductView(input), ...patch });
}
export function restoreProductComposition(input: ProductView): ProductView {
  return updateProductView(input, { viewport: INITIAL_PRODUCT_VIEWPORT });
}
