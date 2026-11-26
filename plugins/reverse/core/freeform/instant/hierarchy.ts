// SPDX-License-Identifier: AGPL-3.0-only
// Part of a TypeScript port of Instant Meshes ("Instant Field-Aligned Meshes").
// Copyright (c) 2015 Wenzel Jakob, Daniele Panozzo, Marco Tarini, and Olga Sorkine-Hornung
// (BSD-3-Clause; the licence text is in ATTRIBUTION.md).
//
// hierarchy.cpp: the multi-resolution hierarchy (pairs of neighbouring
// vertices collapsed level by level), its graph colouring, the random initial
// solution, and the propagation of constraints and of the orientation field
// from the fine levels to the coarse ones.

import type { Adjacency } from './dedge'
import { INVALID, RCPOVERFLOW, Progress, Rng, TICK_MASK, coordinateSystem, sortFloatKeys } from './util'
import type { Tick } from './util'

export const MAX_DEPTH = 25

export interface Level {
  n: number
  V: Float64Array
  N: Float64Array
  A: Float64Array
  adj: Adjacency
  /** The vertices in the order the solver visits them: colour by colour. */
  order: Uint32Array
  /** Orientation field (a tangent per vertex) and position field. */
  Q: Float64Array
  O: Float64Array
  /** Constraints; the weights are all zero when there are none. */
  CQ: Float64Array
  CO: Float64Array
  CQw: Float32Array
  COw: Float32Array
  /** To the next coarser level: this level's vertex → its vertex there. */
  toLower: Uint32Array | null
  /** From the next coarser level: its vertex → two of this level's (the second INVALID when not collapsed). */
  toUpper: Uint32Array | null
}

export interface Hierarchy {
  levels: Level[]
  totalSize: number
  hasConstraints: boolean
}

/** generate_graph_coloring_deterministic(), returned as the visiting order. */
function colouring(adj: Adjacency, n: number, rng: Rng, tick: Tick): Uint32Array {
  const perm = new Uint32Array(n)
  for (let i = 0; i < n; i++) perm[i] = i
  for (let i = n - 1; i > 0; i--) {
    const j = rng.below(i + 1)
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t
  }
  const colour = new Int32Array(n).fill(-1)
  let possible = new Uint8Array(16)
  let nColours = 0
  const { ptr, id } = adj
  for (let k = 0; k < n; k++) {
    if ((k & TICK_MASK) === 0) tick(k / n)
    const i = perm[k]
    for (let c = 0; c < nColours; c++) possible[c] = 1
    for (let l = ptr[i], e = ptr[i + 1]; l < e; l++) {
      const c = colour[id[l]]
      if (c >= 0) possible[c] = 0
    }
    let chosen = -1
    for (let c = 0; c < nColours; c++) if (possible[c]) { chosen = c; break }
    if (chosen < 0) {
      chosen = nColours++
      if (nColours > possible.length) {
        const grown = new Uint8Array(possible.length * 2)
        grown.set(possible)
        possible = grown
      }
    }
    colour[i] = chosen
  }
  const start = new Uint32Array(nColours + 1)
  for (let i = 0; i < n; i++) start[colour[i] + 1]++
  for (let c = 0; c < nColours; c++) start[c + 1] += start[c]
  const order = new Uint32Array(n)
  for (let i = 0; i < n; i++) order[start[colour[i]]++] = i
  return order
}

interface Coarse { V: Float64Array; N: Float64Array; A: Float64Array; adj: Adjacency; toUpper: Uint32Array; toLower: Uint32Array; n: number }

