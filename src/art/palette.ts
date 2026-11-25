import type { PaletteId } from '../config.ts';
import { validateNumericalSettings, type NumericalSettings } from '../numerics/contract.ts';
import { UNESCAPED } from '../numerics/engine.ts';
import { colorizeNumericalField } from '../numerics/palette.ts';

/** Display extension only: schemaVersion=1 and the numerical contract remain unchanged. */
export type PopPaletteId = 'violet-pop' | 'cobalt-pop' | 'crimson-pop';
export type LegacyDisplayPaletteId = PaletteId | 'porcelain';
export type DisplayPaletteId = LegacyDisplayPaletteId | PopPaletteId;
export const ART_DISPLAY_VERSION = 'SAM-006-A-display-v1';

export type DisplayPaletteEntry = Readonly<{
  id: DisplayPaletteId;
  label: string;
  note: string;
  legacyBase: PaletteId;
  group: 'pop' | 'archive';
}>;

export const DISPLAY_PALETTES: readonly DisplayPaletteEntry[] = Object.freeze([
  Object.freeze({ id: 'violet-pop' as const, label: 'Electric Violet', note: 'ヴァイオレット', legacyBase: 'lagoon' as const, group: 'pop' as const }),
  Object.freeze({ id: 'cobalt-pop' as const, label: 'Cobalt Pop', note: 'コバルト＆赤', legacyBase: 'ember' as const, group: 'pop' as const }),
  Object.freeze({ id: 'crimson-pop' as const, label: 'Crimson Bloom', note: 'クリムゾン', legacyBase: 'lagoon' as const, group: 'pop' as const }),
  Object.freeze({ id: 'lagoon' as const, label: 'Lagoon', note: '青緑', legacyBase: 'lagoon' as const, group: 'archive' as const }),
  Object.freeze({ id: 'ember' as const, label: 'Ember', note: '琥珀', legacyBase: 'ember' as const, group: 'archive' as const }),
  Object.freeze({ id: 'porcelain' as const, label: 'Porcelain', note: '白磁と墨', legacyBase: 'lagoon' as const, group: 'archive' as const }),
]);

export const POP_PALETTES = Object.freeze(DISPLAY_PALETTES.filter((p): p is DisplayPaletteEntry & { id: PopPaletteId; group: 'pop' } => p.group === 'pop'));
export const ARCHIVE_PALETTES = Object.freeze(DISPLAY_PALETTES.filter((p): p is DisplayPaletteEntry & { id: LegacyDisplayPaletteId; group: 'archive' } => p.group === 'archive'));

export const PORCELAIN_PERIOD = 96;
export const PORCELAIN_UNESCAPED_RGB = Object.freeze([236, 230, 214] as const);
/** Integer escape counts map to a fixed cyclic RGB ramp, without changing the field. */
export const PORCELAIN_STOPS = Object.freeze([
  Object.freeze({ at: 0, rgb: Object.freeze([19, 34, 47] as const) }),
  Object.freeze({ at: 14, rgb: Object.freeze([69, 99, 103] as const) }),
  Object.freeze({ at: 36, rgb: Object.freeze([239, 229, 209] as const) }),
  Object.freeze({ at: 58, rgb: Object.freeze([164, 111, 69] as const) }),
  Object.freeze({ at: 79, rgb: Object.freeze([244, 236, 219] as const) }),
  Object.freeze({ at: 95, rgb: Object.freeze([19, 34, 47] as const) }),
]);
const porcelainLookup = new Uint8Array(PORCELAIN_PERIOD * 3);
for (let i = 0, interval = 0; i < PORCELAIN_PERIOD; i++) {
  while (interval < PORCELAIN_STOPS.length - 2 && i > PORCELAIN_STOPS[interval + 1]!.at) interval++;
  const low = PORCELAIN_STOPS[interval]!, high = PORCELAIN_STOPS[interval + 1]!;
  const fraction = (i - low.at) / (high.at - low.at);
  for (let channel = 0; channel < 3; channel++) porcelainLookup[i * 3 + channel] = Math.round(low.rgb[channel]! + (high.rgb[channel]! - low.rgb[channel]!) * fraction);
}

