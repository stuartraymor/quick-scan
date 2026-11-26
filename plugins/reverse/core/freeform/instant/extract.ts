// SPDX-License-Identifier: AGPL-3.0-only
// Part of a TypeScript port of Instant Meshes ("Instant Field-Aligned Meshes").
// Copyright (c) 2015 Wenzel Jakob, Daniele Panozzo, Marco Tarini, and Olga Sorkine-Hornung
// (BSD-3-Clause; the licence text is in ATTRIBUTION.md).
//
// extract.cpp: the mesh the two fields describe. extract_graph() collapses
// the scan's vertices onto the lattice points they agree on and keeps the
// unit steps between them as edges; extract_faces() walks the faces of that
// graph, fills the small holes, subdivides every face once so that the
// result is pure quads, and smooths the result back onto the scan.
//
// The scan is hit with rays through a uniform grid here, not through the
// original's BVH; the answers are the same.

import type { Level } from './hierarchy'
import { compatOrientation4, pair } from './hierarchy'
import { Progress, TICK_MASK, coordinateSystem, growF64, growU8, noTick, sortFloatKeys } from './util'
import type { Tick } from './util'

export interface Graph {
  /** Per vertex, its neighbours in clockwise order about the normal. */
  adj: number[][]
  O: Float64Array
  N: Float64Array
  /** Vertices that are not to be smoothed: on a crease or on a constrained boundary. */
  crease: Uint8Array
  nV: number
}

