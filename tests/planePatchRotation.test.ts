// SPDX-License-Identifier: AGPL-3.0-only
import {describe,expect,it} from 'vitest'
import {applyExtension,withPlaneRotation,withSide,squareExtension,zeroExtension,isExtended} from '../src/core/elements/extend'
import type {PlaneFit} from '../src/core/types'
const fit:PlaneFit={kind:'plane',center:[2,3,7],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0],extentU:10,extentV:5,sigma:0.002,usedPoints:25,regionSize:25}
const close=(actual:number[],expected:number[])=>actual.forEach((v,i)=>expect(v).toBeCloseTo(expected[i],10))
describe('plane patch spin',()=>{
 it('turns its basis by 90 degrees without changing the measured plane or size',()=>{
  const original=JSON.stringify(fit), ext=withPlaneRotation(fit,undefined,90)
  const shown=applyExtension(fit,ext) as PlaneFit
  close(shown.basisU,[0,1,0]);close(shown.basisV,[-1,0,0]);close(shown.center,fit.center)
  expect(shown.normal).toEqual(fit.normal);expect(shown.sigma).toBe(fit.sigma)
  expect([shown.extentU,shown.extentV]).toEqual([10,5]);expect(JSON.stringify(fit)).toBe(original)
  expect(isExtended(ext)).toBe(true)
 })
 it('spins an asymmetrically resized patch about its drawn centre',()=>{
  const ext=withSide(fit,zeroExtension(fit),'uMax',12)
  const before=applyExtension(fit,ext) as PlaneFit
  const after=applyExtension(fit,withPlaneRotation(fit,ext,63)) as PlaneFit
  close(after.center,before.center);expect(after.extentU).toBe(before.extentU)
 })
 it('a subsequent resize follows the rotated axes and leaves the opposite edge fixed',()=>{
  const ext=withPlaneRotation(fit,undefined,90)
  const before=applyExtension(fit,ext) as PlaneFit
  const after=applyExtension(fit,withSide(fit,ext,'uMax',8)) as PlaneFit
  close(after.center,[2,7,7]);expect(after.extentU).toBe(14)
  close(before.center.map((v,i)=>v-before.basisU[i]*before.extentU),after.center.map((v,i)=>v-after.basisU[i]*after.extentU))
 })
 it('keeps rotation when squaring the patch and during JSON round trips',()=>{
  const ext=squareExtension(fit,withPlaneRotation(fit,undefined,37))
  expect(applyExtension(fit,JSON.parse(JSON.stringify(ext)))).toEqual(applyExtension(fit,ext))
  expect(ext.kind==='plane'&&ext.rotation).toBe(37)
 })
 it('rejects nonfinite rotation and supports repeated turns without drifting',()=>{
  let ext=withSide(fit,zeroExtension(fit),'vMin',3)
  const before=applyExtension(fit,ext) as PlaneFit
  for(let angle=10;angle<=720;angle+=10)ext=withPlaneRotation(fit,ext,angle)
  const after=applyExtension(fit,ext) as PlaneFit
  close(after.center,before.center);close(after.basisU,before.basisU)
  expect(withPlaneRotation(fit,ext,NaN)).toBe(ext)
 })
})