export const POP_LUT_ENTRIES = 513;
export type PopPaletteStop = Readonly<{ at: number; rgb: readonly [number, number, number] }>;
export type PopPaletteSpec = Readonly<{
  id: PopPaletteId;
  version: '1.0.0';
  knee: number;
  maxRef: number;
  unescapedRGB: readonly [number, number, number];
  stops: readonly PopPaletteStop[];
}>;

/**
 * High-contrast POP palettes.
 * Pure deterministic lookup tables over integer escape counts 0..512 and UNESCAPED (65535).
 * Anchors n=0 and n=1 to the same ground color so |z0|>2 corners stay seamless, and uses a
 * monotonic logarithmic ramp with smoothstep stop interpolation to eliminate modulo-wrap banding.
 */
export const POP_PALETTE_SPECS: Readonly<Record<PopPaletteId, PopPaletteSpec>> = Object.freeze({
  'violet-pop': Object.freeze({
    id: 'violet-pop' as const,
    version: '1.0.0' as const,
    knee: 3.4,
    maxRef: 340,
    unescapedRGB: Object.freeze([252, 245, 255] as const),
    stops: Object.freeze([
      Object.freeze({ at: 0.00, rgb: Object.freeze([13, 11, 26] as const) }),
      Object.freeze({ at: 0.14, rgb: Object.freeze([24, 18, 68] as const) }),
      Object.freeze({ at: 0.28, rgb: Object.freeze([40, 56, 228] as const) }),
      Object.freeze({ at: 0.44, rgb: Object.freeze([122, 40, 255] as const) }),
      Object.freeze({ at: 0.58, rgb: Object.freeze([204, 52, 224] as const) }),
      Object.freeze({ at: 0.72, rgb: Object.freeze([248, 32, 92] as const) }),
      Object.freeze({ at: 0.86, rgb: Object.freeze([255, 148, 186] as const) }),
      Object.freeze({ at: 1.00, rgb: Object.freeze([252, 244, 255] as const) }),
    ]),
  }),
  'cobalt-pop': Object.freeze({
    id: 'cobalt-pop' as const,
    version: '1.0.0' as const,
    knee: 1.8,
    maxRef: 320,
    unescapedRGB: Object.freeze([242, 26, 72] as const),
    stops: Object.freeze([
      Object.freeze({ at: 0.00, rgb: Object.freeze([14, 24, 92] as const) }),
      Object.freeze({ at: 0.13, rgb: Object.freeze([22, 52, 206] as const) }),
      Object.freeze({ at: 0.26, rgb: Object.freeze([38, 98, 255] as const) }),
      Object.freeze({ at: 0.39, rgb: Object.freeze([124, 52, 255] as const) }),
      Object.freeze({ at: 0.50, rgb: Object.freeze([236, 230, 255] as const) }),
      Object.freeze({ at: 0.66, rgb: Object.freeze([246, 30, 78] as const) }),
      Object.freeze({ at: 0.83, rgb: Object.freeze([138, 46, 255] as const) }),
      Object.freeze({ at: 1.00, rgb: Object.freeze([248, 244, 255] as const) }),
    ]),
  }),
  'crimson-pop': Object.freeze({
    id: 'crimson-pop' as const,
    version: '1.0.0' as const,
    knee: 3.8,
    maxRef: 260,
    unescapedRGB: Object.freeze([18, 28, 124] as const),
    stops: Object.freeze([
      Object.freeze({ at: 0.00, rgb: Object.freeze([250, 246, 248] as const) }),
      Object.freeze({ at: 0.15, rgb: Object.freeze([253, 218, 232] as const) }),
      Object.freeze({ at: 0.33, rgb: Object.freeze([246, 28, 80] as const) }),
      Object.freeze({ at: 0.53, rgb: Object.freeze([142, 34, 252] as const) }),
      Object.freeze({ at: 0.73, rgb: Object.freeze([30, 72, 250] as const) }),
      Object.freeze({ at: 0.88, rgb: Object.freeze([112, 146, 255] as const) }),
      Object.freeze({ at: 1.00, rgb: Object.freeze([246, 248, 255] as const) }),
    ]),
  }),
});

