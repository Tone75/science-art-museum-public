import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { validateParameter, parseParameterDraft, planeFromUnit, fromUnit, toUnit, pointerToPlane, pointerToParameter, parameterToClient, getContentRect, arrowParameter, INITIAL_SELECTION } from '../src/parameter/coordinates.ts';
import { ParameterMap } from '../src/parameter/map.ts';
import { PARAMETER_MAP_SETTINGS, MAP_CACHE_BASELINE_BYTES } from '../src/parameter/map-spec.ts';
import { PARAMETER_MAP_INTEGRITY } from '../src/parameter/map-integrity.ts';
import { computeNumericalField } from '../src/numerics/engine.ts';
import { colorizeNumericalField } from '../src/numerics/palette.ts';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const points = [
  {u:0,v:0,re:-2,im:1,selectable:false},{u:.5,v:0,re:-.5,im:1,selectable:true},{u:1,v:0,re:1,im:1,selectable:true},
  {u:0,v:.5,re:-2,im:0,selectable:true},{u:.5,v:.5,re:-.5,im:0,selectable:true},{u:1,v:.5,re:1,im:0,selectable:true},
  {u:0,v:1,re:-2,im:-1,selectable:false},{u:.5,v:1,re:-.5,im:-1,selectable:true},{u:1,v:1,re:1,im:-1,selectable:true},
];
for (const width of [240,360,480]) for (const dpr of [1,2]) for (const p of points) {
  test(`Parameter map: continuous coordinates ${width}px DPR${dpr} u${p.u}v${p.v}`, () => {
    // DPR is a display environment attribute, never another multiplier of client coordinates.
    const rect = {left:17.25,top:33.5,width,height:width*2/3};
    const x = rect.left + p.u*rect.width, y = rect.top + p.v*rect.height;
    assert.deepEqual(planeFromUnit(p.u,p.v),{re:p.re,im:p.im});
    assert.deepEqual(pointerToPlane(x,y,rect),{re:p.re,im:p.im});
    assert.deepEqual(toUnit({re:p.re,im:p.im}),{u:p.u,v:p.v});
    assert.deepEqual(parameterToClient({re:p.re,im:p.im},rect),{x,y});
    if(p.selectable) assert.deepEqual(pointerToParameter(x,y,rect),{re:p.re,im:p.im});
    else assert.throws(()=>pointerToParameter(x,y,rect),/\|c\|/);
  });
}
test('Parameter map: origin and presets preserve numerical values within prescribed tolerance', () => {
  for(const c of [{re:0,im:0},{re:-1,im:0},INITIAL_SELECTION.c,{re:.285,im:.01}]) {
    const r={left:0,top:0,width:360,height:240},screen=parameterToClient(c,r),back=pointerToParameter(screen.x,screen.y,r);
    assert.ok(Math.abs(back.re-c.re)<=8*Number.EPSILON*Math.max(1,Math.abs(c.re)));
    assert.ok(Math.abs(back.im-c.im)<=8*Number.EPSILON*Math.max(1,Math.abs(c.im)));
  }
  const precise={re:-.8123456789012345,im:.1567890123456789};assert.deepEqual(validateParameter(precise),precise);
  assert.deepEqual(parseParameterDraft(String(precise.re),String(precise.im)),precise);
  assert.deepEqual(validateParameter({re:-0,im:-0}),{re:0,im:0});
});
test('Parameter map: draft parsing and supported-domain rejection do not silently clamp', () => {
  for(const [re,im]of [['','0'],['0',' '],['NaN','0'],['Infinity','0'],['0x1','0'],['1abc','0'],['.','0'],['1,5','0'],['-2','1'],['1.01','0'],['0','1.01'],['-2.01','0']]) assert.throws(()=>parseParameterDraft(re,im));
  for(const input of [null,[],{}, {re:0,im:0,extra:1},{re:NaN,im:0},{re:0,im:Infinity},{re:'0',im:0},{re:-2,im:1},{re:0,im:-1.01}])assert.throws(()=>validateParameter(input));
  for(const c of [{re:-2,im:0},{re:1,im:0},{re:0,im:1},{re:0,im:-1}])assert.deepEqual(validateParameter(c),c);
  assert.throws(()=>fromUnit(-.001,.5));assert.throws(()=>fromUnit(1.001,.5));assert.throws(()=>fromUnit(.5,NaN));
  const rect={left:10,top:20,width:240,height:160};assert.throws(()=>pointerToParameter(9.99,100,rect));assert.throws(()=>pointerToParameter(251,100,rect));assert.throws(()=>pointerToPlane(100,100,{...rect,width:0}));
});
test('Parameter map: arrow directions, step sizes and boundary refusal', () => {
  assert.deepEqual(arrowParameter({re:0,im:0},'ArrowRight'),{re:.01,im:0});
  assert.deepEqual(arrowParameter({re:0,im:0},'ArrowLeft',true),{re:-.1,im:0});
  assert.deepEqual(arrowParameter({re:0,im:0},'ArrowUp'),{re:0,im:.01});
  assert.deepEqual(arrowParameter({re:0,im:0},'ArrowDown',true),{re:0,im:-.1});
  assert.throws(()=>arrowParameter({re:1,im:0},'ArrowRight'));
  assert.throws(()=>arrowParameter({re:-2,im:0},'ArrowUp'));
  assert.throws(()=>arrowParameter({re:0,im:0},'Wheel'));
});
test('Parameter map: content box excludes scaled border and padding without DPR multiplication', () => {
  const previous=globalThis.getComputedStyle;
  try {
    globalThis.getComputedStyle=()=>({boxSizing:'content-box',width:'240px',height:'160px',borderLeftWidth:'2px',borderRightWidth:'2px',borderTopWidth:'2px',borderBottomWidth:'2px',paddingLeft:'3px',paddingRight:'3px',paddingTop:'3px',paddingBottom:'3px',transform:'none'} as CSSStyleDeclaration);
    const element={getBoundingClientRect:()=>({left:100,top:200,width:500,height:340})}as HTMLElement;
    assert.deepEqual(getContentRect(element),{left:110,top:210,width:480,height:320});
    globalThis.getComputedStyle=()=>({boxSizing:'border-box',width:'250px',height:'170px',borderLeftWidth:'2px',borderRightWidth:'2px',borderTopWidth:'2px',borderBottomWidth:'2px',paddingLeft:'3px',paddingRight:'3px',paddingTop:'3px',paddingBottom:'3px',transform:'none'}as CSSStyleDeclaration);
    assert.deepEqual(getContentRect(element),{left:110,top:210,width:480,height:320});
  } finally {globalThis.getComputedStyle=previous;}
});
test('Parameter map: generated field, RGBA, PNG and manifest correspond to fresh accepted API', () => {
  const manifestBytes=readFileSync('public/parameter-map/manifest.json'),m=JSON.parse(manifestBytes.toString());assert.equal(sha(manifestBytes),PARAMETER_MAP_INTEGRITY.manifestSha256);
  const raw=readFileSync('public/parameter-map/mandelbrot-field.u16'),field=computeNumericalField(PARAMETER_MAP_SETTINGS);assert.equal(raw.length,field.length*2);
  for(let i=0;i<field.length;i++)assert.equal(raw.readUInt16LE(i*2),field[i]);
  const rgba=readFileSync('public/parameter-map/mandelbrot-rgba.bin');assert.deepEqual(rgba,Buffer.from(colorizeNumericalField(field,PARAMETER_MAP_SETTINGS,'lagoon')));
  assert.equal(sha(raw),m.field.sha256);assert.equal(sha(rgba),m.rgba.sha256);
  const png=readFileSync('public/parameter-map/mandelbrot.png');assert.equal(sha(png),m.image.sha256);
  let offset=8;const idat:Buffer[]=[];while(offset+12<=png.length){const len=png.readUInt32BE(offset),kind=png.toString('ascii',offset+4,offset+8);if(kind==='IDAT')idat.push(png.subarray(offset+8,offset+8+len));assert.ok(!['tEXt','zTXt','iTXt','eXIf'].includes(kind));offset+=len+12;}
  const decoded=inflateSync(Buffer.concat(idat));for(let j=0;j<192;j++){assert.equal(decoded[j*(288*4+1)],0);assert.deepEqual(decoded.subarray(j*(288*4+1)+1,(j+1)*(288*4+1)),rgba.subarray(j*288*4,(j+1)*288*4));}
  for(const [name,digest]of Object.entries(m.sourceSha256))assert.equal(sha(readFileSync(name)),digest);
  execFileSync(process.execPath,['scripts/generate-parameter-map.mjs','--check']);
});