/** downsample_graph(): collapse the best-matched pairs of neighbours. */
function downsample(level: Level, tick: Tick): Coarse {
  const { n, V, N, A } = level
  const { ptr, id, weight } = level.adj
  const nLinks = ptr[n]
  const keys = new Float32Array(nLinks)
  const src = new Uint32Array(nLinks)
  for (let i = 0; i < n; i++) {
    if ((i & TICK_MASK) === 0) tick(0.2 * i / n)
    const nx = N[3 * i], ny = N[3 * i + 1], nz = N[3 * i + 2], ai = A[i]
    for (let l = ptr[i], e = ptr[i + 1]; l < e; l++) {
      const k = id[l]
      const dp = nx * N[3 * k] + ny * N[3 * k + 1] + nz * N[3 * k + 2]
      const ak = A[k]
      const ratio = ai > ak ? ai / ak : ak / ai
      keys[l] = dp * ratio
      src[l] = i
    }
  }
  tick(0.2)
  const perm = sortFloatKeys(keys, nLinks, true, f => tick(0.2 + 0.2 * f))
  tick(0.4)
  const merged = new Uint8Array(n)
  const pairI = new Uint32Array(n >> 1), pairJ = new Uint32Array(n >> 1)
  let nCollapsed = 0
  for (let p = 0; p < nLinks; p++) {
    if ((p & 65535) === 0) tick(0.4 + 0.1 * p / nLinks)
    const l = perm[p]
    const i = src[l], j = id[l]
    if (merged[i] || merged[j] || i === j) continue
    merged[i] = 1
    merged[j] = 1
    pairI[nCollapsed] = i
    pairJ[nCollapsed++] = j
  }
  const m = n - nCollapsed
  // The coarse vertices are numbered in the order of their first fine vertex,
  // which keeps neighbours near each other in memory. (The original numbers
  // the collapsed pairs first, in sorted order; the numbering does not enter
  // the method.)
  const pairOf = new Int32Array(n).fill(-1)
  for (let c = 0; c < nCollapsed; c++) { pairOf[pairI[c]] = c; pairOf[pairJ[c]] = c }
  const pairId = new Int32Array(nCollapsed).fill(-1)
  const Vp = new Float64Array(m * 3), Np = new Float64Array(m * 3), Ap = new Float64Array(m)
  const toUpper = new Uint32Array(m * 2), toLower = new Uint32Array(n)
  tick(0.5)
  let offset = 0
  for (let v = 0; v < n; v++) {
    if ((v & TICK_MASK) === 0) tick(0.5 + 0.1 * v / n)
    const p = pairOf[v]
    if (p < 0) {
      const c = offset++
      Vp[3 * c] = V[3 * v]; Vp[3 * c + 1] = V[3 * v + 1]; Vp[3 * c + 2] = V[3 * v + 2]
      Np[3 * c] = N[3 * v]; Np[3 * c + 1] = N[3 * v + 1]; Np[3 * c + 2] = N[3 * v + 2]
      Ap[c] = A[v]
      toUpper[2 * c] = v
      toUpper[2 * c + 1] = INVALID
      toLower[v] = c
      continue
    }
    if (pairId[p] >= 0) { toLower[v] = pairId[p]; continue }
    const c = offset++
    pairId[p] = c
    const i = pairI[p], j = pairJ[p]
    const a1 = A[i], a2 = A[j], area = a1 + a2
    if (area > RCPOVERFLOW) {
      Vp[3 * c] = (V[3 * i] * a1 + V[3 * j] * a2) / area
      Vp[3 * c + 1] = (V[3 * i + 1] * a1 + V[3 * j + 1] * a2) / area
      Vp[3 * c + 2] = (V[3 * i + 2] * a1 + V[3 * j + 2] * a2) / area
    } else {
      Vp[3 * c] = (V[3 * i] + V[3 * j]) * 0.5
      Vp[3 * c + 1] = (V[3 * i + 1] + V[3 * j + 1]) * 0.5
      Vp[3 * c + 2] = (V[3 * i + 2] + V[3 * j + 2]) * 0.5
    }
    const nx = N[3 * i] * a1 + N[3 * j] * a2, ny = N[3 * i + 1] * a1 + N[3 * j + 1] * a2, nz = N[3 * i + 2] * a1 + N[3 * j + 2] * a2
    const norm = Math.sqrt(nx * nx + ny * ny + nz * nz)
    if (norm > RCPOVERFLOW) { Np[3 * c] = nx / norm; Np[3 * c + 1] = ny / norm; Np[3 * c + 2] = nz / norm }
    else Np[3 * c] = 1
    Ap[c] = area
    toUpper[2 * c] = i
    toUpper[2 * c + 1] = j
    toLower[v] = c
  }
  // The coarse adjacency: the union of the two rings, mapped down, merged by id.
  const ptrP = new Uint32Array(m + 1)
  const idP = new Uint32Array(nLinks)
  const wP = new Float32Array(nLinks)
  let sid = new Uint32Array(64), sw = new Float64Array(64)
  let out = 0
  for (let c = 0; c < m; c++) {
    if ((c & 4095) === 0) tick(0.6 + 0.4 * c / m)
    let count = 0
    for (let k = 0; k < 2; k++) {
      const upper = toUpper[2 * c + k]
      if (upper === INVALID) continue
      const b = ptr[upper], e = ptr[upper + 1]
      if (count + (e - b) > sid.length) {
        const gi = new Uint32Array((count + e - b) * 2); gi.set(sid); sid = gi
        const gw = new Float64Array(gi.length); gw.set(sw); sw = gw
      }
      for (let l = b; l < e; l++) {
        // insertion sort by id
        const key = toLower[id[l]], w = weight[l]
        let p = count++
        while (p > 0 && sid[p - 1] > key) { sid[p] = sid[p - 1]; sw[p] = sw[p - 1]; p-- }
        sid[p] = key
        sw[p] = w
      }
    }
    let last = INVALID
    for (let p = 0; p < count; p++) {
      const k = sid[p]
      if (k === c) continue
      if (k !== last) {
        idP[out] = k
        wP[out++] = sw[p]
        last = k
      } else {
        wP[out - 1] += sw[p]
      }
    }
    ptrP[c + 1] = out
  }
  return { V: Vp, N: Np, A: Ap, adj: { ptr: ptrP, id: idP.slice(0, out), weight: wP.slice(0, out) }, toUpper, toLower, n: m }
}

