// SPDX-License-Identifier: AGPL-3.0-only
// The freeform editor's tools as pure operations on a cage (F3 of
// audit-2026-11-07/FREEFORM_ROADMAP.md): move points with a falloff, add a
// face, increase resolution, split an edge loop, crease, extrapolate an
// edge, delete, smooth, bridge two faces, close a four-sided hole, add a
// rectangle, align, mirror (symmetry). Each takes a cage and answers
// another; the first is never changed. The picks are indices, as
// reverse.freeform.read lists them. A pick that is not there, or an edit
// the cage cannot take (an edge with three faces, a face with two vertices
// the same), is refused with what was wrong — the cage is never left broken.

import type { Vec3 } from '../../../../src/core/types'
import { type Cage, edgeKey, topology, vertexCount } from './cage'
import { cageVertexLimits } from './limit'
import { subdivide } from './subdivide'

export const cloneCage = (c: Cage): Cage => ({ positions: Float64Array.from(c.positions), faces: c.faces.map((f) => f.slice()), creases: c.creases.map(([a, b]) => [a, b]) })

const fail = (m: string): never => {
  throw new Error(m)
}

function vertexIn(c: Cage, v: unknown, what = 'vertex'): number {
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) >= vertexCount(c)) return fail(`There is no ${what} ${String(v)}: the cage has ${vertexCount(c)} vertices, from 0.`)
  return v as number
}

function faceIn(c: Cage, f: unknown): number {
  if (!Number.isInteger(f) || (f as number) < 0 || (f as number) >= c.faces.length) return fail(`There is no face ${String(f)}: the cage has ${c.faces.length} faces, from 0.`)
  return f as number
}

