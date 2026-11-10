// SPDX-License-Identifier: AGPL-3.0-only
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { decodeQsfSketch, isVerifiedQsfDrivingDiameter, isVerifiedQsfCoincidentEndpoints, type QsfSketchConstraint } from '../core/qsfSketch';
const I = [1,0,0,0,0,1,0,0,0,0,1,0];
function fixture(type?: number) {
 const a:number[]=[]; const raw=(b:number[])=>a.push(...b); const z=(n:number)=>raw(Array(n).fill(0));
 const u=(n:number)=>{const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,n,true);raw([...b]);};
 const d=(n:number)=>{const b=new Uint8Array(8);new DataView(b.buffer).setFloat64(0,n,true);raw([...b]);};
 const guid=(s:string)=>raw(s.match(/../g)!.map(n=>parseInt(n,16)));
 u(0x1a2b3c10);u(7);z(112);u(1);raw([83,0]);z(24);u(0);u(0);u(1);u(11);guid('72fab92cb9c8e54d88de526080553831');u(0);
 const frame=a.length;I.forEach(d);z(76);u(1);u(1);
 const entity=a.length;guid('5f34e60d18fe5848986ace6f2c0fa157');u(0);I.forEach(d);
 const points=[5.301513195037842,6.118160724639893,0,11.192084312438965,4.779394626617432,0,8.246798753738403,5.448777675628662,0];
 points.forEach(d);u(0);u(1);u(1);z(1);const nc=type===undefined?0:1;u(nc);const constraint=a.length;
 if(nc){const b=new Uint8Array(184);const v=new DataView(b.buffer);v.setUint32(16,type!,true);v.setFloat64(20,180,true);v.setInt32(56,1,true);raw([...b]);}
 u(0);u(2);points.slice(0,6).forEach(d);z(1);u(0);z(1);u(1);u(nc);z(156*nc);u(1);u(1);z(1);
 return{bytes:new Uint8Array(a),frame,entity,constraint};
}
describe('strict QSF sketch decoder',()=>{
 it('decodes measured layout through EOF and independently matched DXF endpoints',()=>{
  const{bytes}=fixture();const r=decodeQsfSketch(bytes);expect(r.name).toBe('S');expect(r.consumedBytes).toBe(bytes.length);
  expect(r.entities[0].points[0]).toBeCloseTo(5.301513195038,10);expect(r.entities[0].points[4]).toBeCloseTo(4.779394626617,10);
  expect(r.constraints).toEqual([]);expect(r.editableSupported).toBe(true);
 });
 it('retains constraints separately from semantic claims',()=>{
  const r=decodeQsfSketch(fixture(9).bytes);const c=r.constraints[0];expect(c.semantic).toBe('distance');expect(c.value).toBe(180);
  expect(c.entityIndices).toEqual([0,0]);expect(c.pointIndices).toEqual([0,1]);expect(c.raw).toHaveLength(184);expect(c.auxiliary).toHaveLength(156);expect(r.editableSupported).toBe(false);
  expect(decodeQsfSketch(Buffer.from(fixture(9).bytes)).constraints[0].value).toBe(180);
 });
 it('supports independently verified translation and reports rotated frames',()=>{
  const{bytes,frame}=fixture();new DataView(bytes.buffer).setFloat64(frame+24,12,true);const r=decodeQsfSketch(bytes);
  expect(r.frame.transform[3]).toBe(12);expect(r.frame.supported).toBe(true);expect(r.frame.referenceCoordinates).toBe('world'); new DataView(bytes.buffer).setFloat64(frame,0,true);expect(decodeQsfSketch(bytes).frame.supported).toBe(false);
  expect(decodeQsfSketch(Buffer.from(fixture(9).bytes)).constraints[0].value).toBe(180);
 });
 it('rejects unknown constraint and entity kinds',()=>{
  expect(()=>decodeQsfSketch(fixture(14).bytes)).toThrow('constraint type 14');const{bytes,entity}=fixture();bytes[entity]=255;expect(()=>decodeQsfSketch(bytes)).toThrow('entity class');
 });
 it('rejects every truncation',()=>{const{bytes}=fixture(9);for(let i=0;i<bytes.length;i++)expect(()=>decodeQsfSketch(bytes.subarray(0,i))).toThrow();});
 it('rejects trailing bytes and unsupported flags',()=>{
  const{bytes}=fixture();expect(()=>decodeQsfSketch(new Uint8Array([...bytes,0]))).toThrow('trailing');bytes[bytes.length-1]=1;expect(()=>decodeQsfSketch(bytes)).toThrow('entity flags');
 });
 it('rejects invalid constraint indices and nonfinite values',()=>{
  const{bytes,constraint}=fixture(9);const v=new DataView(bytes.buffer);v.setUint32(constraint+168,1,true);expect(()=>decodeQsfSketch(bytes)).toThrow('entity index');
  v.setUint32(constraint+168,0,true);v.setFloat64(constraint+20,NaN,true);expect(()=>decodeQsfSketch(bytes)).toThrow('Nonfinite');
 });
 it('honors byte offsets and count bounds',()=>{
  const{bytes}=fixture();const outer=new Uint8Array(bytes.length+9);outer.set(bytes,5);expect(decodeQsfSketch(outer.subarray(5,5+bytes.length)).entities).toHaveLength(1);
  new DataView(bytes.buffer).setUint32(120,0xffffffff,true);expect(()=>decodeQsfSketch(bytes)).toThrow('count');
 });
});



