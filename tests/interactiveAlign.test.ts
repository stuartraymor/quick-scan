// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach,describe,expect,it} from 'vitest'
import {interactiveTurn,interactiveMove,useInteractiveAlign} from '../src/state/interactiveAlignStore'
import {identityRigid,rigidApply,rigidRotationAngle} from '../src/core/deviation/rigid'
const point=(m:ReturnType<typeof identityRigid>,p:[number,number,number])=>{const out=new Float64Array(3);rigidApply(m,...p,out);return [...out]}
describe('interactive scan alignment',()=>{
 beforeEach(()=>{useInteractiveAlign.getState().close();useInteractiveAlign.getState().setStrength(1);useInteractiveAlign.getState().setMirror(false)})
 it('turns around the part centre rather than the global origin',()=>{
  const m=interactiveTurn(identityRigid(),[50,20,10],'z',90)
  point(m,[50,20,10]).forEach((v,i)=>expect(v).toBeCloseTo([50,20,10][i],10))
  point(m,[60,20,10]).forEach((v,i)=>expect(v).toBeCloseTo([50,30,10][i],10))
 })
 it('keeps a moved centre fixed through a later world-axis turn',()=>{
  const m=interactiveMove(identityRigid(),'x',12),t=interactiveTurn(m,[50,20,10],'y',27)
  point(t,[50,20,10]).forEach((v,i)=>expect(v).toBeCloseTo([62,20,10][i],10))
 })
 it('reports drag deltas from the start rather than accumulating every pointer move',()=>{
  const s=useInteractiveAlign.getState();s.start([0,0,0]);s.drag('align-mx',0,'start');s.drag('align-mx',2,'move');s.drag('align-mx',3,'move')
  expect(useInteractiveAlign.getState().rigid.t[0]).toBe(3)
 })
 it('scales ring drags with strength and clears canceled previews',()=>{
  const s=useInteractiveAlign.getState();s.start([0,0,0]);s.setStrength(.5);s.drag('align-rx',0,'start');s.drag('align-rx',40,'move');s.drag('align-rx',0,'end')
  expect(rigidRotationAngle(useInteractiveAlign.getState().rigid)*180/Math.PI).toBeCloseTo(20,10)
  s.close();expect(useInteractiveAlign.getState().open).toBe(false);expect([...useInteractiveAlign.getState().rigid.r]).toEqual([...identityRigid().r])
 })
 it('ignores invalid and unrelated drag messages',()=>{
  const s=useInteractiveAlign.getState();s.start([0,0,0]);s.drag('align-rx',50,'move');s.rotate('x',NaN);s.move('z',Infinity);s.drag('other',4,'start')
  expect([...useInteractiveAlign.getState().rigid.r]).toEqual([...identityRigid().r]);expect([...useInteractiveAlign.getState().rigid.t]).toEqual([0,0,0])
 })
})

describe('alignment view and mirror preview state',()=>{
 it('orients the view basis and places the part centre at the world origin',()=>{
  const s=useInteractiveAlign.getState();s.start([50,20,10]);s.move('x',12)
  s.orientToView({r:new Float64Array([0,-1,0,1,0,0,0,0,1]),t:new Float64Array(3)})
  const result=useInteractiveAlign.getState();expect(result.asView).toBe(true)
  point(result.rigid,[50,20,10]).forEach(v=>expect(v).toBeCloseTo(0,10))
  point(result.rigid,[60,20,10]).forEach((v,i)=>expect(v).toBeCloseTo([0,10,0][i],10))
 })
 it('keeps the mirrored display separate from the committed rigid and retains the display preference on exit',()=>{
  const s=useInteractiveAlign.getState();s.start([5,2,1]);s.setMirror(true);s.setMirrorPlane('OXY')
  expect([...useInteractiveAlign.getState().rigid.r]).toEqual([...identityRigid().r])
  expect(useInteractiveAlign.getState().mirror).toBe(true)
  s.close();expect(useInteractiveAlign.getState().mirror).toBe(true);s.start([5,2,1]);expect(useInteractiveAlign.getState().mirror).toBe(true)
 })
})

it('allows zero drag strength without changing manual increments',()=>{
 const s=useInteractiveAlign.getState();s.start([0,0,0]);s.setStrength(0);s.drag('align-mx',0,'start');s.drag('align-mx',5,'move');s.drag('align-mx',0,'end')
 expect(useInteractiveAlign.getState().rigid.t[0]).toBe(0);s.move('x',1);expect(useInteractiveAlign.getState().rigid.t[0]).toBe(1)
})
