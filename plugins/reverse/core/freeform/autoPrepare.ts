// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform, before the quads: the scan made ready for a quad layout.
//
// A layout is made of a working copy of the scan, not of the scan itself:
// the part of it asked for (the selected triangles), without the crumbs a
// scanner leaves beside the part, one half of it when the cage is to be
// symmetric, its small holes closed and its rims evened when that is asked.
// The cage is fitted to the scan as it is afterwards, so nothing done here
// moves the surface the result is measured against.
//
// Pure typed-array code, for the worker.

export interface WorkMesh {
  positions: Float32Array
  indices: Uint32Array
}

/** Vertices at one place made one vertex (a seam a file wrote twice, a triangle soup); the triangles keep their order, and one that came to nothing is dropped only when `drop`. */
export function welded(m: WorkMesh): WorkMesh {
  const p = m.positions
  const nv = p.length / 3
  const ids = new Map<string, number>()
  const remap = new Int32Array(nv)
  const pos: number[] = []
  let same = true
  for (let v = 0; v < nv; v++) {
    const key = `${p[v * 3]},${p[v * 3 + 1]},${p[v * 3 + 2]}`
    let w = ids.get(key)
    if (w === undefined) {
      w = pos.length / 3
      ids.set(key, w)
      pos.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2])
    } else same = false
    remap[v] = w
  }
  if (same) return m
  const idx = new Uint32Array(m.indices.length)
  for (let i = 0; i < idx.length; i++) idx[i] = remap[m.indices[i]]
  return { positions: Float32Array.from(pos), indices: idx }
}

/** The mesh without the triangles that have no area (two corners at one vertex). */
export function withoutSlivers(m: WorkMesh): WorkMesh {
  let bad = 0
  for (let t = 0; t + 2 < m.indices.length; t += 3) if (m.indices[t] === m.indices[t + 1] || m.indices[t + 1] === m.indices[t + 2] || m.indices[t] === m.indices[t + 2]) bad++
  if (bad === 0) return m
  const idx = new Uint32Array(m.indices.length - bad * 3)
  let o = 0
  for (let t = 0; t + 2 < m.indices.length; t += 3) {
    if (m.indices[t] === m.indices[t + 1] || m.indices[t + 1] === m.indices[t + 2] || m.indices[t] === m.indices[t + 2]) continue
    idx[o++] = m.indices[t]
    idx[o++] = m.indices[t + 1]
    idx[o++] = m.indices[t + 2]
  }
  return { positions: m.positions, indices: idx }
}

/** The triangles named, as a mesh of their own (vertices renumbered, the unused dropped). */
export function subMesh(m: WorkMesh, triangles: ArrayLike<number>): WorkMesh {
  const remap = new Int32Array(m.positions.length / 3).fill(-1)
  const pos: number[] = []
  const idx = new Uint32Array(triangles.length * 3)
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i]
    for (let k = 0; k < 3; k++) {
      const v = m.indices[t * 3 + k]
      let w = remap[v]
      if (w < 0) {
        w = pos.length / 3
        remap[v] = w
        pos.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2])
      }
      idx[i * 3 + k] = w
    }
  }
  return { positions: Float32Array.from(pos), indices: idx }
}

function triangleArea(p: Float32Array, a: number, b: number, c: number): number {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2]
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
}

export function scanTopology(mesh: WorkMesh): { euler: number; closed: boolean; boundaryEdges: number; boundaryLength: number } {
  const nv = mesh.positions.length / 3, used = new Uint8Array(nv)
  const incidences = new Map<number, number>()
  let vertices = 0, boundaryEdges = 0, nonManifold = 0
  for (let i=0; i<mesh.indices.length; i+=3) for (let k=0; k<3; k++) {
    const a = mesh.indices[i+k], b = mesh.indices[i+(k+1)%3]
    if (!used[a]) { used[a] = 1; vertices++ }
    const key = a < b ? a*nv+b : b*nv+a
    const previous = incidences.get(key) ?? 0
    incidences.set(key, previous+1)
    if (previous === 0) boundaryEdges++
    else if (previous === 1) boundaryEdges--
    else if (previous === 2) nonManifold++
  }
  let boundaryLength = 0
  for (const [key, uses] of incidences) {
    if (uses !== 1) continue
    const a = 3 * Math.floor(key / nv), b = 3 * (key % nv), p = mesh.positions
    boundaryLength += Math.hypot(p[a] - p[b], p[a+1] - p[b+1], p[a+2] - p[b+2])
  }
  return { euler: vertices-incidences.size+mesh.indices.length/3, closed: boundaryEdges===0 && nonManifold===0, boundaryEdges, boundaryLength }
}

