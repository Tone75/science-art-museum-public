import { makeSettings, PRESETS, serializeSettings, type PaletteId, type Settings } from './config.ts';

export type Quality = 'preview' | 'full';
export const UX_PRESETS = [
  { name: 'ふたつの灯', note: 'ゆっくり、形を見つける', image: '/artworks/orbit.png', c: PRESETS[1]! },
  { name: '渦の庭', note: 'こまやかな輪郭をたどる', image: '/artworks/spiral.png', c: PRESETS[3]! },
  { name: '花の軌道', note: 'また違う景色を探す', image: '/artworks/bloom.png', c: PRESETS[4]! },
] as const;

/** The exhibit intentionally exposes only the three already-compared presets. */
export function settingsForSelection(presetIndex: number, palette: PaletteId, quality: Quality): Settings {
  if (!Number.isInteger(presetIndex) || presetIndex < 0 || presetIndex >= UX_PRESETS.length) throw new Error('形の選択が正しくありません');
  if (quality !== 'preview' && quality !== 'full') throw new Error('表示品質の選択が正しくありません');
  return makeSettings('cpu-worker', UX_PRESETS[presetIndex]!.c,
    quality === 'preview' ? 256 : 768, quality === 'preview' ? 128 : 512, palette);
}

export function equalSettings(a: Settings | null, b: Settings | null): boolean {
  return a !== null && b !== null && serializeSettings(a) === serializeSettings(b);
}

export function cLabel(settings: Settings): string {
  const { re, im } = settings.c;
  return im === 0 ? String(re) : `${re} ${im < 0 ? '−' : '+'} ${Math.abs(im)}i`;
}