function mockCanvas(){const painted:Uint8ClampedArray[]=[];return {canvas:{width:300,height:150,getContext:()=>({putImageData:(image:ImageData)=>painted.push(image.data.slice())})}as unknown as HTMLCanvasElement,painted};}
async function mapEnvironment(operation:(fetches:string[])=>Promise<void>){
 const oldFetch=globalThis.fetch,oldImage=globalThis.ImageData;const fetches:string[]=[];
 try{globalThis.ImageData=class {data:Uint8ClampedArray;width:number;height:number;constructor(data:Uint8ClampedArray,width:number,height:number){this.data=data;this.width=width;this.height=height;}}as unknown as typeof ImageData;
 globalThis.fetch=async input=>{const name=String(input);fetches.push(name);const data=readFileSync(`public${name}`);return new Response(data,{status:200,headers:{'Content-Length':String(data.length)}});};await operation(fetches);
 }finally{globalThis.fetch=oldFetch;globalThis.ImageData=oldImage;}
}
test('Parameter map: fixed map loads once, uses a bounded retained cache and disposes',async()=>{
 await mapEnvironment(async fetches=>{const {canvas,painted}=mockCanvas(),map=new ParameterMap(canvas);assert.equal(map.snapshot().resources.managedBufferBytes,0);await map.load();assert.equal(map.snapshot().status,'ready');assert.equal(map.snapshot().resources.managedBufferBytes,MAP_CACHE_BASELINE_BYTES);assert.equal(map.snapshot().resources.baselineBytes,552960);assert.equal(map.snapshot().numericalCalculations,0);assert.equal(fetches.length,3);assert.equal(painted.length,1);await map.load();assert.equal(fetches.length,3);assert.equal(painted.length,1);assert.ok(map.snapshot().resources.peakManagedBufferBytes<64*1024*1024);map.dispose();assert.equal(map.snapshot().status,'disposed');assert.equal(map.snapshot().resources.managedBufferBytes,0);assert.equal(canvas.width,0);assert.equal(canvas.height,0);});
});
test('Parameter map: corrupt / unavailable map is unavailable, then explicit retry restores it',async()=>{
 await mapEnvironment(async()=>{const normalFetch=globalThis.fetch;const {canvas}=mockCanvas(),map=new ParameterMap(canvas);globalThis.fetch=async()=>new Response('unavailable',{status:404});await map.load();assert.equal(map.snapshot().status,'error');assert.equal(map.snapshot().resources.managedBufferBytes,0);assert.equal(canvas.width,0);globalThis.fetch=async(input,init)=>{if(String(input).endsWith('mandelbrot-field.u16')){const raw=readFileSync('public/parameter-map/mandelbrot-field.u16');raw[0]^=1;return new Response(raw);}return normalFetch(input,init);};await map.retry();assert.equal(map.snapshot().status,'error');assert.match(map.snapshot().error!,/hash/);assert.equal(map.snapshot().resources.managedBufferBytes,0);globalThis.fetch=normalFetch;await map.retry();assert.equal(map.snapshot().status,'ready');assert.equal(map.snapshot().resources.managedBufferBytes,552960);map.dispose();});
});
test('Parameter map: declared oversize asset is refused before reading, no fake map is drawn',async()=>{
 await mapEnvironment(async()=>{const {canvas,painted}=mockCanvas(),map=new ParameterMap(canvas);globalThis.fetch=async()=>new Response('{}',{headers:{'Content-Length':'67108865'}});await map.load();assert.equal(map.snapshot().status,'error');assert.equal(map.snapshot().resources.managedBufferBytes,0);assert.equal(painted.length,0);map.dispose();});
});
test('Parameter map: disposal while an asset read is pending cannot resurrect cache or retry',async()=>{
 await mapEnvironment(async()=>{let release!:()=>void;const {canvas,painted}=mockCanvas(),map=new ParameterMap(canvas);globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){release=()=>{controller.enqueue(new Uint8Array([1,2,3]));controller.close();};}}));const pending=map.load();const retry=map.retry();map.dispose();release();await pending;await retry;assert.equal(map.snapshot().status,'disposed');assert.equal(map.snapshot().resources.managedBufferBytes,0);assert.equal(painted.length,0);});
});
test('Parameter map: actual 5000ms map watchdog ends an unavailable request and explicit retry recovers',async()=>{
 await mapEnvironment(async()=>{const normal=globalThis.fetch,{canvas,painted}=mockCanvas(),map=new ParameterMap(canvas);globalThis.fetch=async(_input,options)=>await new Promise<Response>((_resolve,reject)=>{options?.signal?.addEventListener('abort',()=>reject(new DOMException('Request aborted','AbortError')),{once:true});});const at=performance.now();await map.load();const elapsed=performance.now()-at;assert.ok(elapsed>=4900);assert.equal(map.snapshot().status,'error');assert.match(map.snapshot().error!,/5000ms/);assert.equal(map.snapshot().resources.timers,0);assert.equal(map.snapshot().resources.managedBufferBytes,0);assert.equal(painted.length,0);globalThis.fetch=normal;await map.retry();assert.equal(map.snapshot().status,'ready');assert.equal(map.snapshot().resources.managedBufferBytes,552960);assert.equal(map.snapshot().resources.timers,0);map.dispose();});
});
