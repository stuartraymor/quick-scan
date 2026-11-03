// SPDX-License-Identifier: AGPL-3.0-only
// Duplicate triangles, as QUICKSURFACE's Edit Scan counts and removes them:
// a triangle with the same three corners as one before it, whichever way
// round it is wound. Corners are matched by place, not by vertex number, so
// a copy laid over the scan on vertices of its own is found too.

/** Which triangles repeat an earlier one (1 in the mask), and how many. */
export function duplicateTriangles(positions: Float32Array, indices: Uint32Array, vertexCount: number): { mask: Uint8Array; count: number } {
  // One number per place: vertices at the same spot share it.
  const place = new Int32Array(vertexCount)
  const seen = new Map<string, number>()
  for (let v = 0; v < vertexCount; v++) {
    const key = `${positions[v * 3]},${positions[v * 3 + 1]},${positions[v * 3 + 2]}`
    let id = seen.get(key)
    if (id === undefined) seen.set(key, (id = seen.size))
    place[v] = id
  }
  const triangles = indices.length / 3
  const mask = new Uint8Array(triangles)
  const met = new Set<string>()
  let count = 0
  for (let t = 0; t < triangles; t++) {
    const c = [place[indices[t * 3]], place[indices[t * 3 + 1]], place[indices[t * 3 + 2]]].sort((a, b) => a - b)
    // A triangle folded to a line or a point is not a copy of another.
    if (c[0] === c[1] || c[1] === c[2]) continue
    const key = `${c[0]},${c[1]},${c[2]}`
    if (met.has(key)) {
      mask[t] = 1
      count++
    } else met.add(key)
  }
  return { mask, count }
}
