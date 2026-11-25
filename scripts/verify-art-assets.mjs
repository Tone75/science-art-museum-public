// Verify the accepted files and their pixels. Compression-library versions may
// choose different valid IDAT streams when encoding the very same scanlines.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { computeNumericalField } from '../src/numerics/engine.ts';
import { fromLegacySettings } from '../src/numerics/legacy.ts';
import { colorizeNumericalField } from '../src/numerics/palette.ts';
import { PARAMETER_MAP_INTEGRITY } from '../src/parameter/map-integrity.ts';
import { PARAMETER_MAP_SETTINGS, MAP_PALETTE } from '../src/parameter/map-spec.ts';
import {
  ART_MANIFEST_SHA256, ART_IMAGE_CACHE_UPPER_BYTES, ART_CACHE_UPPER_BYTES,
  ART_PALETTE_CACHE_BYTES as recordedPaletteBytes,
} from '../src/art/integrity.ts';
import { colorizeArtField, ART_PALETTE_CACHE_BYTES } from '../src/art/palette.ts';
import { LIVE_WORKS, workSettings } from '../src/art/works.ts';
import { decodePNG } from './png.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function readManifest(path, expectedDigest) {
  const bytes = read(path);
  assert.equal(digest(bytes), expectedDigest, path);
  const manifest = JSON.parse(bytes);
  for (const [source, expected] of Object.entries(manifest.sourceSha256)) {
    assert.equal(digest(read(source)), expected, source);
  }
  return manifest;
}

function fieldBytes(field) {
  const bytes = Buffer.alloc(field.length * 2);
  for (let i = 0; i < field.length; i++) bytes.writeUInt16LE(field[i], i * 2);
  return bytes;
}

function verifyBlob(bytes, recorded, label) {
  assert.equal(bytes.length, recorded.bytes, label + ' length');
  assert.equal(digest(bytes), recorded.sha256, label + ' digest');
}

function verifyImage(asset, settings, rgba) {
  const bytes = read('public' + asset.path);
  verifyBlob(bytes, asset, asset.path);
  const decoded = decodePNG(bytes);
  assert.equal(decoded.width, settings.width, asset.path + ' width');
  assert.equal(decoded.height, settings.height, asset.path + ' height');
  assert.ok(decoded.rgba.equals(rgba), asset.path + ' decoded RGBA differs from fresh rendering');
}

const map = readManifest('public/parameter-map/manifest.json', PARAMETER_MAP_INTEGRITY.manifestSha256);
assert.deepEqual(map.settings, PARAMETER_MAP_SETTINGS);
assert.deepEqual(map.palette, MAP_PALETTE);
assert.equal(map.field.sha256, PARAMETER_MAP_INTEGRITY.fieldSha256);
assert.equal(map.rgba.sha256, PARAMETER_MAP_INTEGRITY.rgbaSha256);
assert.equal(map.image.sha256, PARAMETER_MAP_INTEGRITY.pngSha256);
const mapField = computeNumericalField(PARAMETER_MAP_SETTINGS);
const mapRGBA = Buffer.from(colorizeNumericalField(mapField, PARAMETER_MAP_SETTINGS, MAP_PALETTE.id));
for (const [asset, fresh] of [[map.field, fieldBytes(mapField)], [map.rgba, mapRGBA]]) {
  const stored = read('public' + asset.path);
  verifyBlob(stored, asset, asset.path);
  assert.ok(stored.equals(fresh), asset.path + ' differs from fresh rendering');
}
verifyImage(map.image, map.settings, mapRGBA);

const art = readManifest('public/live-art/manifest.json', ART_MANIFEST_SHA256);
assert.deepEqual(art.works.map(work => work.id), LIVE_WORKS.map(work => work.id));
let encodedBytes = 0;
let decodedBytes = 0;
let images = 0;
for (const work of art.works) {
  assert.deepEqual(work.assets.map(asset => asset.quality), ['preview', 'full']);
  for (const asset of work.assets) {
    const settings = fromLegacySettings(workSettings(work.id, asset.quality));
    assert.deepEqual(settings, asset.settings, asset.image.path + ' numerical settings');
    const field = computeNumericalField(settings);
    const rgba = Buffer.from(colorizeArtField(field, settings, work.palette));
    verifyBlob(fieldBytes(field), asset.field, asset.image.path + ' field');
    verifyBlob(rgba, asset.rgba, asset.image.path + ' RGBA');
    verifyImage(asset.image, settings, rgba);
    encodedBytes += asset.image.bytes;
    decodedBytes += rgba.length;
    images++;
  }
}
assert.equal(encodedBytes, art.cache.imagesEncodedBytes);
assert.equal(decodedBytes, art.cache.imagesDecodedBytes);
assert.equal(ART_PALETTE_CACHE_BYTES, art.cache.paletteLookupBytes);
assert.equal(recordedPaletteBytes, ART_PALETTE_CACHE_BYTES);
assert.equal(ART_IMAGE_CACHE_UPPER_BYTES, encodedBytes + decodedBytes);
assert.equal(ART_CACHE_UPPER_BYTES, encodedBytes + decodedBytes + ART_PALETTE_CACHE_BYTES);
assert.equal(ART_CACHE_UPPER_BYTES, art.cache.upperBytes);

console.log(`Verified 2 fixed manifests and their sources, the ${mapField.length}-pixel Mandelbrot map, and ${images} Julia images (${decodedBytes / 4} pixels) against fresh computation.`);