const point = (c: Cage, v: number): Vec3 => [c.positions[v * 3], c.positions[v * 3 + 1], c.positions[v * 3 + 2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const finite = (p: Vec3, what: string): Vec3 => (p.length === 3 && p.every(Number.isFinite) ? p : fail(`${what} is not three numbers.`))

function pushPoint(c: Cage, p: Vec3): number {
  const n = vertexCount(c)
  const next = new Float64Array((n + 1) * 3)
  next.set(c.positions)
  next.set(p, n * 3)
  c.positions = next
  return n
}

/** The directed edges the faces use. */
function directed(faces: number[][]): Set<string> {
  const s = new Set<string>()
  for (const f of faces) for (let k = 0; k < f.length; k++) s.add(`${f[k]}>${f[(k + 1) % f.length]}`)
  return s
}

/** The cage with a broken topology refused. */
function checked(c: Cage): Cage {
  topology(c)
  return c
}

// ---- move ---------------------------------------------------------------------------

export interface PointMove {
  vertex: number
  /** The new position, or */
  to?: Vec3
  /** the displacement. */
  by?: Vec3
}

/** Points moved; vertices within `radius` of a moved one follow it by a
 *  smooth falloff (`strength` 1 = the full falloff, 0 = none), the way the
 *  editor's drag takes its neighbours. A vertex followed by several is
 *  moved by their average, weighted. */
export function movePoints(c: Cage, moves: PointMove[], radius = 0, strength = 1): Cage {
  if (moves.length === 0) return fail('Nothing to move: give moves.')
  if (!(radius >= 0) || !(strength >= 0 && strength <= 1)) return fail('The radius is zero or more, the strength between 0 and 1.')
  const out = cloneCage(c)
  const n = vertexCount(c)
  const deltas = new Map<number, Vec3>()
  for (const m of moves) {
    const v = vertexIn(c, m.vertex)
    if (!m.to === !m.by) return fail(`Move of vertex ${v}: give either to (the new position) or by (the displacement).`)
    const d = m.to ? sub(finite(m.to, 'to'), point(c, v)) : finite(m.by!, 'by')
    const was = deltas.get(v)
    deltas.set(v, was ? add(was, d) : d)
  }
  const total = new Float64Array(n * 3)
  const weight = new Float64Array(n)
  for (const [v, d] of deltas) {
    const origin = point(c, v)
    for (let w = 0; w < n; w++) {
      let k = 0
      if (w === v) k = 1
      else if (radius > 0 && strength > 0 && !deltas.has(w)) {
        const r = dist(origin, point(c, w)) / radius
        if (r < 1) k = strength * (1 - r) * (1 - r)
      }
      if (k <= 0) continue
      for (let a = 0; a < 3; a++) total[w * 3 + a] += k * d[a]
      weight[w] += k
    }
  }
  for (let w = 0; w < n; w++) {
    if (weight[w] <= 0) continue
    const own = deltas.has(w)
    const div = own ? 1 : Math.max(1, weight[w])
    for (let a = 0; a < 3; a++) out.positions[w * 3 + a] += own ? deltas.get(w)![a] : total[w * 3 + a] / div
  }
  return out
}

// ---- add ----------------------------------------------------------------------------

/** A corner of a new face: a vertex of the cage, or a new point. */
export type Corner = number | Vec3

/** A face added through three or more corners — four clicks for a quad —
 *  wound to agree with its neighbours; refused where an edge would have a
 *  third face. */
export function addFace(c: Cage, corners: Corner[]): Cage {
  if (corners.length < 3) return fail('A face takes three corners at least.')
  const out = cloneCage(c)
  const ids = corners.map((k) => (Array.isArray(k) ? pushPoint(out, finite(k, 'A corner')) : vertexIn(out, k, 'corner')))
  if (new Set(ids).size !== ids.length) return fail('A face cannot use a vertex twice.')
  const used = directed(out.faces)
  const edges = ids.map((a, k) => [a, ids[(k + 1) % ids.length]] as const)
  const same = edges.some(([a, b]) => used.has(`${a}>${b}`))
  const flipped = edges.some(([a, b]) => used.has(`${b}>${a}`))
  const face = same && flipped ? fail('The new face meets the cage’s faces in opposite senses; it cannot be wound to fit.') : same ? ids.slice().reverse() : ids
  out.faces.push(face)
  return checked(out)
}

/** A grid of quads: `nu` × `nv` of them from `origin`, along `u` and `v`
 *  (the face looks along u × v). */
export function addRectangle(c: Cage, origin: Vec3, u: Vec3, v: Vec3, nu = 1, nv = 1): Cage {
  if (!(Number.isInteger(nu) && Number.isInteger(nv) && nu >= 1 && nv >= 1 && nu * nv <= 10_000)) return fail('A rectangle is 1 to 10 000 quads, a whole number each way.')
  finite(origin, 'origin'); finite(u, 'u'); finite(v, 'v')
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  if (!(Math.hypot(...cross) > 1e-12)) return fail('The sides u and v of a rectangle must not lie along one line.')
  const out = cloneCage(c)
  const first = vertexCount(out)
  const grid = new Float64Array((nu + 1) * (nv + 1) * 3)
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const o = (j * (nu + 1) + i) * 3
    for (let a = 0; a < 3; a++) grid[o + a] = origin[a] + (u[a] * i) / nu + (v[a] * j) / nv
  }
  const positions = new Float64Array(out.positions.length + grid.length)
  positions.set(out.positions)
  positions.set(grid, out.positions.length)
  out.positions = positions
  const at = (i: number, j: number) => first + j * (nu + 1) + i
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) out.faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)])
  return out
}

// ---- resolution and splitting -------------------------------------------------------

/** Increase Resolution: every face cut into four (Catmull–Clark), which
 *  holds the limit surface exactly and gives it four times the points. */
export function increaseResolution(c: Cage): Cage {
  if (c.faces.length * 4 > 400_000) return fail('The cage is too fine to refine again.')
  return subdivide(c)
}

/** Split: the loop of edges across the quads from the edge `a`–`b` cut at
 *  `t` of the way from `a` to `b` (0.5 unless given), a ring of new
 *  vertices and every quad it crosses cut in two. */
