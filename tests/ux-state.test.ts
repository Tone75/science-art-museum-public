import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsForSelection, equalSettings, UX_PRESETS } from '../src/ux-state.ts';

test('exhibit choices are exactly the three previously compared CPU presets', () => {
  assert.deepEqual(UX_PRESETS.map((p) => p.c), [{ re: -1, im: 0 }, { re: -0.8, im: 0.156 }, { re: 0.285, im: 0.01 }]);
  for (let i = 0; i < 3; i++) {
    for (const quality of ['preview', 'full'] as const) {
      const settings = settingsForSelection(i, 'lagoon', quality);
      assert.equal(settings.renderer.id, 'cpu-worker');
      assert.equal(settings.renderer.precision, 'float64');
      assert.equal(settings.width, quality === 'preview' ? 256 : 768);
      assert.equal(settings.height, settings.width);
      assert.equal(settings.maxIterations, quality === 'preview' ? 128 : 512);
      assert.equal(settings.escapeRadius, 2);
      assert.deepEqual(settings.viewport, { reMin: -1.6, reMax: 1.6, imMin: -1.6, imMax: 1.6 });
    }
  }
});

test('palette-only selection preserves every numeric input and keeps exact values', () => {
  const a = settingsForSelection(1, 'lagoon', 'full');
  const b = settingsForSelection(1, 'ember', 'full');
  assert.deepEqual({ ...a, palette: undefined }, { ...b, palette: undefined });
  assert.equal(equalSettings(a, JSON.parse(JSON.stringify(a))), true);
  assert.equal(equalSettings(a, b), false);
  assert.equal(equalSettings(a, null), false);
});

test('unsupported exhibit choices are rejected without broadening the numeric domain', () => {
  for (const index of [-1, 3, 1.5, NaN, Infinity]) assert.throws(() => settingsForSelection(index, 'lagoon', 'preview'));
  assert.throws(() => settingsForSelection(0, 'lagoon', 'other' as 'preview'));
});
