import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateProductView,validateProductViewport,cloneProductView,toNumericalSettings,PRODUCT_VIEW_VERSION,INITIAL_VIEWPORT} from '../src/framing/contract.ts';
import {viewportCenter,viewportSpan,zoomViewport,panViewport,panByFraction,panFromDrag,planeFromUnit,clientToPlane,pointToClient} from '../src/framing/coordinates.ts';
import {validateSettings,makeSettings} from '../src/config.ts';
import {ProductRenderer} from '../src/product/renderer.ts';
import {computeNumericalField} from '../src/numerics/engine.ts';
import {colorizeArtField} from '../src/art/palette.ts';
const view=(patch:any={})=>({schemaVersion:PRODUCT_VIEW_VERSION,c:{re:-1,im:0},viewport:{...INITIAL_VIEWPORT},maxIterations:512,resolution:768,displayPalette:'porcelain',...patch});
const minViewport={reMin:1.375,reMax:1.625,imMin:-.125,imMax:.125};

test('Framing explicit product adapter preserves viewport/N/resolution and keeps strict legacy validator unchanged',()=>{
 const v=validateProductView(view({viewport:minViewport,maxIterations:256,resolution:768}));
 const final=toNumericalSettings(v,'final'),intermediate=toNumericalSettings(v,'intermediate');
 assert.deepEqual(final.viewport,minViewport);assert.deepEqual(final.c,{re:-1,im:0});assert.equal(final.width,768);assert.equal(final.height,768);assert.equal(final.maxIterations,256);
 assert.equal(intermediate.width,256);assert.equal(intermediate.maxIterations,128);assert.deepEqual(intermediate.viewport,final.viewport);
 assert.throws(()=>validateSettings({...makeSettings('cpu-worker',{re:-1,im:0}),viewport:minViewport}));
 assert.throws(()=>validateSettings({...makeSettings('cpu-worker',{re:-1,im:0}),palette:{id:'porcelain',version:'1.0.0'}}));
 assert.throws(()=>toNumericalSettings(v,'preview' as any));
 const copied=cloneProductView(v);copied.c.re=0;copied.viewport.reMin=0;assert.equal(v.c.re,-1);assert.equal(v.viewport.reMin,1.375);
});
test('Framing rejects malformed or out-of-product-range states without clamping/coercion',()=>{
 for(const patch of [{schemaVersion:1},{extra:true},{c:{re:1.1,im:0}},{c:{re:NaN,im:0}},{c:{re:0,im:1.1}},{maxIterations:0},{maxIterations:129},{maxIterations:'128'},{maxIterations:Infinity},{resolution:512},{displayPalette:'other'}])assert.throws(()=>validateProductView(view(patch)));
 const valid={reMin:3.75,reMax:4,imMin:-4,imMax:-3.75};assert.deepEqual(validateProductViewport(valid),valid);
 for(const viewport of [{...valid,reMax:4+4*Number.EPSILON},{...valid,imMin:-4-4*Number.EPSILON},{reMin:0,reMax:.25-Number.EPSILON/4,imMin:0,imMax:.25},{reMin:0,reMax:3.2+2*Number.EPSILON,imMin:0,imMax:3.2},{reMin:0,reMax:1,imMin:0,imMax:.5},{...valid,reMin:NaN},{...valid,reMax:Infinity}])assert.throws(()=>validateProductViewport(viewport));
});
test('Framing center-fixed zoom follows the exact five steps and rejects both limits',()=>{
 let v={...INITIAL_VIEWPORT};const spans=[];for(let i=0;i<4;i++){v=zoomViewport(v,'in');spans.push(viewportSpan(v));assert.deepEqual(viewportCenter(v),{re:0,im:0});}assert.deepEqual(spans,[1.6,.8,.4,.25]);assert.throws(()=>zoomViewport(v,'in'));
 for(let i=0;i<4;i++)v=zoomViewport(v,'out');assert.deepEqual(v,INITIAL_VIEWPORT);assert.throws(()=>zoomViewport(v,'out'));
 const p=panViewport(zoomViewport(INITIAL_VIEWPORT,'in'),.5,-.25),z=zoomViewport(p,'in');assert.deepEqual(viewportCenter(z),{re:.5,im:-.25});
});
test('Framing pan signs, rectangular CSS geometry and coordinate inverses match hand-computed binary fixtures',()=>{
 const v={reMin:-.5,reMax:.5,imMin:-.25,imMax:.75},r={left:10,top:20,width:300,height:200};
 for(const [u,w,re,im]of [[0,0,-.5,.75],[.5,.5,0,.25],[1,1,.5,-.25],[.25,.75,-.25,0]]){
  assert.deepEqual(planeFromUnit(v,u,w),{re,im});const p={x:r.left+u*r.width,y:r.top+w*r.height};assert.deepEqual(clientToPlane(v,p.x,p.y,r),{re,im});assert.deepEqual(pointToClient(v,{re,im},r),p);
 }
 assert.deepEqual(panFromDrag(v,{x:10,y:20},{x:85,y:70},r),{reMin:-.75,reMax:.25,imMin:0,imMax:1});
 assert.deepEqual(panByFraction(v,.125,0),{reMin:-.375,reMax:.625,imMin:-.25,imMax:.75});
 assert.throws(()=>clientToPlane(v,9,20,r));assert.throws(()=>panFromDrag(v,{x:NaN,y:0},{x:1,y:1},r));
});