export function splitLoop(c: Cage, a: number, b: number, t = 0.5): Cage {
  vertexIn(c, a); vertexIn(c, b)
  if (!(t > 0 && t < 1)) return fail('Split at a fraction between 0 and 1 of the edge.')
  const top = topology(c)
  const start = top.edgeOf.get(edgeKey(a, b))
  if (start === undefined) return fail(`${a}–${b} is not an edge of the cage.`)
  // From each edge reached, the edge opposite in each of its quads; `from` is the end the cut is measured from.
  const from = new Map<number, number>([[start, a]])
  const faces = new Set<number>()
  const queue = [start]
  while (queue.length > 0) {
    const e = queue.pop()!
    for (const fi of top.edges[e].faces) {
      const f = c.faces[fi]
      if (f.length !== 4) return fail(`The loop meets a face of ${f.length} sides (face ${fi}); only quads are cut across.`)
      faces.add(fi)
      const edge = top.edges[e]
      const k = f.findIndex((v, i) => edgeKey(v, f[(i + 1) % 4]) === edgeKey(edge.a, edge.b))
      // Quad [p, q, r, s]: edge p–q lies opposite r–s, and p pairs with s.
      const p = f[k], q = f[(k + 1) % 4], r = f[(k + 2) % 4], s = f[(k + 3) % 4]
      const oppositeEdge = top.edgeOf.get(edgeKey(r, s))!
      // The end of the opposite edge that pairs with the cut's origin end.
      const origin = from.get(e)!
      const paired = origin === p ? s : origin === q ? r : -1
      if (paired < 0) return fail('The loop could not be followed.')
      const seen = from.get(oppositeEdge)
      if (seen === undefined) {
        from.set(oppositeEdge, paired)
        queue.push(oppositeEdge)
      } else if (seen !== paired) {
        return fail('The loop closes on itself the wrong way (a twisted strip); it cannot be split.')
      }
    }
  }
  const out = cloneCage(c)
  const mid = new Map<number, number>()
  for (const [e, origin] of from) {
    const edge = top.edges[e]
    const other = edge.a === origin ? edge.b : edge.a
    mid.set(e, pushPoint(out, lerp(point(c, origin), point(c, other), t)))
  }
  const faceList: number[][] = []
  c.faces.forEach((f, fi) => {
    if (!faces.has(fi)) {
      faceList.push(f)
      return
    }
    // Rotate so the cut edges are the first and third.
    let k = 0
    while (!(mid.has(top.edgeOf.get(edgeKey(f[k], f[(k + 1) % 4]))!) && mid.has(top.edgeOf.get(edgeKey(f[(k + 2) % 4], f[(k + 3) % 4]))!))) k++
    const [p, q, r, s] = [f[k], f[(k + 1) % 4], f[(k + 2) % 4], f[(k + 3) % 4]]
    const m1 = mid.get(top.edgeOf.get(edgeKey(p, q))!)!
    const m2 = mid.get(top.edgeOf.get(edgeKey(r, s))!)!
    faceList.push([p, m1, m2, s], [m1, q, r, m2])
  })
  out.faces = faceList
  // A crease on a cut edge stays on both halves.
  const creases: [number, number][] = []
  for (const [x, y] of c.creases) {
    const e = top.edgeOf.get(edgeKey(x, y))
    const m = e === undefined ? undefined : mid.get(e)
    if (m === undefined) creases.push([x, y])
    else creases.push([x, m], [m, y])
  }
  out.creases = creases
  return checked(out)
}

// ---- creases ------------------------------------------------------------------------

/** Edges creased or, with `on` false, their crease removed. */
export function setCrease(c: Cage, edges: [number, number][], on: boolean): Cage {
  if (edges.length === 0) return fail('Name the edges: [a, b] pairs.')
  const top = topology(c)
  const out = cloneCage(c)
  const marked = new Set(c.creases.map(([x, y]) => edgeKey(x, y)))
  for (const [x, y] of edges) {
    vertexIn(c, x); vertexIn(c, y)
    if (!top.edgeOf.has(edgeKey(x, y))) return fail(`${x}–${y} is not an edge of the cage.`)
    if (on) marked.add(edgeKey(x, y))
    else marked.delete(edgeKey(x, y))
  }
  out.creases = [...marked].map((k) => k.split(':').map(Number) as [number, number])
  return out
}

// ---- extrapolate --------------------------------------------------------------------

/** Extrapolate: a boundary edge `a`–`b` pulled out into a new quad. The new
 *  edge lies at `by` from the old if given (one vector), else continues the
 *  face beside it: each end as far from the old end as that end is from
 *  the face's next vertex. */
