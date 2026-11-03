// SPDX-License-Identifier: AGPL-3.0-only
// Project the mesh boundaries on OXY plane, as QUICKSURFACE 8.0.128 does it
// (recorded live, 2026-11-03): every open edge of the mesh is carried
// straight down — or up — to Z = 0 as a wall of two triangles, so a scan
// open at its foot reaches the XY plane it stood on. Nothing else moves.

import { boundaryLoops } from './boundary'

/** The mesh with a wall from each rim edge to its foot on Z = 0, and how
 *  many rim edges it walled. The wall is wound as the rim's own triangle,
 *  so it faces the same way as the surface it hangs from. */
export function skirtToOxy(positions: Float32Array, indices: Uint32Array, vertexCount: number): { positions: Float32Array; indices: Uint32Array; vertexMap: Int32Array; edges: number } {
  const { loops } = boundaryLoops(indices, vertexCount)
  // One foot per rim vertex, numbered after the mesh's own.
  const foot = new Map<number, number>()
  for (const l of loops) for (const v of l.vertices) if (!foot.has(v) && positions[v * 3 + 2] !== 0) foot.set(v, vertexCount + foot.size)
  const out = new Float32Array((vertexCount + foot.size) * 3)
  out.set(positions.subarray(0, vertexCount * 3))
  for (const [v, f] of foot) { out[f * 3] = positions[v * 3]; out[f * 3 + 1] = positions[v * 3 + 1]; out[f * 3 + 2] = 0 }
  const footOf = (v: number) => foot.get(v) ?? v
  const added: number[] = []
  let edges = 0
  for (const l of loops) {
    const n = l.vertices.length
    for (let i = 0; i < n; i++) {
      const a = l.vertices[i], b = l.vertices[(i + 1) % n]
      const fa = footOf(a), fb = footOf(b)
      if (fa === a && fb === b) continue
      // The rim runs a → b along its triangle; the wall's triangles run
      // b → a, so the edge they share is walked the other way.
      if (fb !== b) added.push(b, a, fb)
      if (fa !== a) added.push(a, fa, fb)
      edges++
    }
  }
  const tri = new Uint32Array(indices.length + added.length)
  tri.set(indices)
  tri.set(added, indices.length)
  const vertexMap = new Int32Array(vertexCount)
  for (let v = 0; v < vertexCount; v++) vertexMap[v] = v
  return { positions: out, indices: tri, vertexMap, edges }
}
