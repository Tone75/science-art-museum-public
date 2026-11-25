import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {makeSettings,validateSettings} from '../src/config.ts';
import {fromLegacySettings} from '../src/numerics/legacy.ts';
import {computeNumericalField} from '../src/numerics/engine.ts';
import {colorizeNumericalField} from '../src/numerics/palette.ts';
import {colorizeArtField,legacyBasePalette,validateDisplayPalette,DISPLAY_PALETTES,POP_PALETTES,ARCHIVE_PALETTES,POP_PALETTE_SPECS,PORCELAIN_UNESCAPED_RGB,ART_PALETTE_CACHE_BYTES} from '../src/art/palette.ts';
import {LIVE_WORKS,workSettings,workDisplaySettings} from '../src/art/works.ts';
import {ART_CACHE_UPPER_BYTES,ART_MANIFEST_SHA256} from '../src/art/integrity.ts';
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifestBytes=readFileSync(new URL('../public/live-art/manifest.json',import.meta.url));
const manifest=JSON.parse(manifestBytes.toString());

// Frozen numerical field SHA-256 digests for the original works (must never drift when palettes change).
const FROZEN_FIELD_SHA256={
  tide:{preview:'dbcac49ab41bcd526a406f33beeab6464f0df68f9d9cbc8c2b27b0720632c1f2',full:'f9fa4156f70d990cf5ccfdb09595ee2855acafb93c55b148a30d1d85dc29b1f5'},
  twin:{preview:'77c6f743773466ef9508f2a77cac7444823507791a6eafc85353fb90959128b3',full:'fc9c62e107ebd7ed1f761c3ab1732a542e2f0b1b043e4076831eaf2d5ea7caa9'},
  petals:{preview:'cfe281704ffd98132e0bf9e21ec3858bbac53ccc63d59c50cfd2a22cc40aa276',full:'e3cd338022ab92bdc3ac2b2c8a2967d93eaf25e6466f7cd53869cbec9828cc3f'},
};

test('Display extension keeps strict v1 validator closed and maps only explicit legacy bases',()=>{
 const s=makeSettings('cpu-worker',{re:-.8,im:.156});
 for(const id of ['porcelain','violet-pop','cobalt-pop','crimson-pop'])assert.throws(()=>validateSettings({...s,palette:{id,version:'1.0.0'}}));
 assert.equal(legacyBasePalette('porcelain'),'lagoon');assert.equal(legacyBasePalette('ember'),'ember');
 assert.equal(legacyBasePalette('violet-pop'),'lagoon');assert.equal(legacyBasePalette('cobalt-pop'),'ember');assert.equal(legacyBasePalette('crimson-pop'),'lagoon');
 assert.throws(()=>validateDisplayPalette('other'));assert.throws(()=>validateDisplayPalette({id:'porcelain'}));
 assert.deepEqual(POP_PALETTES.map(x=>x.id),['violet-pop','cobalt-pop','crimson-pop']);
 assert.deepEqual(ARCHIVE_PALETTES.map(x=>x.id),['lagoon','ember','porcelain']);
 assert.deepEqual(DISPLAY_PALETTES.map(x=>x.id),['violet-pop','cobalt-pop','crimson-pop','lagoon','ember','porcelain']);
});

test('Both accepted palettes remain byte-identical for all escape counts and sentinel',()=>{
 const s=fromLegacySettings(makeSettings('cpu-worker',{re:0,im:0},24,512));
 const f=new Uint16Array(24*24);for(let i=0;i<f.length;i++)f[i]=i<=512?i:65535;const before=f.slice();
 for(const id of ['lagoon','ember'] as const)assert.deepEqual(colorizeArtField(f,s,id),colorizeNumericalField(f,s,id));
 assert.deepEqual(f,before);
});

test('Porcelain uses fixed RGB anchors and leaves the integer numerical field unchanged',()=>{
 const s=fromLegacySettings(makeSettings('cpu-worker',{re:0,im:0},3,512));
 const f=new Uint16Array([0,14,36,58,79,95,96,512,65535]),before=f.slice();
 const a=colorizeArtField(f,s,'porcelain'),b=colorizeArtField(f,s,'porcelain');
 assert.deepEqual(a,b);assert.deepEqual(f,before);
 for(const [i,rgb]of [[0,[19,34,47]],[1,[69,99,103]],[2,[239,229,209]],[3,[164,111,69]],[4,[244,236,219]],[5,[19,34,47]],[6,[19,34,47]],[8,PORCELAIN_UNESCAPED_RGB]] as const)assert.deepEqual([...a.subarray(i*4,i*4+4)],[...rgb,255]);
});

