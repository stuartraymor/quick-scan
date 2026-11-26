// SPDX-License-Identifier: AGPL-3.0-only
// Part of a TypeScript port of Instant Meshes ("Instant Field-Aligned Meshes").
// Copyright (c) 2015 Wenzel Jakob, Daniele Panozzo, Marco Tarini, and Olga Sorkine-Hornung
// (BSD-3-Clause; the licence text is in ATTRIBUTION.md).
//
// Mesh preparation: dedge.cpp (directed edges), meshstats.cpp (statistics and
// dual vertex areas), subdivide.cpp (splitting edges that are too long for
// the field), adjacency.cpp (uniform weights) and normal.cpp (smooth and
// crease normals), for triangle meshes.

import { INVALID, RCPOVERFLOW, TICK_MASK, growF64, growU32, growU8, noTick, sortU32Keys } from './util'
import type { Tick } from './util'

export interface Dedge {
  /** Per vertex: a directed edge leaving it (the first boundary one, when on the rim), or INVALID. */
  V2E: Uint32Array
  /** Per directed edge 3f+i (from F[3f+i] to F[3f+(i+1)%3]): the opposite one, or INVALID. */
  E2E: Uint32Array
  boundary: Uint8Array
  nonManifold: Uint8Array
}

const prev3 = (e: number): number => (e % 3 === 0 ? e + 2 : e - 1)
const next3 = (e: number): number => (e % 3 === 2 ? e - 2 : e + 1)

export function buildDedge(F: Uint32Array, nF: number, nV: number, tick: Tick = noTick): Dedge {
  const V2E = new Uint32Array(nV).fill(INVALID)
  const nE = nF * 3
  const tmpFirst = new Uint32Array(nE)
  const tmpSecond = new Uint32Array(nE).fill(INVALID)
  const tail = new Uint32Array(nV)
  for (let f = 0; f < nF; f++) {
    if ((f & TICK_MASK) === 0) tick(0.3 * f / nF)
    for (let i = 0; i < 3; i++) {
      const cur = F[3 * f + i], next = F[3 * f + (i + 1) % 3], e = 3 * f + i
      if (cur >= nV || next >= nV) throw new Error('instantQuads: the mesh refers to a vertex that does not exist')
      if (cur === next) continue
      tmpFirst[e] = next
      if (V2E[cur] === INVALID) V2E[cur] = e
      else tmpSecond[tail[cur]] = e
      tail[cur] = e
    }
  }
  const nonManifold = new Uint8Array(nV)
  const E2E = new Uint32Array(nE).fill(INVALID)
  for (let f = 0; f < nF; f++) {
    if ((f & TICK_MASK) === 0) tick(0.3 + 0.5 * f / nF)
    for (let i = 0; i < 3; i++) {
      const cur = F[3 * f + i], next = F[3 * f + (i + 1) % 3], e = 3 * f + i
      if (cur === next) continue
      let it = V2E[next], opp = INVALID
      while (it !== INVALID) {
        if (tmpFirst[it] === cur) {
          if (opp === INVALID) opp = it
          else {
            nonManifold[cur] = 1
            nonManifold[next] = 1
            opp = INVALID
            break
          }
        }
        it = tmpSecond[it]
      }
      if (opp !== INVALID && e < opp) {
        E2E[e] = opp
        E2E[opp] = e
      }
    }
  }
  const boundary = new Uint8Array(nV)
  for (let i = 0; i < nV; i++) {
    if ((i & TICK_MASK) === 0) tick(0.8 + 0.2 * i / nV)
    let edge = V2E[i]
    if (edge === INVALID) continue
    if (nonManifold[i]) { V2E[i] = INVALID; continue }
    // Walk backwards to the first boundary edge, if there is one.
    const start = edge
    let v2e = INVALID, guard = 0
    do {
      if (edge < v2e) v2e = edge
      const prevEdge = E2E[prev3(edge)]
      if (prevEdge === INVALID) {
        v2e = edge
        boundary[i] = 1
        break
      }
      edge = prevEdge
      if (++guard > nE) { nonManifold[i] = 1; v2e = INVALID; break }
    } while (edge !== start)
    V2E[i] = v2e
  }
  return { V2E, E2E, boundary, nonManifold }
}

