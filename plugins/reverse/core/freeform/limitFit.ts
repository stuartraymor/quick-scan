// SPDX-License-Identifier: AGPL-3.0-only
// A cage fitted to the scan by least squares.
//
// The limit surface of a Catmull–Clark cage is linear in the cage's
// vertices: a point of it is a fixed weighted sum of them, the weights set
// by the cage's connectivity and creases alone. Here the cage is subdivided
// once and every vertex of that finer cage taken to its limit point — four
// samples of the surface for each vertex of the cage, about — and the
// weights of each sample kept as a row of a sparse matrix S. Fitting is
// then: find the scan's point for each sample, and solve for the vertices
// that bring the samples to those points,
//
//     min  Σ wᵢ |Sᵢ X − Tᵢ|²  +  λ |L X|²  +  ε |X − X₀|²
//
// with L the cage's umbrella operator (a little fairness, which also
// carries vertices whose samples found no scan — over a hole, say) and the
// last term holding a vertex nothing else speaks for. The scan's points are
// found again from the new surface and the solve repeated a few times.
//
// This replaces moving each vertex by its own limit point's gap
// (edit.ts snapCage), which fits one sample per vertex and converges
// slowly: measured in analysis/quick-scan-v1.2.31.
//
// Pure: a cage and a way to project a point on the scan in, a cage out.

import type { Vec3 } from '../../../../src/core/types'
import { type Cage, type CageTopology, topology, vertexCount } from './cage'
import { vertexNormals } from './limit'
import { subdivide, vertexRule } from './subdivide'

/** A point of the scan for a point of the surface: the nearest, with the scan's normal there. */
export type ScanProject = (p: Vec3, normal: Vec3) => { point: Vec3; normal: Vec3; distance: number } | null

/** Rows of weights over the cage's vertices, compressed. */
export interface WeightRows {
  rows: number
  cols: number
  ptr: Int32Array
  idx: Int32Array
  val: Float64Array
}

class RowBuilder {
  private ptr: number[] = [0]
  private idx: number[] = []
  private val: number[] = []
  private acc: Float64Array
  private mark: Uint8Array
  private touched: number[] = []

  constructor(private cols: number) {
    this.acc = new Float64Array(cols)
    this.mark = new Uint8Array(cols)
  }

  add(col: number, w: number): void {
    if (!this.mark[col]) {
      this.mark[col] = 1
      this.touched.push(col)
    }
    this.acc[col] += w
  }

  /** A row already made, added in with a weight. */
  addRow(row: number, w: number): void {
    for (let k = this.ptr[row]; k < this.ptr[row + 1]; k++) this.add(this.idx[k], this.val[k] * w)
  }

  /** A row of another set, added in with a weight. */
  addFrom(other: WeightRows, row: number, w: number): void {
    for (let k = other.ptr[row]; k < other.ptr[row + 1]; k++) this.add(other.idx[k], other.val[k] * w)
  }

  end(): number {
    this.touched.sort((a, b) => a - b)
    for (const c of this.touched) {
      if (this.acc[c] !== 0) {
        this.idx.push(c)
        this.val.push(this.acc[c])
      }
      this.acc[c] = 0
      this.mark[c] = 0
    }
    this.touched.length = 0
    this.ptr.push(this.idx.length)
    return this.ptr.length - 2
  }

  done(): WeightRows {
    return { rows: this.ptr.length - 1, cols: this.cols, ptr: Int32Array.from(this.ptr), idx: Int32Array.from(this.idx), val: Float64Array.from(this.val) }
  }
}

const sharpEdge = (t: CageTopology, e: number) => t.edges[e].crease || t.edges[e].faces.length < 2

function creaseEnds(t: CageTopology, v: number): number[] {
  const ends: number[] = []
  for (const e of t.vertexEdges[v]) {
    if (sharpEdge(t, e)) ends.push(t.edges[e].a === v ? t.edges[e].b : t.edges[e].a)
  }
  return ends
}