function makeLevel(n: number, V: Float64Array, N: Float64Array, A: Float64Array, adj: Adjacency, rng: Rng, tick: Tick): Level {
  return {
    n, V, N, A, adj, order: colouring(adj, n, rng, tick),
    Q: new Float64Array(n * 3), O: new Float64Array(n * 3),
    CQ: new Float64Array(0), CO: new Float64Array(0), CQw: new Float32Array(0), COw: new Float32Array(0),
    toLower: null, toUpper: null,
  }
}

/** MultiResolutionHierarchy::build(). */
export function buildHierarchy(
  V: Float64Array, N: Float64Array, A: Float64Array, adj: Adjacency, n: number, seed: number, progress: Progress,
): Hierarchy {
  const rng = new Rng(seed)
  // The stage's fraction: a tenth for the first colouring, then each level half of what is left.
  const levels: Level[] = [makeLevel(n, V, N, A, adj, rng, progress.part('hierarchy', 0, 0.1))]
  let total = n
  let from = 0.1
  for (let i = 0; i < MAX_DEPTH; i++) {
    const to = from + (0.95 - from) * 0.5
    const split = from + (to - from) * 0.8
    const fine = levels[i]
    const coarse = downsample(fine, progress.part('hierarchy', from, split))
    // Nothing collapsed: the further levels Instant Meshes builds would be copies of this one.
    if (coarse.n === fine.n) break
    const level = makeLevel(coarse.n, coarse.V, coarse.N, coarse.A, coarse.adj, rng, progress.part('hierarchy', split, to))
    fine.toLower = coarse.toLower
    fine.toUpper = coarse.toUpper
    levels.push(level)
    total += level.n
    from = to
    if (level.n === 1) break
  }
  return { levels, totalSize: total, hasConstraints: false }
}

const frame = new Float64Array(6)

/** init_random_tangent(): a random unit tangent per vertex, on every level. */
export function randomOrientations(h: Hierarchy, seed: number, tick: Tick): void {
  const rng = new Rng(seed + 0x51ed)
  let done = 0
  for (const level of h.levels) {
    const { N, Q, n } = level
    for (let i = 0; i < n; i++) {
      if ((done++ & TICK_MASK) === 0) tick(done / h.totalSize)
      coordinateSystem(N[3 * i], N[3 * i + 1], N[3 * i + 2], frame)
      const angle = rng.next() * 2 * Math.PI
      const c = Math.cos(angle), s = Math.sin(angle)
      Q[3 * i] = frame[0] * c + frame[3] * s
      Q[3 * i + 1] = frame[1] * c + frame[4] * s
      Q[3 * i + 2] = frame[2] * c + frame[5] * s
    }
  }
}

