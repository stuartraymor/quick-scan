// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { decodeQsfPlane } from '../core/qsfPlane';
function sample() {
 const b=new Uint8Array(356),v=new DataView(b.buffer);v.setUint32(0,0x1a2b3c08,true);v.setUint32(32,0x10001,true);v.setUint32(120,8,true);
 [...'Plane(1)'].forEach((c,i)=>v.setUint16(124+2*i,c.charCodeAt(0),true));
 const prefix='00000000000000000000000002000000000000e0ffffef47000000e0ffffef47000000e0ffffef47000000e0ffffef4700000000000000000000000000000000ffffffff00000000';
 b.set(prefix.match(/../g)!.map(s=>parseInt(s,16)),156);v.setFloat64(244,1,true);v.setFloat64(268,5,true);v.setFloat64(284,-1,true);v.setFloat64(300,15.5,true);v.setFloat64(308,15.5,true);return b;
}
describe('QSF datum plane',()=>{
 it('preserves native Z5 datum and raw display provenance',()=>{const r=decodeQsfPlane(sample());expect(r.name).toBe('Plane(1)');expect(r.normal).toEqual([0,0,1]);expect(r.origin).toEqual([0,0,5]);expect(r.nativeDisplaySize).toEqual([15.5,15.5]);});
 it('rejects unknown geometry or metadata and every truncation',()=>{const b=sample();for(let n=0;n<b.length;n++)expect(()=>decodeQsfPlane(b.subarray(0,n))).toThrow();b[320]=1;expect(()=>decodeQsfPlane(b)).toThrow('metadata');b[320]=0;new DataView(b.buffer).setFloat64(244,2,true);expect(()=>decodeQsfPlane(b)).toThrow('geometry');new DataView(b.buffer).setFloat64(244,1,true);new DataView(b.buffer).setFloat64(212,Number.NaN,true);expect(()=>decodeQsfPlane(b)).toThrow('fit value');});
 it('reads any plane: its normal, origin, fit RMS and shown/hidden flag',()=>{const b=sample(),v=new DataView(b.buffer);const s=Math.SQRT1_2;v.setFloat64(212,0.0068,true);v.setFloat64(236,s,true);v.setFloat64(244,s,true);v.setFloat64(252,12,true);v.setFloat64(260,-3,true);v.setFloat64(268,40,true);v.setFloat64(284,-s,true);v.setFloat64(292,s,true);v.setUint32(32,0x10000,true);const r=decodeQsfPlane(b);expect(r.normal).toEqual([0,s,s]);expect(r.origin).toEqual([12,-3,40]);expect(r.fitRms).toBe(0.0068);expect(r.visible).toBe(false);});
 it('refuses a normal not square to its in-plane direction, and an unknown header word',()=>{const b=sample(),v=new DataView(b.buffer);v.setFloat64(284,0,true);v.setFloat64(292,1,true);expect(()=>decodeQsfPlane(b)).toThrow('geometry');const c=sample();new DataView(c.buffer).setUint32(32,0x10002,true);expect(()=>decodeQsfPlane(c)).toThrow('header');});
});