/** One Catmull–Clark step as weights: row i gives vertex i of `subdivide(c)` from the cage's vertices. Its order is subdivide's: the vertices, the face points, the edge points. */
export function subdivisionRows(c: Cage, t: CageTopology = topology(c)): WeightRows {
  const n = vertexCount(c)
  const nf = c.faces.length
  // Face and edge points are needed by the vertex rows, so they are made first, in a set of their own.
  const fe = new RowBuilder(n)
  c.faces.forEach((f) => {
    for (const v of f) fe.add(v, 1 / f.length)
    fe.end()
  })
  t.edges.forEach((e, ei) => {
    if (sharpEdge(t, ei)) {
      fe.add(e.a, 0.5)
      fe.add(e.b, 0.5)
    } else {
      fe.add(e.a, 0.25)
      fe.add(e.b, 0.25)
      fe.addRow(e.faces[0], 0.25)
      fe.addRow(e.faces[1], 0.25)
    }
    fe.end()
  })
  const faceEdge = fe.done()
  const out = new RowBuilder(n)
  for (let v = 0; v < n; v++) {
    const rule = vertexRule(t, v)
    if (rule === 'corner') out.add(v, 1)
    else if (rule === 'crease') {
      const ends = creaseEnds(t, v)
      out.add(ends[0], 1 / 8)
      out.add(v, 6 / 8)
      out.add(ends[1], 1 / 8)
    } else {
      const valence = t.vertexEdges[v].length
      const faces = t.vertexFaces[v]
      for (const f of faces) out.addFrom(faceEdge, f, 1 / (faces.length * valence))
      for (const e of t.vertexEdges[v]) {
        out.add(t.edges[e].a, 1 / (valence * valence))
        out.add(t.edges[e].b, 1 / (valence * valence))
      }
      out.add(v, (valence - 3) / valence)
    }
    out.end()
  }
  for (let r = 0; r < nf + t.edges.length; r++) {
    out.addFrom(faceEdge, r, 1)
    out.end()
  }
  return out.done()
}

/** The limit masks of a quad cage as weights over its own vertices (limit.ts limitPositions, row for row). */
export function limitRows(c: Cage, t: CageTopology = topology(c)): WeightRows {
  const n = vertexCount(c)
  const out = new RowBuilder(n)
  for (let v = 0; v < n; v++) {
    const rule = vertexRule(t, v)
    if (rule === 'corner') out.add(v, 1)
    else if (rule === 'crease') {
      const ends = creaseEnds(t, v)
      out.add(ends[0], 1 / 6)
      out.add(v, 4 / 6)
      out.add(ends[1], 1 / 6)
    } else {
      const valence = t.vertexEdges[v].length
      const den = valence * (valence + 5)
      out.add(v, (valence * valence) / den)
      for (const e of t.vertexEdges[v]) out.add(t.edges[e].a === v ? t.edges[e].b : t.edges[e].a, 4 / den)
      for (const fi of t.vertexFaces[v]) {
        const f = c.faces[fi]
        if (f.length !== 4) throw new Error('The limit masks need a quad cage; subdivide once first.')
        out.add(f[(f.indexOf(v) + 2) % 4], 1 / den)
      }
    }
    out.end()
  }
  return out.done()
}

/** a·b: the rows of `a` (over b's rows) carried through `b`. */
function compose(a: WeightRows, b: WeightRows): WeightRows {
  const out = new RowBuilder(b.cols)
  for (let r = 0; r < a.rows; r++) {
    for (let k = a.ptr[r]; k < a.ptr[r + 1]; k++) out.addFrom(b, a.idx[k], a.val[k])
    out.end()
  }
  return out.done()
}

export interface LimitSamples {
  /** Sample i of the limit surface as weights over the cage's vertices. */
  rows: WeightRows
  /** The once-subdivided cage's quads, over the samples: the surface as a mesh. */
  faces: number[][]
}

/** The limit points of the once-subdivided cage, as weights over the cage's vertices. */
export function limitSamples(c: Cage, t: CageTopology = topology(c)): LimitSamples {
  const fine = subdivide(c, t)
  return { rows: compose(limitRows(fine), subdivisionRows(c, t)), faces: fine.faces }
}

/** out = S x, for one coordinate laid `stride` apart from `offset`. */
function apply(s: WeightRows, x: Float64Array, out: Float64Array): void {
  for (let r = 0; r < s.rows; r++) {
    let sum = 0
    for (let k = s.ptr[r]; k < s.ptr[r + 1]; k++) sum += s.val[k] * x[s.idx[k]]
    out[r] = sum
  }
}

/** out += Sᵀ (w ∘ y). */
function applyTransposed(s: WeightRows, y: Float64Array, w: Float64Array | null, out: Float64Array): void {
  for (let r = 0; r < s.rows; r++) {
    const yr = w ? y[r] * w[r] : y[r]
    if (yr === 0) continue
    for (let k = s.ptr[r]; k < s.ptr[r + 1]; k++) out[s.idx[k]] += s.val[k] * yr
  }
}