/** init_random_position(): the vertex, moved at random within a cell of the lattice, on every level. */
export function randomPositions(h: Hierarchy, scale: number, seed: number, tick: Tick): void {
  const rng = new Rng(seed + 0xa11ce)
  let done = 0
  for (const level of h.levels) {
    const { N, V, O, n } = level
    for (let i = 0; i < n; i++) {
      if ((done++ & TICK_MASK) === 0) tick(done / h.totalSize)
      coordinateSystem(N[3 * i], N[3 * i + 1], N[3 * i + 2], frame)
      const x = (rng.next() * 2 - 1) * scale, y = (rng.next() * 2 - 1) * scale
      O[3 * i] = V[3 * i] + frame[0] * x + frame[3] * y
      O[3 * i + 1] = V[3 * i + 1] + frame[1] * x + frame[4] * y
      O[3 * i + 2] = V[3 * i + 2] + frame[2] * x + frame[5] * y
    }
  }
}

/** clearConstraints(): allocate and zero the constraints of every level. */
export function clearConstraints(h: Hierarchy): void {
  for (const level of h.levels) {
    level.CQ = new Float64Array(level.n * 3)
    level.CO = new Float64Array(level.n * 3)
    level.CQw = new Float32Array(level.n)
    level.COw = new Float32Array(level.n)
  }
  h.hasConstraints = true
}

// The results of the pairwise matchings below.
export const pair = new Float64Array(6)

/** compat_orientation_extrinsic_4(): the two of the eight directions that agree best. Result in `pair`. */
export function compatOrientation4(
  q0x: number, q0y: number, q0z: number, n0x: number, n0y: number, n0z: number,
  q1x: number, q1y: number, q1z: number, n1x: number, n1y: number, n1z: number,
): void {
  const a1x = n0y * q0z - n0z * q0y, a1y = n0z * q0x - n0x * q0z, a1z = n0x * q0y - n0y * q0x
  const b1x = n1y * q1z - n1z * q1y, b1y = n1z * q1x - n1x * q1z, b1z = n1x * q1y - n1y * q1x
  const d00 = q0x * q1x + q0y * q1y + q0z * q1z
  const d01 = q0x * b1x + q0y * b1y + q0z * b1z
  const d10 = a1x * q1x + a1y * q1y + a1z * q1z
  const d11 = a1x * b1x + a1y * b1y + a1z * b1z
  let best = Math.abs(d00), dp = d00, a = 0, b = 0
  let s = Math.abs(d01)
  if (s > best) { best = s; dp = d01; a = 0; b = 1 }
  s = Math.abs(d10)
  if (s > best) { best = s; dp = d10; a = 1; b = 0 }
  s = Math.abs(d11)
  if (s > best) { dp = d11; a = 1; b = 1 }
  const sign = dp < 0 ? -1 : 1
  if (a === 0) { pair[0] = q0x; pair[1] = q0y; pair[2] = q0z } else { pair[0] = a1x; pair[1] = a1y; pair[2] = a1z }
  if (b === 0) { pair[3] = q1x * sign; pair[4] = q1y * sign; pair[5] = q1z * sign }
  else { pair[3] = b1x * sign; pair[4] = b1y * sign; pair[5] = b1z * sign }
}

/**
 * The matching of two constraint directions when they are merged on a coarser
 * level. NOT the original's, which matches them as it matches the field
 * (compat_orientation_extrinsic_4) and so may turn both a quarter: right for
 * the cross, but the direction is also the LINE the position constraint lets
 * the lattice slide along, and a quarter-turned line pins the lattice along
 * the boundary instead of across it. On a densely sampled rim that welded the
 * whole rim to one vertex (a slit of the lego scan closed in ten runs of ten;
 * the native program kept it in five of five). Here the first
 * direction is kept and the second is matched to it: itself or its quarter
 * turn, with the sign that agrees. Result in `pair`.
 */