export interface MeshStats { surfaceArea: number; averageEdgeLength: number; maximumEdgeLength: number }

export function meshStats(F: Uint32Array, nF: number, V: Float64Array): MeshStats {
  let area = 0, sum = 0, max = 0
  for (let f = 0; f < nF; f++) {
    const a = 3 * F[3 * f], b = 3 * F[3 * f + 1], c = 3 * F[3 * f + 2]
    const ax = V[a], ay = V[a + 1], az = V[a + 2]
    const ux = V[b] - ax, uy = V[b + 1] - ay, uz = V[b + 2] - az
    const vx = V[c] - ax, vy = V[c + 1] - ay, vz = V[c + 2] - az
    const wx = vx - ux, wy = vy - uy, wz = vz - uz
    const l0 = Math.sqrt(ux * ux + uy * uy + uz * uz)
    const l1 = Math.sqrt(wx * wx + wy * wy + wz * wz)
    const l2 = Math.sqrt(vx * vx + vy * vy + vz * vz)
    sum += l0 + l1 + l2
    if (l0 > max) max = l0
    if (l1 > max) max = l1
    if (l2 > max) max = l2
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
    area += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz)
  }
  return { surfaceArea: area, averageEdgeLength: nF > 0 ? sum / (nF * 3) : 0, maximumEdgeLength: max }
}

/** A max-heap of (edge, squared length); ties go to the smaller edge, so the order is fixed. */
class EdgeHeap {
  private ids: Uint32Array = new Uint32Array(1024)
  private keys: Float64Array = new Float64Array(1024)
  size = 0
  private before(i: number, j: number): boolean {
    const a = this.keys[i], b = this.keys[j]
    return a > b || (a === b && this.ids[i] < this.ids[j])
  }
  private swap(i: number, j: number): void {
    const id = this.ids[i]; this.ids[i] = this.ids[j]; this.ids[j] = id
    const k = this.keys[i]; this.keys[i] = this.keys[j]; this.keys[j] = k
  }
  push(id: number, key: number): void {
    if (this.size === this.ids.length) {
      this.ids = growU32(this.ids, this.size + 1)
      this.keys = growF64(this.keys, this.size + 1)
    }
    let i = this.size++
    this.ids[i] = id
    this.keys[i] = key
    while (i > 0) {
      const p = (i - 1) >> 1
      if (!this.before(i, p)) break
      this.swap(i, p)
      i = p
    }
  }
  topId = 0
  topKey = 0
  pop(): void {
    this.topId = this.ids[0]
    this.topKey = this.keys[0]
    const n = --this.size
    if (n === 0) return
    this.ids[0] = this.ids[n]
    this.keys[0] = this.keys[n]
    let i = 0
    for (;;) {
      const l = 2 * i + 1, r = l + 1
      let m = i
      if (l < n && this.before(l, m)) m = l
      if (r < n && this.before(r, m)) m = r
      if (m === i) break
      this.swap(i, m)
      i = m
    }
  }
}

export interface TriMesh { F: Uint32Array; nF: number; V: Float64Array; nV: number }