it('recognizes only the measured driving-diameter metadata fingerprint', () => {
 const fromHex = (s: string) => new Uint8Array(s.match(/../g)!.map(x => parseInt(x, 16)));
 const c: QsfSketchConstraint = { nativeType: 12, value: 10, entityIndices: [0, 0], pointIndices: [4, -1], semantic: 'radius',
 raw: fromHex('0000000048fb17410100000000cbebeb0c000000000000000000244000c0ebebfe7f000030a693050000000030a693050000000004000000ffffffff0000010000000000000000000000000078c946415ce919410000000078c946415ce9194100000000ffff7f7f0000000000000000000000000000000048f40440000000003c7ae83fffff7f7f000000000000000000000000000000000000000000000000000000000000000000000000000000006c00790000000000'), auxiliary: fromHex('0000000000000000000000000000000054597e31000000e0ffffef4700000000000000000000000000000000000000e0ffffef470000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000') };
 expect(isVerifiedQsfDrivingDiameter(c)).toBe(true);
 c.value = 9; new DataView(c.raw.buffer).setFloat64(20, 9, true); c.raw[36] ^= 1;
 expect(isVerifiedQsfDrivingDiameter(c)).toBe(true);
 c.raw[60] ^= 1; expect(isVerifiedQsfDrivingDiameter(c)).toBe(false); c.raw[60] ^= 1;
 c.auxiliary[30] ^= 1; expect(isVerifiedQsfDrivingDiameter(c)).toBe(false);
});
it('decodes native visibility toggle and the calibrated X2 section basis', () => {
 const {bytes,frame}=fixture(); const v=new DataView(bytes.buffer);v.setUint32(32,1,true);
 [0,0,1,2,1,0,0,0,0,1,0,0].forEach((n,i)=>v.setFloat64(frame+i*8,n,true));
 const r=decodeQsfSketch(bytes);expect(r.visible).toBe(true);expect(r.frame.supported).toBe(true);
 expect(r.frame.origin).toEqual([2,0,0]);expect(r.frame.normal).toEqual([1,0,0]);expect(r.frame.basisU).toEqual([0,1,0]);expect(r.frame.basisV).toEqual([0,0,1]);
 v.setUint32(32,0,true);expect(decodeQsfSketch(bytes).visible).toBe(false);v.setUint32(32,2,true);expect(()=>decodeQsfSketch(bytes)).toThrow('visibility');
});

it('retains the native verified coincidence binding through endpoint drag', () => {
 const points = [
 [25.067618203719164,9.600437329787834,0,-9.238795312094865,-3.826834359396029,0,7.914411445812149,2.8868014851959023,0],
 [25.067618203719164,9.600437329787834,0,-3.361894267834076,-11.920141050871177,0,10.852861967942545,-1.1598518605416714,0]];
 const entities = points.map(p => ({kind:'line' as const,classGuid:'5f34e60d18fe5848986ace6f2c0fa157',transform:I,points:p,nativeFlags:[0,1]}));
 const fromHex = (s:string)=>new Uint8Array(s.match(/../g)!.map(n=>parseInt(n,16)));
 const c:QsfSketchConstraint={nativeType:2,value:0,entityIndices:[0,1],pointIndices:[0,0],semantic:'coincident',raw:fromHex("0000000048fb174101000000004b7bf70200000000000000000000000033a00400000000306778040000000020697804000000000000000000000000000001f7f97f00000000000000000000000000000000000000000000703ecb4136121f4100000000ffff7f7f00000000000000000000000000000000404bca3f00000000404bca3fffff7f7f000000000000000000000000000000000000000000000000000000000000000000000000010000000000000000000000"),auxiliary:fromHex("0000000000000000000000000000000000000000000000e0ffffef4700000000000000000000000000000000000000e0ffffef470000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000")};
 expect(isVerifiedQsfCoincidentEndpoints(c,entities)).toBe(true);
 c.raw[29]^=1;c.raw[88]^=1;expect(isVerifiedQsfCoincidentEndpoints(c,entities)).toBe(true);
 c.raw[62]^=1;expect(isVerifiedQsfCoincidentEndpoints(c,entities)).toBe(false);c.raw[62]^=1;
 entities[1].points[0]+=1;expect(isVerifiedQsfCoincidentEndpoints(c,entities)).toBe(false);
});

it('matches native coupled endpoint-drag geometry using the imported relation', async () => {
 const {emptySketch,addEntity,addConstraint,entityOf}=await import('../core/sketch');
 const {solveSketch}=await import('../core/solver');const s=emptySketch();
 const a=addEntity(s,{kind:'line',a:[25.067618203719164,9.600437329787834],b:[-9.238795312094865,-3.826834359396029]});
 const b=addEntity(s,{kind:'line',a:[25.067618203719164,9.600437329787834],b:[-3.361894267834076,-11.920141050871177]});
 addConstraint(s,{kind:'coincident',p:{entity:a,at:'a'},q:{entity:b,at:'a'}});
 const target:[number,number]=[19.165285992257076,7.290308986975477];
 const result=solveSketch(s,{pull:[{anchor:{entity:a,at:'a'},to:target}]});expect(result.ok).toBe(true);
 const l=entityOf(s,a),r=entityOf(s,b);if(l?.kind!=='line'||r?.kind!=='line')throw Error('Missing lines');
 expect(Math.hypot(l.a[0]-target[0],l.a[1]-target[1])).toBeLessThan(2e-5);expect(Math.hypot(r.a[0]-target[0],r.a[1]-target[1])).toBeLessThan(2e-5);expect(Math.hypot(l.a[0]-r.a[0],l.a[1]-r.a[1])).toBeLessThan(1e-9);
 expect(l.b[0]).toBeCloseTo(-9.238795312094865,9);expect(l.b[1]).toBeCloseTo(-3.826834359396029,9);
 expect(r.b[0]).toBeCloseTo(-3.361894267834076,9);expect(r.b[1]).toBeCloseTo(-11.920141050871177,9);
});