function compatConstraint(
  q0x: number, q0y: number, q0z: number,
  q1x: number, q1y: number, q1z: number, n1x: number, n1y: number, n1z: number,
): void {
  const b1x = n1y * q1z - n1z * q1y, b1y = n1z * q1x - n1x * q1z, b1z = n1x * q1y - n1y * q1x
  const d0 = q0x * q1x + q0y * q1y + q0z * q1z
  const d1 = q0x * b1x + q0y * b1y + q0z * b1z
  pair[0] = q0x; pair[1] = q0y; pair[2] = q0z
  if (Math.abs(d1) > Math.abs(d0)) {
    const sign = d1 < 0 ? -1 : 1
    pair[3] = b1x * sign; pair[4] = b1y * sign; pair[5] = b1z * sign
  } else {
    const sign = d0 < 0 ? -1 : 1
    pair[3] = q1x * sign; pair[4] = q1y * sign; pair[5] = q1z * sign
  }
}

/**
 * compat_position_extrinsic_4(): the lattice points of the two vertices that
 * lie closest to each other near the middle of the edge. Result in `pair`.
 */
export function compatPosition4(
  p0x: number, p0y: number, p0z: number, n0x: number, n0y: number, n0z: number,
  q0x: number, q0y: number, q0z: number, o0x: number, o0y: number, o0z: number,
  p1x: number, p1y: number, p1z: number, n1x: number, n1y: number, n1z: number,
  q1x: number, q1y: number, q1z: number, o1x: number, o1y: number, o1z: number,
  scale: number, invScale: number,
): void {
  const t0x = n0y * q0z - n0z * q0y, t0y = n0z * q0x - n0x * q0z, t0z = n0x * q0y - n0y * q0x
  const t1x = n1y * q1z - n1z * q1y, t1y = n1z * q1x - n1x * q1z, t1z = n1x * q1y - n1y * q1x
  // middle_point()
  const n0p0 = n0x * p0x + n0y * p0y + n0z * p0z, n0p1 = n0x * p1x + n0y * p1y + n0z * p1z
  const n1p0 = n1x * p0x + n1y * p0y + n1z * p0z, n1p1 = n1x * p1x + n1y * p1y + n1z * p1z
  const n0n1 = n0x * n1x + n0y * n1y + n0z * n1z
  const denom = 1 / (1 - n0n1 * n0n1 + 1e-4)
  const l0 = 2 * (n0p1 - n0p0 - n0n1 * (n1p0 - n1p1)) * denom
  const l1 = 2 * (n1p0 - n1p1 - n0n1 * (n0p1 - n0p0)) * denom
  const mx = 0.5 * (p0x + p1x) - 0.25 * (n0x * l0 + n1x * l1)
  const my = 0.5 * (p0y + p1y) - 0.25 * (n0y * l0 + n1y * l1)
  const mz = 0.5 * (p0z + p1z) - 0.25 * (n0z * l0 + n1z * l1)
  // position_floor_4() of each
  let dx = mx - o0x, dy = my - o0y, dz = mz - o0z
  let u = Math.floor((q0x * dx + q0y * dy + q0z * dz) * invScale) * scale
  let v = Math.floor((t0x * dx + t0y * dy + t0z * dz) * invScale) * scale
  const ax = o0x + q0x * u + t0x * v, ay = o0y + q0y * u + t0y * v, az = o0z + q0z * u + t0z * v
  dx = mx - o1x; dy = my - o1y; dz = mz - o1z
  u = Math.floor((q1x * dx + q1y * dy + q1z * dz) * invScale) * scale
  v = Math.floor((t1x * dx + t1y * dy + t1z * dz) * invScale) * scale
  const bx = o1x + q1x * u + t1x * v, by = o1y + q1y * u + t1y * v, bz = o1z + q1z * u + t1z * v
  // The best of the 4 × 4 corners: minimise |a + i - (b + j)|².
  const q0sx = q0x * scale, q0sy = q0y * scale, q0sz = q0z * scale
  const t0sx = t0x * scale, t0sy = t0y * scale, t0sz = t0z * scale
  const q1sx = q1x * scale, q1sy = q1y * scale, q1sz = q1z * scale
  const t1sx = t1x * scale, t1sy = t1y * scale, t1sz = t1z * scale
  let best = Infinity, bi = 0, bj = 0
  for (let i = 0; i < 4; i++) {
    const iu = i & 1, iv = i >> 1
    const ex = ax + q0sx * iu + t0sx * iv - bx, ey = ay + q0sy * iu + t0sy * iv - by, ez = az + q0sz * iu + t0sz * iv - bz
    for (let j = 0; j < 4; j++) {
      const ju = j & 1, jv = j >> 1
      const fx = ex - q1sx * ju - t1sx * jv, fy = ey - q1sy * ju - t1sy * jv, fz = ez - q1sz * ju - t1sz * jv
      const cost = fx * fx + fy * fy + fz * fz
      if (cost < best) { best = cost; bi = i; bj = j }
    }
  }
  const iu = bi & 1, iv = bi >> 1, ju = bj & 1, jv = bj >> 1
  pair[0] = ax + q0sx * iu + t0sx * iv
  pair[1] = ay + q0sy * iu + t0sy * iv
  pair[2] = az + q0sz * iu + t0sz * iv
  pair[3] = bx + q1sx * ju + t1sx * jv
  pair[4] = by + q1sy * ju + t1sy * jv
  pair[5] = bz + q1sz * ju + t1sz * jv
}