/** The umbrella operator of the cage: a vertex less the mean of its neighbours — along the rim alone for a rim or crease vertex, nothing for a corner. */
export function umbrellaRows(c: Cage, t: CageTopology = topology(c)): WeightRows {
  const n = vertexCount(c)
  const out = new RowBuilder(n)
  for (let v = 0; v < n; v++) {
    const rule = vertexRule(t, v)
    if (rule !== 'corner') {
      const ns = rule === 'crease' ? creaseEnds(t, v) : t.vertexEdges[v].map((e) => (t.edges[e].a === v ? t.edges[e].b : t.edges[e].a))
      if (ns.length > 0) {
        out.add(v, 1)
        for (const w of ns) out.add(w, -1 / ns.length)
      }
    }
    out.end()
  }
  return out.done()
}

/** Conjugate gradient on (Sᵀ W S + λ Lᵀ L + ε I) x = b, Jacobi-preconditioned, from x0. */
function solve(s: WeightRows, w: Float64Array, l: WeightRows, lambda: number, eps: number, diag: Float64Array, b: Float64Array, x: Float64Array, tolerance: number, maxIterations: number): void {
  const n = s.cols
  const sx = new Float64Array(s.rows)
  const lx = new Float64Array(l.rows)
  const mul = (v: Float64Array, out: Float64Array) => {
    out.fill(0)
    apply(s, v, sx)
    applyTransposed(s, sx, w, out)
    apply(l, v, lx)
    for (let i = 0; i < lx.length; i++) lx[i] *= lambda
    applyTransposed(l, lx, null, out)
    for (let i = 0; i < n; i++) out[i] += eps * v[i]
  }
  const r = new Float64Array(n)
  const z = new Float64Array(n)
  const p = new Float64Array(n)
  const ap = new Float64Array(n)
  mul(x, ap)
  let bb = 0
  for (let i = 0; i < n; i++) {
    r[i] = b[i] - ap[i]
    bb += b[i] * b[i]
  }
  if (bb === 0) bb = 1
  let rz = 0
  for (let i = 0; i < n; i++) {
    z[i] = r[i] / diag[i]
    p[i] = z[i]
    rz += r[i] * z[i]
  }
  const stop = tolerance * tolerance * bb
  for (let it = 0; it < maxIterations; it++) {
    let rr = 0
    for (let i = 0; i < n; i++) rr += r[i] * r[i]
    if (rr <= stop) break
    mul(p, ap)
    let pap = 0
    for (let i = 0; i < n; i++) pap += p[i] * ap[i]
    if (!(pap > 0)) break
    const alpha = rz / pap
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i]
      r[i] -= alpha * ap[i]
    }
    let next = 0
    for (let i = 0; i < n; i++) {
      z[i] = r[i] / diag[i]
      next += r[i] * z[i]
    }
    const beta = next / rz
    rz = next
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i]
  }
}

/**
 * Whether the cage is wound the other way round from the scan: its surface normals point against the scan's at most
 * of a few hundred samples. A cage read from a file may be; the projection compares sides, and has to be told.
 */
export function woundAgainst(positions: Float64Array, normals: Float64Array, project: ScanProject): boolean {
  const n = positions.length / 3
  const step = Math.max(1, Math.floor(n / 400))
  let with_ = 0, against = 0
  for (let v = 0; v < n; v += step) {
    const q = project([positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]], [0, 0, 0])
    if (!q) continue
    const dot = q.normal[0] * normals[v * 3] + q.normal[1] * normals[v * 3 + 1] + q.normal[2] * normals[v * 3 + 2]
    if (dot >= 0) with_++
    else against++
  }
  return against > with_
}

export interface FitOptions {
  /** Times the scan's points are found and the vertices solved; 5 unless given. */
  iterations?: number
  /** Fairness λ, against a sample's weight of 1; 0.02 unless given. */
  fairness?: number
  /** A scan point further than this from its sample is not believed, mm; six mean cage edges unless given. */
  reach?: number
  /** How much of a sample's gap along the surface (not off it) is asked for, 0–1: 0 lets the samples slide, 1 pins each to its nearest point. 0.25 unless given; a rim sample is always pinned. */
  tangential?: number
  /** Vertices held where they are. */
  fixed?: ReadonlySet<number>
  progress?: (fraction: number) => void
}

export interface FitStats {
  iterations: number
  samples: number
  /** Samples the scan had no point for. */
  missed: number
  /** Of the samples' gaps to the scan after the last solve, mm. */
  rms: number
  max: number
}

function meanEdge(c: Cage, t: CageTopology): number {
  let sum = 0
  const p = c.positions
  for (const e of t.edges) sum += Math.hypot(p[e.a * 3] - p[e.b * 3], p[e.a * 3 + 1] - p[e.b * 3 + 1], p[e.a * 3 + 2] - p[e.b * 3 + 2])
  return t.edges.length > 0 ? sum / t.edges.length : 0
}

