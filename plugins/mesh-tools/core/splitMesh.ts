// SPDX-License-Identifier: AGPL-3.0-only
import { BufferAttribute, BufferGeometry, Line3, Matrix4, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import cdt2d from 'cdt2d'
import type { Triangles } from './boolean'
import type { Vec3 } from '../../../src/core/types'
import { cutMesh } from './cut'
import type { EditedMesh } from './edit'

export type SplitTool = {plane:{origin:Vec3;normal:Vec3}} | Triangles
export interface SplitResult extends EditedMesh { regions:Uint32Array; parts:number }
const edge=(a:number,b:number)=>a<b?a+','+b:b+','+a

function tree(mesh:Triangles) {
  const geometry=new BufferGeometry()
  geometry.setAttribute('position',new BufferAttribute(mesh.positions,3))
  geometry.setIndex(new BufferAttribute(mesh.indices,1))
  const options={indirect:true,maxLeafTris:10}
  return new MeshBVH(geometry,options)
}

function groups(size:number) {
  const parents=Int32Array.from({length:size},(_,i)=>i)
  const root=(i:number):number=>{
    while(i!==parents[i]){parents[i]=parents[parents[i]];i=parents[i]}
    return i
  }
  return {root,join:(a:number,b:number)=>{parents[root(a)]=root(b)}}
}

function components(indices:ArrayLike<number>,barrier:Set<string>) {
  const count=indices.length/3, sets=groups(count),first=new Map<string,number>()
  for(let f=0;f<count;f++)for(let k=0;k<3;k++){
    const key=edge(indices[3*f+k],indices[3*f+(k+1)%3])
    if(barrier.has(key))continue
    const other=first.get(key)
    if(other===undefined)first.set(key,f);else sets.join(f,other)
  }
  const ids=new Map<number,number>(),regions=new Uint32Array(count)
  for(let f=0;f<count;f++){
    const r=sets.root(f)
    if(!ids.has(r))ids.set(r,ids.size)
    regions[f]=ids.get(r)!
  }
  return {regions,parts:ids.size}
}

export function splitMesh(scan:Triangles,tool:SplitTool):SplitResult {
  const {positions,indices}=scan,vertices=positions.length/3
  if('plane' in tool){
    const {origin,normal}=tool.plane
    const a=cutMesh(positions,indices,vertices,origin,normal,false)
    const b=cutMesh(positions,indices,vertices,origin,normal.map(v=>-v) as Vec3,false)
    const points=new Float32Array(a.positions.length+b.positions.length),faces=new Uint32Array(a.indices.length+b.indices.length)
    points.set(a.positions);points.set(b.positions,a.positions.length);faces.set(a.indices)
    const offset=a.positions.length/3
    for(let i=0;i<b.indices.length;i++)faces[a.indices.length+i]=b.indices[i]+offset
    const regions=components(faces,new Set())
    if(regions.parts<=components(indices,new Set()).parts)throw Error('The plane does not separate the mesh.')
    const vertexMap=a.vertexMap.map((v,i)=>v>=0?v:b.vertexMap[i]<0?-1:b.vertexMap[i]+offset)
    return {positions:points,indices:faces,vertexMap,...regions}
  }
  const scanTree=tree(scan), cutterTree=tree(tool),segment=new Line3()
  const cuts=new Map<number,Line3[]>()
  scanTree.bvhcast(cutterTree,new Matrix4(),{intersectsTriangles:(a,b,i)=>{
    if(a.intersectsTriangle(b,segment)&&segment.distanceSq()>0){
      const f=(scanTree as MeshBVH & {resolveTriangleIndex(index:number):number}).resolveTriangleIndex(i)
      if(!cuts.has(f))cuts.set(f,[])
      cuts.get(f)!.push(segment.clone())
    }
    return false
  }})
  if(!cuts.size)throw Error('The cutter does not cross the mesh.')
  // Share intersection vertices only along the same original edge. Distinct,
  // coincident sheets in an already split scan must retain their topology.
  const xyz=Array.from(positions),edgePoints=new Map<string,number>(),barrier=new Set<string>()
  const faces:number[]=[]
  for(let f=0;f<indices.length/3;f++){
    const ids=Array.from(indices.subarray(f*3,f*3+3)), lines=cuts.get(f)
    if(!lines){faces.push(ids[0],ids[1],ids[2]);continue}
    const [a,b,c]=ids.map(id=>new Vector3().fromArray(positions,3*id))
    const ab=b.clone().sub(a),ac=c.clone().sub(a),n=ab.clone().cross(ac),denom=n.lengthSq()
    if(!denom)continue
    const uv:number[][]=[[0,0],[1,0],[0,1]], constraints=new Map<string,number[]>()
    const epsilon=1e-8
    const insert=(p:Vector3)=>{
      const ap=p.clone().sub(a)
      let u=ap.clone().cross(ac).dot(n)/denom,v=ab.clone().cross(ap).dot(n)/denom
      if(Math.abs(u)<epsilon)u=0
      if(Math.abs(v)<epsilon)v=0
      if(Math.abs(1-u-v)<epsilon){if(v===0)u=1;else v=1-u}
      const known=uv.findIndex(q=>Math.abs(q[0]-u)+Math.abs(q[1]-v)<2*epsilon)
      if(known>=0)return known
      const e=u===0?[0,2,v]:v===0?[0,1,u]:Math.abs(1-u-v)<epsilon?[1,2,v]:null
      const key=e?edge(ids[e[0]],ids[e[1]])+':'+Math.round((ids[e[0]]<ids[e[1]]?e[2]:1-e[2])/epsilon):null
      let id=key===null?undefined:edgePoints.get(key)
      if(id===undefined){id=xyz.length/3;xyz.push(p.x,p.y,p.z);if(key)edgePoints.set(key,id)}
      ids.push(id);uv.push([u,v]);return ids.length-1
    }
    const seams=lines.map(l=>[insert(l.start),insert(l.end)])
    for(const [s,t,isSeam] of [...seams.map(([i,j])=>[i,j,1]),[0,1,0],[1,2,0],[2,0,0]]){
      if(s===t)continue
      const [x,y]=uv[s],dx=uv[t][0]-x,dy=uv[t][1]-y,d2=dx*dx+dy*dy
      const chain=uv.map(([px,py],i)=>({i,k:((px-x)*dx+(py-y)*dy)/d2,cross:(px-x)*dy-(py-y)*dx}))
        .filter(q=>Math.abs(q.cross)<epsilon*Math.sqrt(d2)&&q.k>=-epsilon&&q.k<=1+epsilon).sort((l,r)=>l.k-r.k)
      for(let j=1;j<chain.length;j++){
        const l=chain[j-1].i,r=chain[j].i
        constraints.set(edge(l,r),[l,r]);if(isSeam)barrier.add(edge(ids[l],ids[r]))
      }
    }
    for(const [s,t,h] of cdt2d(uv,[...constraints.values()])){
      const area=(uv[t][0]-uv[s][0])*(uv[h][1]-uv[s][1])-(uv[t][1]-uv[s][1])*(uv[h][0]-uv[s][0])
      if(Math.abs(area)>1e-14)faces.push(ids[s],ids[area>0?t:h],ids[area>0?h:t])
    }
  }
  const result=components(faces,barrier)
  if(result.parts<=components(indices,new Set()).parts)throw Error('The intersection does not separate the scan. Extend the cutter across the part.')
  // Duplicate each shared seam vertex per resulting component.
  const remap=new Map<string,number>(),output:number[]=[],out=new Uint32Array(faces.length)
  const vertexMap=new Int32Array(vertices).fill(-1)
  for(let i=0;i<faces.length;i++){
    const id=faces[i],key=result.regions[Math.floor(i/3)]+':'+id
    let v=remap.get(key)
    if(v===undefined){
      v=output.length/3;remap.set(key,v);output.push(xyz[3*id],xyz[3*id+1],xyz[3*id+2])
      if(id<vertices&&vertexMap[id]<0)vertexMap[id]=v
    }
    out[i]=v
  }
  return {positions:Float32Array.from(output),indices:out,vertexMap,...result}
}