export function meshArea(m: WorkMesh): number {
  let area = 0
  for (let t = 0; t + 2 < m.indices.length; t += 3) area += triangleArea(m.positions, m.indices[t], m.indices[t + 1], m.indices[t + 2])
  return area
}

export interface Pieces {
  mesh: WorkMesh
  /** Pieces the scan came in, and how many were kept. */
  pieces: number
  kept: number
}

/** The scan without its crumbs: of its connected pieces, those with at least `share` of the largest one's area. */
export function mainPieces(m: WorkMesh, share = 0.02): Pieces {
  const nv = m.positions.length / 3
  const parent = new Int32Array(nv)
  for (let i = 0; i < nv; i++) parent[i] = i
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]]
      a = parent[a]
    }
    return a
  }
  const nt = m.indices.length / 3
  for (let t = 0; t < nt; t++) {
    const a = find(m.indices[t * 3])
    const b = find(m.indices[t * 3 + 1])
    const c = find(m.indices[t * 3 + 2])
    if (b !== a) parent[b] = a
    if (c !== a) parent[find(c)] = a
  }
  const area = new Float64Array(nv)
  for (let t = 0; t < nt; t++) area[find(m.indices[t * 3])] += triangleArea(m.positions, m.indices[t * 3], m.indices[t * 3 + 1], m.indices[t * 3 + 2])
  let largest = 0, pieces = 0
  for (let v = 0; v < nv; v++) {
    if (area[v] > 0) pieces++
    if (area[v] > largest) largest = area[v]
  }
  if (pieces <= 1) return { mesh: m, pieces, kept: pieces }
  const keep: number[] = []
  const keptRoots = new Set<number>()
  for (let t = 0; t < nt; t++) {
    const r = find(m.indices[t * 3])
    if (area[r] >= share * largest) {
      keep.push(t)
      keptRoots.add(r)
    }
  }
  return { mesh: subMesh(m, keep), pieces, kept: keptRoots.size }
}

/** The half of the mesh on the positive side of the plane `axis` = 0: triangles across it cut, the cut's vertices exactly on the plane. */
export function positiveHalf(m: WorkMesh, axis: number): WorkMesh {
  const p = m.positions
  const nv = p.length / 3
  const remap = new Int32Array(nv).fill(-1)
  const pos: number[] = []
  const idx: number[] = []
  const eps = 1e-7
  const side = (v: number) => {
    const c = p[v * 3 + axis]
    return c > eps ? 1 : c < -eps ? -1 : 0
  }
  const keep = (v: number): number => {
    let w = remap[v]
    if (w < 0) {
      w = pos.length / 3
      remap[v] = w
      pos.push(p[v * 3], p[v * 3 + 1], p[v * 3 + 2])
      if (side(v) === 0) pos[w * 3 + axis] = 0
    }
    return w
  }
  const cuts = new Map<number, number>()
  const cut = (a: number, b: number): number => {
    const key = a < b ? a * nv + b : b * nv + a
    let w = cuts.get(key)
    if (w === undefined) {
      const ca = p[a * 3 + axis], cb = p[b * 3 + axis]
      const s = ca / (ca - cb)
      w = pos.length / 3
      for (let k = 0; k < 3; k++) pos.push(k === axis ? 0 : p[a * 3 + k] + s * (p[b * 3 + k] - p[a * 3 + k]))
      cuts.set(key, w)
    }
    return w
  }
  for (let t = 0; t + 2 < m.indices.length; t += 3) {
    const v = [m.indices[t], m.indices[t + 1], m.indices[t + 2]]
    const s = [side(v[0]), side(v[1]), side(v[2])]
    if (s[0] >= 0 && s[1] >= 0 && s[2] >= 0) {
      if (s[0] + s[1] + s[2] === 0) continue // lying in the plane
      idx.push(keep(v[0]), keep(v[1]), keep(v[2]))
      continue
    }
    if (s[0] <= 0 && s[1] <= 0 && s[2] <= 0) continue
    // Clipped: the polygon of the positive side, in the triangle's order.
    const poly: number[] = []
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3]
      if (s[k] >= 0) poly.push(keep(a))
      if (s[k] * s[(k + 1) % 3] < 0) poly.push(cut(a, b))
    }
    for (let k = 1; k + 1 < poly.length; k++) if (poly[0] !== poly[k] && poly[k] !== poly[k + 1] && poly[0] !== poly[k + 1]) idx.push(poly[0], poly[k], poly[k + 1])
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }
}