/** subdivide(): split every edge longer than maxLength at its midpoint, longest first. New vertices are appended. */
export function subdivide(mesh: TriMesh, dedge: Dedge, maxLength: number, tick: Tick = noTick): TriMesh {
  let { F, V } = mesh
  let nF = mesh.nF, nV = mesh.nV
  let E2E = dedge.E2E
  let nonManifold = dedge.nonManifold
  const max2 = maxLength * maxLength
  const heap = new EdgeHeap()
  const len2 = (a: number, b: number): number => {
    const dx = V[3 * a] - V[3 * b], dy = V[3 * a + 1] - V[3 * b + 1], dz = V[3 * a + 2] - V[3 * b + 2]
    return dx * dx + dy * dy + dz * dz
  }
  for (let i = 0; i < nF * 3; i++) {
    const f = (i / 3) | 0, k = i - 3 * f
    const v0 = F[i], v1 = F[3 * f + (k + 1) % 3]
    if (nonManifold[v0] || nonManifold[v1]) continue
    const length = len2(v0, v1)
    if (length > max2) {
      const other = E2E[i]
      if (other === INVALID || other > i) heap.push(i, length)
    }
  }
  const setE = (a: number, b: number): void => {
    E2E[a] = b
    if (b !== INVALID) E2E[b] = a
  }
  const schedule = (f: number): void => {
    for (let i = 0; i < 3; i++) {
      const length = len2(F[3 * f + i], F[3 * f + (i + 1) % 3])
      if (length > max2) heap.push(3 * f + i, length)
    }
  }
  const queued = heap.size + 1
  let pops = 0
  while (heap.size > 0) {
    // How far along is a guess: each split queues more.
    if ((pops++ & 4095) === 0) tick(pops / (pops + heap.size + queued))
    heap.pop()
    const e0 = heap.topId, e1 = E2E[e0]
    const isBoundary = e1 === INVALID
    const f0 = (e0 / 3) | 0, f1 = isBoundary ? INVALID : (e1 / 3) | 0
    const k0 = e0 - 3 * f0
    const v0 = F[e0], v0p = F[3 * f0 + (k0 + 2) % 3], v1 = F[3 * f0 + (k0 + 1) % 3]
    if (len2(v0, v1) !== heap.topKey) continue
    const v1p = isBoundary ? INVALID : F[3 * f1 + ((e1 - 3 * f1) + 2) % 3]
    const vn = nV++
    if (nV * 3 > V.length) V = growF64(V, nV * 3)
    if (nV > nonManifold.length) nonManifold = growU8(nonManifold, nV)
    V[3 * vn] = (V[3 * v0] + V[3 * v1]) * 0.5
    V[3 * vn + 1] = (V[3 * v0 + 1] + V[3 * v1 + 1]) * 0.5
    V[3 * vn + 2] = (V[3 * v0 + 2] + V[3 * v1 + 2]) * 0.5
    nonManifold[vn] = 0
    const f2 = isBoundary ? INVALID : nF++
    const f3 = nF++
    if (nF * 3 > F.length) {
      F = growU32(F, nF * 3)
      const grown = new Uint32Array(F.length).fill(INVALID)
      grown.set(E2E)
      E2E = grown
    }
    const e0p = E2E[prev3(e0)], e0n = E2E[next3(e0)]
    let e1p = INVALID, e1n = INVALID
    if (!isBoundary) { e1p = E2E[prev3(e1)]; e1n = E2E[next3(e1)] }
    F[3 * f0] = vn; F[3 * f0 + 1] = v0p; F[3 * f0 + 2] = v0
    if (!isBoundary) {
      F[3 * f1] = vn; F[3 * f1 + 1] = v0; F[3 * f1 + 2] = v1p
      F[3 * f2] = vn; F[3 * f2 + 1] = v1p; F[3 * f2 + 2] = v1
    }
    F[3 * f3] = vn; F[3 * f3 + 1] = v1; F[3 * f3 + 2] = v0p
    setE(3 * f0, 3 * f3 + 2)
    setE(3 * f0 + 1, e0p)
    setE(3 * f3 + 1, e0n)
    if (isBoundary) {
      setE(3 * f0 + 2, INVALID)
      setE(3 * f3, INVALID)
    } else {
      setE(3 * f0 + 2, 3 * f1)
      setE(3 * f1 + 1, e1n)
      setE(3 * f1 + 2, 3 * f2)
      setE(3 * f2 + 1, e1p)
      setE(3 * f2 + 2, 3 * f3)
    }
    schedule(f0)
    if (!isBoundary) { schedule(f2); schedule(f1) }
    schedule(f3)
  }
  return { F, nF, V, nV }
}

