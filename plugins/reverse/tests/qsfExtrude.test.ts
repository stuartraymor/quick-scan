// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { decodeQsfExtrude } from '../core/qsfExtrude';
function sample() {
 const record = new Uint8Array(222), metadata = new Uint8Array(220), cache = new Uint8Array(28);
 const v=new DataView(record.buffer), m=new DataView(metadata.buffer), c=new DataView(cache.buffer);
 const own=Array.from({length:16},(_,i)=>i+1), source=Array.from({length:16},(_,i)=>i+20);
 const hex=(a:number[])=>a.map(n=>n.toString(16).padStart(2,'0')).join('');
 v.setUint32(0,0x1a2b3c11,true);record.set(own,12);v.setUint32(120,11,true);
 [...'Extruded(1)'].forEach((s,i)=>v.setUint16(124+2*i,s.charCodeAt(0),true));
 record.set(own,146);v.setUint32(162,1,true);v.setUint32(166,1,true);record.set(source,170);v.setFloat64(190,12,true);
 m.setUint32(0,1,true);m.setUint32(4,7,true);metadata.set(own,12);
 for(const p of[68,92,148,196]){m.setUint32(p,0xe0000000,true);m.setUint32(p+4,0x47efffff,true);}
 c.setUint32(0,0x1a2b3c30,true);cache.set(own,12);
 return{record,metadata,cache,sketch:{guid:hex(source),links:[hex(own)]}};
}
describe('verified QSF extrusion whitelist',()=>{
 it('links sketch/feature/metadata/cache and preserves independently verified depth',()=>{
  const x=sample();const r=decodeQsfExtrude(x.record,x.metadata,x.sketch,x.cache);
  expect(r.name).toBe('Extruded(1)');expect(r.startDepth).toBe(0);expect(r.endDepth).toBe(12);expect(r.draftDegrees).toBe(0);
  // Historical native STEP volumes for diameter20 and regenerated diameter18.
  expect(Math.PI*10**2*r.depth).toBeCloseTo(3769.9111843079163,7);
  expect(Math.PI*9**2*r.depth).toBeCloseTo(3053.6280592894127,7);
 });
 it('rejects every record truncation and unknown operation flags',()=>{
  const x=sample();for(let i=0;i<x.record.length;i++)expect(()=>decodeQsfExtrude(x.record.subarray(0,i),x.metadata,x.sketch)).toThrow();
  x.record[198]=1;expect(()=>decodeQsfExtrude(x.record,x.metadata,x.sketch)).toThrow('flags');
 });
 it('rejects mismatched links/cache and unknown metadata',()=>{
  const x=sample();expect(()=>decodeQsfExtrude(x.record,x.metadata,{...x.sketch,links:[]})).toThrow('dependency');
  x.cache[12]=255;expect(()=>decodeQsfExtrude(x.record,x.metadata,x.sketch,x.cache)).toThrow('cache dependency');
  x.metadata[144]=1;expect(()=>decodeQsfExtrude(x.record,x.metadata,x.sketch)).toThrow('metadata flags');
 });
 it('rejects invalid depth and malformed names',()=>{
  const x=sample();new DataView(x.record.buffer).setFloat64(190,NaN,true);expect(()=>decodeQsfExtrude(x.record,x.metadata,x.sketch)).toThrow('depth');
  new DataView(x.record.buffer).setUint32(120,0xffffffff,true);expect(()=>decodeQsfExtrude(x.record,x.metadata,x.sketch)).toThrow('layout');
 });
});
