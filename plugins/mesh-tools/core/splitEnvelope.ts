// SPDX-License-Identifier: AGPL-3.0-only
import {Vector3} from 'three'
import {weldExact} from '../../../src/core/export3mf'
import {closedness,type Triangles} from './boolean'
import {offsetMesh,thickenMesh} from './offset'
import type {SplitTool} from './splitMesh'

// Use the scan extents for an unbounded datum plane. The lateral walls of
// the slab sit outside the scan, so only its two offset faces can intersect it.
export function splitEnvelope(cutter:SplitTool,subject:Triangles,distance:number):Triangles {
  if(!(distance>0&&Number.isFinite(distance)))throw Error('Enter a positive envelope distance.')
  let mesh:Triangles
  if('plane' in cutter){
    const o=new Vector3(...cutter.plane.origin),n=new Vector3(...cutter.plane.normal).normalize()
    const u=new Vector3(Math.abs(n.x)<.8?1:0,Math.abs(n.x)<.8?0:1,0).cross(n).normalize(),v=n.clone().cross(u)
    let reach=1
    const p=new Vector3()
    for(let i=0;i<subject.positions.length;i+=3)reach=Math.max(reach,p.fromArray(subject.positions,i).distanceTo(o)+distance)
    const points=[[-1,-1],[1,-1],[1,1],[-1,1]].flatMap(([a,b])=>o.clone().addScaledVector(u,a*reach).addScaledVector(v,b*reach).toArray())
    mesh={positions:Float32Array.from(points),indices:Uint32Array.of(0,1,2,0,2,3)}
  }else{
    const welded=weldExact(cutter.positions,cutter.indices)
    mesh={positions:welded.vertices,indices:welded.triangles}
  }
  const count=mesh.positions.length/3,edges=closedness(mesh.indices,count)
  if(edges.bad)throw Error('The cutter has a non-manifold edge and cannot form an envelope.')
  return edges.open?thickenMesh(mesh.positions,mesh.indices,count,2*distance,'both'):offsetMesh(mesh.positions,mesh.indices,count,{distance})
}