export function extrapolate(c: Cage, a: number, b: number, by?: Vec3): Cage {
  vertexIn(c, a); vertexIn(c, b)
  const top = topology(c)
  const e = top.edgeOf.get(edgeKey(a, b))
  if (e === undefined) return fail(`${a}–${b} is not an edge of the cage.`)
  if (top.edges[e].faces.length !== 1) return fail(`${a}–${b} is not a boundary edge; only an edge with one face is extrapolated.`)
  const face = c.faces[top.edges[e].faces[0]]
  const k = face.findIndex((v, i) => edgeKey(v, face[(i + 1) % face.length]) === edgeKey(a, b))
  // The face runs p → q along the edge.
  const p = face[k], q = face[(k + 1) % face.length]
  const before = face[(k + face.length - 1) % face.length], after = face[(k + 2) % face.length]
  let pa: Vec3, qa: Vec3
  if (by) {
    finite(by, 'by')
    pa = add(point(c, p), by)
    qa = add(point(c, q), by)
  } else {
    pa = add(point(c, p), sub(point(c, p), point(c, before)))
    qa = add(point(c, q), sub(point(c, q), point(c, after)))
  }
  const out = cloneCage(c)
  const np = pushPoint(out, pa)
  const nq = pushPoint(out, qa)
  // The new quad goes against the old face's edge p → q: q → p.
  out.faces.push([q, p, np, nq])
  return checked(out)
}

// ---- delete -------------------------------------------------------------------------

function compacted(c: Cage, keepFaces: boolean[]): Cage {
  const faces = c.faces.filter((_, i) => keepFaces[i])
  const used = new Set<number>()
  for (const f of faces) for (const v of f) used.add(v)
  const map = new Map<number, number>()
  const order = [...used].sort((x, y) => x - y)
  order.forEach((v, i) => map.set(v, i))
  const positions = new Float64Array(order.length * 3)
  order.forEach((v, i) => positions.set(point(c, v), i * 3))
  const renumbered = faces.map((f) => f.map((v) => map.get(v)!))
  const edges = topology({ positions, faces: renumbered, creases: [] }).edgeOf
  const creases: [number, number][] = []
  for (const [x, y] of c.creases) {
    const nx = map.get(x), ny = map.get(y)
    if (nx !== undefined && ny !== undefined && edges.has(edgeKey(nx, ny))) creases.push([nx, ny])
  }
  return { positions, faces: renumbered, creases }
}

/** Delete: faces removed, and with them the vertices only they used. */
export function deleteFaces(c: Cage, faces: number[]): Cage {
  if (faces.length === 0) return fail('Name the faces to delete.')
  const gone = new Set(faces.map((f) => faceIn(c, f)))
  if (gone.size >= c.faces.length) return fail('That deletes every face of the cage.')
  return compacted(c, c.faces.map((_, i) => !gone.has(i)))
}

/** Delete: vertices removed, and the faces they belong to. */
export function deleteVertices(c: Cage, vertices: number[]): Cage {
  if (vertices.length === 0) return fail('Name the vertices to delete.')
  const gone = new Set(vertices.map((v) => vertexIn(c, v)))
  const keep = c.faces.map((f) => !f.some((v) => gone.has(v)))
  if (!keep.some(Boolean)) return fail('That deletes every face of the cage.')
  return compacted(c, keep)
}

// ---- smooth, align, mirror ----------------------------------------------------------

/** Smooth: the given vertices (all when none are given) moved `factor` of
 *  the way to the average of their neighbours, `iterations` times. A
 *  vertex on a boundary or a crease holds still. */