/** The cage's vertices moved so that its limit surface lies on the scan, by least squares: see the head of the file. The connectivity and creases are kept. */
export function fitCageToScan(c: Cage, project: ScanProject, options: FitOptions = {}): { cage: Cage; stats: FitStats } {
  const t = topology(c)
  const n = vertexCount(c)
  const { rows: s, faces } = limitSamples(c, t)
  const l = umbrellaRows(c, t)
  const m = s.rows
  const iterations = Math.max(1, Math.round(options.iterations ?? 5))
  const lambda = options.fairness ?? 0.02
  const tangential = Math.min(1, Math.max(0, options.tangential ?? 0.25))
  const reach = options.reach ?? 6 * meanEdge(c, t)
  const eps = 1e-6
  // Which samples lie on the rim: the fine cage's rim vertices, found from its faces.
  const rim = new Uint8Array(m)
  {
    const count = new Map<number, number>()
    const key = (a: number, b: number) => (a < b ? a * m + b : b * m + a)
    for (const f of faces) for (let k = 0; k < 4; k++) count.set(key(f[k], f[(k + 1) % 4]), (count.get(key(f[k], f[(k + 1) % 4])) ?? 0) + 1)
    for (const [e, k] of count) {
      if (k === 1) {
        rim[Math.floor(e / m)] = 1
        rim[e % m] = 1
      }
    }
  }
  const x = [new Float64Array(n), new Float64Array(n), new Float64Array(n)]
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) x[k][v] = c.positions[v * 3 + k]
  const sample = [new Float64Array(m), new Float64Array(m), new Float64Array(m)]
  const target = [new Float64Array(m), new Float64Array(m), new Float64Array(m)]
  const w = new Float64Array(m)
  const diag = new Float64Array(n)
  const b = new Float64Array(n)
  const limit = new Float64Array(m * 3)
  const fixed = options.fixed
  const held = fixed && fixed.size > 0 ? 1e6 : 0
  let stats: FitStats = { iterations: 0, samples: m, missed: 0, rms: 0, max: 0 }
  let flip: boolean | null = null
  const measure = (final: boolean): void => {
    for (let k = 0; k < 3; k++) apply(s, x[k], sample[k])
    for (let i = 0; i < m; i++) {
      limit[i * 3] = sample[0][i]
      limit[i * 3 + 1] = sample[1][i]
      limit[i * 3 + 2] = sample[2][i]
    }
    const normals = vertexNormals(limit, faces)
    if (flip === null) flip = woundAgainst(limit, normals, project)
    if (flip) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i]
    let missed = 0, sum = 0, max = 0, got = 0
    for (let i = 0; i < m; i++) {
      const p: Vec3 = [limit[i * 3], limit[i * 3 + 1], limit[i * 3 + 2]]
      const nrm: Vec3 = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]
      const q = project(p, nrm)
      if (!q || !(q.distance <= reach)) {
        w[i] = 0
        missed++
        continue
      }
      got++
      sum += q.distance * q.distance
      if (q.distance > max) max = q.distance
      if (final) continue
      w[i] = 1
      const d: Vec3 = [q.point[0] - p[0], q.point[1] - p[1], q.point[2] - p[2]]
      // Off the surface in full; along it by `tangential` only, so the quads keep their layout. A rim sample goes to its point.
      const along = rim[i] ? 1 : tangential
      const dn = d[0] * q.normal[0] + d[1] * q.normal[1] + d[2] * q.normal[2]
      for (let k = 0; k < 3; k++) target[k][i] = p[k] + q.normal[k] * dn * (1 - along) + d[k] * along
    }
    stats = { iterations: stats.iterations, samples: m, missed, rms: got > 0 ? Math.sqrt(sum / got) : 0, max }
  }
  for (let it = 0; it < iterations; it++) {
    measure(false)
    // The diagonal of Sᵀ W S + λ Lᵀ L + ε I, for the preconditioner.
    diag.fill(eps)
    for (let r = 0; r < m; r++) {
      if (w[r] === 0) continue
      for (let k = s.ptr[r]; k < s.ptr[r + 1]; k++) diag[s.idx[k]] += w[r] * s.val[k] * s.val[k]
    }
    for (let r = 0; r < l.rows; r++) for (let k = l.ptr[r]; k < l.ptr[r + 1]; k++) diag[l.idx[k]] += lambda * l.val[k] * l.val[k]
    if (fixed) for (const v of fixed) diag[v] += held
    for (let k = 0; k < 3; k++) {
      b.fill(0)
      applyTransposed(s, target[k], w, b)
      for (let v = 0; v < n; v++) b[v] += eps * x[k][v]
      if (fixed) {
        // A held vertex: a heavy pull to where it is, through the ε term's place on the diagonal.
        for (const v of fixed) b[v] += held * x[k][v]
        solveHeld(s, w, l, lambda, eps, held, fixed, diag, b, x[k])
      } else solve(s, w, l, lambda, eps, diag, b, x[k], 1e-7, 200)
    }
    stats.iterations = it + 1
    options.progress?.((it + 1) / (iterations + 1))
  }
  measure(true)
  options.progress?.(1)
  const positions = new Float64Array(n * 3)
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) positions[v * 3 + k] = x[k][v]
  return { cage: { positions, faces: c.faces, creases: c.creases }, stats }
}