/**
 * Renumber the vertices along a Z-order curve and the triangles after their
 * first vertex, so that neighbours lie near each other in memory: the
 * solvers' time is mostly cache misses otherwise. Not in the original, which
 * keeps the file's order; the numbering does not enter the method. Returns
 * the mesh and, per old vertex, its new index.
 */
export function reorderForLocality(mesh: TriMesh, tick: Tick = noTick): { mesh: TriMesh; newIndex: Uint32Array } {
  const { F, nF, V, nV } = mesh
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < nV; i++) for (let c = 0; c < 3; c++) {
    const x = V[3 * i + c]
    if (x < min[c]) min[c] = x
    if (x > max[c]) max[c] = x
  }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1e-300)
  const k = 1023.999 / extent
  const spread = (x: number): number => {
    x &= 1023
    x = (x | (x << 16)) & 0x030000ff
    x = (x | (x << 8)) & 0x0300f00f
    x = (x | (x << 4)) & 0x030c30c3
    x = (x | (x << 2)) & 0x09249249
    return x
  }
  const keys = new Uint32Array(nV)
  tick(0.1)
  for (let i = 0; i < nV; i++) {
    keys[i] = (spread((V[3 * i] - min[0]) * k) | (spread((V[3 * i + 1] - min[1]) * k) << 1) | (spread((V[3 * i + 2] - min[2]) * k) << 2)) >>> 0
  }
  tick(0.3)
  const order = sortU32Keys(keys, nV)
  tick(0.5)
  const newIndex = new Uint32Array(nV)
  const V2 = new Float64Array(nV * 3)
  for (let r = 0; r < nV; r++) {
    const old = order[r]
    newIndex[old] = r
    V2[3 * r] = V[3 * old]; V2[3 * r + 1] = V[3 * old + 1]; V2[3 * r + 2] = V[3 * old + 2]
  }
  const first = new Uint32Array(nF)
  for (let f = 0; f < nF; f++) first[f] = Math.min(newIndex[F[3 * f]], newIndex[F[3 * f + 1]], newIndex[F[3 * f + 2]])
  tick(0.7)
  const faceOrder = sortU32Keys(first, nF)
  tick(0.9)
  const F2 = new Uint32Array(nF * 3)
  for (let r = 0; r < nF; r++) {
    const f = faceOrder[r]
    F2[3 * r] = newIndex[F[3 * f]]; F2[3 * r + 1] = newIndex[F[3 * f + 1]]; F2[3 * r + 2] = newIndex[F[3 * f + 2]]
  }
  return { mesh: { F: F2, nF, V: V2, nV }, newIndex }
}

export interface Adjacency { ptr: Uint32Array; id: Uint32Array; weight: Float32Array }