/** The mesh's open rims as loops of vertices, each in the direction of its triangles' edges; a rim that does not close (a pinched vertex) is left out. */
export function rims(m: WorkMesh): number[][] {
  const nv = m.positions.length / 3
  const half = new Map<number, number>()
  const key = (a: number, b: number) => a * nv + b
  for (let t = 0; t + 2 < m.indices.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = m.indices[t + k], b = m.indices[t + ((k + 1) % 3)]
      half.set(key(a, b), (half.get(key(a, b)) ?? 0) + 1)
    }
  }
  const next = new Map<number, number>()
  const twice = new Set<number>()
  for (const [k] of half) {
    const a = Math.floor(k / nv), b = k % nv
    if (half.has(key(b, a))) continue
    if (next.has(a)) twice.add(a)
    next.set(a, b)
  }
  const seen = new Set<number>()
  const loops: number[][] = []
  for (const [start] of next) {
    if (seen.has(start)) continue
    const loop: number[] = []
    let v = start
    let ok = true
    while (!seen.has(v)) {
      seen.add(v)
      loop.push(v)
      if (twice.has(v)) ok = false
      const n = next.get(v)
      if (n === undefined) {
        ok = false
        break
      }
      v = n
    }
    if (ok && v === start && loop.length >= 3) loops.push(loop)
  }
  return loops
}

function loopLength(p: Float32Array, loop: number[]): number {
  let len = 0
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i] * 3, b = loop[(i + 1) % loop.length] * 3
    len += Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2])
  }
  return len
}

export interface RimWork {
  mesh: WorkMesh
  /** Holes closed, and rims left open and evened. */
  filled: number
  evened: number
}

/**
 * Improve holes' boundaries: a hole no longer round than `fill` is closed with a fan about its middle, so
 * the quads run over it; the rims left are evened — each rim vertex moved toward the middle of its two
 * neighbours along the rim, `passes` times — so that the quads do not follow a ragged edge tooth by tooth.
 */
export function improveRims(m: WorkMesh, fill: number, passes = 3): RimWork {
  const loops = rims(m)
  if (loops.length === 0) return { mesh: m, filled: 0, evened: 0 }
  const pos = Array.from(m.positions)
  const idx = Array.from(m.indices)
  let filled = 0, evened = 0
  for (const loop of loops) {
    if (loopLength(m.positions, loop) <= fill) {
      const c = pos.length / 3
      let x = 0, y = 0, z = 0
      for (const v of loop) {
        x += pos[v * 3]
        y += pos[v * 3 + 1]
        z += pos[v * 3 + 2]
      }
      pos.push(x / loop.length, y / loop.length, z / loop.length)
      // The rim runs with its triangles' edges, so the fan runs against it.
      for (let i = 0; i < loop.length; i++) idx.push(loop[(i + 1) % loop.length], loop[i], c)
      filled++
      continue
    }
    evened++
    for (let pass = 0; pass < passes; pass++) {
      const moved = new Float64Array(loop.length * 3)
      for (let i = 0; i < loop.length; i++) {
        const a = loop[(i + loop.length - 1) % loop.length] * 3, v = loop[i] * 3, b = loop[(i + 1) % loop.length] * 3
        for (let k = 0; k < 3; k++) moved[i * 3 + k] = pos[v + k] + 0.5 * ((pos[a + k] + pos[b + k]) / 2 - pos[v + k])
      }
      for (let i = 0; i < loop.length; i++) for (let k = 0; k < 3; k++) pos[loop[i] * 3 + k] = moved[i * 3 + k]
    }
  }
  return { mesh: { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) }, filled, evened }
}

export interface Mirrored {
  positions: Float64Array
  faces: number[][]
  /** Each vertex's mirror partner; itself on the plane. */
  partner: Int32Array
  /** Rim vertices of the half taken onto the plane. */
  onPlane: number
}