/** propagateConstraints(): carry the constraints of level 0 down to the coarse levels. */
export function propagateConstraints(h: Hierarchy, scale: number): void {
  const invScale = 1 / scale
  for (let l = 0; l + 1 < h.levels.length; l++) {
    const fine = h.levels[l], coarse = h.levels[l + 1]
    const { N, V, CQ, CO, CQw, COw } = fine
    const toUpper = fine.toUpper!
    for (let i = 0; i < coarse.n; i++) {
      const u0 = toUpper[2 * i], u1 = toUpper[2 * i + 1]
      let cqx = 0, cqy = 0, cqz = 0, cox = 0, coy = 0, coz = 0, cqw = 0, cow = 0
      const hasCq0 = CQw[u0] !== 0, hasCq1 = u1 !== INVALID && CQw[u1] !== 0
      const hasCo0 = COw[u0] !== 0, hasCo1 = u1 !== INVALID && COw[u1] !== 0
      if (hasCq0 && !hasCq1) {
        cqx = CQ[3 * u0]; cqy = CQ[3 * u0 + 1]; cqz = CQ[3 * u0 + 2]; cqw = CQw[u0]
      } else if (hasCq1 && !hasCq0) {
        cqx = CQ[3 * u1]; cqy = CQ[3 * u1 + 1]; cqz = CQ[3 * u1 + 2]; cqw = CQw[u1]
      } else if (hasCq1 && hasCq0) {
        compatConstraint(
          CQ[3 * u0], CQ[3 * u0 + 1], CQ[3 * u0 + 2],
          CQ[3 * u1], CQ[3 * u1 + 1], CQ[3 * u1 + 2], N[3 * u1], N[3 * u1 + 1], N[3 * u1 + 2])
        const w0 = CQw[u0], w1 = CQw[u1]
        cqx = pair[0] * w0 + pair[3] * w1; cqy = pair[1] * w0 + pair[4] * w1; cqz = pair[2] * w0 + pair[5] * w1
        cqw = w0 + w1
      }
      const nx = coarse.N[3 * i], ny = coarse.N[3 * i + 1], nz = coarse.N[3 * i + 2]
      if (cqx !== 0 || cqy !== 0 || cqz !== 0) {
        const d = nx * cqx + ny * cqy + nz * cqz
        cqx -= d * nx; cqy -= d * ny; cqz -= d * nz
        const len2 = cqx * cqx + cqy * cqy + cqz * cqz
        if (len2 > RCPOVERFLOW) { const inv = 1 / Math.sqrt(len2); cqx *= inv; cqy *= inv; cqz *= inv }
      }
      if (hasCo0 && !hasCo1) {
        cox = CO[3 * u0]; coy = CO[3 * u0 + 1]; coz = CO[3 * u0 + 2]; cow = COw[u0]
      } else if (hasCo1 && !hasCo0) {
        cox = CO[3 * u1]; coy = CO[3 * u1 + 1]; coz = CO[3 * u1 + 2]; cow = COw[u1]
      } else if (hasCo1 && hasCo0) {
        compatPosition4(
          V[3 * u0], V[3 * u0 + 1], V[3 * u0 + 2], N[3 * u0], N[3 * u0 + 1], N[3 * u0 + 2],
          CQ[3 * u0], CQ[3 * u0 + 1], CQ[3 * u0 + 2], CO[3 * u0], CO[3 * u0 + 1], CO[3 * u0 + 2],
          V[3 * u1], V[3 * u1 + 1], V[3 * u1 + 2], N[3 * u1], N[3 * u1 + 1], N[3 * u1 + 2],
          CQ[3 * u1], CQ[3 * u1 + 1], CQ[3 * u1 + 2], CO[3 * u1], CO[3 * u1 + 1], CO[3 * u1 + 2],
          scale, invScale)
        const w0 = COw[u0], w1 = COw[u1]
        cow = w0 + w1
        cox = (pair[0] * w0 + pair[3] * w1) / cow; coy = (pair[1] * w0 + pair[4] * w1) / cow; coz = (pair[2] * w0 + pair[5] * w1) / cow
      }
      if (cox !== 0 || coy !== 0 || coz !== 0) {
        // Onto the tangent plane of the coarse vertex. NOT as the original
        // has it: it subtracts n·(cq − v) n where n·(co − v) n was surely
        // meant, which leaves the coarse constraints off their planes by
        // about the plane's distance from the origin — so the result changed
        // when the scan was moved (measured on a tube: no irregular vertex
        // at the origin, 9–12 thirty units away; the native program likewise).
        const d = nx * (cox - coarse.V[3 * i]) + ny * (coy - coarse.V[3 * i + 1]) + nz * (coz - coarse.V[3 * i + 2])
        cox -= d * nx; coy -= d * ny; coz -= d * nz
      }
      coarse.CQw[i] = cqw > 0 ? 1 : cqw
      coarse.COw[i] = cow > 0 ? 1 : cow
      coarse.CQ[3 * i] = cqx; coarse.CQ[3 * i + 1] = cqy; coarse.CQ[3 * i + 2] = cqz
      coarse.CO[3 * i] = cox; coarse.CO[3 * i + 1] = coy; coarse.CO[3 * i + 2] = coz
    }
  }
}

