import { makeSettings, type Settings } from '../config.ts';
import { validateDisplayPalette, legacyBasePalette, type DisplayPaletteId } from './palette.ts';
export { DISPLAY_PALETTES } from './palette.ts';

export const ART_WORK_VERSION = 'SAM-006-A-works-v1';
export const ART_GENERATOR_VERSION = 'SAM-006-A-generator-v1';
export const ART_QUALITY = Object.freeze({
  preview: Object.freeze({ width: 256, height: 256, maxIterations: 128 }),
  full: Object.freeze({ width: 768, height: 768, maxIterations: 512 }),
});
export const LIVE_WORKS = Object.freeze([
  Object.freeze({ id: 'tide', title: '潮目', name: '潮目', note: '紫の渦が、鮮やかにほどける。', c: Object.freeze({ re: -0.8, im: 0.156 }), palette: 'violet-pop' as const, quality: 'full' as const, image: '/live-art/tide-full.png', thumbnail: '/live-art/tide-preview.png', width: 768, height: 768 }),
  Object.freeze({ id: 'twin', title: '双環', name: '双環', note: '青い波に、赤い輪郭がうねる。', c: Object.freeze({ re: -1, im: 0 }), palette: 'cobalt-pop' as const, quality: 'full' as const, image: '/live-art/twin-full.png', thumbnail: '/live-art/twin-preview.png', width: 768, height: 768 }),
  Object.freeze({ id: 'petals', title: '花片', name: '花片', note: '真紅の花に、青と紫がひらく。', c: Object.freeze({ re: 0.285, im: 0.01 }), palette: 'crimson-pop' as const, quality: 'full' as const, image: '/live-art/petals-full.png', thumbnail: '/live-art/petals-preview.png', width: 768, height: 768 }),
]);
export type LiveWork = typeof LIVE_WORKS[number];
export type LiveWorkId = LiveWork['id'];
export const INITIAL_WORK = LIVE_WORKS[0]!;
/** Work selection changes c, display palette, quality and corresponding fixed Julia buffer settings. */
export function workSettings(id: string, quality: 'preview' | 'full' = 'full', palette?: DisplayPaletteId): Settings {
  const work = LIVE_WORKS.find(w => w.id === id);
  if (!work) throw new Error('work: unsupported id');
  if (quality !== 'preview' && quality !== 'full') throw new Error('work: unsupported quality');
  const q = ART_QUALITY[quality], style = validateDisplayPalette(palette ?? work.palette);
  return makeSettings('cpu-worker', work.c, q.width, q.maxIterations, legacyBasePalette(style));
}
export function workDisplaySettings(id: string, quality: 'preview' | 'full' = 'full') {
  const work = LIVE_WORKS.find(w => w.id === id);
  if (!work) throw new Error('work: unsupported id');
  return { workId: work.id, workVersion: ART_WORK_VERSION, palette: { id: work.palette, version: '1.0.0' as const }, quality, numericalBase: workSettings(id, quality) };
}
