// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import type { Feature, TrimFeature } from '../core/features'
import { mutualTrim } from '../core/mutualTrim'
import { Builder } from '../core/build'
import { ReKernel } from '../core/kernel'
import { INTERACTIVE_SURFACE_FIT } from '../core/surfaceFit'
import { build, rectangleSketch } from './reKit'
import { flattenSheet } from '../core/flattenSheet'

const kernel=ReKernel.load()
const face = (id:number,sketchId:number):Feature => ({ id,sketchId,name:'Face',kind:'sheet',from:0,to:0,planar:true,visible:true })
it.each(['cone','sphere'] as const)('fits and trims the %s carrier to the selected angular interval',async shape=>{
 const b=new Builder(await kernel), verts:number[]=[], idx:number[]=[]
 try {
  for(let i=0;i<21;i++)for(let j=0;j<16;j++){
   const a=-1+i/10,z=-3+j*0.4,r=shape==='cone'?5+z*0.2:Math.sqrt(25-z*z)
   verts.push(r*Math.cos(a),r*Math.sin(a),z)
   const v=i*16+j
   if(i<20&&j<15)idx.push(v,v+16,v+17,v,v+17,v+1)
  }
  const pos=Float32Array.from(verts)
  b.setScan(new NominalSurface(pos,Uint32Array.from(idx)),pos)
  const out=await build(b,[{ id:1,name:shape,kind:'surface',shape,fit:{...INTERACTIVE_SURFACE_FIT,expandPct:0},region:Uint32Array.from({length:pos.length/3},(_,i)=>i),visible:true }])
  expect(out.results.map(r=>r.message??r.status)).toEqual(['ok'])
  expect(out.results[0].surface!.radius).toBeCloseTo(5,4)
  expect(out.results[0].surface!.rms).toBeLessThan(1e-5)
  expect(out.bodies[0].surface).toBe(true)
  expect(out.bodies[0].box!.min[0]).toBeGreaterThan(1)
 }finally{b.dispose()}
})
it('removes picked halves of two crossing sheets and rebuilds the saved picks',async()=>{
 const b=new Builder(await kernel)
 try{
  const a=rectangleSketch(1,10,10,[-5,-5]), v=rectangleSketch(3,10,10,[-5,-5])
  v.plane={kind:'world',axis:'x',offset:0}
  v.frame={origin:[0,0,0],normal:[1,0,0],basisU:[0,1,0],basisV:[0,0,1]}
  const sources=[a,face(2,1),v,face(4,3)]
  const trim:TrimFeature={kind:'trim',id:5,name:'Trim',tools:[{kind:'body',id:2},{kind:'body',id:4}],removed:[{body:2,at:[-2,0,0]},{body:4,at:[0,0,-2]}],tolerance:0.1,overlap:0.5,visible:true}
  const out=await build(b,[...sources,trim]);expect(out.results.at(-1)?.message??out.results.at(-1)?.status).toBe('ok')
  expect(out.results.at(-1)?.trim).toMatchObject({faces:4,kept:2,closed:false})
  const kept=out.bodies.find(x=>x.id===5)!;expect(kept.box!.min[0]).toBeCloseTo(0,4);expect(kept.box!.min[2]).toBeCloseTo(0,4)
  const refused=await build(b,[...sources,{...trim,removed:[{body:2,at:[0,0,0]}]}]);expect(refused.results.at(-1)?.message).toMatch(/cut edge/)
 }finally{b.dispose()}
})
it('projects a profile onto a sheet and lofts stations as an open shell',async()=>{
 const b=new Builder(await kernel)
 try{
  const a=rectangleSketch(1,10,10), upper=rectangleSketch(3,3,4,[2,2]);upper.plane={kind:'world',axis:'z',offset:7};upper.frame={...upper.frame,origin:[0,0,7]}
  const out=await build(b,[a,face(2,1),upper,{kind:'sheet',sketchId:3,id:4,name:'Project',from:0,to:0,planar:true,projectOnto:2,visible:true},{kind:'loft',id:5,name:'Loft',sketches:[1,3],ruled:true,surface:true,op:'new',visible:true}])
  expect(out.results.map(r=>r.message??r.status)).toEqual(['ok','ok','ok'])
  expect(out.bodies.find(x=>x.id===4)?.topology.faces[0].fingerprint.area).toBeCloseTo(12,5)
  expect(out.bodies.find(x=>x.id===5)?.surface).toBe(true)
 }finally{b.dispose()}
})
it('unfolds two perpendicular strips preserving their combined width',()=>{
 const pos=Float32Array.from([0,0,0,1,0,0,1,0,1,0,2,0,1,2,0,1,2,1])
 const {sketch,maxClosure}=flattenSheet({positions:pos,normals:new Float32Array(18),indices:Uint32Array.from([0,1,4,0,4,3,1,2,5,1,5,4])})
 expect(maxClosure).toBeLessThan(1e-8);expect(sketch.entities.length).toBe(4)
})

