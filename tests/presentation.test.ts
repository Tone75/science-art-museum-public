import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ProductRenderer} from '../src/product/renderer.ts';
import {makeSettings} from '../src/config.ts';
import {computeNumericalField} from '../src/numerics/engine.ts';
import {colorizeNumericalField} from '../src/numerics/palette.ts';

test('Presentation colorizer and stopped recolor preserve actual fields, identities and numerical job count',async()=>{
 const originals={Worker:globalThis.Worker,ImageData:globalThis.ImageData,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
 const workers:any[]=[],paints:Uint8ClampedArray[]=[];
 class FakeWorker{onmessage:any;commands:any[]=[];constructor(){workers.push(this);}postMessage(m:any){this.commands.push(m);}terminate(){}respond(m:any,type:string,counts?:Uint16Array){this.onmessage?.({data:{protocolVersion:1,type,jobId:m.jobId,requestId:m.requestId,epoch:m.epoch,numericKey:m.numericKey,rows:type==='started'?0:m.settings.height,timerScheduled:type==='started',...(counts?{counts:counts.buffer}:{})}});}}
 class FakeImageData{data:Uint8ClampedArray;constructor(data:Uint8ClampedArray){this.data=data;}}
 Object.assign(globalThis,{Worker:FakeWorker,ImageData:FakeImageData,requestAnimationFrame:(cb:any)=>setTimeout(cb,0),cancelAnimationFrame:clearTimeout});
 let renderer:ProductRenderer|undefined,style=0;
 try{
  const canvas={width:0,height:0,getContext:()=>({putImageData:(im:any)=>paints.push(im.data.slice())})};
  renderer=new ProductRenderer(canvas as any,{audit:true,colorizer:(field,settings,p)=>{const rgba=colorizeNumericalField(field,settings,p);if(style)rgba[0]=201;return rgba;}});
  renderer.auditConfigureRetention(performance.now(),[{re:0,im:0},{re:1,im:0}]);
  const id=renderer.request(makeSettings('cpu-worker',{re:-1,im:0}));const m=workers[0].commands[0];workers[0].respond(m,'started');workers[0].respond(m,'complete',computeNumericalField(m.settings));await renderer.waitForRequest(id);
  const retained=renderer.auditExportFrames();assert.equal(retained.length,1);assert.equal(retained[0]!.window,0);assert.deepEqual(retained[0]!.field,renderer.numericalSnapshot());assert.deepEqual(retained[0]!.rgba,paints[0]);retained[0]!.field[0]=42;assert.notEqual(renderer.numericalSnapshot()![0],42);renderer.auditClearFrames();
  const before=renderer.numericalSnapshot()!,jobs=renderer.resourceSnapshot().numericalComputations;
  renderer.stop();style=1;assert.equal(renderer.repaint('ember'),true);
  assert.equal(renderer.snapshot().status,'stopped');assert.equal(renderer.snapshot().displayedRequestId,id);assert.equal(renderer.resourceSnapshot().numericalComputations,jobs);assert.deepEqual(renderer.numericalSnapshot(),before);assert.equal(paints.at(-1)![0],201);
  assert.equal(renderer.snapshot().displayedSettings?.palette.id,'ember');
  const next=renderer.request(makeSettings('cpu-worker',{re:0,im:0}));const count=renderer.resourceSnapshot().numericalComputations;renderer.repaint('lagoon');assert.equal(renderer.resourceSnapshot().numericalComputations,count);assert.equal(renderer.snapshot().status,'rendering');assert.equal(renderer.snapshot().desiredSettings?.palette.id,'lagoon');assert.equal(renderer.snapshot().displayedSettings?.c.re,-1);
  assert.throws(()=>renderer!.repaint('porcelain' as any));
  renderer.leave();assert.equal(renderer.repaint('lagoon'),false);assert.equal(renderer.resourceSnapshot().managedBufferBytes,0);assert.equal(renderer.resourceSnapshot().worker,0);assert.ok(next>id);
 }finally{renderer?.dispose();Object.assign(globalThis,originals);}
});