test('Product view uses explicit intermediate/final stages, preserves N256 full and N512 small final and recolors without work',async()=>{
 const originals={Worker:globalThis.Worker,ImageData:globalThis.ImageData,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 const workers:any[]=[],paints:any[]=[];
 class FakeWorker{onmessage:any;onerror:any;commands:any[]=[];constructor(){workers.push(this);}postMessage(m:any){this.commands.push(m);}terminate(){}respond(m:any,type:string,counts?:Uint16Array){this.onmessage?.({data:{protocolVersion:1,type,jobId:m.jobId,requestId:m.requestId,epoch:m.epoch,numericKey:m.numericKey,rows:type==='started'?0:m.settings.height,timerScheduled:type==='started',...(counts?{counts:counts.buffer}:{})}});}}
 class FakeImageData{data:Uint8ClampedArray;constructor(data:Uint8ClampedArray){this.data=data;}}
 Object.assign(globalThis,{Worker:FakeWorker,ImageData:FakeImageData,requestAnimationFrame:(cb:any)=>setTimeout(cb,0),cancelAnimationFrame:clearTimeout});
 let renderer:ProductRenderer|undefined;
 try{
  const canvas={width:0,height:0,getContext:()=>({putImageData:(data:any)=>paints.push(data.data.slice())})};renderer=new ProductRenderer(canvas as any,{audit:true});
  assert.throws(()=>renderer!.requestView(view({maxIterations:513})));assert.equal(workers.length,0);
  const product=validateProductView(view({viewport:minViewport,maxIterations:256}));const id=renderer.requestView(product);let m=workers[0].commands.at(-1);
  assert.equal(m.settings.width,256);assert.equal(m.settings.maxIterations,128);workers[0].respond(m,'started');workers[0].respond(m,'complete',computeNumericalField(m.settings));await new Promise(r=>setTimeout(r,5));
  assert.equal(renderer.snapshot().displayedStage,'intermediate');assert.equal(renderer.snapshot().status,'rendering');assert.equal(renderer.snapshot().displayedNumerical!.maxIterations,128);assert.equal(renderer.snapshot().displayedView!.maxIterations,256);
  m=workers[0].commands.at(-1);assert.equal(m.settings.width,768);assert.equal(m.settings.maxIterations,256);workers[0].respond(m,'started');workers[0].respond(m,'complete',computeNumericalField(m.settings));await renderer.waitForRequest(id);
  let s=renderer.snapshot();assert.equal(s.displayedStage,'final');assert.equal(s.displayedNumerical!.maxIterations,256);assert.equal(s.displayedNumerical!.width,768);assert.equal(s.desiredSettings,null);assert.equal(s.displayedSettings,null);
  assert.deepEqual(paints.at(-1),colorizeArtField(renderer.numericalSnapshot()!,s.displayedNumerical!,'porcelain'));
  const field=renderer.numericalSnapshot(),jobs=renderer.resourceSnapshot().numericalComputations;renderer.stop();assert.equal(renderer.repaintViewPalette('ember'),true);assert.deepEqual(renderer.numericalSnapshot(),field);assert.equal(renderer.resourceSnapshot().numericalComputations,jobs);assert.equal(renderer.snapshot().status,'stopped');assert.equal(renderer.snapshot().desiredView!.displayPalette,'ember');
  const small=renderer.requestView({...product,resolution:256,maxIterations:512});m=workers[0].commands.at(-1);assert.equal(m.settings.width,256);assert.equal(m.settings.maxIterations,128);workers[0].respond(m,'started');workers[0].respond(m,'complete',computeNumericalField(m.settings));await new Promise(r=>setTimeout(r,5));assert.equal(renderer.snapshot().displayedStage,'intermediate');m=workers[0].commands.at(-1);assert.equal(m.settings.width,256);assert.equal(m.settings.maxIterations,512);workers[0].respond(m,'started');workers[0].respond(m,'complete',computeNumericalField(m.settings));await renderer.waitForRequest(small);assert.equal(renderer.snapshot().displayedStage,'final');assert.equal(renderer.snapshot().displayedNumerical!.width,256);assert.equal(renderer.snapshot().displayedNumerical!.maxIterations,512);
  renderer.leave();assert.equal(renderer.snapshot().displayedView,null);assert.equal(renderer.snapshot().displayedNumerical,null);assert.equal(renderer.resourceSnapshot().managedBufferBytes,0);
 }finally{renderer?.dispose();Object.assign(globalThis,originals);}
});
