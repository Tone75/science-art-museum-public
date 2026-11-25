import {test} from 'node:test';
import assert from 'node:assert/strict';
import { validateProductViewport, INITIAL_VIEWPORT } from '../src/framing/contract.ts';
import { GuidedTour } from '../src/tour/player.ts';
import { APPROACH_MS, HOLD_MS, STOP_MS, TOUR_MS, cameraAt, cropOf, locateScene } from '../src/tour/route.ts';

test('The route visits each print once, with a hold on both sides of the approach', () => {
  for (const [i,id] of ['tide','twin','petals'].entries()) {
    const start = STOP_MS * i;
    assert.equal(locateScene(start).stop.workId, id);
    assert.equal(locateScene(start + HOLD_MS - 1).phase, 'overview');
    assert.equal(locateScene(start + HOLD_MS).phase, 'approach');
    const detailAt = start + HOLD_MS + APPROACH_MS;
    assert.equal(locateScene(detailAt).phase, 'detail');
    assert.equal(locateScene(start + STOP_MS - 1).phase, 'passage');
    assert.deepEqual(cameraAt(start + STOP_MS - 1, false), cameraAt(detailAt, false));
    assert.deepEqual(cameraAt(detailAt - 1, true), INITIAL_VIEWPORT);
    assert.deepEqual(cameraAt(detailAt, true), cameraAt(detailAt, false));
  }
  assert.equal(locateScene(TOUR_MS).stop.workId, 'petals');
  assert.throws(() => locateScene(TOUR_MS + 1));
});

test('Crop coordinates map the actual print to a valid square camera throughout travel', () => {
  assert.deepEqual(cropOf(INITIAL_VIEWPORT,768), {x:0,y:0,width:768,height:768});
  assert.deepEqual(cropOf({reMin:-.8,reMax:.8,imMin:0,imMax:1.6},768), {x:192,y:0,width:384,height:384});
  for (let t = 0; t < TOUR_MS; t += 17.36) {
    const viewport = cameraAt(t, false);
    validateProductViewport(viewport);
    const {x,y,width,height} = cropOf(viewport,768);
    assert.ok(x >= 0 && y >= 0 && x + width <= 768.0000000001 && y + height <= 768.0000000001);
    assert.ok(Math.abs(width - height) < 1e-10);
    assert.ok(Math.abs((x + width) / 768 * 3.2 - 1.6 - viewport.reMax) < 1e-14);
    assert.ok(Math.abs(1.6 - (y + height) / 768 * 3.2 - viewport.imMin) < 1e-14);
  }
});

test('Paused, hidden and exited tours ignore stale image callbacks; replay starts a new first scene', t => {
  const document = Object.assign(new EventTarget(), {hidden:false});
  const images = [];
  class PendingImage {
    constructor() { images.push(this); }
    removeAttribute() {}
  }
  const globals = {Image:PendingImage, window:{setTimeout}, matchMedia:()=>Object.assign(new EventTarget(),{matches:false}), document};
  const restore = [];
  for(const [name,value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{configurable:true,value});
    restore.push(() => previous ? Object.defineProperty(globalThis,name,previous) : Reflect.deleteProperty(globalThis,name));
  }
  const player = new GuidedTour({width:768,height:768,getContext:()=>({})},()=>{});
  t.after(() => {
    player.dispose();
    for (const reset of restore) reset();
  });
  player.start();
  assert.equal(player.snapshot().status,'loading');
  const late = images[0].onload;
  player.pause();
  late();
  assert.equal(player.snapshot().pausedBy,'visitor');
  assert.equal(player.snapshot().displayed,null);
  assert.equal(player.resources().timers,0);
  player.resume();
  const lateError = images[1].onerror;
  document.hidden=true; document.dispatchEvent(new Event('visibilitychange'));
  lateError();
  assert.equal(player.snapshot().pausedBy,'hidden');
  document.hidden=false; document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(player.snapshot().status,'paused');
  player.resume();
  const afterExit = images[2].onload;
  player.stop(); afterExit();
  assert.deepEqual(player.resources(),{worker:0,active:0,pending:0,timers:0,managedBufferBytes:0});
  player.start();
  assert.ok(images[3].src.endsWith('tide-full.png'));
  images[3].onerror();
  assert.equal(player.snapshot().status,'error');
  player.resume();
  assert.equal(player.snapshot().status,'loading');
  player.stop();
});
