import {test} from 'node:test';
import assert from 'node:assert/strict';
import{createHash}from'node:crypto';
import {ARTWORK_SCHEMA,MAX_ARTWORK_BYTES,artworkId,definitionFromView,definitionToView,definitionJson,serializeArtwork,parseArtworkJson,parseUniqueJson,validateArtwork,verifyDefinition,fieldBytes,sha256} from '../src/save/schema.ts';
const view={schemaVersion:'SAM-006-B-view-v1',c:{re:-.8000000000000002,im:.15600000000000003},viewport:{reMin:.10000000000000002,reMax:.9000000000000001,imMin:-.30000000000000004,imMax:.5},maxIterations:256,resolution:768,displayPalette:'porcelain'};
async function artifact(){const definition=definitionFromView(view),integrity={definitionSha256:await sha256(new TextEncoder().encode(definitionJson(definition))),fieldSha256:'1'.repeat(64),rgbaSha256:'2'.repeat(64)};return{schemaVersion:ARTWORK_SCHEMA,artworkId:artworkId(integrity),definition,integrity,reference:{workId:'not-a-preset'},provenance:{sourceCommit:null},execution:{requestId:3,epoch:2}};}
test('Save envelope JSON preserves nontrivial binary64 definition, including asymmetric endpoint representations',async()=>{
 const a=await artifact(),text=serializeArtwork(a),parsed=await verifyDefinition(parseArtworkJson(text));assert.deepEqual(parsed,a);assert.ok(text.endsWith('\n'));assert.equal(new TextEncoder().encode(text).length<MAX_ARTWORK_BYTES,true);
 const v=definitionToView(parsed.definition);for(const key of ['re','im'])assert.ok(Object.is(v.c[key],view.c[key]));for(const key of ['reMin','reMax','imMin','imMax'])assert.ok(Object.is(v.viewport[key],view.viewport[key]));assert.equal(parsed.reference.workId,'not-a-preset');assert.deepEqual(v,view);
 const zero={...view,c:{re:-0,im:+0}},d=definitionFromView(zero);assert.equal(JSON.parse(definitionJson(d)).c.re,0);assert.equal(JSON.parse(definitionJson(d)).c.im,0);
});
test('Save JSON parser reads the JSON grammar and rejects nested escaped-key duplicates, trailing syntax and depth/bytes',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(parseUniqueJson(' {"a":[true,false,null,-1.25e+2],"b":"escape\\n\\u3042\\\\\\\""}\n'))),{a:[true,false,null,-125],b:'escape\nあ\\"'});
 for(const text of ['{"a":1,"a":2}','{"a":{"x":0,"\\u0078":1}}','{"a":1,"\\u0061":2}','{"a":1,}','{"a":01}','{"a":NaN}','{"a":Infinity}','{"a":1}x','[1,]','{"a":"bad\nline"}', '['.repeat(34)+'0'+']'.repeat(34), ' '.repeat(MAX_ARTWORK_BYTES+1)])assert.throws(()=>parseUniqueJson(text),text.slice(0,70));
});
test('Save schema rejects unsupported, missing/unknown/typed/domain variants without loosening B or legacy contracts',async()=>{
 const a=await artifact();const variants=[{...a,schemaVersion:'old'}, {...a,extra:true},Object.fromEntries(Object.entries(a).filter(([k])=>k!=='integrity')), {...a,artworkId:'sam-other'}, {...a,integrity:{...a.integrity,rgbaSha256:'A'.repeat(64)}}, {...a,definition:{...a.definition,engineCompatibilityVersion:'future'}}, {...a,definition:{...a.definition,palette:{id:'porcelain',version:'future'}}}, {...a,definition:{...a.definition,width:512,height:512}}, {...a,definition:{...a.definition,maxIterations:0}}, {...a,definition:{...a.definition,c:{re:NaN,im:0}}}, {...a,definition:{...a.definition,c:{re:2,im:0}}}, {...a,definition:{...a.definition,viewport:{reMin:0,reMax:.2,imMin:0,imMax:.2}}}, {...a,provenance:{sourceCommit:'bad'}}, {...a,execution:{requestId:0,epoch:1}}];for(const v of variants)assert.throws(()=>validateArtwork(v));
 const changed={...a,definition:{...a.definition,maxIterations:128}};assert.throws(()=>parseArtworkJson(JSON.stringify({...a,definition:{...a.definition,c:{re:null,im:0}}})));await assert.rejects(()=>verifyDefinition(changed),/照合情報/);
 const sourceChanged={...a,provenance:{sourceCommit:'a'.repeat(40)}};assert.equal((await verifyDefinition(sourceChanged)).provenance.sourceCommit,'a'.repeat(40));
});
test('Field hashing explicitly encodes little-endian n=0, n=N, and sentinel without conflation',async()=>{
 const b=fieldBytes(new Uint16Array([0,1,255,256,512,65535]));assert.deepEqual([...b],[0,0,1,0,255,0,0,1,0,2,255,255]);assert.equal(await sha256(b),createHash('sha256').update(Buffer.from('00000100ff0000010002ffff','hex')).digest('hex'));
});
test('Save envelope JSON accepts both legacy archive palettes and POP palettes cleanly',async()=>{
 for(const displayPalette of ['violet-pop','cobalt-pop','crimson-pop','lagoon','ember','porcelain'] as const){
  const v={...view,displayPalette},definition=definitionFromView(v),integrity={definitionSha256:await sha256(new TextEncoder().encode(definitionJson(definition))),fieldSha256:'3'.repeat(64),rgbaSha256:'4'.repeat(64)};
  const a={schemaVersion:ARTWORK_SCHEMA,artworkId:artworkId(integrity),definition,integrity,reference:{workId:'tide'},provenance:{sourceCommit:null},execution:{requestId:1,epoch:1}};
  const roundtrip=await verifyDefinition(parseArtworkJson(serializeArtwork(a)));
  assert.deepEqual(definitionToView(roundtrip.definition),v);
 }
});