export function smooth(c: Cage, vertices?: number[], factor = 0.5, iterations = 1): Cage {
  if (!(factor > 0 && factor <= 1) || !(Number.isInteger(iterations) && iterations >= 1 && iterations <= 100)) return fail('Smooth by a factor above 0 up to 1, 1 to 100 times.')
  const top = topology(c)
  const picked = new Set((vertices ?? Array.from({ length: vertexCount(c) }, (_, i) => i)).map((v) => vertexIn(c, v)))
  const held = new Set<number>()
  for (const e of top.edges) if (e.crease || e.faces.length < 2) { held.add(e.a); held.add(e.b) }
  let out = cloneCage(c)
  for (let it = 0; it < iterations; it++) {
    const next = Float64Array.from(out.positions)
    for (const v of picked) {
      if (held.has(v) || top.vertexEdges[v].length === 0) continue
      const mean: Vec3 = [0, 0, 0]
      for (const e of top.vertexEdges[v]) {
        const other = top.edges[e].a === v ? top.edges[e].b : top.edges[e].a
        for (let k = 0; k < 3; k++) mean[k] += out.positions[other * 3 + k] / top.vertexEdges[v].length
      }
      for (let k = 0; k < 3; k++) next[v * 3 + k] += (mean[k] - out.positions[v * 3 + k]) * factor
    }
    out = { ...out, positions: next }
  }
  return out
}

/** Align: the vertices' `axis` coordinate made one — their mean unless `to`. */
export function align(c: Cage, vertices: number[], axis: 'x' | 'y' | 'z', to?: number): Cage {
  if (vertices.length === 0) return fail('Name the vertices to align.')
  const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  const ids = vertices.map((v) => vertexIn(c, v))
  const level = to ?? ids.reduce((s, v) => s + c.positions[v * 3 + k], 0) / ids.length
  if (!Number.isFinite(level)) return fail('Align to a number.')
  const out = cloneCage(c)
  for (const v of ids) out.positions[v * 3 + k] = level
  return out
}

/** Symmetry: the cage mirrored in the plane `axis` = `offset`, vertices on
 *  the plane (within `tolerance`) shared by the two halves. */
export function mirror(c: Cage, axis: 'x' | 'y' | 'z', offset = 0, tolerance = 1e-6): Cage {
  const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2
  if (!(tolerance >= 0) || !Number.isFinite(offset)) return fail('Mirror about a plane at a number, to a tolerance of zero or more.')
  const n = vertexCount(c)
  const out = cloneCage(c)
  const twin = new Int32Array(n)
  const added: number[] = []
  for (let v = 0; v < n; v++) {
    if (Math.abs(c.positions[v * 3 + k] - offset) <= tolerance) {
      twin[v] = v
      out.positions[v * 3 + k] = offset
    } else {
      twin[v] = n + added.length
      added.push(v)
    }
  }
  const positions = new Float64Array((n + added.length) * 3)
  positions.set(out.positions)
  added.forEach((v, i) => {
    const p = point(c, v)
    p[k] = 2 * offset - p[k]
    positions.set(p, (n + i) * 3)
  })
  out.positions = positions
  for (const f of c.faces) out.faces.push(f.map((v) => twin[v]).reverse())
  for (const [x, y] of c.creases) out.creases.push([twin[x], twin[y]])
  const marked = new Map<string, [number, number]>()
  for (const [x, y] of out.creases) if (x !== y) marked.set(edgeKey(x, y), [x, y])
  out.creases = [...marked.values()]
  return checked(out)
}

// ---- bridge, close -----------------------------------------------------------------

/** Bridge: two quads joined by a tube of four, the faces themselves
 *  removed. The faces should look at each other; the corners are paired
 *  by the shortest way round. */
export function bridge(c: Cage, fa: number, fb: number): Cage {
  faceIn(c, fa); faceIn(c, fb)
  if (fa === fb) return fail('Bridge two different faces.')
  const A = c.faces[fa], B = c.faces[fb]
  if (A.length !== 4 || B.length !== 4) return fail('Bridge takes two quads.')
  if (A.some((v) => B.includes(v))) return fail('The two faces share a vertex; they cannot be bridged.')
  let best = 0, least = Infinity
  for (let k = 0; k < 4; k++) {
    let sum = 0
    for (let i = 0; i < 4; i++) sum += dist(point(c, A[i]), point(c, B[(((k - i) % 4) + 4) % 4]))
    if (sum < least) { least = sum; best = k }
  }
  const out = cloneCage(c)
  out.faces = c.faces.filter((_, i) => i !== fa && i !== fb)
  for (let i = 0; i < 4; i++) {
    const pi = B[(((best - i) % 4) + 4) % 4], pj = B[(((best - (i + 1)) % 4) + 4) % 4]
    out.faces.push([A[(i + 1) % 4], A[i], pi, pj])
  }
  return checked(out)
}