/** generate_adjacency_matrix_uniform(): each vertex's ring, in order, with weight 1. */
export function uniformAdjacency(F: Uint32Array, nV: number, dedge: Dedge, tick: Tick = noTick): Adjacency {
  const { V2E, E2E, nonManifold } = dedge
  const ptr = new Uint32Array(nV + 1)
  const limit = E2E.length + 2
  for (let i = 0; i < nV; i++) {
    if ((i & TICK_MASK) === 0) tick(0.4 * i / nV)
    let edge = V2E[i]
    const stop = edge
    let n = 0
    if (!nonManifold[i] && edge !== INVALID) {
      do {
        const opp = E2E[edge]
        if (opp === INVALID) { n += 2; break }
        edge = next3(opp)
        n++
      } while (edge !== stop && n < limit)
    }
    ptr[i + 1] = ptr[i] + n
  }
  const id = new Uint32Array(ptr[nV])
  for (let i = 0; i < nV; i++) {
    if ((i & TICK_MASK) === 0) tick(0.4 + 0.6 * i / nV)
    let edge = V2E[i]
    const stop = edge
    if (nonManifold[i] || edge === INVALID) continue
    let p = ptr[i], it = 0
    const end = ptr[i + 1]
    do {
      const f = (edge / 3) | 0, base = edge - 3 * f
      const opp = E2E[edge]
      const next = opp === INVALID ? INVALID : next3(opp)
      if (it === 0) id[p++] = F[3 * f + (base + 2) % 3]
      if (opp === INVALID || next !== stop) {
        id[p++] = F[3 * f + (base + 1) % 3]
        if (opp === INVALID) break
      }
      edge = next
      ++it
    } while (edge !== stop && p < end)
  }
  return { ptr, id, weight: new Float32Array(ptr[nV]).fill(1) }
}

function faceNormals(F: Uint32Array, nF: number, V: Float64Array): Float64Array {
  const Nf = new Float64Array(nF * 3)
  for (let f = 0; f < nF; f++) {
    const a = 3 * F[3 * f], b = 3 * F[3 * f + 1], c = 3 * F[3 * f + 2]
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2]
    const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const norm = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (norm < RCPOVERFLOW) { nx = 1; ny = 0; nz = 0 } else { nx /= norm; ny /= norm; nz /= norm }
    Nf[3 * f] = nx; Nf[3 * f + 1] = ny; Nf[3 * f + 2] = nz
  }
  return Nf
}

/**
 * generate_smooth_normals() and, when a crease angle is given,
 * generate_crease_normals(): angle-weighted vertex normals. With creases, a
 * vertex on a crease takes the normal of the fan after its crease edge and is
 * flagged in the returned `crease`.
 */
export function vertexNormals(
  F: Uint32Array, nF: number, V: Float64Array, nV: number, dedge: Dedge, creaseAngle: number | undefined,
  tick: Tick = noTick,
): { N: Float64Array; crease: Uint8Array } {
  const { E2E, boundary, nonManifold } = dedge
  const Nf = faceNormals(F, nF, V)
  const N = new Float64Array(nV * 3)
  const crease = new Uint8Array(nV)
  const withCrease = creaseAngle !== undefined && creaseAngle >= 0
  const dpThreshold = withCrease ? Math.cos(creaseAngle * Math.PI / 180) : -Infinity
  let V2E = dedge.V2E
  const limit = E2E.length + 2
  if (withCrease) {
    V2E = V2E.slice()
    for (let i = 0; i < nV; i++) {
      let edge = V2E[i]
      const stop = edge
      if (nonManifold[i] || edge === INVALID) continue
      let creaseEdge = INVALID, guard = 0
      do {
        const opp = E2E[edge]
        if (opp === INVALID) break
        const nextEdge = next3(opp)
        const fa = 3 * ((edge / 3) | 0), fb = 3 * ((nextEdge / 3) | 0)
        if (Nf[fa] * Nf[fb] + Nf[fa + 1] * Nf[fb + 1] + Nf[fa + 2] * Nf[fb + 2] < dpThreshold) {
          if (creaseEdge === INVALID || creaseEdge < nextEdge) creaseEdge = nextEdge
        }
        edge = nextEdge
      } while (edge !== stop && ++guard < limit)
      if (creaseEdge !== INVALID && !boundary[i]) V2E[i] = creaseEdge
    }
  }
  tick(0.3)
  for (let i = 0; i < nV; i++) {
    if ((i & TICK_MASK) === 0) tick(0.3 + 0.7 * i / nV)
    let edge = V2E[i]
    if (nonManifold[i] || edge === INVALID) { N[3 * i] = 1; continue }
    const stop = edge
    let nx = 0, ny = 0, nz = 0, guard = 0
    const px = V[3 * i], py = V[3 * i + 1], pz = V[3 * i + 2]
    do {
      const f = (edge / 3) | 0, idx = edge - 3 * f
      const a = 3 * F[3 * f + (idx + 1) % 3], b = 3 * F[3 * f + (idx + 2) % 3]
      const d0x = V[a] - px, d0y = V[a + 1] - py, d0z = V[a + 2] - pz
      const d1x = V[b] - px, d1y = V[b + 1] - py, d1z = V[b + 2] - pz
      let c = (d0x * d1x + d0y * d1y + d0z * d1z) /
        Math.sqrt((d0x * d0x + d0y * d0y + d0z * d0z) * (d1x * d1x + d1y * d1y + d1z * d1z))
      if (c > 1) c = 1; else if (c < -1) c = -1
      const angle = Math.acos(c)
      if (Number.isFinite(angle)) {
        nx += Nf[3 * f] * angle; ny += Nf[3 * f + 1] * angle; nz += Nf[3 * f + 2] * angle
      }
      const opp = E2E[edge]
      if (opp === INVALID) break
      const nextEdge = next3(opp)
      if (withCrease) {
        const fb = 3 * ((nextEdge / 3) | 0)
        if (Nf[3 * f] * Nf[fb] + Nf[3 * f + 1] * Nf[fb + 1] + Nf[3 * f + 2] * Nf[fb + 2] < dpThreshold) {
          crease[i] = 1
          break
        }
      }
      edge = nextEdge
    } while (edge !== stop && ++guard < limit)
    const norm = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (norm > RCPOVERFLOW) { N[3 * i] = nx / norm; N[3 * i + 1] = ny / norm; N[3 * i + 2] = nz / norm }
    else N[3 * i] = 1
  }
  return { N, crease }
}