function buildPopLookup(spec: PopPaletteSpec): Uint8Array {
  const table = new Uint8Array(POP_LUT_ENTRIES * 3);
  const denom = Math.log(1 + spec.maxRef / spec.knee);
  for (let n = 0; n < POP_LUT_ENTRIES; n++) {
    const eff = n > 0 ? n - 1 : 0;
    const u = Math.max(0, Math.min(1, Math.log(1 + eff / spec.knee) / denom));
    let idx = 0;
    while (idx < spec.stops.length - 2 && u > spec.stops[idx + 1]!.at) idx++;
    const low = spec.stops[idx]!, high = spec.stops[idx + 1]!;
    const raw = (u - low.at) / Math.max(1e-9, high.at - low.at);
    const t = raw * raw * (3 - 2 * raw);
    for (let channel = 0; channel < 3; channel++) {
      table[n * 3 + channel] = Math.round(low.rgb[channel]! + (high.rgb[channel]! - low.rgb[channel]!) * t);
    }
  }
  return table;
}

const popLookups: Readonly<Record<PopPaletteId, Uint8Array>> = Object.freeze({
  'violet-pop': buildPopLookup(POP_PALETTE_SPECS['violet-pop']),
  'cobalt-pop': buildPopLookup(POP_PALETTE_SPECS['cobalt-pop']),
  'crimson-pop': buildPopLookup(POP_PALETTE_SPECS['crimson-pop']),
});

export const ART_PALETTE_CACHE_BYTES = PORCELAIN_PERIOD * 3 + Object.keys(POP_PALETTE_SPECS).length * POP_LUT_ENTRIES * 3;

const VALID_PALETTE_IDS = new Set<string>(DISPLAY_PALETTES.map(p => p.id));

export function validateDisplayPalette(input: unknown): DisplayPaletteId {
  if (typeof input !== 'string' || !VALID_PALETTE_IDS.has(input)) throw new Error('display palette: unsupported');
  return input as DisplayPaletteId;
}

export function legacyBasePalette(input: unknown): PaletteId {
  const id = validateDisplayPalette(input);
  return DISPLAY_PALETTES.find(p => p.id === id)!.legacyBase;
}

export function colorizeArtField(field: Uint16Array, input: NumericalSettings, palette: DisplayPaletteId): Uint8ClampedArray {
  const id = validateDisplayPalette(palette);
  // Preserve both accepted old palettes by delegating their exact byte mapping.
  if (id === 'lagoon' || id === 'ember') return colorizeNumericalField(field, input, id);
  const settings = validateNumericalSettings(input);
  if (!(field instanceof Uint16Array) || field.length !== settings.width * settings.height) throw new Error('display palette: field dimensions do not match');
  for (const value of field) if (value !== UNESCAPED && value > settings.maxIterations) throw new Error('display palette: invalid escape count');
  const rgba = new Uint8ClampedArray(field.length * 4);
  if (id === 'porcelain') {
    for (let i = 0; i < field.length; i++) {
      const value = field[i]!, offset = (value % PORCELAIN_PERIOD) * 3;
      for (let channel = 0; channel < 3; channel++) rgba[i * 4 + channel] = value === UNESCAPED ? PORCELAIN_UNESCAPED_RGB[channel]! : porcelainLookup[offset + channel]!;
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }
  const lut = popLookups[id];
  const unescaped = POP_PALETTE_SPECS[id].unescapedRGB;
  for (let i = 0; i < field.length; i++) {
    const value = field[i]!;
    if (value === UNESCAPED) {
      rgba[i * 4] = unescaped[0];
      rgba[i * 4 + 1] = unescaped[1];
      rgba[i * 4 + 2] = unescaped[2];
    } else {
      const offset = value * 3;
      rgba[i * 4] = lut[offset]!;
      rgba[i * 4 + 1] = lut[offset + 1]!;
      rgba[i * 4 + 2] = lut[offset + 2]!;
    }
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
