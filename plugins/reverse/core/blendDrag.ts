// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import type { EdgeFingerprint } from './topo'
import { liveMapReach, type SparseField } from './liveMap'
import { add, addScaled, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { KernelMesh } from './kernel'

/** Cross section and span of an exact straight-edge blend. All section
 * vectors are measured from the original sharp edge, in model coordinates. */
export interface BlendSection {
  kind: 'chamfer' | 'fillet'
  mid: Vec3
  axis: Vec3
  half: number
  size: number
  convex: boolean
  center: Vec3
  first: Vec3
  second: Vec3
}

/** Reuse the exact mesh connectivity under the mouse. Nodes on the new
 * face and their seam duplicates move together. Adjacent faces keep their
 * far boundaries. The kernel re-trims the ends when the grip is released. */
export function prepareBlendDrag(mesh: KernelMesh, section: BlendSection) {
  const { axis, first, second, center, mid, half, size } = section
  const chord = sub(second, first), chord2 = dot(chord, chord)
  const tol = Math.max(0.0001, size * 0.0001)
  const touched = new Map<number, number>()
  const offsets: Vec3[] = []
  const nodeIds: number[] = []
  const patch: number[] = []
  const stations: number[] = []
  const towardCorner = sub([0,0,0], center)
  const arcThreshold = dot(sub(first, center), towardCorner)
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const delta: Vec3 = [mesh.positions[i]-mid[0], mesh.positions[i+1]-mid[1], mesh.positions[i+2]-mid[2]]
    const station = dot(delta, axis)
    if (Math.abs(station) > half + tol) continue
    const radial = addScaled(delta, axis, -station)
    if (section.kind === 'fillet') {
      const v = sub(radial, center)
      if (Math.abs(len(v) - size) > tol || dot(v, towardCorner) < arcThreshold - tol*len(center)) continue
    } else {
      const v = sub(radial, first)
      const t = dot(v, chord)/chord2
      if (t < -tol/size || t > 1+tol/size || len(addScaled(v, chord, -t)) > tol) continue
    }
    touched.set(i/3, offsets.length)
    offsets.push(radial)
    stations.push(station)
    nodeIds.push(i)
  }
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = touched.get(mesh.indices[i]), b = touched.get(mesh.indices[i+1]), c = touched.get(mesh.indices[i+2])
    if (a !== undefined && b !== undefined && c !== undefined) patch.push(a,b,c)
  }
  if (!patch.length) return null
  const drawn: KernelMesh = { ...mesh, positions: mesh.positions.slice() }
  const inward = normalize(center)!, across = normalize(chord)!
  const h = dot(first, inward)/size, w = len(chord)/(2*size), c = len(center)/size
  // Unwrap the exact trimmed face into (cross-section angle, axial station).
  // Test its triangles before painting so its ends and holes stay bounded.
  const phase = (x: number, y: number, r: number) => section.kind === 'fillet' ? Math.atan2(y, c*r-x) : y/r
  const u = offsets.map(v => phase(dot(v,inward),dot(v,across),size))
  let sign = section.convex ? 1 : -1
  const boundary = new Map<string,[number,number]>()
  const triangles: {x:number; y:number; ux:number; uy:number; vx:number; vy:number; det:number}[] = []
  for (let i=0; i<patch.length; i+=3) {
    const [a,b,d] = patch.slice(i,i+3)
    const ux=u[b]-u[a], uy=stations[b]-stations[a], vx=u[d]-u[a], vy=stations[d]-stations[a]
    const det = ux*vy-uy*vx
    if (Math.abs(det)<=1e-9) continue
    if (!triangles.length) {
      const n=nodeIds[a]
      const outward = section.kind==='fillet' ? sub(offsets[a],center) : scale(inward,-1)
      sign = mesh.normals[n]*outward[0] + mesh.normals[n+1]*outward[1] + mesh.normals[n+2]*outward[2] >= 0 ? 1 : -1
    }
    triangles.push({ x:u[a], y:stations[a], ux, uy, vx, vy, det })
    for (const [left,right] of [[a,b],[b,d],[d,a]]) {
      const key = left < right ? left+','+right : right+','+left
      if (!boundary.delete(key)) boundary.set(key,[left,right])
    }
  }
  if (!triangles.length) return null
  let minU = Infinity, maxU = -Infinity
  for (const t of triangles) {
    minU = Math.min(minU,t.x,t.x+t.ux,t.x+t.vx)
    maxU = Math.max(maxU,t.x,t.x+t.ux,t.x+t.vx)
  }
  const bins = Array.from({length:32}, (_,i) => triangles.filter(t =>
    Math.min(t.x,t.x+t.ux,t.x+t.vx) <= minU+(maxU-minU)*(i+1)/32 &&
    Math.max(t.x,t.x+t.ux,t.x+t.vx) >= minU+(maxU-minU)*i/32))
  let scanBuffer: ArrayBufferLike | undefined, scanLength = 0, scanStamp = -1, footprint = 0
  let nearby: number[] = []
  function field(scan: Float32Array, r: number, range: number, stamp = 0): SparseField {
    const reach = liveMapReach(range)
    const extent = Math.hypot(h,w)*r + reach
    if (scan.buffer!==scanBuffer || scan.length!==scanLength || stamp!==scanStamp || extent>footprint) {
      scanBuffer = scan.buffer
      scanLength = scan.length
      scanStamp = stamp
      footprint = extent * 2
      nearby=[]
      for (let i=0; i<scan.length; i+=3) {
        const x=scan[i]-mid[0], y=scan[i+1]-mid[1], z=scan[i+2]-mid[2]
        const t=x*axis[0]+y*axis[1]+z*axis[2]
        if (Math.abs(t)>half) continue
        const depth=x*inward[0]+y*inward[1]+z*inward[2], side=x*across[0]+y*across[1]+z*across[2]
        if (depth*depth+side*side <= footprint*footprint) nearby.push(i/3,t,depth,side)
      }
    }
    const subset = [], values = []
    for (let i=0; i<nearby.length; i+=4) {
      const t=nearby[i+1], depth=nearby[i+2], side=nearby[i+3]
      const distance=section.kind==='fillet' ? Math.hypot(c*r-depth,side)-r : h*r-depth
      if (Math.abs(distance)>reach) continue
      const angle=phase(depth,side,r)
      if (angle<minU || angle>maxU) continue
      const bin=bins[Math.min(31,Math.floor((angle-minU)/(maxU-minU)*32))]
      if (!bin.some(q=>{
        const x=angle-q.x,y=t-q.y
        const a=(x*q.vy-y*q.vx)/q.det,b=(q.ux*y-q.uy*x)/q.det
        return a>=-1e-6 && b>=-1e-6 && a+b<=1+1e-6
      })) continue
      subset.push(nearby[i]); values.push(sign * distance)
    }
    return {subset:Uint32Array.from(subset),values:Float32Array.from(values)}
  }
  const borderIds = [...boundary.values()].flat()
  const outline = new Float32Array(borderIds.length*3)
  return { mesh: drawn, outline, field, resize(next: number) {
    const ratio = next / size - 1
    for (let j = 0; j < nodeIds.length; j++) {
      const i = nodeIds[j]
      for (let k = 0; k < 3; k++) drawn.positions[i+k] = mesh.positions[i+k] + offsets[j][k]*ratio
    }
    for (let j = 0; j < borderIds.length; j++) {
      const i = nodeIds[borderIds[j]]
      outline.set(drawn.positions.subarray(i,i+3),j*3)
    }
  } }
}

/** Native rounds of a single straight edge can supply the same drag data.
 * Match the analytic section to triangles of the finished face. */
export function nativeBlendDrag(mesh: KernelMesh, edge: EdgeFingerprint, kind: BlendSection['kind'], size: number) {
  if (edge.kind !== 'line' || edge.faces.length !== 2 || edge.faces.some(f=>f.kind!=='plane') || !(size>0)) return null
  const [a,b] = edge.faces.map(f=>f.dir)
  for (const i of [1,-1]) for (const j of [1,-1]) {
    const n1=scale(a,i), n2=scale(b,j), cos=dot(n1,n2)
    if (Math.abs(cos)>0.9999) return null
    const inward=normalize(add(n1,n2))!
    const center=scale(inward,size/Math.sqrt((1+cos)/2))
    const contact=(n:Vec3,other:Vec3) => kind==='fillet' ? addScaled(center,n,-size) : scale(normalize(addScaled(other,n,-cos))!,size)
    const section={kind,size,center,axis:edge.dir,mid:edge.mid,half:edge.length/2,first:contact(n1,n2),second:contact(n2,n1),convex:true}
    const drag=prepareBlendDrag(mesh,section)
    if (drag) return drag
  }
  return null
}
