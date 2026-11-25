import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSettings, parseSettings, serializeSettings, validateSettings } from '../src/config.ts';
import { computeField, escapeCount, pixelCenter, SENTINEL } from '../src/math/cpu.ts';
import { colorize } from '../src/color.ts';
import { ANALYTIC_CASES, referenceEscape, referencePixel } from './reference.ts';

for (const point of ANALYTIC_CASES) {
  test(`analytic contract: ${point.name}`, () => {
    assert.equal(escapeCount(point.re, point.im, point.c.re, point.c.im, point.N), point.expected);
    assert.equal(referenceEscape(point.re, point.im, point.c.re, point.c.im, point.N), point.expected);
  });
}

test('pixel centers have top-left origin and imaginary axis points upward', () => {
  const settings = makeSettings('cpu-worker', { re: 0, im: 0 }, 2);
  assert.deepEqual(pixelCenter(0, 0, 2, 2, settings.viewport), { re: -0.8, im: 0.8 });
  const bottomRight = pixelCenter(1, 1, 2, 2, settings.viewport);
  assert.ok(Math.abs(bottomRight.re - 0.8) < 1e-15);
  assert.ok(Math.abs(bottomRight.im + 0.8) < 1e-15);
  assert.deepEqual(referencePixel(0, 0, settings), { re: -0.8, im: 0.8 });
  assert.deepEqual(pixelCenter(0, 0, 1, 1, settings.viewport), { re: 0, im: 0 });
  assert.throws(() => pixelCenter(-1, 0, 2, 2, settings.viewport));
  assert.throws(() => pixelCenter(0, 2, 2, 2, settings.viewport));
  assert.throws(() => pixelCenter(0, 0, 2, 3, settings.viewport));
});

test('fresh CPU field preserves n=N versus sentinel and never depends on palette', () => {
  const settings = makeSettings('cpu-worker', { re: 1, im: 0 }, 1, 3);
  const escaped = computeField(settings);
  assert.deepEqual([...escaped], [3]);
  assert.deepEqual([...computeField({ ...settings, maxIterations: 2 })], [SENTINEL]);
  const changedPalette = { ...settings, palette: { ...settings.palette, id: 'ember' as const } };
  assert.deepEqual(computeField(changedPalette), escaped);
  assert.notStrictEqual(computeField(settings), escaped);
  const snapshot = escaped.slice();
  assert.notDeepEqual(colorize(escaped, settings), colorize(escaped, changedPalette));
  assert.deepEqual(escaped, snapshot);
  assert.equal(colorize(escaped, settings)[3], 255);
  assert.notEqual(SENTINEL, 0);
  for (const count of [0, 1, 255, 256, 512, SENTINEL]) {
    assert.equal(new Uint16Array([count])[0], count);
  }
});

test('JSON retains c precision and all renderer, viewport, sampling and palette fields', () => {
  for (const renderer of ['cpu-worker', 'webgl2'] as const) {
    const settings = makeSettings(renderer, { re: -0.8000000000000002, im: 0.15600000000000003 }, 768, 512, 'ember');
    assert.deepEqual(parseSettings(serializeSettings(settings)), settings);
    assert.equal(parseSettings(serializeSettings(settings)).c.re, settings.c.re);
    assert.equal(parseSettings(serializeSettings(settings)).c.im, settings.c.im);
  }
});

test('invalid schemas, nonfinite values and out-of-range inputs fail before rendering', () => {
  const valid = makeSettings('cpu-worker', { re: 0, im: 0 });
  const invalid: unknown[] = [
    null, [], {}, { ...valid, schemaVersion: 2 }, { ...valid, extra: true },
    { ...valid, c: { re: Number.NaN, im: 0 } },
    { ...valid, c: { re: 0, im: Number.POSITIVE_INFINITY } },
    { ...valid, c: { re: 1.5, im: 1.5 } },
    { ...valid, c: { re: 0, im: 0, extra: true } },
    { ...valid, width: 0 }, { ...valid, width: 769, height: 769 },
    { ...valid, width: 2.5, height: 2.5 }, { ...valid, height: 128 },
    { ...valid, maxIterations: -1 }, { ...valid, maxIterations: 513 },
    { ...valid, maxIterations: 1.1 }, { ...valid, escapeRadius: 3 },
    { ...valid, viewport: { ...valid.viewport, reMin: -2 } },
    { ...valid, pixelSampling: 'corner' },
    { ...valid, renderer: { ...valid.renderer, id: 'unknown' } },
    { ...valid, renderer: { ...valid.renderer, precision: 'highp-float32' } },
    { ...valid, renderer: { ...valid.renderer, version: '2.0.0' } },
    { ...valid, palette: { ...valid.palette, id: 'unknown' } },
    { ...valid, palette: { ...valid.palette, version: '2.0.0' } },
  ];
  for (const value of invalid) assert.throws(() => validateSettings(value));
  assert.throws(() => parseSettings('{"c": Infinity}'));
  assert.throws(() => parseSettings('not json'));
  assert.throws(() => escapeCount(0, 0, Number.NaN, 0, 5));
  assert.throws(() => escapeCount(0, 0, 0, 0, 1.2));
  assert.throws(() => escapeCount(Number.POSITIVE_INFINITY, 0, 0, 0, 2));
  assert.throws(() => colorize(new Uint16Array(1), valid));
});