class DisjointSets {
  readonly parent: Uint32Array
  readonly rank: Uint8Array
  constructor(n: number) {
    this.parent = new Uint32Array(n)
    for (let i = 0; i < n; i++) this.parent[i] = i
    this.rank = new Uint8Array(n)
  }
  find(x: number): number {
    const parent = this.parent
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
}

let classifyError = 0
/**
 * Step 1 for one edge of the scan: 0 when the two lattice points are more
 * than a unit step apart (or diagonal), 1 when they are the same point
 * (collapse; the mismatch is left in classifyError), 2 when a unit step apart.
 */
function classify(level: Level, i: number, j: number, scale: number, invScale: number): number {
  const { Q, N, V, O } = level
  const i3 = 3 * i, j3 = 3 * j
  const n0x = N[i3], n0y = N[i3 + 1], n0z = N[i3 + 2], n1x = N[j3], n1y = N[j3 + 1], n1z = N[j3 + 2]
  compatOrientation4(Q[i3], Q[i3 + 1], Q[i3 + 2], n0x, n0y, n0z, Q[j3], Q[j3 + 1], Q[j3 + 2], n1x, n1y, n1z)
  const q0x = pair[0], q0y = pair[1], q0z = pair[2], q1x = pair[3], q1y = pair[4], q1z = pair[5]
  const p0x = V[i3], p0y = V[i3 + 1], p0z = V[i3 + 2], p1x = V[j3], p1y = V[j3 + 1], p1z = V[j3 + 2]
  const o0x = O[i3], o0y = O[i3 + 1], o0z = O[i3 + 2], o1x = O[j3], o1y = O[j3 + 1], o1z = O[j3 + 2]
  // compat_position_extrinsic_index_4()
  const t0x = n0y * q0z - n0z * q0y, t0y = n0z * q0x - n0x * q0z, t0z = n0x * q0y - n0y * q0x
  const t1x = n1y * q1z - n1z * q1y, t1y = n1z * q1x - n1x * q1z, t1z = n1x * q1y - n1y * q1x
  const n0p0 = n0x * p0x + n0y * p0y + n0z * p0z, n0p1 = n0x * p1x + n0y * p1y + n0z * p1z
  const n1p0 = n1x * p0x + n1y * p0y + n1z * p0z, n1p1 = n1x * p1x + n1y * p1y + n1z * p1z
  const n0n1 = n0x * n1x + n0y * n1y + n0z * n1z
  const denom = 0.5 / (1 - n0n1 * n0n1 + 1e-4)
  const l0 = (n0p1 - n0p0 - n0n1 * (n1p0 - n1p1)) * denom
  const l1 = (n1p0 - n1p1 - n0n1 * (n0p1 - n0p0)) * denom
  const mx = 0.5 * (p0x + p1x) - (n0x * l0 + n1x * l1)
  const my = 0.5 * (p0y + p1y) - (n0y * l0 + n1y * l1)
  const mz = 0.5 * (p0z + p1z) - (n0z * l0 + n1z * l1)
  let dx = mx - o0x, dy = my - o0y, dz = mz - o0z
  const u0 = Math.floor((q0x * dx + q0y * dy + q0z * dz) * invScale)
  const v0 = Math.floor((t0x * dx + t0y * dy + t0z * dz) * invScale)
  dx = mx - o1x; dy = my - o1y; dz = mz - o1z
  const u1 = Math.floor((q1x * dx + q1y * dy + q1z * dz) * invScale)
  const v1 = Math.floor((t1x * dx + t1y * dy + t1z * dz) * invScale)
  let best = Infinity, bi = 0, bj = 0
  for (let a = 0; a < 4; a++) {
    const au = (a & 1) + u0, av = (a >> 1) + v0
    const ax = o0x + (q0x * au + t0x * av) * scale, ay = o0y + (q0y * au + t0y * av) * scale, az = o0z + (q0z * au + t0z * av) * scale
    for (let b = 0; b < 4; b++) {
      const bu = (b & 1) + u1, bv = (b >> 1) + v1
      const ex = ax - (o1x + (q1x * bu + t1x * bv) * scale)
      const ey = ay - (o1y + (q1y * bu + t1y * bv) * scale)
      const ez = az - (o1z + (q1z * bu + t1z * bv) * scale)
      const cost = ex * ex + ey * ey + ez * ez
      if (cost < best) { best = cost; bi = a; bj = b }
    }
  }
  const du = Math.abs((bi & 1) + u0 - (bj & 1) - u1), dv = Math.abs((bi >> 1) + v0 - (bj >> 1) - v1)
  if (du > 1 || dv > 1 || (du === 1 && dv === 1)) return 0
  if (du + dv === 0) { classifyError = best; return 1 }
  return 2
}

const numeric = (a: number, b: number): number => a - b

function sortedUnique(list: number[]): number[] {
  list.sort(numeric)
  let n = 0
  for (let i = 0; i < list.length; i++) if (i === 0 || list[i] !== list[i - 1]) list[n++] = list[i]
  list.length = n
  return list
}

function removeValue(list: number[], value: number): void {
  let n = 0
  for (let i = 0; i < list.length; i++) if (list[i] !== value) list[n++] = list[i]
  list.length = n
}

/** extract_graph(), with spurious vertices and unnecessary edges removed and vertices snapped, as in batch mode. */
export function extractGraph(level: Level, creaseIn: Uint8Array, scale: number, progress: Progress): Graph {
  const n = level.n
  const invScale = 1 / scale
  const { ptr, id } = level.adj
  const dset = new DisjointSets(n)
  const adjFine: (number[] | undefined)[] = new Array(n)

  // Step 1: classify the scan's edges.
  let capacity = Math.max(16, ptr[n] >> 1)
  let collapseA = new Uint32Array(capacity), collapseB = new Uint32Array(capacity)
  let collapseError = new Float32Array(capacity)
  let nCollapse = 0
  for (let i = 0; i < n; i++) {
    if ((i & 4095) === 0) progress.tick('extract', 0.5 * i / n)
    for (let l = ptr[i], e = ptr[i + 1]; l < e; l++) {
      const j = id[l]
      if (j < i) continue
      const kind = classify(level, i, j, scale, invScale)
      if (kind === 0) continue
      if (kind === 1) {
        if (nCollapse === capacity) {
          capacity *= 2
          const a = new Uint32Array(capacity); a.set(collapseA); collapseA = a
          const b = new Uint32Array(capacity); b.set(collapseB); collapseB = b
          const c = new Float32Array(capacity); c.set(collapseError); collapseError = c
        }
        collapseA[nCollapse] = i
        collapseB[nCollapse] = j
        collapseError[nCollapse++] = classifyError
      } else {
        (adjFine[i] ??= []).push(j);
        (adjFine[j] ??= []).push(i)
      }
    }
  }

  // Step 2: collapse, best agreement first.
  const order = sortFloatKeys(collapseError, nCollapse, false)
  const nCollapses = new Uint32Array(n)
  const { parent, rank } = dset
  for (let p = 0; p < nCollapse; p++) {
    if ((p & 8191) === 0) progress.tick('extract', 0.5 + 0.3 * p / nCollapse)
    const e = order[p]
    const a = dset.find(collapseA[e]), b = dset.find(collapseB[e])
    if (a === b) continue
    const la = adjFine[a], lb = adjFine[b]
    const hasA = la !== undefined && la.length > 0, hasB = lb !== undefined && lb.length > 0
    if (hasA) {
      let contained = false
      for (let k = 0; k < la.length; k++) if (dset.find(la[k]) === b) { contained = true; break }
      if (contained) continue
    }
    let merged: number[] | undefined
    if (hasA || hasB) {
      merged = []
      if (hasA) for (let k = 0; k < la.length; k++) merged.push(dset.find(la[k]))
      if (hasB) for (let k = 0; k < lb.length; k++) merged.push(dset.find(lb[k]))
      sortedUnique(merged)
    }
    const ra = rank[a], rb = rank[b]
    const target = ra > rb ? a : b
    adjFine[a] = undefined
    adjFine[b] = undefined
    adjFine[target] = merged
    nCollapses[target] = nCollapses[a] + nCollapses[b] + 1
    if (ra > rb) parent[b] = a
    else {
      parent[a] = b
      if (ra === rb) rank[b] = rb + 1
    }
  }

  // Step 3: the clusters that kept an edge are the vertices.
  const vertexMap = new Int32Array(n).fill(-1)
  const adj: number[][] = []
  const collapses: number[] = []
  let total = 0
  for (let i = 0; i < n; i++) {
    const list = adjFine[i]
    if (list === undefined || list.length === 0) continue
    vertexMap[i] = adj.length
    adj.push(list)
    collapses.push(nCollapses[i])
    total += nCollapses[i]
  }
  const nV = adj.length
  const average = nV > 0 ? total / nV : 0
  for (let i = 0; i < nV; i++) {
    const list = adj[i]
    let m = 0
    for (let k = 0; k < list.length; k++) {
      const v = vertexMap[dset.find(list[k])]
      if (v >= 0 && v !== i) list[m++] = v
    }
    list.length = m
    sortedUnique(list)
  }
  // Step 3a: remove spurious vertices.
  for (let i = 0; i < nV; i++) {
    if (collapses[i] > average / 10) continue
    for (const nb of adj[i]) removeValue(adj[nb], i)
    adj[i] = []
  }

  // Step 4: positions and normals of the vertices.
  const O = new Float64Array(nV * 3), N = new Float64Array(nV * 3)
  const crease = new Uint8Array(nV)
  const clusterWeight = new Float64Array(nV)
  const hasCO = level.COw.length > 0
  {
    const fo = level.O, fv = level.V, fn = level.N, cow = level.COw
    const k9 = invScale * invScale * 9
    for (let i = 0; i < n; i++) {
      if ((i & TICK_MASK) === 0) progress.tick('extract', 0.8 + 0.05 * i / n)
      const j = vertexMap[dset.find(i)]
      if (j < 0) continue
      const i3 = 3 * i
      const dx = fo[i3] - fv[i3], dy = fo[i3 + 1] - fv[i3 + 1], dz = fo[i3 + 2] - fv[i3 + 2]
      const w = Math.exp(-(dx * dx + dy * dy + dz * dz) * k9)
      if ((hasCO && cow[i] !== 0) || creaseIn[i]) crease[j] = 1
      O[3 * j] += fo[i3] * w; O[3 * j + 1] += fo[i3 + 1] * w; O[3 * j + 2] += fo[i3 + 2] * w
      N[3 * j] += fn[i3] * w; N[3 * j + 1] += fn[i3 + 1] * w; N[3 * j + 2] += fn[i3 + 2] * w
      clusterWeight[j] += w
    }
    for (let j = 0; j < nV; j++) {
      const w = clusterWeight[j]
      if (w === 0) continue
      O[3 * j] /= w; O[3 * j + 1] /= w; O[3 * j + 2] /= w
      const len = Math.hypot(N[3 * j], N[3 * j + 1], N[3 * j + 2])
      if (len > 0) { N[3 * j] /= len; N[3 * j + 1] /= len; N[3 * j + 2] /= len }
    }
  }
  progress.tick('extract', 0.85)

  // Step 5: snap vertices onto the edges they lie on and remove the diagonals of quads.
  const dist = (a: number, b: number): number =>
    Math.hypot(O[3 * a] - O[3 * b], O[3 * a + 1] - O[3 * b + 1], O[3 * a + 2] - O[3 * b + 2])
  const heightOf = (i: number, j: number, k: number): number => {
    const a = dist(j, k), b = dist(i, j), c = dist(i, k)
    const s = 0.5 * (a + b + c)
    return 2 * Math.sqrt(s * (s - a) * (s - b) * (s - c)) / a
  }
  const thresh = 0.3 * scale
  let changed: boolean
  let rounds = 0
  do {
    changed = false
    let changedInner: boolean
    do {
      changedInner = false
      const ch: number[] = [], ci: number[] = [], cj: number[] = [], ck: number[] = []
      for (let i = 0; i < nV; i++) {
        const ai = adj[i]
        for (let jj = 0; jj < ai.length; jj++) {
          const j = ai[jj], aj = adj[j]
          const b = dist(i, j)
          for (let kk = 0; kk < aj.length; kk++) {
            const k = aj[kk]
            if (k === i) continue
            const a = dist(j, k), c = dist(i, k)
            if (a > Math.max(b, c)) {
              const s = 0.5 * (a + b + c)
              const height = 2 * Math.sqrt(s * (s - a) * (s - b) * (s - c)) / a
              if (height < thresh) { ch.push(height); ci.push(i); cj.push(j); ck.push(k) }
            }
          }
        }
      }
      const idx = ch.map((_, q) => q).sort((x, y) => ch[x] - ch[y])
      for (const q of idx) {
        const i = ci[q], j = cj[q], k = ck[q]
        const edge1 = adj[i].includes(j), edge2 = adj[j].includes(k), edge3 = adj[k].includes(i)
        if (!edge1 || !edge2) continue
        if (heightOf(i, j, k) !== ch[q]) continue
        const dij = dist(i, j), dik = dist(i, k)
        if (dij < thresh || dik < thresh) {
          const merge = dij < thresh ? j : k
          for (let c = 0; c < 3; c++) {
            O[3 * i + c] = (O[3 * i + c] + O[3 * merge + c]) * 0.5
            N[3 * i + c] = (N[3 * i + c] + N[3 * merge + c]) * 0.5
          }
          const updated: number[] = []
          for (const nb of adj[merge]) {
            if (nb === i) continue
            updated.push(nb)
            const list = adj[nb]
            // The original renames merge → i in place, which can list i twice; keep one.
            if (list.includes(i)) removeValue(list, merge)
            else for (let c = 0; c < list.length; c++) if (list[c] === merge) list[c] = i
          }
          for (const nb of adj[i]) updated.push(nb)
          sortedUnique(updated)
          removeValue(updated, i)
          removeValue(updated, merge)
          adj[merge] = []
          adj[i] = updated
          if (crease[merge]) { crease[merge] = 0; crease[i] = 1 }
        } else {
          let nx = N[3 * j] + N[3 * k], ny = N[3 * j + 1] + N[3 * k + 1], nz = N[3 * j + 2] + N[3 * k + 2]
          const len = Math.hypot(nx, ny, nz)
          if (len > 0) { nx /= len; ny /= len; nz /= len }
          for (let c = 0; c < 3; c++) O[3 * i + c] = (O[3 * j + c] + O[3 * k + c]) * 0.5
          N[3 * i] = nx; N[3 * i + 1] = ny; N[3 * i + 2] = nz
          if (crease[j] && crease[k]) crease[i] = 1
          removeValue(adj[j], k)
          removeValue(adj[k], j)
          if (!edge3) {
            adj[i].push(k)
            adj[k].push(i)
          }
        }
        changed = true
        changedInner = true
      }
    } while (changedInner && ++rounds < 200)

    {
      const cs: number[] = [], ci: number[] = [], cj: number[] = []
      for (let i = 0; i < nV; i++) {
        const ai = adj[i]
        for (let jj = 0; jj < ai.length; jj++) {
          const j = ai[jj], aj = adj[j]
          let nTris = 0, length = 0
          for (let kk = 0; kk < ai.length; kk++) {
            const k = ai[kk]
            if (k === j || !aj.includes(k)) continue
            nTris++
            length += dist(k, i) + dist(k, j)
          }
          if (nTris === 2) {
            const expected = length / 4 * Math.SQRT2
            const diag = dist(i, j)
            cs.push(Math.abs((diag - expected) / Math.min(diag, expected)))
            ci.push(i)
            cj.push(j)
          }
        }
      }
      const idx = cs.map((_, q) => q).sort((x, y) => cs[x] - cs[y])
      for (const q of idx) {
        const i = ci[q], j = cj[q]
        // (The original does not look whether the edge is still there, and so counts a removal twice.)
        if (!adj[i].includes(j)) continue
        const ai = adj[i], aj = adj[j]
        let nTris = 0
        for (let kk = 0; kk < ai.length; kk++) if (aj.includes(ai[kk])) nTris++
        if (nTris === 2) {
          removeValue(adj[i], j)
          removeValue(adj[j], i)
          changed = true
        }
      }
    }
  } while (changed && ++rounds < 200)

  // Step 6: order each vertex's edges around its normal.
  const frame = new Float64Array(6)
  for (let i = 0; i < nV; i++) {
    const list = adj[i]
    if (list.length < 2) continue
    coordinateSystem(N[3 * i], N[3 * i + 1], N[3 * i + 2], frame)
    const angles = new Map<number, number>()
    for (const j of list) {
      const vx = O[3 * j] - O[3 * i], vy = O[3 * j + 1] - O[3 * i + 1], vz = O[3 * j + 2] - O[3 * i + 2]
      angles.set(j, Math.atan2(frame[3] * vx + frame[4] * vy + frame[5] * vz, frame[0] * vx + frame[1] * vy + frame[2] * vz))
    }
    list.sort((a, b) => angles.get(b)! - angles.get(a)! || a - b)
  }
  return { adj, O, N, crease, nV }
}

/** A uniform grid over the scan's triangles, for the short rays of the reprojection. */
export class RayGrid {
  private readonly min = [0, 0, 0]
  private readonly dims = [1, 1, 1]
  private readonly cell: number
  private readonly start: Uint32Array
  private readonly items: Uint32Array
  constructor(private readonly V: Float64Array, private readonly F: Uint32Array, nF: number, cell: number, tick: Tick = noTick) {
    const max = [-Infinity, -Infinity, -Infinity], min = [Infinity, Infinity, Infinity]
    for (let f = 0; f < nF * 3; f++) {
      const v = 3 * F[f]
      for (let c = 0; c < 3; c++) {
        if (V[v + c] < min[c]) min[c] = V[v + c]
        if (V[v + c] > max[c]) max[c] = V[v + c]
      }
    }
    if (nF === 0) { min.fill(0); max.fill(0) }
    const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
    const cells = (s: number): number => (Math.floor(ext[0] / s) + 1) * (Math.floor(ext[1] / s) + 1) * (Math.floor(ext[2] / s) + 1)
    while (!(cells(cell) <= 2_000_000)) cell *= 1.26
    this.cell = cell
    for (let c = 0; c < 3; c++) { this.min[c] = min[c]; this.dims[c] = Math.floor(ext[c] / cell) + 1 }
    const [dx, dy] = this.dims
    const nCells = dx * dy * this.dims[2]
    const start = new Uint32Array(nCells + 1)
    const range = new Int32Array(6)
    const span = (f: number): void => {
      const a = 3 * F[3 * f], b = 3 * F[3 * f + 1], c = 3 * F[3 * f + 2]
      for (let k = 0; k < 3; k++) {
        const lo = Math.min(V[a + k], V[b + k], V[c + k]), hi = Math.max(V[a + k], V[b + k], V[c + k])
        range[k] = Math.floor((lo - min[k]) / cell)
        range[k + 3] = Math.floor((hi - min[k]) / cell)
      }
    }
    for (let f = 0; f < nF; f++) {
      if ((f & TICK_MASK) === 0) tick(0.5 * f / nF)
      span(f)
      for (let z = range[2]; z <= range[5]; z++)
        for (let y = range[1]; y <= range[4]; y++)
          for (let x = range[0]; x <= range[3]; x++) start[(z * dy + y) * dx + x + 1]++
    }
    for (let c = 0; c < nCells; c++) start[c + 1] += start[c]
    const items = new Uint32Array(start[nCells])
    const fill = start.slice(0, nCells)
    for (let f = 0; f < nF; f++) {
      if ((f & TICK_MASK) === 0) tick(0.5 + 0.5 * f / nF)
      span(f)
      for (let z = range[2]; z <= range[5]; z++)
        for (let y = range[1]; y <= range[4]; y++)
          for (let x = range[0]; x <= range[3]; x++) items[fill[(z * dy + y) * dx + x]++] = f
    }
    this.start = start
    this.items = items
  }

