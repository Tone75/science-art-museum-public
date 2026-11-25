import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillRows, numericKey, assertBufferBudget, BUFFER_BUDGET_BYTES, CHUNK_ROWS } from '../src/product/kernel.ts';
import { computeNumericalField } from '../src/numerics/engine.ts';
import { fromLegacySettings } from '../src/numerics/legacy.ts';
import { makeSettings } from '../src/config.ts';
import { ProductRenderer } from '../src/product/renderer.ts';

const fixture = (patch = {}) => ({ contractVersion: 'SAM-003-N-v1', mode: 'julia', precision: 'float64', width: 37, height: 33, maxIterations: 128, escapeRadius: 2, pixelSampling: 'center-top-left-y-up', viewport: { reMin: -2, reMax: 1, imMin: -1, imMax: 2 }, c: { re: -0.8, im: 0.156 }, ...patch });

test('Product global row chunks preserve accepted API values at every pixel and uneven chunk boundary', () => {
  const settings = fixture(); const actual = new Uint16Array(settings.width * settings.height);
  for (let row = 0; row < settings.height; row += CHUNK_ROWS) fillRows(actual, settings, row, Math.min(row + CHUNK_ROWS, settings.height));
  assert.deepEqual(actual, computeNumericalField(settings));
});

test('Product one-pixel/N0 and rectangular/global rows preserve the n=0/N/null contract', () => {
  for (const settings of [fixture({ width: 1, height: 1, maxIterations: 0, c: { re: 0, im: 0 }, viewport: { reMin: -1, reMax: 1, imMin: -1, imMax: 1 } }), fixture({ width: 3, height: 2, maxIterations: 3, c: { re: 0, im: 0 } })]) {
    const field = new Uint16Array(settings.width * settings.height);
    for (let j = 0; j < settings.height; j++) fillRows(field, settings, j, j + 1);
    assert.deepEqual(field, computeNumericalField(settings));
  }
});

test('Product row rejection happens before writes, including unsupported mode', () => {
  const field = new Uint16Array(37 * 33).fill(42);
  for (const settings of [fixture({ mode: 'mandelbrot' }), fixture({ width: 769 }), fixture({ c: { re: 3, im: 0 } }), fixture({ maxIterations: Number.NaN })]) {
    assert.throws(() => fillRows(field, settings, 0, 1)); assert.ok(field.every(v => v === 42));
  }
  assert.throws(() => fillRows(field, fixture(), -1, 1));
  assert.throws(() => fillRows(field, fixture(), 0, 34));
});

