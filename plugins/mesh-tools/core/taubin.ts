// SPDX-License-Identifier: AGPL-3.0-only
// Reduce noise as QUICKSURFACE sets it: a number of iterations, the open
// boundary held or smoothed with the rest, the whole mesh or a selection.
// Each iteration is one Taubin step — a pull toward the neighbours' mean
// (λ) and a push back (μ) — so the scatter goes and the part does not
// shrink as plain averaging would make it.

import { halfEdges, boundaryLoops } from './boundary'

const LAMBDA = 0.5
const MU = -0.53

/** The mesh's positions smoothed `iterations` times. Vertices left out of
 *  `region` (when given), and — unless `boundary` — the rim's, stay put. */
export function taubinSmooth(positions: Float32Array, indices: Uint32Array, vertexCount: number, iterations: number, boundary: boolean, region?: Uint32Array | null): Float32Array {
  // Each vertex's neighbours, once, from the triangles' edges.
  const he = halfEdges(indices, vertexCount)
  const near: number[][] = Array.from({ length: vertexCount }, () => [])
  for (let t = 0; t < indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = indices[t + k], b = indices[t + ((k + 1) % 3)]
    if (!near[a].includes(b)) near[a].push(b)
    if (!near[b].includes(a)) near[b].push(a)
  }
  const moves = new Uint8Array(vertexCount)
  if (region) for (const v of region) moves[v] = 1
  else moves.fill(1)
  if (!boundary) for (const l of boundaryLoops(indices, vertexCount, he).loops) for (const v of l.vertices) moves[v] = 0
  let p = new Float32Array(positions.subarray(0, vertexCount * 3))
  let q = new Float32Array(p.length)
  const step = (factor: number) => {
    q.set(p)
    for (let v = 0; v < vertexCount; v++) {
      const n = near[v]
      if (!moves[v] || n.length === 0) continue
      let x = 0, y = 0, z = 0
      for (const u of n) { x += p[u * 3]; y += p[u * 3 + 1]; z += p[u * 3 + 2] }
      x /= n.length; y /= n.length; z /= n.length
      q[v * 3] = p[v * 3] + factor * (x - p[v * 3])
      q[v * 3 + 1] = p[v * 3 + 1] + factor * (y - p[v * 3 + 1])
      q[v * 3 + 2] = p[v * 3 + 2] + factor * (z - p[v * 3 + 2])
    }
    ;[p, q] = [q, p]
  }
  for (let i = 0; i < iterations; i++) { step(LAMBDA); step(MU) }
  return p
}