  /** The nearest hit of the ray o + t d (d unit) with 0 ≤ t ≤ maxT, or Infinity. */
  intersect(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    const { V, F, min, dims, cell, start, items } = this
    const ex = ox + dx * maxT, ey = oy + dy * maxT, ez = oz + dz * maxT
    const x0 = Math.max(0, Math.floor((Math.min(ox, ex) - min[0]) / cell)), x1 = Math.min(dims[0] - 1, Math.floor((Math.max(ox, ex) - min[0]) / cell))
    const y0 = Math.max(0, Math.floor((Math.min(oy, ey) - min[1]) / cell)), y1 = Math.min(dims[1] - 1, Math.floor((Math.max(oy, ey) - min[1]) / cell))
    const z0 = Math.max(0, Math.floor((Math.min(oz, ez) - min[2]) / cell)), z1 = Math.min(dims[2] - 1, Math.floor((Math.max(oz, ez) - min[2]) / cell))
    let best = Infinity
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const c = (z * dims[1] + y) * dims[0] + x
          for (let q = start[c], e = start[c + 1]; q < e; q++) {
            const f = 3 * items[q]
            const a = 3 * F[f], b = 3 * F[f + 1], cc = 3 * F[f + 2]
            // Möller–Trumbore
            const e1x = V[b] - V[a], e1y = V[b + 1] - V[a + 1], e1z = V[b + 2] - V[a + 2]
            const e2x = V[cc] - V[a], e2y = V[cc + 1] - V[a + 1], e2z = V[cc + 2] - V[a + 2]
            const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
            const det = e1x * px + e1y * py + e1z * pz
            if (det > -1e-14 && det < 1e-14) continue
            const inv = 1 / det
            const tx = ox - V[a], ty = oy - V[a + 1], tz = oz - V[a + 2]
            const u = (tx * px + ty * py + tz * pz) * inv
            if (u < 0 || u > 1) continue
            const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
            const v = (dx * qx + dy * qy + dz * qz) * inv
            if (v < 0 || u + v > 1) continue
            const t = (e2x * qx + e2y * qy + e2z * qz) * inv
            if (t >= 0 && t <= maxT && t < best) best = t
          }
        }
      }
    }
    return best
  }
}

