import test from 'node:test';
import assert from 'node:assert/strict';
import { RenderController } from '../src/controller.ts';
import { makeSettings } from '../src/config.ts';

test('one active / latest pending only, stale work never presents', async () => {
  const gates: (() => void)[] = [];
  const presented: number[] = [];
  let renders = 0;
  const controller = new RenderController({
    render: () => { renders++; return new Promise<void>((resolve) => gates.push(resolve)); },
    present: async () => {},
  }, { frame: async () => {}, onDisplay: (r) => presented.push(r.id) });
  const a = controller.request(makeSettings('cpu-worker', { re: 0, im: 0 }));
  const b = controller.request(makeSettings('cpu-worker', { re: -1, im: 0 }));
  const c = controller.request(makeSettings('cpu-worker', { re: 1, im: 0 }));
  assert.equal((await b).reason, 'superseded-pending');
  gates.shift()!();
  assert.equal((await a).reason, 'superseded-active');
  await new Promise((resolve) => setTimeout(resolve, 0));
  gates.shift()!();
  assert.equal((await c).status, 'displayed');
  assert.equal(renders, 2);
  assert.deepEqual(presented, [3]);
  assert.equal(controller.maxPendingObserved, 1);
});

test('input arriving during presentation never reveals the previous canvas', async () => {
  let release: () => void = () => {};
  let first = true;
  const visible: number[] = [];
  const controller = new RenderController({
    render: async () => {},
    present: async () => { if (first) { first = false; await new Promise<void>((resolve) => { release = resolve; }); } },
  }, { frame: async () => {}, onDisplay: (r) => visible.push(r.id) });
  const a = controller.request(makeSettings('cpu-worker', { re: 0, im: 0 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const b = controller.request(makeSettings('cpu-worker', { re: 1, im: 0 }));
  release();
  assert.equal((await a).reason, 'superseded-before-visibility');
  assert.equal((await b).status, 'displayed');
  assert.deepEqual(visible, [2]);
});

test('invalid inputs are rejected before work starts; settings are copied', async () => {
  let calls = 0;
  const controller = new RenderController({ render: async () => { calls++; }, present: async () => {} }, { frame: async () => {} });
  const s = makeSettings('cpu-worker', { re: 0, im: 0 });
  assert.throws(() => controller.request({ ...s, maxIterations: NaN }));
  assert.equal(calls, 0);
  const result = controller.request(s);
  s.c.re = 1;
  assert.equal((await result).settings.c.re, 0);
});

test('a hung presentation times out, retires the device and never reveals late work', async () => {
  let release: () => void = () => {};
  let disposed = false;
  let displays = 0;
  const controller = new RenderController({
    render: async () => {},
    present: () => new Promise<void>((resolve) => { release = resolve; }),
    dispose: () => { disposed = true; },
  }, { frame: async () => {}, onDisplay: () => { displays++; } });
  const a = await controller.request(makeSettings('cpu-worker', { re: 0, im: 0 }));
  assert.equal(a.status, 'timeout');
  assert.equal(disposed, true);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(displays, 0);
  const b = await controller.request(makeSettings('cpu-worker', { re: 1, im: 0 }));
  assert.equal(b.status, 'error');
  assert.match(b.reason!, /unavailable/);
});