/** The solve with some vertices held: the same system with a heavy diagonal on them. */
function solveHeld(s: WeightRows, w: Float64Array, l: WeightRows, lambda: number, eps: number, held: number, fixed: ReadonlySet<number>, diag: Float64Array, b: Float64Array, x: Float64Array): void {
  // Folded into S's system as an extra diagonal operator: a one-entry row per held vertex.
  const extra = new RowBuilder(s.cols)
  for (const v of fixed) {
    extra.add(v, Math.sqrt(held / Math.max(lambda, 1e-12)))
    extra.end()
  }
  const e = extra.done()
  // Lᵀ L + (held/λ) I on the held: append the rows to L.
  const ptr = new Int32Array(l.rows + e.rows + 1)
  ptr.set(l.ptr)
  for (let r = 0; r < e.rows; r++) ptr[l.rows + r + 1] = l.ptr[l.rows] + e.ptr[r + 1]
  const idx = new Int32Array(l.idx.length + e.idx.length)
  idx.set(l.idx)
  idx.set(e.idx, l.idx.length)
  const val = new Float64Array(l.val.length + e.val.length)
  val.set(l.val)
  val.set(e.val, l.val.length)
  solve(s, w, { rows: l.rows + e.rows, cols: l.cols, ptr, idx, val }, Math.max(lambda, 1e-12), eps, diag, b, x, 1e-7, 200)
}

export interface SurfaceDeviation {
  /** The limit surface as a triangle mesh. */
  positions: Float32Array
  normals: Float32Array
  indices: Uint32Array
  /** Unsigned distance to the scan at each vertex, mm; NaN where the scan had no point. */
  distance: Float32Array
  points: number
  missed: number
  rms: number
  max: number
  /** Points within the tolerance. */
  within: number
}

/** The cage's limit surface sampled (subdivided `steps` times) with each sample's distance to the scan. */
export function surfaceDeviation(c: Cage, project: ScanProject, tolerance: number, steps = 2, reach = Infinity): SurfaceDeviation {
  let fine = c
  for (let i = 0; i < Math.max(1, steps); i++) fine = subdivide(fine)
  const rows = limitRows(fine)
  const nv = rows.rows
  const pos = new Float64Array(nv * 3)
  const col = new Float64Array(nv)
  const out = new Float64Array(nv)
  for (let k = 0; k < 3; k++) {
    for (let v = 0; v < nv; v++) col[v] = fine.positions[v * 3 + k]
    apply(rows, col, out)
    for (let v = 0; v < nv; v++) pos[v * 3 + k] = out[v]
  }
  const nrm = vertexNormals(pos, fine.faces)
  const side = woundAgainst(pos, nrm, project) ? -1 : 1
  const distance = new Float32Array(nv)
  let points = 0, missed = 0, sum = 0, max = 0, within = 0
  for (let v = 0; v < nv; v++) {
    const q = project([pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]], [side * nrm[v * 3], side * nrm[v * 3 + 1], side * nrm[v * 3 + 2]])
    if (!q || !(q.distance <= reach)) {
      distance[v] = NaN
      missed++
      continue
    }
    distance[v] = q.distance
    points++
    sum += q.distance * q.distance
    if (q.distance > max) max = q.distance
    if (q.distance <= tolerance) within++
  }
  const indices = new Uint32Array(fine.faces.length * 6)
  fine.faces.forEach((f, i) => {
    indices.set([f[0], f[1], f[2], f[0], f[2], f[3]], i * 6)
  })
  return { positions: Float32Array.from(pos), normals: Float32Array.from(nrm), indices, distance, points, missed, rms: points > 0 ? Math.sqrt(sum / points) : 0, max, within }
}