it('shows only the lower rim of a cylinder trimmed by a tilted plane', async () => {
 const k = await kernel
 const wall = k.sheet([{ kind: 'circle', center: [0,0,0], normal: [0,0,1], radius: 10 }], [0,0,1], -20, 25)
 const corner: [number,number,number][] = [[-20,-20,3],[20,-20,17],[20,20,17],[-20,20,3]]
 const plane = k.face({ outer: corner.map((a,i) => ({ kind: 'line', a, b: corner[(i+1)%4] })), holes: [] })
 try {
  const cut = mutualTrim(k, [{ id: 1, shape: wall }, { id: 2, shape: plane }], [{ body: 1, at: [10,0,20] }, { body: 2, at: [15,0,15.25] }])
  try {
   expect(cut.report).toMatchObject({ kept: 2, faces: 4, closed: false })
   expect(cut.report.openEdges).toHaveLength(1)
   const rim = cut.report.openEdges[0]
   expect(rim.length).toBeGreaterThan(12)
   for (let i=2; i<rim.length; i+=3) expect(rim[i]).toBeCloseTo(-20, 5)
   expect(k.openEdgeLength(cut.shape)).toBeCloseTo(20 * Math.PI, 8)
  } finally { k.release(cut.shape) }
 } finally { k.release(wall, plane) }
})

it('cuts the full corner with a short touching plane and leaves a separated plane alone', async () => {
  const b = new Builder(await kernel)
  try {
    const floor = rectangleSketch(1, 20, 20, [-10, -10])
    const wall = rectangleSketch(3, 10, 14, [-5, -7])
    wall.plane = { kind: 'world', axis: 'x', offset: 0 }
    wall.frame = { origin: [0,0,0], normal: [1,0,0], basisU: [0,1,0], basisV: [0,0,1] }
    const trim: TrimFeature = { id: 5, name: 'Corner', kind: 'trim', tools: [{kind:'body',id:2},{kind:'body',id:4}], tolerance: 0.1, overlap: 0.5, removed: [{body:2,at:[-3,0,0]},{body:4,at:[0,0,-3]}], visible:true }
    const sources = [floor,face(2,1),wall,face(4,3)]
    const result = await build(b, [...sources,trim])
    expect(result.results.at(-1)?.trim).toMatchObject({faces:4,kept:2,closed:false})
    const edges = result.bodies.find(body => body.id === 5)!.topology.edges
    expect(edges.some(e => e.faces.length === 2 && Math.abs(e.fingerprint.length - 10) < 1e-5)).toBe(true)
    const away = { ...wall, plane: {kind:'world' as const,axis:'x' as const,offset:40}, frame:{...wall.frame, origin:[40,0,0] as [number,number,number]} }
    const separate = await build(b, [floor, face(2,1), away, face(4,3), {...trim,removed:[]}])
    expect(separate.results.at(-1)?.message).toMatch(/do not cut/)
  } finally { b.dispose() }
})