test('POP palettes are deterministic, leave fields unchanged, anchor n=0/1 seamlessly, and preserve unescaped RGB',()=>{
 const s=fromLegacySettings(makeSettings('cpu-worker',{re:0,im:0},24,512));
 const f=new Uint16Array(24*24);for(let i=0;i<f.length;i++)f[i]=i<=512?i:65535;const before=f.slice();
 const hashes=new Set<string>();
 for(const id of ['violet-pop','cobalt-pop','crimson-pop'] as const){
  const spec=POP_PALETTE_SPECS[id];
  const a=colorizeArtField(f,s,id),b=colorizeArtField(f,s,id);
  assert.deepEqual(a,b);assert.deepEqual(f,before);
  assert.deepEqual([...a.subarray(0,4)],[...spec.stops[0]!.rgb,255]);
  assert.deepEqual([...a.subarray(4,8)],[...spec.stops[0]!.rgb,255]);
  assert.deepEqual([...a.subarray(513*4,513*4+4)],[...spec.unescapedRGB,255]);
  hashes.add(sha(a));
 }
 assert.equal(hashes.size,3);
});

test('Art colorizer rejects bad dimensions, counts, palette and numerical settings',()=>{
 const s=fromLegacySettings(makeSettings('cpu-worker',{re:0,im:0},1,3));
 for(const id of ['violet-pop','cobalt-pop','crimson-pop','lagoon','ember','porcelain'] as const){assert.throws(()=>colorizeArtField(new Uint16Array(2),s,id));assert.throws(()=>colorizeArtField(new Uint16Array([4]),s,id));}
 assert.throws(()=>colorizeArtField(new Uint16Array([0]),s,'unknown' as any));
 assert.throws(()=>colorizeArtField(new Uint16Array([0]),{...s,maxIterations:NaN},'porcelain'));
});

test('Three works have different canonical c, POP palettes and shape fields, and full selection is explicit',()=>{
 assert.equal(LIVE_WORKS.length,3);assert.equal(new Set(LIVE_WORKS.map(w=>JSON.stringify(w.c))).size,3);
 assert.equal(new Set(LIVE_WORKS.map(w=>w.palette)).size,3);
 const hashes=[];for(const w of LIVE_WORKS){const s=workSettings(w.id);assert.equal(s.width,768);assert.equal(s.maxIterations,512);assert.deepEqual(s.c,w.c);assert.equal(s.palette.id,legacyBasePalette(w.palette));const display=workDisplaySettings(w.id);assert.equal(display.palette.id,w.palette);hashes.push(sha(computeNumericalField(fromLegacySettings(workSettings(w.id,'preview')))));}
 assert.equal(new Set(hashes).size,3);assert.throws(()=>workSettings('no-work'));assert.throws(()=>workSettings('tide','bad' as any));
});

test('Manifest pins all six work images to fresh API field, frozen numerical field SHA-256, display mapping, PNG and cache budget',()=>{
 assert.equal(sha(manifestBytes),ART_MANIFEST_SHA256);assert.equal(manifest.works.length,3);
 let encoded=0,decoded=0;for(const work of manifest.works){assert.equal(work.assets.length,2);for(const a of work.assets){const numeric=fromLegacySettings(workSettings(work.id,a.quality));assert.deepEqual(a.settings,numeric);const f=computeNumericalField(numeric),fb=Buffer.alloc(f.length*2);for(let i=0;i<f.length;i++)fb.writeUInt16LE(f[i],i*2);assert.equal(sha(fb),a.field.sha256);assert.equal(sha(fb),FROZEN_FIELD_SHA256[work.id as keyof typeof FROZEN_FIELD_SHA256][a.quality as 'preview'|'full']);assert.equal(sha(colorizeArtField(f,numeric,work.palette)),a.rgba.sha256);const image=readFileSync(new URL('../public'+a.image.path,import.meta.url));assert.equal(sha(image),a.image.sha256);assert.equal(image.readUInt32BE(16),numeric.width);assert.equal(image.readUInt32BE(20),numeric.height);encoded+=image.length;decoded+=numeric.width*numeric.height*4;}}
 assert.equal(decoded,7864320);assert.equal(ART_CACHE_UPPER_BYTES,encoded+decoded+ART_PALETTE_CACHE_BYTES);assert.equal(manifest.cache.upperBytes,ART_CACHE_UPPER_BYTES);
});
