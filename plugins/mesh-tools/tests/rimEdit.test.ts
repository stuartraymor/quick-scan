// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { boundaryLoops } from '../core/boundary'
import { editRims } from '../core/rimEdit'
import { fillHoles } from '../core/fillHoles'

function annulus(n:number) {
  const points:number[]=[],indices:number[]=[]
  for(const radius of [3,1])for(let i=0;i<n;i++){
    const a=i*2*Math.PI/n
    points.push(radius*Math.cos(a),radius*Math.sin(a),.1*radius*radius+.08*Math.cos(3*a))
  }
  for(let i=0;i<n;i++){
    const j=(i+1)%n
    indices.push(i,j,n+j,i,n+j,n+i)
  }
  return {p:Float32Array.from(points),f:Uint32Array.from(indices),n:2*n}
}
const shells=Float32Array.from([0,0,0,1,0,0,1,1,0,0,1,0, 2,0,0,3,0,0,3,1,0,2,1,0])
const triangles=Uint32Array.from([0,1,2,0,2,3,4,5,6,4,6,7])
describe('mesh edit rim tools',()=>{
  it('splits a rim into two holes and fills either independently of the batch diameter',()=>{
    const {p,f,n}=annulus(12)
    const split=editRims(p,f,n,{action:'semi',ends:[12,18]})
    const rims=boundaryLoops(split.indices,n).loops
    expect(rims).toHaveLength(3)
    const hole=rims.find(r=>r.vertices.includes(14))!
    const filled=fillHoles(split.positions,split.indices,n,.001,'flat',undefined,undefined,{start:hole.vertices[0],method:'flat'})
    expect(filled.report.filled).toBe(1)
    expect(boundaryLoops(filled.indices,filled.positions.length/3).loops).toHaveLength(2)
    expect(()=>editRims(p,f,n,{action:'semi',ends:[12,13]})).toThrow()
  })
  it('bridges two guided arcs with an oriented strip and zips opposing edges by welding',()=>{
    const bridged=editRims(shells,triangles,8,{action:'bridge',first:[1,4],second:[2,7],side:1})
    expect(bridged.indices.length).toBe(triangles.length+6)
    expect(boundaryLoops(bridged.indices,8).loops).toHaveLength(1)
    const zipped=editRims(shells,triangles,8,{action:'zip',ends:[1,4],anchors:[1]})
    expect(zipped.positions.length/3).toBe(6)
    expect(zipped.vertexMap[1]).toBe(zipped.vertexMap[4])
    expect(zipped.positions[zipped.vertexMap[1]*3]).toBe(1)
    expect(boundaryLoops(zipped.indices,6).loops).toHaveLength(1)
    expect(()=>editRims(shells,triangles,8,{action:'zip',ends:[1,4],anchors:[1,4]})).toThrow()
  })
  it('smooths only the selected rim, pinning anchors and leaving the outer rim unchanged',()=>{
    const {p,f,n}=annulus(12)
    const smooth=editRims(p,f,n,{action:'smooth',starts:[12],anchors:[14],strength:4})
    expect(smooth.positions.slice(0,36)).toEqual(p.slice(0,36))
    expect(smooth.positions.slice(42,45)).toEqual(p.slice(42,45))
    expect(smooth.positions.slice(36,39)).not.toEqual(p.slice(36,39))
    expect(smooth.indices).toEqual(f)
  })
  it.each([16,40])('uses the automatic edge threshold for a %i-sided rim',n=>{
    const mesh=annulus(n)
    const fill=(method:'tangent'|'curvature'|'auto')=>fillHoles(mesh.p,mesh.f,mesh.n,10,'curved',undefined,undefined,{start:n,method})
    const auto=fill('auto'),tangent=fill('tangent'),curvature=fill('curvature')
    expect(auto.positions).toEqual(n<40?tangent.positions:curvature.positions)
    expect(tangent.positions).not.toEqual(curvature.positions)
    expect(auto.report.filled).toBe(1)
  })
})
