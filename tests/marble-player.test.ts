import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GuidedTour } from '../src/tour/player.ts';
import { marbleC } from '../src/tour/marble.ts';
import { TOUR_MS } from '../src/tour/route.ts';

function fixture(t, reducedMotion = false) {
  const timers = new Map();
  const images = [];
  const workers = [];
  const document = Object.assign(new EventTarget(), {hidden: false});
  const motion = Object.assign(new EventTarget(), {matches: reducedMotion});
  let now = 0, nextId = 0, paints = 0;
  function advance() {
    const next = [...timers].sort(([, a], [, b]) => a.at - b.at)[0];
    assert.ok(next, 'the tour has scheduled a wake-up');
    timers.delete(next[0]);
    now = Math.max(now, next[1].at);
    next[1].run();
  }
  class ImageStub {
    naturalWidth = 768;
    naturalHeight = 768;
    constructor() { images.push(this); }
    removeAttribute() {}
  }
  class WorkerStub {
    commands = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(command) { this.commands.push(command); }
    terminate() { this.terminated = true; }
  }
  const globals = {
    window: {setTimeout(run, delay) { timers.set(++nextId, {run, at: now + delay}); return nextId; }},
    clearTimeout: id => timers.delete(id), performance: {now: () => now}, matchMedia: () => motion,
    Image: ImageStub, ImageData: class {}, Worker: WorkerStub, document,
  };
  const originals = Object.getOwnPropertyDescriptors(globalThis);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, {value, configurable: true});
  const canvas = {width: 0, height: 0, getContext() { return {drawImage() { paints++; }, putImageData() { paints++; }}; }};
  const player = new GuidedTour(canvas, () => {}, {audit: true});
  t.after(() => {
    player.dispose();
    for (const key of Object.keys(globals)) {
      if (originals[key]) Object.defineProperty(globalThis, key, originals[key]);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  function reply(worker = workers.at(-1)) {
    const {id, settings} = worker.commands.at(-1);
    return {data: {id, rgba: new ArrayBuffer(settings.width * settings.height * 4)}};
  }
  function start() { player.start(); images[0].onload(); }
  return {player, advance, workers, document, timers, images, canvas, reply, start,
    elapse: ms => { now += ms; }, paints: () => paints};
}

test('An in-flight frame cannot become the handoff before paint, after hiding, or after exit', t => {
  const h = fixture(t);
  h.start();
  h.advance(); h.advance();
  const worker = h.workers[0];
  assert.equal(h.player.resources().active, 1);
  const print = h.player.snapshot().displayed;
  assert.equal(print.rendering, 'overview');
  assert.equal(print.width, 768);
  h.elapse(14); worker.onmessage(h.reply());
  const first = h.player.snapshot().displayed;
  assert.deepEqual(first.view.c, marbleC(first.workId, first.timeMs));
  assert.notDeepEqual(first.view.c, print.view.c);
  assert.equal(first.width, h.canvas.width);
  assert.equal(first.maxIterations, first.view.maxIterations);
  assert.equal(first.view.resolution, 768);

  h.advance();
  const late = worker.onmessage, stale = h.reply(), paints = h.paints();
  assert.deepEqual(h.player.snapshot().displayed, first);
  h.document.hidden = true; h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(worker.terminated, true);
  assert.equal(h.player.resources().timers, 0);
  h.elapse(90000); late(stale);
  assert.equal(h.player.snapshot().pausedBy, 'hidden');
  assert.equal(h.player.snapshot().elapsedMs, first.timeMs);
  assert.equal(h.paints(), paints);
  h.document.hidden = false; h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.player.snapshot().status, 'paused');
  h.player.resume(); h.advance();
  const current = h.workers[1];
  h.elapse(12); current.onmessage(h.reply());
  assert.ok(h.player.snapshot().displayed.timeMs < first.timeMs + 125);
  h.advance();
  const afterExit = current.onmessage, old = h.reply();
  h.player.stop(); afterExit(old);
  assert.equal(h.player.snapshot().displayed, null);
  assert.deepEqual(h.player.resources(), {worker: 0, active: 0, pending: 0, timers: 0, managedBufferBytes: 0});
});

test('Slow frames lower raster density and a stalled worker times out and can be retried', t => {
  const h = fixture(t);
  h.start(); h.advance(); h.advance();
  const worker = h.workers[0];
  for (let i = 0; i < 3; i++) {
    assert.equal(h.timers.size, 1, 'a busy worker only has a watchdog');
    h.elapse(85);
    worker.onmessage(h.reply());
    h.advance();
  }
  assert.equal(worker.commands[3].settings.width, 256);
  assert.equal(worker.commands[3].settings.maxIterations, 512);
  assert.equal(h.player.diagnostics().framesRequested, 4);
  assert.equal(h.player.diagnostics().framesPainted, 3);
  assert.equal(h.player.diagnostics().maxPending, 0);
  const stable = h.player.snapshot().displayed;
  const late = worker.onmessage, stale = h.reply();
  h.advance();
  assert.equal(h.player.snapshot().status, 'error');
  assert.equal(worker.terminated, true);
  late(stale);
  assert.deepEqual(h.player.snapshot().displayed, stable);
  h.player.resume(); h.advance();
  const retry = h.workers[1];
  h.elapse(21); retry.onmessage(h.reply());
  assert.equal(h.player.snapshot().status, 'playing');
  assert.equal(h.player.snapshot().displayed.sequence, stable.sequence + 1);
});

test('Reduced motion visits the three actual prints with one wake-up at a time and no numerical jobs', t => {
  const h = fixture(t, true);
  h.start();
  const stops = [];
  for (const workId of ['tide', 'twin', 'petals']) {
    if (h.player.snapshot().status === 'loading') h.images.at(-1).onload();
    stops.push(h.player.snapshot().displayed.workId);
    assert.equal(h.player.snapshot().displayed.workId, workId);
    for (let i = 0; i < 4; i++) { assert.equal(h.timers.size, 1); h.advance(); }
  }
  assert.deepEqual(stops, ['tide', 'twin', 'petals']);
  assert.equal(h.player.snapshot().status, 'ended');
  assert.equal(h.player.snapshot().elapsedMs, TOUR_MS);
  assert.equal(h.player.snapshot().displayed.workId, 'petals');
  assert.equal(h.player.resources().timers, 0);
  assert.equal(h.workers.length, 0);
});