/**
 * A quad mesh of the positive half made whole: its rim vertices within `reach` of the plane are put on the
 * plane, and the mesh is joined there to its mirror image, whose faces turn the other way round.
 */
export function mirrored(positions: Float64Array, faces: number[][], axis: number, reach: number): Mirrored {
  const n = positions.length / 3
  const edges = new Map<number, number>()
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a)
  for (const f of faces) for (let k = 0; k < f.length; k++) edges.set(key(f[k], f[(k + 1) % f.length]), (edges.get(key(f[k], f[(k + 1) % f.length])) ?? 0) + 1)
  const rim = new Uint8Array(n)
  for (const [e, c] of edges) {
    if (c === 1) {
      rim[Math.floor(e / n)] = 1
      rim[e % n] = 1
    }
  }
  const on = new Uint8Array(n)
  for (let v = 0; v < n; v++) if (rim[v] && Math.abs(positions[v * 3 + axis]) <= reach) on[v] = 1
  // The cut's rim is not always even: a quad short at it leaves a vertex or two standing back from the plane between
  // vertices that are on it. A short run like that, along the rim, is part of the cut.
  const next = new Map<number, number>()
  for (const f of faces) {
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length]
      if (edges.get(key(a, b)) === 1) next.set(a, b)
    }
  }
  const NOTCH = 3
  for (const [start] of next) {
    if (!on[start]) continue
    const run: number[] = []
    let v = next.get(start)
    while (v !== undefined && !on[v] && run.length <= NOTCH) {
      run.push(v)
      v = next.get(v)
    }
    if (v !== undefined && on[v] && run.length > 0 && run.length <= NOTCH) for (const w of run) on[w] = 2
  }
  let onPlane = 0
  for (let v = 0; v < n; v++) if (on[v]) onPlane++
  const twin = new Int32Array(n)
  let count = n
  for (let v = 0; v < n; v++) twin[v] = on[v] ? v : count++
  const out = new Float64Array(count * 3)
  for (let v = 0; v < n; v++) {
    for (let k = 0; k < 3; k++) out[v * 3 + k] = positions[v * 3 + k]
    if (on[v]) out[v * 3 + axis] = 0
    else {
      // A vertex that strayed to the wrong side is brought back to its own.
      if (out[v * 3 + axis] < 0) out[v * 3 + axis] = -out[v * 3 + axis]
      const w = twin[v]
      for (let k = 0; k < 3; k++) out[w * 3 + k] = k === axis ? -out[v * 3 + k] : out[v * 3 + k]
    }
  }
  const all: number[][] = []
  for (const f of faces) all.push(f.slice())
  for (const f of faces) {
    const g = f.map((v) => twin[v]).reverse()
    // A face with every vertex on the plane has no mirror image of its own.
    if (g.every((v, i) => v === f[f.length - 1 - i])) continue
    all.push(g)
  }
  const partner = new Int32Array(count)
  for (let v = 0; v < n; v++) {
    partner[v] = twin[v]
    partner[twin[v]] = v
  }
  return { positions: out, faces: all, partner, onPlane }
}

export interface HolesFilled {
  positions: Float64Array
  faces: number[][]
  /** The vertices added, one at the middle of each hole closed. */
  centres: number[]
}

/**
 * Small holes of a quad mesh closed with quads: a rim of an even number of edges, `maxEdges` at most, that `accept`
 * says has surface under it, gets a vertex at its middle and a quad for every two of its edges. The quads start at a
 * vertex `first` names when one is on the rim — so that a hole across a mirror plane is closed alike on both sides.
 */