/** The loops of boundary edges, each as the vertices in the sense the faces run. */
export function boundaryLoops(c: Cage): number[][] {
  const next = new Map<number, number[]>()
  const used = directed(c.faces)
  for (const key of used) {
    const [a, b] = key.split('>').map(Number)
    if (used.has(`${b}>${a}`)) continue
    next.set(a, [...(next.get(a) ?? []), b])
  }
  const loops: number[][] = []
  const done = new Set<number>()
  for (const start of next.keys()) {
    if (done.has(start)) continue
    const loop = [start]
    done.add(start)
    let v = next.get(start)![0]
    while (v !== start && !done.has(v) && next.has(v)) {
      loop.push(v)
      done.add(v)
      v = next.get(v)![0]
    }
    if (v === start) loops.push(loop)
  }
  return loops
}

/** Close a four-sided hole: the boundary loop through `vertex` (every
 *  four-sided one when none is given) filled with a quad. */
export function closeHole(c: Cage, vertex?: number): Cage {
  const loops = boundaryLoops(c)
  const chosen = vertex === undefined ? loops.filter((l) => l.length === 4) : loops.filter((l) => l.includes(vertexIn(c, vertex)))
  if (chosen.length === 0) return fail(vertex === undefined ? 'The cage has no four-sided hole.' : `Vertex ${vertex} is not on a hole.`)
  const bad = chosen.find((l) => l.length !== 4)
  if (bad) return fail(`The hole at vertex ${bad[0]} has ${bad.length} sides; only four-sided holes are closed (add a face, or extrapolate).`)
  const out = cloneCage(c)
  // The new face runs against the boundary.
  for (const l of chosen) out.faces.push(l.slice().reverse())
  return checked(out)
}

// ---- snap ---------------------------------------------------------------------------

/** The scan's nearest point to a point, or null where none is in reach. */
export type Closest = (p: Vec3) => { point: Vec3; distance: number } | null

export interface SnapStats {
  iterations: number
  /** Cage vertices whose limit point found no scan point. */
  missed: number
  /** The distance of the cage's limit points from the scan after, mm. */
  rms: number
  max: number
  /** How many of those points lie within `tolerance` of the scan. */
  within: number
  points: number
}

/** The distance from the scan of the cage's limit points (the cage refined
 *  `steps` times), in total and within `tolerance`. */
export function deviation(c: Cage, closest: Closest, tolerance = 0.05, steps = 2): Omit<SnapStats, 'iterations'> {
  let fine = c
  for (let s = 0; s < steps; s++) fine = subdivide(fine)
  const limits = cageVertexLimits(fine)
  let sum = 0, max = 0, within = 0, points = 0, missed = 0
  for (const p of limits) {
    const q = closest(p)
    if (!q) { missed++; continue }
    points++
    sum += q.distance * q.distance
    if (q.distance > max) max = q.distance
    if (q.distance <= tolerance) within++
  }
  return { missed, rms: points > 0 ? Math.sqrt(sum / points) : 0, max, within, points }
}

/** Snap: the cage's vertices moved so their limit points lie on the scan —
 *  each by the gap between its limit point and the scan's nearest point,
 *  `iterations` times or until the gap is under `tolerance`. A vertex the
 *  scan is out of reach of holds still. */
export function snapCage(c: Cage, closest: Closest, iterations = 8, tolerance = 0.01, relax = 1): { cage: Cage; stats: SnapStats } {
  if (!(Number.isInteger(iterations) && iterations >= 1 && iterations <= 100)) return fail('Snap 1 to 100 times.')
  let cage = cloneCage(c)
  let done = 0
  for (let it = 0; it < iterations; it++) {
    done++
    const limits = cageVertexLimits(cage)
    let worst = 0
    const next = Float64Array.from(cage.positions)
    limits.forEach((l, v) => {
      const q = closest(l)
      if (!q) return
      worst = Math.max(worst, q.distance)
      for (let k = 0; k < 3; k++) next[v * 3 + k] += (q.point[k] - l[k]) * relax
    })
    cage = { ...cage, positions: next }
    if (worst < tolerance) break
  }
  const d = deviation(cage, closest, tolerance)
  return { cage, stats: { iterations: done, ...d } }
}
