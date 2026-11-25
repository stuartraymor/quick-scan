// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec2 } from '../../../src/core/flat/types'
import type { KernelMesh } from './kernel'
import { addEntity, emptySketch } from './sketch'

/** Develop a connected triangulated face into a plane by preserving the
 * three edge lengths of each triangle. Cycles independently predict the
 * same vertex. Reject a non-developable patch when those predictions differ. */
export function flattenSheet(mesh: KernelMesh, faceHash?: number) {
  const triangles: number[][] = []
  const edges = new Map<string, { a: number; b: number; faces: number[] }>()
  const key = (a: number, b: number) => a < b ? a + '/' + b : b + '/' + a
  const length = (a: number, b: number) => Math.hypot(...[0, 1, 2].map(k => mesh.positions[3*a+k] - mesh.positions[3*b+k]))
  for (let i = 0; i < mesh.indices.length; i += 3) {
    if (faceHash !== undefined && mesh.faceHash?.[i/3] !== faceHash) continue
    const tri = Array.from(mesh.indices.subarray(i, i+3))
    if (new Set(tri).size < 3) continue
    const id = triangles.push(tri) - 1
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j+1)%3], k = key(a,b)
      const edge = edges.get(k)
      if (!edge) edges.set(k, { a, b, faces: [id] })
      else {
        if (edge.faces.length !== 1 || edge.a === a) throw new Error('Select an oriented face with a manifold boundary.')
        edge.faces.push(id)
      }
    }
  }
  if (!triangles.length) throw new Error('Select a triangulated CAD face.')
  const uv = new Map<number, Vec2>()
  const [first, second] = triangles[0]
  uv.set(first, [0,0]); uv.set(second, [length(first,second),0])
  const queue = [0], visited = new Set(queue)
  let maxClosure = 0
  for (let j = 0; j < queue.length; j++) {
    const tri = triangles[queue[j]]
    const side = tri.findIndex((a,i) => uv.has(a) && uv.has(tri[(i+1)%3]))
    const a = tri[side], b = tri[(side+1)%3], c = tri[(side+2)%3]
    const p = uv.get(a)!, q = uv.get(b)!
    const ab = length(a,b), ac = length(a,c), bc = length(b,c)
    const dx = q[0]-p[0], dy = q[1]-p[1], base = Math.hypot(dx,dy)
    if (base < 1e-10 || ab < 1e-10) throw new Error('A collapsed triangle cannot be flattened.')
    const u = (ac*ac + ab*ab - bc*bc)/(2*ab), v = Math.sqrt(Math.max(0, ac*ac-u*u))
    const predicted: Vec2 = [p[0]+(u*dx-v*dy)/base, p[1]+(u*dy+v*dx)/base]
    const known = uv.get(c)
    if (known) maxClosure = Math.max(maxClosure, Math.hypot(known[0]-predicted[0], known[1]-predicted[1]))
    else uv.set(c,predicted)
    for (let i = 0; i < 3; i++) {
      for (const next of edges.get(key(tri[i],tri[(i+1)%3]))!.faces) {
        if (!visited.has(next)) { visited.add(next); queue.push(next) }
      }
    }
  }
  if (visited.size !== triangles.length) throw new Error('Select one connected face to flatten.')
  if (maxClosure > 0.02) throw new Error('This face has too much compound curvature to flatten within the unfolding tolerance. Split it into smaller patches.')
  const next = new Map<number, number>()
  for (const edge of edges.values()) if (edge.faces.length === 1) {
    if (next.has(edge.a)) throw new Error('The boundary branches. Select one face with a continuous outline.')
    next.set(edge.a,edge.b)
  }
  if (!next.size) throw new Error('A closed skin needs a seam before flattening.')
  const sketch = emptySketch()
  while (next.size) {
    const start = next.keys().next().value!
    const loop: Vec2[] = []
    let index = start
    do {
      const end = next.get(index)
      if (end === undefined) throw new Error('The flattened boundary is open.')
      loop.push(uv.get(index)!); next.delete(index); index = end
    } while (index !== start)
    // Drop collinear tessellation points along straight boundaries.
    const corners = loop.filter((b,i) => {
      const a = loop[(i+loop.length-1)%loop.length], c = loop[(i+1)%loop.length]
      return Math.abs((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])) > 1e-9*Math.max(1,Math.hypot(c[0]-a[0], c[1]-a[1]))
    })
    if (corners.length < 3) throw new Error('The flattened outline has no area.')
    for (let i=0;i<corners.length;i++) addEntity(sketch,{ kind:'line', a:corners[i], b:corners[(i+1)%corners.length] })
  }
  return { sketch, maxClosure }
}
