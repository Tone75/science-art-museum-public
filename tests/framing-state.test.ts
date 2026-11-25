import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultWorkView, updateProductView, restoreProductComposition, INITIAL_PRODUCT_VIEWPORT} from '../src/framing/state.ts';

test('Framing controls preserve every canonical variable outside their declared change',()=>{
 const view=updateProductView(defaultWorkView('petals'),{viewport:{reMin:.5,reMax:.75,imMin:-.125,imMax:.125},maxIterations:256,resolution:256,displayPalette:'porcelain'});
 const operations=[{patch:{c:{re:-1,im:0}},changed:'c'},{patch:{viewport:{reMin:.625,reMax:.875,imMin:-.125,imMax:.125}},changed:'viewport'},{patch:{maxIterations:128 as const},changed:'maxIterations'},{patch:{resolution:768 as const},changed:'resolution'},{patch:{displayPalette:'ember' as const},changed:'displayPalette'}];
 for(const operation of operations){const next=updateProductView(view,operation.patch);for(const key of Object.keys(view) as (keyof typeof view)[])if(key!==operation.changed)assert.deepEqual(next[key],view[key]);assert.deepEqual(view.viewport,{reMin:.5,reMax:.75,imMin:-.125,imMax:.125});}
 const full=restoreProductComposition(view);assert.deepEqual(full.viewport,INITIAL_PRODUCT_VIEWPORT);for(const key of ['c','maxIterations','resolution','displayPalette'] as const)assert.deepEqual(full[key],view[key]);
});
test('Work initialization restores its own work rather than silently switching to a different work',()=>{
 const twin=defaultWorkView('twin');assert.deepEqual(twin.c,{re:-1,im:0});assert.equal(twin.displayPalette,'cobalt-pop');assert.equal(twin.resolution,768);assert.equal(twin.maxIterations,512);assert.deepEqual(twin.viewport,INITIAL_PRODUCT_VIEWPORT);
 assert.throws(()=>defaultWorkView('unknown'));assert.throws(()=>updateProductView(twin,{maxIterations:300 as any}));assert.throws(()=>updateProductView(twin,{viewport:{reMin:3.9,reMax:4.15,imMin:-.125,imMax:.125}}));assert.deepEqual(twin,defaultWorkView('twin'));
});