test('Product buffer budget is an explicit upper bound and is not a clamp', () => {
  assert.doesNotThrow(() => assertBufferBudget(BUFFER_BUDGET_BYTES));
  for (const invalid of [BUFFER_BUDGET_BYTES + 1, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) assert.throws(() => assertBufferBudget(invalid));
});

test('Product numeric key excludes palette but distinguishes actual numerical settings', () => {
  const a = makeSettings('cpu-worker', { re: -1, im: 0 });
  const b = { ...a, palette: { id: 'ember', version: '1.0.0' } };
  assert.equal(numericKey(fromLegacySettings(a)), numericKey(fromLegacySettings(b)));
  assert.notEqual(numericKey(fromLegacySettings(a)), numericKey(fromLegacySettings(makeSettings('cpu-worker', { re: 0, im: 0 }))));
  assert.notEqual(numericKey(fromLegacySettings(a)), numericKey(fromLegacySettings(makeSettings('cpu-worker', { re: -1, im: 0 }, 768, 512))));
});

test('Product controller bounds pending work, suppresses old results, reuses palette fields, rejects malformed replies and releases lifecycle resources', async () => {
  const originals = { Worker: globalThis.Worker, ImageData: globalThis.ImageData, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  const workers = [];
  class FakeWorker {
    onmessage = null; onerror = null; onmessageerror = null; commands = []; terminated = false;
    constructor() { workers.push(this); }
    postMessage(command) { this.commands.push(command); }
    terminate() { this.terminated = true; }
    respond(command, type, counts) { this.onmessage?.({ data: { protocolVersion: 1, type, jobId: command.jobId, requestId: command.requestId, epoch: command.epoch, numericKey: command.numericKey, rows: type === 'started' ? 0 : command.settings.height, timerScheduled: type === 'started', ...(counts ? { counts: counts.buffer } : {}) } }); }
  }
  class FakeImageData { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } }
  let paints = 0;
  const canvas = { width: 0, height: 0, getContext: () => ({ putImageData: () => { paints++; } }) };
  Object.assign(globalThis, { Worker: FakeWorker, ImageData: FakeImageData, requestAnimationFrame: callback => setTimeout(() => callback(performance.now()), 0), cancelAnimationFrame: id => clearTimeout(id) });
  let renderer;
  try {
    renderer = new ProductRenderer(canvas, { audit: true });
    assert.throws(() => renderer.request({ ...makeSettings('cpu-worker', { re: 0, im: 0 }), width: 769 })); assert.equal(workers.length, 0);
    assert.throws(() => renderer.auditBudgetRequest(BUFFER_BUDGET_BYTES + 1)); assert.equal(workers.length, 0);
    const a = renderer.request(makeSettings('cpu-worker', { re: 0, im: 0 }), { fresh: true });
    const first = workers[0].commands[0]; workers[0].respond(first, 'started');
    const b = renderer.request(makeSettings('cpu-worker', { re: -1, im: 0 }), { fresh: true });
    const c = renderer.request(makeSettings('cpu-worker', { re: 1, im: 0 }), { fresh: true });
    assert.equal(renderer.resourceSnapshot().active, 1); assert.equal(renderer.resourceSnapshot().pending, 1);
    const cancelled = { ...first, settings: { ...first.settings, height: 0 } };
    workers[0].respond(cancelled, 'cancelled');
    const latest = workers[0].commands.findLast(x => x.type === 'calculate'); assert.notEqual(latest.jobId, first.jobId);
    workers[0].respond(latest, 'started'); workers[0].respond(latest, 'complete', computeNumericalField(latest.settings));
    assert.equal((await renderer.waitForRequest(c)).status, 'displayed');
    assert.equal((await renderer.waitForRequest(a)).status, 'superseded'); assert.equal((await renderer.waitForRequest(b)).status, 'superseded');
    assert.equal(paints, 1);
    const before = renderer.resourceSnapshot().numericalComputations;
    const palette = renderer.request(makeSettings('cpu-worker', { re: 1, im: 0 }, 256, 128, 'ember'));
    assert.equal((await renderer.waitForRequest(palette)).status, 'displayed'); assert.equal(renderer.resourceSnapshot().numericalComputations, before);
    const paintedBeforeOld = paints; workers[0].respond(first, 'complete', computeNumericalField(first.settings)); assert.equal(paints, paintedBeforeOld);
    const bad = renderer.request(makeSettings('cpu-worker', { re: 0, im: 0 }), { fresh: true });
    const badCommand = workers[0].commands.findLast(x => x.type === 'calculate'); workers[0].respond(badCommand, 'started'); workers[0].respond(badCommand, 'complete', new Uint16Array(1));
    assert.equal((await renderer.waitForRequest(bad)).status, 'error'); assert.equal(renderer.resourceSnapshot().worker, 0);
    renderer.leave(); assert.deepEqual(['worker', 'active', 'pending', 'timers', 'managedBufferBytes'].map(k => renderer.resourceSnapshot()[k]), [0, 0, 0, 0, 0]);
    const returned = renderer.request(makeSettings('cpu-worker', { re: -1, im: 0 })); const next = workers[1].commands[0];
    renderer.auditInjectResponse({ protocolVersion: 1, type: 'complete', jobId: first.jobId, requestId: first.requestId, epoch: first.epoch, numericKey: first.numericKey, rows: first.settings.height, timerScheduled: false, counts: computeNumericalField(first.settings).buffer });
    workers[1].respond(next, 'started'); workers[1].respond(next, 'complete', computeNumericalField(next.settings));
    assert.equal((await renderer.waitForRequest(returned)).status, 'displayed'); assert.equal(renderer.snapshot().events.some(e => e.type === 'discard-old-epoch'), true);
    renderer.configureFaults({ holdStart: true }); const stop = renderer.request(makeSettings('cpu-worker', { re: 0, im: 0 }), { fresh: true });
    const waiting = renderer.waitForRequest(stop); renderer.stop(); assert.equal((await waiting).status, 'stopped'); assert.equal(renderer.resourceSnapshot().waiters, 0);
    renderer.leave(); assert.equal(renderer.resourceSnapshot().managedBufferBytes, 0);
  } finally { renderer?.dispose(); Object.assign(globalThis, originals); }
});