/** compute_dual_vertex_areas(): the barycentric cell of each vertex. */
export function dualVertexAreas(F: Uint32Array, V: Float64Array, nV: number, dedge: Dedge, tick: Tick = noTick): Float64Array {
  const { V2E, E2E, nonManifold } = dedge
  const A = new Float64Array(nV)
  const limit = E2E.length + 2
  for (let i = 0; i < nV; i++) {
    if ((i & TICK_MASK) === 0) tick(i / nV)
    let edge = V2E[i]
    const stop = edge
    if (nonManifold[i] || edge === INVALID) continue
    let area = 0, guard = 0
    do {
      const ep = prev3(edge), en = next3(edge)
      const a = 3 * F[edge], b = 3 * F[en], c = 3 * F[ep]
      const vx = V[a], vy = V[a + 1], vz = V[a + 2]
      const cx = (vx + V[b] + V[c]) / 3, cy = (vy + V[b + 1] + V[c + 1]) / 3, cz = (vz + V[b + 2] + V[c + 2]) / 3
      const fx = vx - cx, fy = vy - cy, fz = vz - cz
      // v - prev = (v - vp)/2, v - next = (v - vn)/2
      const px = (vx - V[c]) * 0.5, py = (vy - V[c + 1]) * 0.5, pz = (vz - V[c + 2]) * 0.5
      const qx = (vx - V[b]) * 0.5, qy = (vy - V[b + 1]) * 0.5, qz = (vz - V[b + 2]) * 0.5
      const ax = py * fz - pz * fy, ay = pz * fx - px * fz, az = px * fy - py * fx
      const bx = qy * fz - qz * fy, by = qz * fx - qx * fz, bz = qx * fy - qy * fx
      area += 0.5 * (Math.sqrt(ax * ax + ay * ay + az * az) + Math.sqrt(bx * bx + by * by + bz * bz))
      const opp = E2E[edge]
      if (opp === INVALID) break
      edge = next3(opp)
    } while (edge !== stop && ++guard < limit)
    A[i] = area
  }
  return A
}