/** The unit eigenvector of the smallest eigenvalue of a symmetric 3 × 3 matrix (cyclic Jacobi). Written to out. */
function smallestEigenvector(
  a00: number, a01: number, a02: number, a11: number, a12: number, a22: number, out: Float64Array,
): void {
  const a = [a00, a01, a02, a01, a11, a12, a02, a12, a22]
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  for (let sweep = 0; sweep < 12; sweep++) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5])
    if (off < 1e-300 || off <= 1e-15 * (Math.abs(a[0]) + Math.abs(a[4]) + Math.abs(a[8]))) break
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[3 * p + q]
        if (apq === 0) continue
        const theta = (a[3 * q + q] - a[3 * p + p]) / (2 * apq)
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1), s = t * c
        for (let k = 0; k < 3; k++) {
          const akp = a[3 * k + p], akq = a[3 * k + q]
          a[3 * k + p] = c * akp - s * akq
          a[3 * k + q] = s * akp + c * akq
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[3 * p + k], aqk = a[3 * q + k]
          a[3 * p + k] = c * apk - s * aqk
          a[3 * q + k] = s * apk + c * aqk
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[3 * k + p], vkq = v[3 * k + q]
          v[3 * k + p] = c * vkp - s * vkq
          v[3 * k + q] = s * vkp + c * vkq
        }
      }
    }
  }
  let m = 0
  if (a[4] < a[m * 4]) m = 1
  if (a[8] < a[m * 4]) m = 2
  const x = v[m], y = v[3 + m], z = v[6 + m]
  const len = Math.hypot(x, y, z) || 1
  out[0] = x / len; out[1] = y / len; out[2] = z / len
}

