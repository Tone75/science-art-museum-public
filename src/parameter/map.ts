import { validateNumericalSettings } from '../numerics/contract.ts';
import { PARAMETER_MAP_INTEGRITY } from './map-integrity.ts';
import { PARAMETER_MAP_SETTINGS, MAP_GENERATOR_VERSION, MAP_ASSET_VERSION, MAP_PALETTE, MAP_FIELD_BYTES, MAP_RGBA_BYTES, MAP_CACHE_BASELINE_BYTES, MAP_MANIFEST_URL } from './map-spec.ts';

type MapManifest = {
  schemaVersion: 1; assetVersion: string; generatorVersion: string; numericImplementation: string;
  settings: typeof PARAMETER_MAP_SETTINGS; palette: { id: 'lagoon'; version: string };
  field: { path: string; encoding: string; bytes: number; sha256: string };
  rgba: { path: string; encoding: string; bytes: number; sha256: string };
  image: { path: string; encoding: string; bytes: number; sha256: string };
  sourceSha256: Record<string, string>; limits: string;
};
export type ParameterMapSnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'disposed'; error: string | null;
  loadCount: number; numericalCalculations: 0; manifest: MapManifest | null; verifiedHash: string | null;
  resources: { managedBufferBytes: number; baselineBytes: number; expectedBaselineBytes: number; peakManagedBufferBytes: number; loading: number; fieldBytes: number; rgbaBytes: number; canvasBytes: number; transientBytes: number; timers: number };
};
const HASH = /^[a-f0-9]{64}$/;
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical((v as Record<string, unknown>)[k])])) : v;
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function record(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Reflect.ownKeys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) throw new Error(`地図の${label}を確認できません。`);
  return value as Record<string, unknown>;
}
function validateManifest(input: unknown): MapManifest {
  const m = record(input, ['schemaVersion','assetVersion','generatorVersion','numericImplementation','settings','palette','field','rgba','image','sourceSha256','limits'], 'manifest');
  if (m.schemaVersion !== 1 || m.assetVersion !== MAP_ASSET_VERSION || m.generatorVersion !== MAP_GENERATOR_VERSION
    || typeof m.numericImplementation !== 'string' || typeof m.limits !== 'string') throw new Error('地図の生成版が対応していません。');
  if (!equal(validateNumericalSettings(m.settings), PARAMETER_MAP_SETTINGS) || !equal(m.palette, MAP_PALETTE)) throw new Error('地図の計算条件が一致しません。');
  for (const [name, path, encoding, size, expected] of [
    ['field', '/parameter-map/mandelbrot-field.u16', 'uint16le', MAP_FIELD_BYTES, PARAMETER_MAP_INTEGRITY.fieldSha256],
    ['rgba', '/parameter-map/mandelbrot-rgba.bin', 'rgba8-row-major', MAP_RGBA_BYTES, PARAMETER_MAP_INTEGRITY.rgbaSha256],
    ['image', '/parameter-map/mandelbrot.png', 'png-rgba8', null, PARAMETER_MAP_INTEGRITY.pngSha256],
  ] as const) {
    const a = record(m[name], ['path','encoding','bytes','sha256'], name);
    if (a.path !== path || a.encoding !== encoding || !Number.isSafeInteger(a.bytes) || (a.bytes as number) <= 0
      || (size !== null && a.bytes !== size) || a.sha256 !== expected) throw new Error(`地図の${name}情報が一致しません。`);
  }
  if (typeof m.sourceSha256 !== 'object' || m.sourceSha256 === null || Array.isArray(m.sourceSha256)
    || Object.values(m.sourceSha256).some(v => typeof v !== 'string' || !HASH.test(v))) throw new Error('地図の生成元hashを確認できません。');
  return m as unknown as MapManifest;
}

/** One verified constant cache; no orbit code, Worker or selection-triggered regeneration. */
export class ParameterMap {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly onChange?: () => void;
  private status: ParameterMapSnapshot['status'] = 'idle';
  private error: string | null = null;
  private field: Uint16Array | null = null;
  private rgba: Uint8ClampedArray | null = null;
  private manifest: MapManifest | null = null;
  private verifiedHash: string | null = null;
  private inFlight: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private retrying: Promise<void> | null = null;
  private generation = 0;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private timedOut = false;
  private loads = 0;
  private networkBytes = 0;
  private loadingBuffers = 0;
  private digestBytes = 0;
  private paintBytes = 0;
  private peak = 0;

