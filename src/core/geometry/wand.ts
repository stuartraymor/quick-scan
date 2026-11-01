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
//
// The triangle graph (face normals and the neighbour across each edge) is
// built once per mesh and reused: a wand click, and every move of the degrees
// slider, is then a walk over the graph only — fast enough to follow the
// slider on a scan of millions of triangles.

/** Face normals and edge neighbours of a mesh, in the scan's own vertices. */
export interface TriangleGraph {
  /** Triangle count. */
  count: number
  /** Unit normal per triangle (zero for a degenerate one). */
  normals: Float32Array
  /** The scan's own vertex at each corner, three per triangle. */
  corners: Uint32Array
  /** The triangle across each edge (corner e to e+1), or -1 on a rim. */
  next: Int32Array
  /** One past the largest own vertex id. */
  vertexSpan: number
}

/** Build the graph. `own` maps a render vertex to the vertex it was cut from,
 *  as in core/geometry/crease, so split corners still join their neighbours. */
export function buildTriangleGraph(
  indices: ArrayLike<number>,
  positions: ArrayLike<number>,
  own: (v: number) => number = (v) => v,
): TriangleGraph {
  const count = Math.floor(indices.length / 3)
  const normals = new Float32Array(count * 3)
  const corners = new Uint32Array(count * 3)
  let span = 0
  for (let t = 0; t < count; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz)
    if (len > 0) {
      normals[t * 3] = nx / len
      normals[t * 3 + 1] = ny / len
      normals[t * 3 + 2] = nz / len
    }
    for (let k = 0; k < 3; k++) {
      const v = own(indices[t * 3 + k])
      corners[t * 3 + k] = v
      if (v + 1 > span) span = v + 1
    }
  }
  // Pair each edge with the triangle on its other side: numeric keys (the
  // lower id times the span plus the higher), each removed as soon as it is
  // matched, so the map holds only the edges still waiting for a partner.
  const next = new Int32Array(count * 3).fill(-1)
  const open = new Map<number, number>()
  for (let t = 0; t < count; t++) {
    for (let e = 0; e < 3; e++) {
      const p = corners[t * 3 + e]
      const q = corners[t * 3 + ((e + 1) % 3)]
      if (p === q) continue
      const key = p < q ? p * span + q : q * span + p
      const waiting = open.get(key)
      if (waiting === undefined) open.set(key, t * 3 + e)
      else {
        next[t * 3 + e] = Math.floor(waiting / 3)
        next[waiting] = t
        open.delete(key)
      }
    }
  }
  return { count, normals, corners, next, vertexSpan: span }
}

/** The own vertices of the smoothly turning patch around triangle `seed`. */
export function wandGrow(graph: TriangleGraph, seed: number, degrees: number): Uint32Array {
  const { count, normals, corners, next, vertexSpan } = graph
  if (!(seed >= 0 && seed < count) || !Number.isFinite(degrees)) return new Uint32Array(0)
  // A small tolerance so an exact fold at the slider's value is taken.
  const limit = Math.cos((Math.min(Math.max(degrees, 0), 180) * Math.PI) / 180) - 1e-9
  const taken = new Uint8Array(count)
  const stack = new Int32Array(count)
  let top = 0
  stack[top++] = seed
  taken[seed] = 1
  while (top > 0) {
    const t = stack[--top]
    for (let e = 0; e < 3; e++) {
      const n = next[t * 3 + e]
      if (n < 0 || taken[n]) continue
      const dot = normals[t * 3] * normals[n * 3] + normals[t * 3 + 1] * normals[n * 3 + 1] + normals[t * 3 + 2] * normals[n * 3 + 2]
      if (dot >= limit) {
        taken[n] = 1
        stack[top++] = n
      }
    }
  }
  const on = new Uint8Array(vertexSpan)
  let found = 0
  for (let t = 0; t < count; t++) {
    if (!taken[t]) continue
    for (let k = 0; k < 3; k++) {
      const v = corners[t * 3 + k]
      if (!on[v]) {
        on[v] = 1
        found++
      }
    }
  }
  const out = new Uint32Array(found)
  let w = 0
  for (let v = 0; v < vertexSpan && w < found; v++) if (on[v]) out[w++] = v
  return out
}

/** One-shot form: build the graph and grow from `seed` (tests, small meshes). */
export function wandSelect(
  indices: ArrayLike<number>,
  positions: ArrayLike<number>,
  seed: number,
  degrees: number,
  own: (v: number) => number = (v) => v,
): Uint32Array {
  return wandGrow(buildTriangleGraph(indices, positions, own), seed, degrees)
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