export interface Extracted {
  positions: Float64Array
  normals: Float64Array
  /** Four vertices per quad. */
  quads: Uint32Array
  nV: number
  nQ: number
  /** How many faces of each number of sides the graph had (index = sides), holes that were filled included. */
  faceSides: number[]
  /** The sides of the holes that were left open (seven or more). */
  openHoles: number[]
}

/**
 * extract_faces(): faces of the graph, small holes filled, everything
 * subdivided once into pure quads; then `smooth` rounds of smoothing and
 * reprojection onto the scan.
 */
export function extractFaces(
  graph: Graph, scale: number, smooth: number, grid: RayGrid | null, progress: Progress, preserveOpenings = false,
): Extracted {
  const nVOld = graph.nV
  let ids = graph.adj
  let flags: Uint8Array[] = ids.map(list => new Uint8Array(list.length))
  let O = graph.O, N = graph.N, crease = graph.crease
  let nV = nVOld

  // The walk around one face: from `cur` along its link `curIdx`, always taking the next link around the vertex reached.
  const walk: number[] = []
  const extractFace = (cur: number, curIdx: number, targetSize: number): boolean => {
    const initial = cur
    let success = false
    walk.length = 0
    for (;;) {
      if ((flags[cur][curIdx] & 1) !== 0 || (targetSize > 0 && walk.length / 2 + 1 > targetSize)) break
      walk.push(cur, curIdx)
      const next = ids[cur][curIdx]
      const list = ids[next], rank = list.length
      const idx = list.indexOf(cur)
      if (idx < 0 || rank === 1) break
      cur = next
      curIdx = (idx + 1) % rank
      if (cur === initial) {
        success = targetSize === 0 || walk.length / 2 === targetSize
        break
      }
    }
    if (success) for (let k = 0; k < walk.length; k += 2) flags[walk[k]][walk[k + 1]] |= 1
    else walk.length = 0
    return success
  }

  const polys: number[][] = []
  const faceSides: number[] = [], openHoles: number[] = []
  const angleAt = (a: number, b: number, c: number): number => {
    let d0x = O[3 * a] - O[3 * b], d0y = O[3 * a + 1] - O[3 * b + 1], d0z = O[3 * a + 2] - O[3 * b + 2]
    let d1x = O[3 * c] - O[3 * b], d1y = O[3 * c + 1] - O[3 * b + 1], d1z = O[3 * c + 2] - O[3 * b + 2]
    const l0 = Math.hypot(d0x, d0y, d0z), l1 = Math.hypot(d1x, d1y, d1z)
    d0x /= l0; d0y /= l0; d0z /= l0; d1x /= l1; d1y /= l1; d1z /= l1
    return Math.acos(d0x * d1x + d0y * d1y + d0z * d1z) * 180 / Math.PI
  }
  /** fill_face(): a quad as it is; a triangle or pentagon as a fan (kept whole here); larger faces cut into quads. */
  const fillFace = (verts: number[]): void => {
    // A short cycle around a bore or an open tube can look exactly like a face
    // in the field graph. Check its interior against the input before capping it.
    if (preserveOpenings && grid && verts.every(v => crease[v])) {
      let x = 0, y = 0, z = 0, nx = 0, ny = 0, nz = 0
      const first = 3 * verts[0]
      for (let i = 0; i < verts.length; i++) {
        const a = 3 * verts[i], b = 3 * verts[(i + 1) % verts.length]
        x += O[a]; y += O[a+1]; z += O[a+2]
        const ax = O[a]-O[first], ay = O[a+1]-O[first+1], az = O[a+2]-O[first+2]
        const bx = O[b]-O[first], by = O[b+1]-O[first+1], bz = O[b+2]-O[first+2]
        nx += ay*bz-az*by; ny += az*bx-ax*bz; nz += ax*by-ay*bx
      }
      const length = Math.hypot(nx, ny, nz)
      if (length > 0) {
        nx /= length; ny /= length; nz /= length
        x /= verts.length; y /= verts.length; z /= verts.length
        if (!Number.isFinite(grid.intersect(x,y,z,nx,ny,nz,scale/2)) &&
            !Number.isFinite(grid.intersect(x,y,z,-nx,-ny,-nz,scale/2))) return
      }
    }
    while (verts.length > 2) {
      const m = verts.length
      if (m === 4 || m === 3 || m === 5) {
        polys.push(verts.slice())
        break
      }
      let bestScore = Infinity, bestIdx = -1
      for (let i = 0; i < m; i++) {
        let score = 0
        for (let k = 0; k < 4; k++) score += Math.abs(angleAt(verts[(i + k) % m], verts[(i + k + 1) % m], verts[(i + k + 2) % m]) - 90)
        if (score < bestScore) { bestScore = score; bestIdx = i }
      }
      if (bestIdx < 0) bestIdx = 0
      polys.push([verts[bestIdx], verts[(bestIdx + 1) % m], verts[(bestIdx + 2) % m], verts[(bestIdx + 3) % m]])
      const drop1 = (bestIdx + 1) % m, drop2 = (bestIdx + 2) % m
      verts = verts.filter((_, k) => k !== drop1 && k !== drop2)
    }
  }
  const walkVertices = (): number[] => {
    const verts: number[] = []
    for (let k = 0; k < walk.length; k += 2) verts.push(walk[k])
    return verts
  }

  // Step 7: faces of 3 to 8 sides.
  for (let deg = 3; deg <= 8; deg++) {
    for (let i = 0; i < nVOld; i++) {
      for (let j = 0; j < ids[i].length; j++) {
        if (!extractFace(i, j, deg)) continue
        faceSides[deg] = (faceSides[deg] ?? 0) + 1
        fillFace(walkVertices())
      }
    }
  }
  progress.tick('extract', 0.92)

  // Step 8: the loops left over are holes; those of fewer than seven sides are filled.
  for (let i = 0; i < nVOld; i++) {
    for (let j = 0; j < ids[i].length; j++) {
      if ((flags[i][j] & 1) !== 0) continue
      const other = ids[i][j]
      const k = ids[other].indexOf(i)
      if (k >= 0 && (flags[other][k] & 1) !== 0) {
        flags[i][j] |= 2
        flags[other][k] |= 2
      }
    }
  }
  {
    const keptIds: number[][] = [], keptFlags: Uint8Array[] = []
    for (let i = 0; i < nVOld; i++) {
      const list: number[] = [], fl: number[] = []
      for (let j = 0; j < ids[i].length; j++) if ((flags[i][j] & 2) !== 0) { list.push(ids[i][j]); fl.push(flags[i][j]) }
      keptIds.push(list)
      keptFlags.push(Uint8Array.from(fl))
    }
    ids = keptIds
    flags = keptFlags
  }
  for (let i = 0; i < nVOld; i++) {
    for (let j = 0; j < ids[i].length; j++) {
      if (!extractFace(i, j, 0)) continue
      const sides = walk.length / 2
      if (sides >= 7) { openHoles.push(sides); continue }
      faceSides[sides] = (faceSides[sides] ?? 0) + 1
      fillFace(walkVertices())
    }
  }

  // Step 9: one regular subdivision: a centre per face, a midpoint per edge, a quad per corner.
  const quads: number[] = []
  const midpoints = new Map<number, number>()
  const addVertex = (): number => {
    const v = nV++
    if (nV * 3 > O.length) {
      O = growF64(O, nV * 3)
      N = growF64(N, nV * 3)
      crease = growU8(crease, nV)
    }
    return v
  }
  const midpoint = (a: number, b: number): number => {
    const key = a < b ? a * 0x4000000 + b : b * 0x4000000 + a
    let v = midpoints.get(key)
    if (v !== undefined) return v
    v = addVertex()
    let nx = N[3 * a] + N[3 * b], ny = N[3 * a + 1] + N[3 * b + 1], nz = N[3 * a + 2] + N[3 * b + 2]
    const len = Math.hypot(nx, ny, nz)
    if (len > 0) { nx /= len; ny /= len; nz /= len }
    O[3 * v] = (O[3 * a] + O[3 * b]) * 0.5; O[3 * v + 1] = (O[3 * a + 1] + O[3 * b + 1]) * 0.5; O[3 * v + 2] = (O[3 * a + 2] + O[3 * b + 2]) * 0.5
    N[3 * v] = nx; N[3 * v + 1] = ny; N[3 * v + 2] = nz
    crease[v] = crease[a] && crease[b] ? 1 : 0
    midpoints.set(key, v)
    return v
  }
  for (const poly of polys) {
    const m = poly.length
    let degenerate = false
    for (let k = 0; k < m && !degenerate; k++) for (let l = k + 1; l < m; l++) if (poly[k] === poly[l]) { degenerate = true; break }
    if (degenerate) continue
    const centre = addVertex()
    let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0, allCrease = m === 4
    for (const v of poly) {
      cx += O[3 * v]; cy += O[3 * v + 1]; cz += O[3 * v + 2]
      nx += N[3 * v]; ny += N[3 * v + 1]; nz += N[3 * v + 2]
      if (!crease[v]) allCrease = false
    }
    const len = Math.hypot(nx, ny, nz)
    if (len > 0) { nx /= len; ny /= len; nz /= len }
    O[3 * centre] = cx / m; O[3 * centre + 1] = cy / m; O[3 * centre + 2] = cz / m
    N[3 * centre] = nx; N[3 * centre + 1] = ny; N[3 * centre + 2] = nz
    crease[centre] = allCrease ? 1 : 0
    const mids: number[] = []
    for (let k = 0; k < m; k++) mids.push(midpoint(poly[k], poly[(k + 1) % m]))
    for (let k = 0; k < m; k++) quads.push(mids[k], poly[(k + 1) % m], mids[(k + 1) % m], centre)
  }
  const nQ = quads.length / 4
  progress.report('smooth', 0)

  // Step 10: smoothing and reprojection.
  if (smooth > 0 && nQ > 0) {
    const pairsA: number[] = [], pairsB: number[] = []
    const seen = new Set<number>()
    for (let q = 0; q < nQ; q++) {
      for (let k = 0; k < 4; k++) {
        const a = quads[4 * q + k], b = quads[4 * q + (k + 1) % 4]
        if (a === b) continue
        const key = a < b ? a * 0x4000000 + b : b * 0x4000000 + a
        if (seen.has(key)) continue
        seen.add(key)
        pairsA.push(a)
        pairsB.push(b)
      }
    }
    const start = new Uint32Array(nV + 1)
    for (let e = 0; e < pairsA.length; e++) { start[pairsA[e] + 1]++; start[pairsB[e] + 1]++ }
    for (let v = 0; v < nV; v++) start[v + 1] += start[v]
    const fill = start.slice(0, nV)
    const nb = new Uint32Array(start[nV])
    for (let e = 0; e < pairsA.length; e++) { nb[fill[pairsA[e]]++] = pairsB[e]; nb[fill[pairsB[e]]++] = pairsA[e] }
    const axis = new Float64Array(3)
    for (let it = 0; it < smooth; it++) {
      const O2 = new Float64Array(nV * 3), N2 = new Float64Array(nV * 3)
      for (let i = 0; i < nV; i++) {
        if ((i & 255) === 0) progress.tick('smooth', (it + i / nV) / smooth)
        const b = start[i], e = start[i + 1]
        if (e === b || crease[i]) {
          O2[3 * i] = O[3 * i]; O2[3 * i + 1] = O[3 * i + 1]; O2[3 * i + 2] = O[3 * i + 2]
          N2[3 * i] = N[3 * i]; N2[3 * i + 1] = N[3 * i + 1]; N2[3 * i + 2] = N[3 * i + 2]
          continue
        }
        let cx = 0, cy = 0, cz = 0, ax = N[3 * i], ay = N[3 * i + 1], az = N[3 * i + 2]
        for (let q = b; q < e; q++) {
          const j = 3 * nb[q]
          cx += O[j]; cy += O[j + 1]; cz += O[j + 2]
          ax += N[j]; ay += N[j + 1]; az += N[j + 2]
        }
        const inv = 1 / (e - b)
        cx *= inv; cy *= inv; cz *= inv
        let c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0
        for (let q = b; q < e; q++) {
          const j = 3 * nb[q]
          const dx = O[j] - cx, dy = O[j + 1] - cy, dz = O[j + 2] - cz
          c00 += dx * dx; c01 += dx * dy; c02 += dx * dz; c11 += dy * dy; c12 += dy * dz; c22 += dz * dz
        }
        smallestEigenvector(c00, c01, c02, c11, c12, c22, axis)
        let nx = axis[0], ny = axis[1], nz = axis[2]
        if (ax * nx + ay * ny + az * nz < 0) { nx = -nx; ny = -ny; nz = -nz }
        if (grid) {
          const t1 = grid.intersect(cx, cy, cz, nx, ny, nz, scale / 2)
          const t2 = grid.intersect(cx, cy, cz, -nx, -ny, -nz, scale / 2)
          if (Math.min(t1, t2) < scale * 0.5) {
            const t = t1 < t2 ? t1 : -t2
            cx += nx * t; cy += ny * t; cz += nz * t
          }
        }
        O2[3 * i] = cx; O2[3 * i + 1] = cy; O2[3 * i + 2] = cz
        N2[3 * i] = nx; N2[3 * i + 1] = ny; N2[3 * i + 2] = nz
      }
      O = O2
      N = N2
    }
  }
  progress.report('smooth', 1)
  return { positions: O.subarray(0, nV * 3), normals: N.subarray(0, nV * 3), quads: Uint32Array.from(quads), nV, nQ, faceSides, openHoles }
}
