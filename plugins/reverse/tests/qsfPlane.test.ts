// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { decodeQsfPlane } from '../core/qsfPlane';
function sample() {
 const b=new Uint8Array(356),v=new DataView(b.buffer);v.setUint32(0,0x1a2b3c08,true);v.setUint32(120,8,true);
 [...'Plane(1)'].forEach((c,i)=>v.setUint16(124+2*i,c.charCodeAt(0),true));
 const prefix='00000000000000000000000002000000000000e0ffffef47000000e0ffffef47000000e0ffffef47000000e0ffffef4700000000000000000000000000000000ffffffff00000000';
 b.set(prefix.match(/../g)!.map(s=>parseInt(s,16)),156);v.setFloat64(244,1,true);v.setFloat64(268,5,true);v.setFloat64(284,-1,true);v.setFloat64(300,15.5,true);v.setFloat64(308,15.5,true);return b;
}
describe('verified cylinder datum plane',()=>{
 it('preserves native Z5 datum and raw display provenance',()=>{const r=decodeQsfPlane(sample());expect(r.name).toBe('Plane(1)');expect(r.normal).toEqual([0,0,1]);expect(r.origin).toEqual([0,0,5]);expect(r.nativeDisplaySize).toEqual([15.5,15.5]);});
 it('rejects unknown geometry or metadata and every truncation',()=>{const b=sample();for(let n=0;n<b.length;n++)expect(()=>decodeQsfPlane(b.subarray(0,n))).toThrow();b[320]=1;expect(()=>decodeQsfPlane(b)).toThrow('metadata');b[320]=0;new DataView(b.buffer).setFloat64(268,6,true);expect(()=>decodeQsfPlane(b)).toThrow('geometry');});
});
