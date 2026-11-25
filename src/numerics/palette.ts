import { PALETTES, UNESCAPED_RGB } from '../color.ts';
import { validateNumericalSettings } from './contract.ts';
import type { NumericalSettings } from './contract.ts';
import { UNESCAPED } from './engine.ts';

/** New rectangular numerical fields share the two existing RGB ramps only. */
export function colorizeNumericalField(
  counts: Uint16Array,
  input: NumericalSettings,
  paletteId: 'lagoon' | 'ember',
): Uint8ClampedArray {
  const settings = validateNumericalSettings(input);
  if (paletteId !== 'lagoon' && paletteId !== 'ember') throw new Error('palette: unsupported');
  if (!(counts instanceof Uint16Array) || counts.length !== settings.width * settings.height) {
    throw new Error('palette: Uint16 field dimensions do not match settings');
  }
  // Check the whole numerical input before allocating a display buffer.
  for (const count of counts) {
    if (count !== UNESCAPED && count > settings.maxIterations) throw new Error('palette: invalid escape count');
  }
  const palette = PALETTES[paletteId];
  const rgba = new Uint8ClampedArray(counts.length * 4);
  for (let i = 0; i < counts.length; i += 1) {
    const count = counts[i]!;
    const t = (count % 64) / 63;
    for (let channel = 0; channel < 3; channel += 1) {
      rgba[i * 4 + channel] = count === UNESCAPED
        ? UNESCAPED_RGB[channel]!
        : Math.round(palette.low[channel]! + (palette.high[channel]! - palette.low[channel]!) * t);
    }
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
