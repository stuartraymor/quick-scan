// SPDX-License-Identifier: AGPL-3.0-only
// Mesh selection by neighbourhood: the Magic Wand, and Enlarge / Shrink.
//
// The wand takes the triangle clicked and spreads across every edge to a
// neighbour whose face turns from it by no more than the sensitivity in
// degrees — so a plane, a cylinder or any smoothly curved patch is taken in one
// click and a crease stops it. Spreading neighbour to neighbour (not against
// the first triangle) is what lets it follow a cylinder round. Behaviour is
// modelled on QUICKSURFACE's documented Magic Wand ("degrees of the
// neighboured triangles"); the exact algorithm is not known.

/** Vertices of the connected, smoothly turning patch around `seed`, as the
 *  scan's own vertices (`own` maps a render vertex to the vertex it was cut
 *  from, as in core/geometry/crease). */
export function wandSelect(
  indices: ArrayLike<number>,
  positions: ArrayLike<number>,
  seed: number,
  degrees: number,
  own: (v: number) => number = (v) => v,
): Uint32Array {
  const triangles = Math.floor(indices.length / 3)
  if (!(seed >= 0 && seed < triangles) || !Number.isFinite(degrees)) return new Uint32Array(0)
  const limit = Math.cos((Math.min(Math.max(degrees, 0), 180) * Math.PI) / 180) - 1e-9 // tolerance: an exact 90° fold must pass at 90
  const normal = new Float32Array(triangles * 3)
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len > 0) { normal[t * 3] = nx / len; normal[t * 3 + 1] = ny / len; normal[t * 3 + 2] = nz / len }
  }
  // Triangles sharing an edge, keyed on the scan's own vertices.
  const edges = new Map<string, number[]>()
  const key = (p: number, q: number) => (p < q ? `${p}:${q}` : `${q}:${p}`)
  for (let t = 0; t < triangles; t++) {
    const v = [own(indices[t * 3]), own(indices[t * 3 + 1]), own(indices[t * 3 + 2])]
    for (let e = 0; e < 3; e++) {
      const k = key(v[e], v[(e + 1) % 3])
      const list = edges.get(k)
      if (list) list.push(t); else edges.set(k, [t])
    }
  }
  const taken = new Uint8Array(triangles)
  const stack = [seed]
  taken[seed] = 1
  while (stack.length) {
    const t = stack.pop() as number
    const v = [own(indices[t * 3]), own(indices[t * 3 + 1]), own(indices[t * 3 + 2])]
    for (let e = 0; e < 3; e++) {
      for (const n of edges.get(key(v[e], v[(e + 1) % 3])) ?? []) {
        if (taken[n]) continue
        const dot = normal[t * 3] * normal[n * 3] + normal[t * 3 + 1] * normal[n * 3 + 1] + normal[t * 3 + 2] * normal[n * 3 + 2]
        if (dot >= limit) { taken[n] = 1; stack.push(n) }
      }
    }
  }
  const out = new Set<number>()
  for (let t = 0; t < triangles; t++) if (taken[t]) for (let k = 0; k < 3; k++) out.add(own(indices[t * 3 + k]))
  return Uint32Array.from(out)
}

/** The marking grown by one ring: every vertex of any triangle that touches it. */
export function enlargeVertices(indices: ArrayLike<number>, marked: Uint32Array, own: (v: number) => number = (v) => v): Uint32Array {
  const inside = new Set(marked)
  const out = new Set(marked)
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const v = [own(indices[t]), own(indices[t + 1]), own(indices[t + 2])]
    if (inside.has(v[0]) || inside.has(v[1]) || inside.has(v[2])) v.forEach((x) => out.add(x))
  }
  return Uint32Array.from(out)
}

/** The marking worn down by one ring: a vertex stays only if every triangle
 *  around it lies wholly inside the marking. */
export function shrinkVertices(indices: ArrayLike<number>, marked: Uint32Array, own: (v: number) => number = (v) => v): Uint32Array {
  const inside = new Set(marked)
  const out = new Set(marked)
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const v = [own(indices[t]), own(indices[t + 1]), own(indices[t + 2])]
    if (v.some((x) => !inside.has(x))) v.forEach((x) => out.delete(x))
  }
  return Uint32Array.from(out)
}
