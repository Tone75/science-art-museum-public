import { validateSettings } from './config.ts';
import type { PaletteId, Settings } from './config.ts';
import { SENTINEL } from './math/cpu.ts';

/** Deliberately light RGB ramps; palette changes never enter orbit calculation. */
export const PALETTES: Record<PaletteId, { low: readonly number[]; high: readonly number[] }> = {
  lagoon: { low: [15, 48, 76], high: [91, 238, 200] },
  ember: { low: [74, 23, 57], high: [255, 207, 112] },
};
export const UNESCAPED_RGB = [7, 12, 24] as const;

export function colorize(counts: Uint16Array, input: Settings): Uint8ClampedArray {
  const settings = validateSettings(input);
  if (counts.length !== settings.width * settings.height) throw new Error('palette: field dimensions do not match settings');
  const rgba = new Uint8ClampedArray(counts.length * 4);
  const palette = PALETTES[settings.palette.id];
  for (let i = 0; i < counts.length; i += 1) {
    const count = counts[i]!;
    if (count !== SENTINEL && count > settings.maxIterations) throw new Error('palette: invalid escape count');
    const t = (count % 64) / 63;
    for (let channel = 0; channel < 3; channel += 1) {
      rgba[i * 4 + channel] = count === SENTINEL
        ? UNESCAPED_RGB[channel]!
        : Math.round(palette.low[channel]! + (palette.high[channel]! - palette.low[channel]!) * t);
    }
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