export function fillCageHoles(positions: Float64Array, faces: number[][], maxEdges: number, accept: (centre: [number, number, number], rim: number[]) => boolean, first?: (v: number) => boolean): HolesFilled {
  const n = positions.length / 3
  const count = new Map<number, number>()
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a)
  for (const f of faces) for (let k = 0; k < f.length; k++) count.set(key(f[k], f[(k + 1) % f.length]), (count.get(key(f[k], f[(k + 1) % f.length])) ?? 0) + 1)
  const next = new Map<number, number>()
  const twice = new Set<number>()
  for (const f of faces) {
    for (let k = 0; k < f.length; k++) {
      const a = f[k], b = f[(k + 1) % f.length]
      if (count.get(key(a, b)) !== 1) continue
      if (next.has(a)) twice.add(a)
      next.set(a, b)
    }
  }
  const pos = Array.from(positions)
  const all = faces.slice()
  const centres: number[] = []
  const seen = new Set<number>()
  for (const [start] of next) {
    if (seen.has(start)) continue
    let loop: number[] = []
    let v: number | undefined = start
    let ok = true
    while (v !== undefined && !seen.has(v)) {
      seen.add(v)
      loop.push(v)
      if (twice.has(v)) ok = false
      v = next.get(v)
    }
    if (!ok || v !== start || loop.length < 4 || loop.length > maxEdges || loop.length % 2 !== 0) continue
    const c: [number, number, number] = [0, 0, 0]
    for (const w of loop) for (let k = 0; k < 3; k++) c[k] += positions[w * 3 + k] / loop.length
    if (!accept(c, loop)) continue
    if (first) {
      const at = loop.findIndex(first)
      if (at > 0) loop = [...loop.slice(at), ...loop.slice(0, at)]
    }
    if (loop.length === 4) {
      // The rim runs with its faces' edges, so the quad that closes it runs against it.
      all.push([loop[3], loop[2], loop[1], loop[0]])
      continue
    }
    const centre = pos.length / 3
    pos.push(c[0], c[1], c[2])
    centres.push(centre)
    for (let i = 0; i < loop.length; i += 2) all.push([centre, loop[(i + 2) % loop.length], loop[i + 1], loop[i]])
  }
  return { positions: Float64Array.from(pos), faces: all, centres }
}

/** The vertices of a mesh in a grid by place, for the nearest vertex to a point. */
export class VertexGrid {
  private cell: number
  private map = new Map<number, number[]>()
  constructor(private positions: Float32Array, cell: number) {
    this.cell = cell > 0 ? cell : 1
    for (let v = 0; v < positions.length / 3; v++) {
      const k = this.key(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
      const had = this.map.get(k)
      if (had) had.push(v)
      else this.map.set(k, [v])
    }
  }
  private key(x: number, y: number, z: number): number {
    const i = Math.floor(x / this.cell), j = Math.floor(y / this.cell), k = Math.floor(z / this.cell)
    return ((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) | 0
  }
  /** The nearest vertex within one cell's reach of the point, or -1. */
  nearest(x: number, y: number, z: number): number {
    let best = -1, bd = this.cell * this.cell
    const p = this.positions
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
      const list = this.map.get(this.key(x + di * this.cell, y + dj * this.cell, z + dk * this.cell))
      if (!list) continue
      for (const v of list) {
        const d = (p[v * 3] - x) ** 2 + (p[v * 3 + 1] - y) ** 2 + (p[v * 3 + 2] - z) ** 2
        if (d < bd) {
          bd = d
          best = v
        }
      }
    }
    return best
  }
}

export interface DirectionConstraint {
  vertex: number
  direction: [number, number, number]
  position?: [number, number, number]
  weight?: number
}

/** Guide curves as constraints on the layout: along each polyline (xyz flat, on the scan) the nearest vertices are told the curve's direction, and to lie on it. */
export function guideConstraints(m: WorkMesh, curves: readonly ArrayLike<number>[], spacing: number): DirectionConstraint[] {
  if (curves.length === 0) return []
  const grid = new VertexGrid(m.positions, Math.max(spacing, 1e-6) * 2)
  const out = new Map<number, DirectionConstraint>()
  for (const c of curves) {
    for (let i = 0; i + 5 < c.length; i += 3) {
      const ax = c[i], ay = c[i + 1], az = c[i + 2]
      const dx = c[i + 3] - ax, dy = c[i + 4] - ay, dz = c[i + 5] - az
      const len = Math.hypot(dx, dy, dz)
      if (!(len > 0)) continue
      const steps = Math.max(1, Math.ceil(len / spacing))
      for (let s = 0; s <= steps; s++) {
        const u = s / steps
        const x = ax + u * dx, y = ay + u * dy, z = az + u * dz
        const v = grid.nearest(x, y, z)
        if (v < 0 || out.has(v)) continue
        out.set(v, { vertex: v, direction: [dx / len, dy / len, dz / len], position: [x, y, z], weight: 1 })
      }
    }
  }
  return [...out.values()]
}
