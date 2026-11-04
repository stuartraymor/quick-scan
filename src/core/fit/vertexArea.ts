// SPDX-License-Identifier: AGPL-3.0-only
// How much surface each vertex of a mesh stands for: a third of the area of
// every triangle it is a corner of. A scan meshes curved edges and fine detail
// densely and flat faces coarsely, so a fit that counts vertices lets the
// dense parts outvote the surface; one weighted by these areas fits the
// surface itself, as QUICKSURFACE's plane does (measured 2026-11-03 on
// basic_part: unweighted, the rounded edges pulled the plane 3.8 µm off the
// face; weighted, it lies within 0.5 µm and 0.0004° of QUICKSURFACE's).

const cache = new WeakMap<Float32Array, Float64Array>()

export function vertexAreas(positions: Float32Array, indices: ArrayLike<number>): Float64Array {
  const hit = cache.get(positions)
  if (hit && hit.length === positions.length / 3) return hit
  const P = positions
  const area = new Float64Array(P.length / 3)
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2]
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2]
    const third = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 6
    area[indices[t]] += third
    area[indices[t + 1]] += third
    area[indices[t + 2]] += third
  }
  cache.set(positions, area)
  return area
}
