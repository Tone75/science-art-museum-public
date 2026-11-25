import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIVE_WORKS } from '../src/art/works.ts';
import { marbleC } from '../src/tour/marble.ts';
import { STOP_MS } from '../src/tour/route.ts';
import { validateParameter } from '../src/parameter/coordinates.ts';

test('Each marble path returns to its work, stays inside the product domain and holds still with reduced motion', () => {
  for (const work of LIVE_WORKS) {
    assert.deepEqual(marbleC(work.id, 0), work.c);
    assert.deepEqual(marbleC(work.id, STOP_MS), work.c);
    let previous = work.c, excursion = 0;
    for (let t = 10; t <= STOP_MS; t += 10) {
      const c = marbleC(work.id, t);
      assert.deepEqual(validateParameter(c), c);
      assert.deepEqual(marbleC(work.id, t), c);
      assert.deepEqual(marbleC(work.id, t, true), work.c);
      assert.ok(Math.hypot(c.re - previous.re, c.im - previous.im) < .003);
      excursion = Math.max(excursion, Math.hypot(c.re - work.c.re, c.im - work.c.im));
      previous = c;
    }
    assert.ok(excursion > .015);
  }
  for (const t of [-1, STOP_MS + 1, Infinity, NaN]) assert.throws(() => marbleC('tide', t));
});
