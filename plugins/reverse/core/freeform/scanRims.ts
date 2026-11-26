// SPDX-License-Identifier: AGPL-3.0-only
import { ScanPaths } from '../../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../../src/core/types'
import { rims, type WorkMesh } from './autoPrepare'
import { triangles, type Cage } from './cage'

/** Restore a scan aperture that fits inside one covering quad. Only use actual
 * scan boundaries. The ring must have four consistently oriented convex quads. */
export function restoreScanRims(cage: Cage, scan: WorkMesh, edge: number): Cage {
  const map = new ScanPaths(Float32Array.from(cage.positions), triangles(cage))
  const point = (p: ArrayLike<number>, i: number): Vec3 => [p[3*i], p[3*i+1], p[3*i+2]]
  const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2])
  const positions = Array.from(cage.positions), faces = cage.faces.slice(), used = new Set<number>()
  for (const loop of rims(scan)) {
    if (loop.length < 4) continue
    const ring = loop.map(v => point(scan.positions, v))
    const ends = [0]
    for (let i = 0; i < ring.length; i++) ends.push(ends[i] + dist(ring[i], ring[(i+1)%ring.length]))
    const length = ends[ring.length]
    if (length < 0.25*edge || length > 3*edge) continue
    const entries = ring.map(p => map.closest(p))
    const hit = entries[0]
    if (!hit) continue
    const id = Math.floor(hit.triangle/2)
    if (used.has(id) || entries.some(h => !h || h.distance > 0.2*edge || Math.floor(h.triangle/2) !== id)) continue
    const face = cage.faces[id], corners = face.map(v => point(cage.positions,v))
    const n = hit.normal
    const turn = (a: Vec3,b: Vec3,c: Vec3) => {
      const x=b[0]-a[0], y=b[1]-a[1], z=b[2]-a[2], u=c[0]-b[0], v=c[1]-b[1], w=c[2]-b[2]
      return n[0]*(y*w-z*v)+n[1]*(z*u-x*w)+n[2]*(x*v-y*u)
    }
    // Every rim point must project inside the parent, including the spans between samples.
    if (ring.some(p => corners.some((a,i) => turn(a,corners[(i+1)%4],p) <= 1e-6*edge*edge))) continue
    // Concave scan rims may cross a corner ray more than once. Odd parity
    // places the centre inside the rim. Use its first exit on each ray.
    const origin = ring[0]
    const tangent = corners[1].map((p,k) => p-corners[0][k]) as Vec3
    const normalPart = tangent.reduce((s,x,k) => s+x*n[k],0)
    for (let k=0;k<3;k++) tangent[k] -= normalPart*n[k]
    const mag = Math.hypot(...tangent)
    if (!mag) continue
    for (let k=0;k<3;k++) tangent[k] /= mag
    const bitangent: Vec3 = [n[1]*tangent[2]-n[2]*tangent[1],n[2]*tangent[0]-n[0]*tangent[2],n[0]*tangent[1]-n[1]*tangent[0]]
    const coord = (p: Vec3, d: Vec3) => p.reduce((s,x,k) => s+(x-origin[k])*d[k],0)
    const extent = (d: Vec3) => ring.reduce(([lo,hi],p) => {
      const t=coord(p,d)
      return [Math.min(lo,t),Math.max(hi,t)]
    },[Infinity,-Infinity])
    const [xmin,xmax]=extent(tangent), [ymin,ymax]=extent(bitangent)
    const centres = [ring.reduce((s,p) => s.map((x,k) => x+p[k]/ring.length) as Vec3,[0,0,0] as Vec3)]
    // On a concave slit the mean may fall outside. Evaluate interior origins
    // in its tangent-plane bounding box and retain the best-conditioned ring.
    for (const u of [0.15,0.325,0.5,0.675,0.85]) for (const v of [0.15,0.325,0.5,0.675,0.85]) {
      centres.push(origin.map((x,k) => x+(xmin+u*(xmax-xmin))*tangent[k]+(ymin+v*(ymax-ymin))*bitangent[k]) as Vec3)
    }
    let best: Vec3[] | undefined, bestArea=1e-5*edge*edge
    for (const centre of centres) {
      const inner: Vec3[] = []
      for (const corner of corners) {
        const dx=coord(corner,tangent)-coord(centre,tangent), dy=coord(corner,bitangent)-coord(centre,bitangent)
        let crossings=0, nearest=Infinity, first: Vec3 | undefined
        for (let i=0;i<ring.length;i++) {
          const a=ring[i], b=ring[(i+1)%ring.length]
          const u=turn(centre,corner,a), v=turn(centre,corner,b)
          if ((u>0) === (v>0)) continue
          const t=u/(u-v), p=a.map((x,k) => x+t*(b[k]-x)) as Vec3
          const along=(coord(p,tangent)-coord(centre,tangent))*dx+(coord(p,bitangent)-coord(centre,bitangent))*dy
          if (along <= 0) continue
          crossings++
          if (along < nearest) { nearest=along; first=p }
        }
        if (first && crossings%2===1) inner.push(first)
      }
      if (inner.length !== 4) continue
      let area=Infinity
      for (let i=0;i<4;i++) {
        const j=(i+1)%4, quad=[corners[i],corners[j],inner[j],inner[i]]
        area=Math.min(area,turn(inner[i],inner[j],inner[(j+1)%4]))
        for (let k=0;k<4;k++) area=Math.min(area,turn(quad[k],quad[(k+1)%4],quad[(k+2)%4]))
      }
      if (area>bestArea) { bestArea=area; best=inner }
    }
    if (!best) continue
    const base = positions.length/3
    for (const p of best) positions.push(...p)
    for (let i=0;i<4;i++) {
      const j=(i+1)%4, quad=[face[i],face[j],base+j,base+i]
      if (i===0) faces[id]=quad
      else faces.push(quad)
    }
    used.add(id)
  }
  return used.size ? { ...cage, positions: Float64Array.from(positions), faces } : cage
}