  constructor(canvas: HTMLCanvasElement, options: { onChange?: () => void } = {}) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('地図のCanvas2Dが利用できません。');
    this.canvas = canvas; this.context = ctx; this.onChange = options.onChange;
    // A not-yet-verified map must never look like a usable selection image.
    this.clearCache();
  }
  load(): Promise<void> {
    if (this.status === 'disposed') return Promise.resolve();
    if (this.status === 'ready') return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    const generation = ++this.generation;
    this.clearCache(); this.status = 'loading'; this.error = null; this.loads++;
    this.controller = new AbortController(); this.timedOut = false;
    const controller = this.controller;
    this.watchdog = setTimeout(() => { if (generation === this.generation) { this.timedOut = true; controller.abort(); } }, 5000);
    this.notify();
    const promise = this.loadAssets(generation, this.controller.signal).finally(() => {
      if (generation === this.generation) { this.clearWatchdog(); this.controller = null; this.inFlight = null; }
    });
    this.inFlight = promise;
    return promise;
  }
  retry(): Promise<void> {
    if (this.status === 'disposed') return Promise.resolve();
    if (this.retrying) return this.retrying;
    const perform = async (): Promise<void> => {
      if (this.inFlight) { this.controller?.abort(); await this.inFlight; }
      if (this.status === 'disposed') return;
      this.clearCache(); this.status = 'idle'; this.error = null;
      await this.load();
    };
    this.retrying = perform().finally(() => { this.retrying = null; });
    return this.retrying;
  }
  dispose(): void {
    this.controller?.abort(); this.generation++; this.controller = null; this.inFlight = null;
    this.clearCache(); this.status = 'disposed'; this.error = null; this.notify();
  }
  snapshot(): ParameterMapSnapshot {
    return { status: this.status, error: this.error, loadCount: this.loads, numericalCalculations: 0,
      manifest: this.manifest ? JSON.parse(JSON.stringify(this.manifest)) as MapManifest : null, verifiedHash: this.verifiedHash,
      resources: this.resourceSnapshot() };
  }
  resourceSnapshot(): ParameterMapSnapshot['resources'] {
    const fieldBytes = this.field?.byteLength ?? 0, rgbaBytes = this.rgba?.byteLength ?? 0;
    const canvasBytes = this.canvas.width * this.canvas.height * 4;
    const transientBytes = this.networkBytes + this.loadingBuffers + this.digestBytes + this.paintBytes;
    const managedBufferBytes = fieldBytes + rgbaBytes + canvasBytes + transientBytes;
    return { managedBufferBytes, baselineBytes: this.status === 'ready' ? MAP_CACHE_BASELINE_BYTES : 0,
      expectedBaselineBytes: MAP_CACHE_BASELINE_BYTES, peakManagedBufferBytes: this.peak,
      loading: Number(this.status === 'loading'), fieldBytes, rgbaBytes, canvasBytes, transientBytes, timers: Number(this.watchdog !== null) };
  }
  private observe(): void {
    const bytes = this.resourceSnapshot().managedBufferBytes;
    this.peak = Math.max(this.peak, bytes);
    if (bytes > 64 * 1024 * 1024) throw new Error('地図の管理buffer上限を超えました。');
  }
  private notify(): void { this.observe(); this.onChange?.(); }
  private clearWatchdog(): void { if (this.watchdog !== null) clearTimeout(this.watchdog); this.watchdog = null; }
  private clearCache(): void {
    this.clearWatchdog();
    this.field = null; this.rgba = null; this.manifest = null; this.verifiedHash = null;
    this.networkBytes = 0; this.loadingBuffers = 0; this.digestBytes = 0; this.paintBytes = 0;
    this.canvas.width = 0; this.canvas.height = 0;
  }
  private async digest(bytes: Uint8Array): Promise<string> {
    this.digestBytes = bytes.byteLength; this.observe();
    try { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))].map(v => v.toString(16).padStart(2, '0')).join(''); }
    finally { this.digestBytes = 0; }
  }
  private async readAsset(path: string, limit: number, signal: AbortSignal): Promise<Uint8Array> {
    const response = await fetch(path, { signal, cache: 'no-store' });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`地図assetの読込に失敗しました（HTTP ${response.status}）。`); }
    const lengthHeader = response.headers.get('content-length');
    if (lengthHeader !== null && (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > limit)) { await response.body?.cancel(); throw new Error('地図assetが想定サイズを超えています。'); }
    if (!response.body) throw new Error('地図assetの内容を読み込めません。');
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const next = await reader.read(); if (signal.aborted) throw new Error('地図の読込を中断しました。'); if (next.done) break;
        this.networkBytes = total + next.value.byteLength; this.observe();
        if (this.networkBytes > limit) throw new Error('地図assetが想定サイズを超えています。');
        chunks.push(next.value); total += next.value.byteLength;
      }
      this.networkBytes = total * 2; this.observe();
      const result = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
      return result;
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); this.networkBytes = 0; }
  }
  private async loadAssets(generation: number, signal: AbortSignal): Promise<void> {
    try {
      const manifestBytes = await this.readAsset(MAP_MANIFEST_URL, 16384, signal);
      if (generation !== this.generation) return;
      if (signal.aborted) throw new Error('地図の読込を中断しました。');
      this.loadingBuffers = manifestBytes.byteLength; this.observe();
      const manifestHash = await this.digest(manifestBytes);
      if (generation !== this.generation) return;
      if (signal.aborted) throw new Error('地図の読込を中断しました。');
      if (manifestHash !== PARAMETER_MAP_INTEGRITY.manifestSha256) throw new Error('地図manifestのhashが一致しません。');
      const manifest = validateManifest(JSON.parse(new TextDecoder().decode(manifestBytes)));
      const fieldBytes = await this.readAsset(manifest.field.path, MAP_FIELD_BYTES, signal);
      if (generation !== this.generation) return;
      if (signal.aborted) throw new Error('地図の読込を中断しました。');
      this.loadingBuffers += fieldBytes.byteLength; this.observe();
      if (fieldBytes.byteLength !== MAP_FIELD_BYTES || await this.digest(fieldBytes) !== manifest.field.sha256) throw new Error('地図fieldのhashまたは長さが一致しません。');
      if (generation !== this.generation) return;
      if (signal.aborted) throw new Error('地図の読込を中断しました。');
      const field = new Uint16Array(MAP_FIELD_BYTES / 2); this.field = field; this.observe();
      const view = new DataView(fieldBytes.buffer, fieldBytes.byteOffset, fieldBytes.byteLength);
      for (let i = 0; i < field.length; i++) { const n = view.getUint16(i * 2, true); if (n !== 65535 && n > 128) throw new Error('地図fieldに不正な値があります。'); field[i] = n; }
      const rgbaBytes = await this.readAsset(manifest.rgba.path, MAP_RGBA_BYTES, signal);
      if (generation !== this.generation) return;
      if (signal.aborted) throw new Error('地図の読込を中断しました。');
      this.loadingBuffers += rgbaBytes.byteLength; this.observe();
      if (rgbaBytes.byteLength !== MAP_RGBA_BYTES || await this.digest(rgbaBytes) !== manifest.rgba.sha256) throw new Error('地図RGBAのhashまたは長さが一致しません。');
      if (generation !== this.generation) return;
      if (signal.aborted) throw new Error('地図の読込を中断しました。');
      this.rgba = new Uint8ClampedArray(rgbaBytes.buffer as ArrayBuffer, rgbaBytes.byteOffset, rgbaBytes.byteLength);
      this.paintBytes = MAP_RGBA_BYTES; this.observe();
      const image = new ImageData(this.rgba as Uint8ClampedArray<ArrayBuffer>, PARAMETER_MAP_SETTINGS.width, PARAMETER_MAP_SETTINGS.height);
      this.canvas.width = PARAMETER_MAP_SETTINGS.width; this.canvas.height = PARAMETER_MAP_SETTINGS.height; this.observe();
      this.context.putImageData(image, 0, 0); this.paintBytes = 0;
      this.manifest = manifest; this.verifiedHash = manifestHash;
      this.loadingBuffers = 0; this.networkBytes = 0; this.digestBytes = 0;
      this.clearWatchdog(); this.status = 'ready'; this.error = null; this.notify();
    } catch (error) {
      if (generation !== this.generation) return;
      this.clearCache(); this.status = 'error';
      this.error = this.timedOut ? '地図の読込が5000msを超えました。再読込で再試行できます。' : error instanceof Error ? error.message : '地図を読み込めませんでした。';
      this.notify();
    }
  }
}
