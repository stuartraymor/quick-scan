// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest'
import {measureAnalytic,measureThreePointAngle,type AnalyticGeometry as G} from '../src/core/measure/analytic'
import type {Vec3} from '../src/core/types'
const cases:{name:string;a:G;b:G;distance:number;key?:string}[]=[
 {name:'3-4-12 points',a:{kind:'point',at:[0,0,0]},b:{kind:'point',at:[3,4,12]},distance:13},
 {name:'point to finite edge end',a:{kind:'point',at:[3,4,0]},b:{kind:'segment',a:[0,0,0],b:[1,0,0]},distance:Math.sqrt(20)},
 {name:'point to infinite line',a:{kind:'point',at:[3,4,0]},b:{kind:'line',at:[0,0,0],dir:[1,0,0]},distance:4},
 {name:'point to plane',a:{kind:'point',at:[1,2,7]},b:{kind:'plane',at:[0,0,2],normal:[0,0,1]},distance:5},
 {name:'parallel segments',a:{kind:'segment',a:[0,0,0],b:[10,0,0]},b:{kind:'segment',a:[2,3,0],b:[8,3,0]},distance:3},
 {name:'intersecting segments',a:{kind:'segment',a:[0,0,0],b:[10,0,0]},b:{kind:'segment',a:[5,-1,0],b:[5,1,0]},distance:0},
 {name:'separated collinear segments',a:{kind:'segment',a:[0,0,0],b:[5,0,0]},b:{kind:'segment',a:[10,0,0],b:[20,0,0]},distance:5},
 {name:'skew supporting lines',a:{kind:'line',at:[0,0,0],dir:[1,0,0]},b:{kind:'line',at:[0,0,5],dir:[0,1,0]},distance:5},
 {name:'parallel line and plane',a:{kind:'line',at:[0,0,5],dir:[1,0,0]},b:{kind:'plane',at:[0,0,0],normal:[0,0,1]},distance:5},
 {name:'finite edge short of plane',a:{kind:'segment',a:[0,0,5],b:[0,0,10]},b:{kind:'plane',at:[0,0,0],normal:[0,0,1]},distance:5},
 {name:'crossing supporting line and plane',a:{kind:'line',at:[0,0,5],dir:[1,0,1]},b:{kind:'plane',at:[0,0,0],normal:[0,0,1]},distance:0},
 {name:'parallel planes',a:{kind:'plane',at:[0,0,0],normal:[0,0,1]},b:{kind:'plane',at:[0,0,12],normal:[0,0,1]},distance:12},
 {name:'intersecting planes',a:{kind:'plane',at:[5,0,0],normal:[1,0,0]},b:{kind:'plane',at:[0,0,2],normal:[0,0,1]},distance:0},
 {name:'point to tilted circle',a:{kind:'point',at:[0,3,5]},b:{kind:'circle',center:[0,0,0],normal:[0,1,0],radius:2},distance:Math.sqrt(18)},
 {name:'sphere centre to its surface',a:{kind:'point',at:[0,0,0]},b:{kind:'sphere',center:[0,0,0],radius:2},distance:2},
 {name:'external circle gap',a:{kind:'circle',center:[0,0,0],normal:[0,0,1],radius:2},b:{kind:'circle',center:[10,0,0],normal:[0,0,1],radius:3},distance:5,key:'minDistance'},
 {name:'nested circle gap',a:{kind:'circle',center:[0,0,0],normal:[0,0,1],radius:5},b:{kind:'circle',center:[1,0,0],normal:[0,0,1],radius:2},distance:2,key:'minDistance'},
 {name:'intersecting circles',a:{kind:'circle',center:[0,0,0],normal:[0,0,1],radius:3},b:{kind:'circle',center:[4,0,0],normal:[0,0,1],radius:2},distance:0,key:'minDistance'},
]
const transform=(g:G,size:number,offset:Vec3):G=>{
 const p=(v:Vec3):Vec3=>[offset[0]-v[1]*size,offset[1]+v[0]*size,offset[2]+v[2]*size]
 const n=(v:Vec3):Vec3=>[-v[1],v[0],v[2]]
 switch(g.kind){
 case'point':return{...g,at:p(g.at)}
 case'segment':return{...g,a:p(g.a),b:p(g.b)}
 case'line':return{...g,at:p(g.at),dir:n(g.dir)}
 case'plane':return{...g,at:p(g.at),normal:n(g.normal)}
 case'circle':return{...g,center:p(g.center),normal:n(g.normal),radius:g.radius*size}
 case'sphere':return{...g,center:p(g.center),radius:g.radius*size}
 }
}
for(const c of cases)for(const [size,offset]of [[1,[0,0,0]],[.001,[0,0,0]],[100,[0,0,0]],[1,[1e8,-1e8,2e8]]] as [number,Vec3][]){
 it(`${c.name}: rotated, scale ${size}, offset ${offset}`,()=>{
  const a=transform(c.a,size,offset),b=transform(c.b,size,offset),before=JSON.stringify([a,b])
  const result=measureAnalytic(a,b),reverse=measureAnalytic(b,a),key=c.key??'distance'
  expect(result.status).toBe('ok')
  const expected=c.distance*size,tol=Math.max(1e-9*size,offset[0]?1e-7:1e-12)
  expect(Math.abs(result.values.find(r=>r.key===key)!.value-expected)).toBeLessThan(tol)
  expect(Math.abs(reverse.values.find(r=>r.key===key)!.value-expected)).toBeLessThan(tol)
  for(const r of result.values)if(r.witness)expect(Math.abs(Math.hypot(...r.witness[0].map((v,i)=>v-r.witness![1][i]))-r.value)).toBeLessThan(tol)
  expect(JSON.stringify([a,b])).toBe(before)
 })
}
it('does not invent minimum distances for tilted circles',()=>{
 const r=measureAnalytic({kind:'circle',center:[0,0,0],normal:[0,0,1],radius:2},{kind:'circle',center:[0,0,5],normal:[0,1,0],radius:3})
 expect(r.status).toBe('partial');expect(r.values.map(v=>v.key)).toEqual(['centerDistance']);expect(r.reason).toMatch(/non-coplanar/)
})
it('distinguishes a supporting-line distance from a bounded edge distance',()=>{
 const p:G={kind:'point',at:[3,4,0]}
 expect(measureAnalytic(p,{kind:'line',at:[0,0,0],dir:[1,0,0]}).values[0].domain).toBe('supporting geometry')
 expect(measureAnalytic(p,{kind:'segment',a:[0,0,0],b:[1,0,0]}).values[0].domain).toBe('finite edges')
})
it('measures obtuse and right three-point angles and refuses a zero arm',()=>{
 expect(measureThreePointAngle([1,0,0],[0,0,0],[0,1,0]).values[0].value).toBe(90)
 expect(measureThreePointAngle([1,0,0],[0,0,0],[-1,1,0]).values[0].value).toBe(135)
 expect(measureThreePointAngle([0,0,0],[0,0,0],[1,1,0]).status).toBe('invalid')
})
it('does not mistake nearly parallel crossing carriers for parallel geometry',()=>{
 const a:G={kind:'line',at:[0,0,0],dir:[1,0,0]},b:G={kind:'line',at:[0,1,0],dir:[1,-1e-8,0]}
 expect(measureAnalytic(a,b).values[0].value).toBeLessThan(1e-8)
 const edgeA:G={kind:'segment',a:[0,0,0],b:[2e8,0,0]},edgeB:G={kind:'segment',a:[0,1,0],b:[2e8,-1,0]}
 expect(measureAnalytic(edgeA,edgeB).values[0].value).toBeLessThan(1e-8)
 const planes=measureAnalytic({kind:'plane',at:[0,0,0],normal:[0,1,0]},{kind:'plane',at:[0,1,0],normal:[1e-8,1,0]})
 expect(planes.values[0].value).toBe(0)
})
it.each([{kind:'line',at:[0,0,0],dir:[0,0,0]},{kind:'plane',at:[0,0,0],normal:[0,0,0]},{kind:'sphere',center:[0,0,0],radius:-1},{kind:'point',at:[NaN,0,0]}] as G[])('refuses invalid geometry %j',g=>{
 expect(measureAnalytic(g,{kind:'point',at:[0,0,0]}).status).toBe('invalid')
})
