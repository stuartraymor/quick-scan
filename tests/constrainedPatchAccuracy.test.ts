// SPDX-License-Identifier: AGPL-3.0-only
import {it,expect} from 'vitest'
import {constrainFit} from '../src/core/elements/constrain'
import type {PlaneFit,CylinderFit} from '../src/core/types'
const plane:PlaneFit={kind:'plane',center:[0,0,0],normal:[0,0,1],basisU:[1,0,0],basisV:[0,1,0],extentU:1,extentV:1,sigma:0,usedPoints:0,regionSize:0}
const cylinder:CylinderFit={kind:'cylinder',center:[0,0,0],axis:[0,0,1],radius:1,length:1,coverage:90,sigma:0,usedPoints:0,regionSize:0}
const ids=(pos:number[])=>Uint32Array.from({length:pos.length/3},(_,i)=>i)
it('preserves the dimensions of a rotated 80 by 4 mm patch under a parallel hold',()=>{
 const p:number[]=[],a=37*Math.PI/180
 for(let u=-40;u<=40;u+=2)for(let v=-2;v<=2;v++)p.push(10+u*Math.cos(a)-v*Math.sin(a),20+u*Math.sin(a)+v*Math.cos(a),4)
 const f=constrainFit(plane,Float32Array.from(p),ids(p),'parallel-oxy') as PlaneFit
 const sizes=[2*f.extentU,2*f.extentV].sort((a,b)=>a-b)
 console.log('held rectangle dimensions (mm)',sizes)
 expect(sizes[0]).toBeCloseTo(4,3);expect(sizes[1]).toBeCloseTo(80,3)
})
it('recovers the same partial cylinder after translation by 100000 mm',()=>{
 for(const offset of [0,100000]){
  const p:number[]=[]
  for(let i=0;i<=90;i++)for(const z of [-8,0,8]){const a=i*Math.PI/180;p.push(offset+10*Math.cos(a),-offset+10*Math.sin(a),z)}
  const f=constrainFit(cylinder,Float32Array.from(p),ids(p),'perpendicular-oxy') as CylinderFit
  console.log('translated quarter cylinder (offset, radius, sigma mm)',offset,f?.radius,f?.sigma)
  expect(f).toBeTruthy();expect(Math.abs(f.radius-10)).toBeLessThan(.01);expect(f.sigma).toBeLessThan(.005);expect(f.length).toBe(16)
 }
})
it('holds a plane perpendicular by projecting its own normal, as QUICKSURFACE does',()=>{
 // QUICKSURFACE 8.0.128 turns the fitted normal square to the other
 // direction (test-models/bearinghousing: Plane(2) held perpendicular to
 // Plane(1) lands on native within 2e-5 degrees this way, 0.008 degrees off
 // when the normal is refitted across the points). The points here would
 // pull a refit towards (1,-1,0); the projection keeps (1,0,0).
 const p:number[]=[]
 for(let y=-20;y<=20;y++)for(const t of [-.1,.1])p.push(y+t,y,-y-t)
 const f=constrainFit({...plane,normal:[Math.SQRT1_2,0,Math.SQRT1_2]},Float32Array.from(p),ids(p),'perpendicular-oxy') as PlaneFit
 expect(f.normal[2]).toBeCloseTo(0,10);expect(Math.abs(f.normal[0])).toBeCloseTo(1,10);expect(f.normal[1]).toBeCloseTo(0,10)
})