/** propagateSolution(): rebuild the coarse orientation fields from the solved fine one. */
export function propagateSolution(h: Hierarchy): void {
  for (let l = 0; l + 1 < h.levels.length; l++) {
    const fine = h.levels[l], coarse = h.levels[l + 1]
    const { N, Q } = fine
    const toUpper = fine.toUpper!
    for (let i = 0; i < coarse.n; i++) {
      const u0 = toUpper[2 * i], u1 = toUpper[2 * i + 1]
      let qx = Q[3 * u0], qy = Q[3 * u0 + 1], qz = Q[3 * u0 + 2]
      if (u1 !== INVALID) {
        compatOrientation4(
          qx, qy, qz, N[3 * u0], N[3 * u0 + 1], N[3 * u0 + 2],
          Q[3 * u1], Q[3 * u1 + 1], Q[3 * u1 + 2], N[3 * u1], N[3 * u1 + 1], N[3 * u1 + 2])
        qx = pair[0] + pair[3]; qy = pair[1] + pair[4]; qz = pair[2] + pair[5]
      }
      const nx = coarse.N[3 * i], ny = coarse.N[3 * i + 1], nz = coarse.N[3 * i + 2]
      const d = nx * qx + ny * qy + nz * qz
      qx -= d * nx; qy -= d * ny; qz -= d * nz
      const len2 = qx * qx + qy * qy + qz * qz
      if (len2 > RCPOVERFLOW) { const inv = 1 / Math.sqrt(len2); qx *= inv; qy *= inv; qz *= inv }
      coarse.Q[3 * i] = qx; coarse.Q[3 * i + 1] = qy; coarse.Q[3 * i + 2] = qz
    }
  }
}
