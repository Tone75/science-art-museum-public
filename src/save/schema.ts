import { ART_DISPLAY_VERSION, validateDisplayPalette, type DisplayPaletteId } from '../art/palette.ts';
import { PRODUCT_VIEW_VERSION, validateProductView, toNumericalSettings, type ProductView } from '../framing/contract.ts';

export const ARTWORK_SCHEMA = 'SAM-008-A-artwork-v1' as const;
export const SAVE_ENGINE_COMPATIBILITY = 'SAM-003-Number-global-center-v1' as const;
export const MAX_ARTWORK_BYTES = 64 * 1024;
export type ArtworkDefinition = {
  productViewVersion: typeof PRODUCT_VIEW_VERSION;
  numericalContractVersion: 'SAM-003-N-v1';
  engineCompatibilityVersion: typeof SAVE_ENGINE_COMPATIBILITY;
  mode: 'julia'; precision: 'float64';
  c: { re: number; im: number };
  viewport: { reMin: number; reMax: number; imMin: number; imMax: number };
  width: 256 | 768; height: 256 | 768; maxIterations: 128 | 256 | 512;
  escapeRadius: 2; pixelSampling: 'center-top-left-y-up';
  palette: { id: DisplayPaletteId; version: typeof ART_DISPLAY_VERSION };
};
export type SavedArtwork = {
  schemaVersion: typeof ARTWORK_SCHEMA;
  artworkId: string;
  definition: ArtworkDefinition;
  integrity: { definitionSha256: string; fieldSha256: string; rgbaSha256: string };
  reference: { workId: string | null };
  provenance: { sourceCommit: string | null };
  execution: { requestId: number; epoch: number };
};
function exact(input: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Reflect.ownKeys(input).length !== keys.length || keys.some(k => !Object.hasOwn(input, k))) throw Error(`${label}：項目の欠落・未知の項目を確認してください。`);
  return input as Record<string, unknown>;
}
function hash(input: unknown, label: string): string {
  if (typeof input !== 'string' || !/^[a-f0-9]{64}$/.test(input)) throw Error(`${label}：SHA256の形式が不正です。`);
  return input;
}
function positiveInteger(input: unknown, label: string): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 1) throw Error(`${label}：正の整数が必要です。`);
  return input;
}
export function definitionFromView(input: unknown): ArtworkDefinition {
  const view = validateProductView(input), n = toNumericalSettings(view, 'final');
  return { productViewVersion: PRODUCT_VIEW_VERSION, numericalContractVersion: 'SAM-003-N-v1', engineCompatibilityVersion: SAVE_ENGINE_COMPATIBILITY,
    mode: 'julia', precision: 'float64', c: { ...view.c }, viewport: { ...view.viewport }, width: view.resolution, height: view.resolution,
    maxIterations: view.maxIterations, escapeRadius: 2, pixelSampling: n.pixelSampling,
    palette: { id: view.displayPalette, version: ART_DISPLAY_VERSION } };
}
export function definitionToView(input: unknown): ProductView {
  const d = exact(input, ['productViewVersion','numericalContractVersion','engineCompatibilityVersion','mode','precision','c','viewport','width','height','maxIterations','escapeRadius','pixelSampling','palette'], '作品設定');
  if (d.productViewVersion !== PRODUCT_VIEW_VERSION || d.numericalContractVersion !== 'SAM-003-N-v1'
    || d.engineCompatibilityVersion !== SAVE_ENGINE_COMPATIBILITY || d.mode !== 'julia' || d.precision !== 'float64'
    || d.escapeRadius !== 2 || d.pixelSampling !== 'center-top-left-y-up') throw Error('この数値仕様・engine互換版には対応していません。');
  const p = exact(d.palette, ['id','version'], '配色');
  if (p.version !== ART_DISPLAY_VERSION) throw Error('この配色仕様版には対応していません。');
  if (d.width !== d.height) throw Error('保存解像度は正方形で指定してください。');
  return validateProductView({ schemaVersion: d.productViewVersion, c: d.c, viewport: d.viewport, resolution: d.width,
    maxIterations: d.maxIterations, displayPalette: validateDisplayPalette(p.id) });
}
export function artworkId(integrity: SavedArtwork['integrity']): string {
  return `sam-${integrity.definitionSha256.slice(0,12)}-${integrity.fieldSha256.slice(0,12)}-${integrity.rgbaSha256.slice(0,12)}`;
}
export function validateArtwork(input: unknown): SavedArtwork {
  const a = exact(input, ['schemaVersion','artworkId','definition','integrity','reference','provenance','execution'], '作品ファイル');
  if (a.schemaVersion !== ARTWORK_SCHEMA) throw Error('この作品schema版には対応していません。');
  const view = definitionToView(a.definition), i = exact(a.integrity, ['definitionSha256','fieldSha256','rgbaSha256'], '照合情報');
  const integrity = { definitionSha256: hash(i.definitionSha256,'設定hash'), fieldSha256: hash(i.fieldSha256,'数値hash'), rgbaSha256: hash(i.rgbaSha256,'画像hash') };
  if (a.artworkId !== artworkId(integrity)) throw Error('作品IDとファイルの組が一致していません。');
  const r = exact(a.reference,['workId'],'参照情報'), p = exact(a.provenance,['sourceCommit'],'来歴'), e = exact(a.execution,['requestId','epoch'],'実行追跡');
  if (r.workId !== null && (typeof r.workId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(r.workId))) throw Error('参照work IDが不正です。');
  if (p.sourceCommit !== null && (typeof p.sourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(p.sourceCommit))) throw Error('来歴のcommit形式が不正です。');
  return { schemaVersion: ARTWORK_SCHEMA, artworkId: a.artworkId as string, definition: definitionFromView(view), integrity,
    reference: { workId: r.workId as string | null }, provenance: { sourceCommit: p.sourceCommit as string | null },
    execution: { requestId: positiveInteger(e.requestId,'request ID'), epoch: positiveInteger(e.epoch,'epoch') } };
}
export function definitionJson(input: unknown): string { return JSON.stringify(definitionFromView(definitionToView(input))); }
export function serializeArtwork(input: unknown): string {
  const text = JSON.stringify(validateArtwork(input), null, 2) + '\n';
  if (new TextEncoder().encode(text).byteLength > MAX_ARTWORK_BYTES) throw Error('作品JSONは64KiB以内にしてください。');
  return text;
}
/** A bounded JSON grammar reader rejects duplicate decoded keys at every depth. */
export function parseUniqueJson(text: string): unknown {
  if (typeof text !== 'string' || text.length > MAX_ARTWORK_BYTES || new TextEncoder().encode(text).byteLength > MAX_ARTWORK_BYTES) throw Error('作品JSONは64KiB以内にしてください。');
  let at = 0;
  const white = () => { while (at < text.length && /[\x20\t\r\n]/.test(text[at]!)) at++; };
  const string = (): string => {
    const start = at; if (text[at++] !== '"') throw Error('JSONの文字列を確認してください。');
    let escaped = false;
    while (at < text.length) { const c = text[at++]!; if (!escaped && c === '"') { try { return JSON.parse(text.slice(start,at)); } catch { throw Error('JSONの文字列が不正です。'); } }
      if (!escaped && c.charCodeAt(0) === 92) escaped = true; else escaped = false; }
    throw Error('JSONの文字列が閉じていません。');
  };
  const value = (depth: number): unknown => {
    if (depth > 32) throw Error('JSONの入れ子が深すぎます。'); white(); const c = text[at];
    if (c === '"') return string();
    if (c === '{') { at++; white(); const object: Record<string, unknown> = Object.create(null), keys = new Set<string>();
      if (text[at] === '}') { at++; return object; }
      while (at < text.length) { white(); const key = string(); if (keys.has(key)) throw Error('JSONに重複した項目があります。'); keys.add(key); white(); if (text[at++] !== ':') throw Error('JSONの区切りが不正です。'); object[key] = value(depth + 1); white(); const sep = text[at++]; if (sep === '}') return object; if (sep !== ',') throw Error('JSONの区切りが不正です。'); }
    } else if (c === '[') { at++; white(); const items: unknown[] = []; if (text[at] === ']') { at++; return items; }
      while (at < text.length) { items.push(value(depth + 1)); white(); const sep = text[at++]; if (sep === ']') return items; if (sep !== ',') throw Error('JSONの区切りが不正です。'); }
    } else { for (const [literal,result] of [['true',true],['false',false],['null',null]] as const) if (text.startsWith(literal,at)) { at += literal.length; return result; }
      const number = text.slice(at).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/); if (number) { at += number[0].length; return Number(number[0]); } }
    throw Error('JSONとして読み込めませんでした。');
  };
  const result = value(0); white(); if (at !== text.length) throw Error('JSONの後ろに余分な内容があります。'); return result;
}
export function parseArtworkJson(text: string): SavedArtwork { return validateArtwork(parseUniqueJson(text)); }
export function fieldBytes(field: Uint16Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(field.length * 2), view = new DataView(bytes.buffer);
  for (let i = 0; i < field.length; i++) view.setUint16(i * 2, field[i]!, true);
  return bytes;
}
export function sha256(bytes: ArrayBufferView<ArrayBuffer> | ArrayBuffer): Promise<string> {
  // The continuation captures only the resulting digest, never its input view.
  return crypto.subtle.digest('SHA-256', bytes).then(hash => [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2,'0')).join(''));
}
export async function verifyDefinition(input: unknown): Promise<SavedArtwork> {
  const artifact = validateArtwork(input);
  if (await sha256(new TextEncoder().encode(definitionJson(artifact.definition))) !== artifact.integrity.definitionSha256) throw Error('設定の照合情報が一致しません。ファイルを確認してください。');
  return artifact;
}
