// SPDX-License-Identifier: AGPL-3.0-only
// Part of a TypeScript port of Instant Meshes ("Instant Field-Aligned Meshes").
// Copyright (c) 2015 Wenzel Jakob, Daniele Panozzo, Marco Tarini, and Olga Sorkine-Hornung
// (BSD-3-Clause; the licence text is in ATTRIBUTION.md).
//
// field.cpp, the extrinsic 4-RoSy / 4-PoSy paths only: the Gauss-Seidel
// smoothing of the orientation field and of the position field, run as the
// Optimizer does in batch mode (six sweeps per level from the coarsest level
// to the finest, each level's result copied up to the next), and the count of
// the orientation field's singularities.

import type { Hierarchy, Level } from './hierarchy'
import { propagateSolution } from './hierarchy'
import { INVALID, RCPOVERFLOW, Progress } from './util'

const LEVEL_ITERATIONS = 6
const CHUNK = 4096

/** optimize_orientations_impl(), solve_normal, for one sweep over a level. */
function sweepOrientations(level: Level, constrained: boolean, progress: Progress, done: number, total: number): void {
  const { N, Q, order, n, CQ, CQw } = level
  const { ptr, id, weight } = level.adj
  for (let k = 0; k < n; k++) {
    if ((k & (CHUNK - 1)) === 0) progress.tick('orientation', (done + k) / total)
    const i = order[k]
    const b = ptr[i], e = ptr[i + 1]
    if (b === e) continue
    const i3 = 3 * i
    const nx = N[i3], ny = N[i3 + 1], nz = N[i3 + 2]
    let sx = Q[i3], sy = Q[i3 + 1], sz = Q[i3 + 2]
    let wsum = 0
    for (let l = b; l < e; l++) {
      const w = weight[l]
      if (w === 0) continue
      const j3 = 3 * id[l]
      const qx = Q[j3], qy = Q[j3 + 1], qz = Q[j3 + 2]
      const mx = N[j3], my = N[j3 + 1], mz = N[j3 + 2]
      // compat_orientation_extrinsic_4(sum, n_i, q_j, n_j)
      const ax = ny * sz - nz * sy, ay = nz * sx - nx * sz, az = nx * sy - ny * sx
      const bx = my * qz - mz * qy, by = mz * qx - mx * qz, bz = mx * qy - my * qx
      const d00 = sx * qx + sy * qy + sz * qz
      const d01 = sx * bx + sy * by + sz * bz
      const d10 = ax * qx + ay * qy + az * qz
      const d11 = ax * bx + ay * by + az * bz
      // The first of the four with the largest |dot|, picked without branches
      // (they would be mispredicted): row a (s or n × s), then column b.
      const r0 = Math.max(Math.abs(d00), Math.abs(d01)), r1 = Math.max(Math.abs(d10), Math.abs(d11))
      const ua = +(r1 > r0), na = 1 - ua
      const e0 = na * d00 + ua * d10, e1 = na * d01 + ua * d11
      const ub = +(Math.abs(e1) > Math.abs(e0)), nb = 1 - ub
      const dp = nb * e0 + ub * e1
      const sw = w * (1 - 2 * +(dp < 0))
      const w0 = wsum * na, w1 = wsum * ua, w2 = sw * nb, w3 = sw * ub
      let fx = sx * w0 + ax * w1 + qx * w2 + bx * w3
      let fy = sy * w0 + ay * w1 + qy * w2 + by * w3
      let fz = sz * w0 + az * w1 + qz * w2 + bz * w3
      const d = nx * fx + ny * fy + nz * fz
      fx -= nx * d; fy -= ny * d; fz -= nz * d
      wsum += w
      const norm = Math.sqrt(fx * fx + fy * fy + fz * fz)
      if (norm > RCPOVERFLOW) { const inv = 1 / norm; sx = fx * inv; sy = fy * inv; sz = fz * inv } else { sx = fx; sy = fy; sz = fz }
    }
    if (constrained) {
      const cw = CQw[i]
      if (cw !== 0) {
        const qx = CQ[i3], qy = CQ[i3 + 1], qz = CQ[i3 + 2]
        const ax = ny * sz - nz * sy, ay = nz * sx - nx * sz, az = nx * sy - ny * sx
        const bx = ny * qz - nz * qy, by = nz * qx - nx * qz, bz = nx * qy - ny * qx
        const d00 = sx * qx + sy * qy + sz * qz
        const d01 = sx * bx + sy * by + sz * bz
        const d10 = ax * qx + ay * qy + az * qz
        const d11 = ax * bx + ay * by + az * bz
        let best = Math.abs(d00), dp = d00, sel = 0
        if (Math.abs(d01) > best) { best = Math.abs(d01); dp = d01; sel = 1 }
        if (Math.abs(d10) > best) { best = Math.abs(d10); dp = d10; sel = 2 }
        if (Math.abs(d11) > best) { dp = d11; sel = 3 }
        const w0 = 1 - cw, w1 = dp < 0 ? -cw : cw
        let fx: number, fy: number, fz: number
        if (sel < 2) { fx = sx * w0; fy = sy * w0; fz = sz * w0 } else { fx = ax * w0; fy = ay * w0; fz = az * w0 }
        if ((sel & 1) === 0) { fx += qx * w1; fy += qy * w1; fz += qz * w1 } else { fx += bx * w1; fy += by * w1; fz += bz * w1 }
        const d = nx * fx + ny * fy + nz * fz
        fx -= nx * d; fy -= ny * d; fz -= nz * d
        const norm = Math.sqrt(fx * fx + fy * fy + fz * fz)
        if (norm > RCPOVERFLOW) { const inv = 1 / norm; sx = fx * inv; sy = fy * inv; sz = fz * inv } else { sx = fx; sy = fy; sz = fz }
      }
    }
    if (wsum > 0) { Q[i3] = sx; Q[i3 + 1] = sy; Q[i3 + 2] = sz }
  }
}

/** Optimizer::optimizeOrientations(-1): the hierarchical solve, then propagateSolution(). */
export function optimizeOrientations(h: Hierarchy, progress: Progress): void {
  const total = h.totalSize * LEVEL_ITERATIONS
  let done = 0
  for (let l = h.levels.length - 1; l >= 0; l--) {
    const level = h.levels[l]
    for (let it = 0; it < LEVEL_ITERATIONS; it++) {
      sweepOrientations(level, h.hasConstraints, progress, done, total)
      done += level.n
    }
    if (l > 0) {
      // Copy the result up to the finer level, into each vertex's tangent plane.
      const fine = h.levels[l - 1]
      const toUpper = fine.toUpper!
      const src = level.Q, dst = fine.Q, N = fine.N
      for (let j = 0; j < level.n; j++) {
        const qx = src[3 * j], qy = src[3 * j + 1], qz = src[3 * j + 2]
        for (let k = 0; k < 2; k++) {
          const dest = toUpper[2 * j + k]
          if (dest === INVALID) continue
          const nx = N[3 * dest], ny = N[3 * dest + 1], nz = N[3 * dest + 2]
          const d = nx * qx + ny * qy + nz * qz
          dst[3 * dest] = qx - nx * d
          dst[3 * dest + 1] = qy - ny * d
          dst[3 * dest + 2] = qz - nz * d
        }
      }
    }
  }
  progress.tick('orientation', 1)
  propagateSolution(h)
  progress.report('orientation', 1)
}

/** compat_orientation_extrinsic_index_4(): the rotation indices of the best-matching pair; returns second − first. */
function orientationIndexDelta(Q: Float64Array, N: Float64Array, i: number, j: number): number {
  const i3 = 3 * i, j3 = 3 * j
  const sx = Q[i3], sy = Q[i3 + 1], sz = Q[i3 + 2], nx = N[i3], ny = N[i3 + 1], nz = N[i3 + 2]
  const qx = Q[j3], qy = Q[j3 + 1], qz = Q[j3 + 2], mx = N[j3], my = N[j3 + 1], mz = N[j3 + 2]
  const ax = ny * sz - nz * sy, ay = nz * sx - nx * sz, az = nx * sy - ny * sx
  const bx = my * qz - mz * qy, by = mz * qx - mx * qz, bz = mx * qy - my * qx
  const d00 = sx * qx + sy * qy + sz * qz
  const d01 = sx * bx + sy * by + sz * bz
  const d10 = ax * qx + ay * qy + az * qz
  const d11 = ax * bx + ay * by + az * bz
  let best = Math.abs(d00), dp = d00, a = 0, b = 0
  if (Math.abs(d01) > best) { best = Math.abs(d01); dp = d01; a = 0; b = 1 }
  if (Math.abs(d10) > best) { best = Math.abs(d10); dp = d10; a = 1; b = 0 }
  if (Math.abs(d11) > best) { dp = d11; a = 1; b = 1 }
  if (dp < 0) b += 2
  return b - a
}

/** compute_orientation_singularities(): the number of triangles the field turns a quarter around. */
export function countOrientationSingularities(h: Hierarchy, F: Uint32Array, nF: number, progress: Progress): number {
  const { Q, N } = h.levels[0]
  let count = 0
  for (let f = 0; f < nF; f++) {
    if ((f & 16383) === 0) progress.tick('orientation', 1)
    let index = 0
    for (let k = 0; k < 3; k++) index += orientationIndexDelta(Q, N, F[3 * f + k], F[3 * f + (k === 2 ? 0 : k + 1)])
    index = ((index % 4) + 4) % 4
    if (index === 1 || index === 3) count++
  }
  return count
}

/** optimize_positions_impl(), solve_normal, for one sweep over a level. Qn and T are the unit field and n × it. */
function sweepPositions(
  level: Level, Qn: Float64Array, T: Float64Array, scale: number, constrained: boolean,
  progress: Progress, done: number, total: number,
): void {
  const { N, V, O, order, n, CQ, CO, COw } = level
  const { ptr, id, weight } = level.adj
  const invScale = 1 / scale
  for (let k = 0; k < n; k++) {
    if ((k & (CHUNK - 1)) === 0) progress.tick('position', (done + k) / total)
    const i = order[k]
    const b = ptr[i], e = ptr[i + 1]
    if (b === e) continue
    const i3 = 3 * i
    const n0x = N[i3], n0y = N[i3 + 1], n0z = N[i3 + 2]
    const p0x = V[i3], p0y = V[i3 + 1], p0z = V[i3 + 2]
    const q0x = Qn[i3], q0y = Qn[i3 + 1], q0z = Qn[i3 + 2]
    const t0x = T[i3], t0y = T[i3 + 1], t0z = T[i3 + 2]
    const q0sx = q0x * scale, q0sy = q0y * scale, q0sz = q0z * scale
    const t0sx = t0x * scale, t0sy = t0y * scale, t0sz = t0z * scale
    const n0p0 = n0x * p0x + n0y * p0y + n0z * p0z
    let sx = O[i3], sy = O[i3 + 1], sz = O[i3 + 2]
    let wsum = 0
    for (let l = b; l < e; l++) {
      const w = weight[l]
      if (w === 0) continue
      const j3 = 3 * id[l]
      const n1x = N[j3], n1y = N[j3 + 1], n1z = N[j3 + 2]
      const p1x = V[j3], p1y = V[j3 + 1], p1z = V[j3 + 2]
      const q1x = Qn[j3], q1y = Qn[j3 + 1], q1z = Qn[j3 + 2]
      const t1x = T[j3], t1y = T[j3 + 1], t1z = T[j3 + 2]
      const o1x = O[j3], o1y = O[j3 + 1], o1z = O[j3 + 2]
      // middle_point(p0, n0, p1, n1)
      const n0p1 = n0x * p1x + n0y * p1y + n0z * p1z
      const n1p0 = n1x * p0x + n1y * p0y + n1z * p0z, n1p1 = n1x * p1x + n1y * p1y + n1z * p1z
      const n0n1 = n0x * n1x + n0y * n1y + n0z * n1z
      const denom = 0.5 / (1 - n0n1 * n0n1 + 1e-4)
      const l0 = (n0p1 - n0p0 - n0n1 * (n1p0 - n1p1)) * denom
      const l1 = (n1p0 - n1p1 - n0n1 * (n0p1 - n0p0)) * denom
      const mx = 0.5 * (p0x + p1x) - (n0x * l0 + n1x * l1)
      const my = 0.5 * (p0y + p1y) - (n0y * l0 + n1y * l1)
      const mz = 0.5 * (p0z + p1z) - (n0z * l0 + n1z * l1)
      // position_floor_4() of each lattice at the middle
      let dx = mx - sx, dy = my - sy, dz = mz - sz
      let u = Math.floor((q0x * dx + q0y * dy + q0z * dz) * invScale)
      let v = Math.floor((t0x * dx + t0y * dy + t0z * dz) * invScale)
      const ax = sx + q0sx * u + t0sx * v, ay = sy + q0sy * u + t0sy * v, az = sz + q0sz * u + t0sz * v
      dx = mx - o1x; dy = my - o1y; dz = mz - o1z
      u = Math.floor((q1x * dx + q1y * dy + q1z * dz) * invScale)
      v = Math.floor((t1x * dx + t1y * dy + t1z * dz) * invScale)
      const q1sx = q1x * scale, q1sy = q1y * scale, q1sz = q1z * scale
      const t1sx = t1x * scale, t1sy = t1y * scale, t1sz = t1z * scale
      const bx = o1x + q1sx * u + t1sx * v, by = o1y + q1sy * u + t1sy * v, bz = o1z + q1sz * u + t1sz * v
      // The closest of the 4 × 4 pairs of cell corners (first minimum, i outer, j inner).
      const ex = ax - bx, ey = ay - by, ez = az - bz
      let best = Infinity, bi = 0, bj = 0
      for (let ci = 0; ci < 4; ci++) {
        const iu = ci & 1, iv = ci >> 1
        const gx = ex + q0sx * iu + t0sx * iv, gy = ey + q0sy * iu + t0sy * iv, gz = ez + q0sz * iu + t0sz * iv
        let hx = gx, hy = gy, hz = gz
        let cost = hx * hx + hy * hy + hz * hz
        if (cost < best) { best = cost; bi = ci; bj = 0 }
        hx = gx - q1sx; hy = gy - q1sy; hz = gz - q1sz
        cost = hx * hx + hy * hy + hz * hz
        if (cost < best) { best = cost; bi = ci; bj = 1 }
        hx = gx - t1sx; hy = gy - t1sy; hz = gz - t1sz
        cost = hx * hx + hy * hy + hz * hz
        if (cost < best) { best = cost; bi = ci; bj = 2 }
        hx -= q1sx; hy -= q1sy; hz -= q1sz
        cost = hx * hx + hy * hy + hz * hz
        if (cost < best) { best = cost; bi = ci; bj = 3 }
      }
      const iu = bi & 1, iv = bi >> 1, ju = bj & 1, jv = bj >> 1
      const fx = (ax + q0sx * iu + t0sx * iv) * wsum + (bx + q1sx * ju + t1sx * jv) * w
      const fy = (ay + q0sy * iu + t0sy * iv) * wsum + (by + q1sy * ju + t1sy * jv) * w
      const fz = (az + q0sz * iu + t0sz * iv) * wsum + (bz + q1sz * ju + t1sz * jv) * w
      wsum += w
      if (wsum > RCPOVERFLOW) { const inv = 1 / wsum; sx = fx * inv; sy = fy * inv; sz = fz * inv } else { sx = fx; sy = fy; sz = fz }
      const d = n0x * (sx - p0x) + n0y * (sy - p0y) + n0z * (sz - p0z)
      sx -= n0x * d; sy -= n0y * d; sz -= n0z * d
    }
    if (constrained) {
      const cw = COw[i]
      if (cw !== 0) {
        const cqx = CQ[i3], cqy = CQ[i3 + 1], cqz = CQ[i3 + 2]
        let dx = CO[i3] - sx, dy = CO[i3 + 1] - sy, dz = CO[i3 + 2] - sz
        const along = cqx * dx + cqy * dy + cqz * dz
        dx -= cqx * along; dy -= cqy * along; dz -= cqz * along
        sx += cw * dx; sy += cw * dy; sz += cw * dz
        const d = n0x * (sx - p0x) + n0y * (sy - p0y) + n0z * (sz - p0z)
        sx -= n0x * d; sy -= n0y * d; sz -= n0z * d
      }
    }
    if (wsum > 0) {
      // position_round_4(sum, q_i, n_i, v_i)
      const dx = p0x - sx, dy = p0y - sy, dz = p0z - sz
      const u = Math.round((q0x * dx + q0y * dy + q0z * dz) * invScale)
      const v = Math.round((t0x * dx + t0y * dy + t0z * dz) * invScale)
      O[i3] = sx + q0sx * u + t0sx * v
      O[i3 + 1] = sy + q0sy * u + t0sy * v
      O[i3 + 2] = sz + q0sz * u + t0sz * v
    }
  }
}

/** Optimizer::optimizePositions(-1): the hierarchical solve of the position field at `scale`. */
export function optimizePositions(h: Hierarchy, scale: number, progress: Progress): void {
  const total = h.totalSize * LEVEL_ITERATIONS
  let done = 0
  for (let l = h.levels.length - 1; l >= 0; l--) {
    const level = h.levels[l]
    const { N, Q, n } = level
    const Qn = new Float64Array(n * 3), T = new Float64Array(n * 3)
    progress.tick('position', done / total)
    for (let i = 0; i < n; i++) {
      const i3 = 3 * i
      let qx = Q[i3], qy = Q[i3 + 1], qz = Q[i3 + 2]
      const len = Math.sqrt(qx * qx + qy * qy + qz * qz)
      if (len > 0) { qx /= len; qy /= len; qz /= len }
      Qn[i3] = qx; Qn[i3 + 1] = qy; Qn[i3 + 2] = qz
      const nx = N[i3], ny = N[i3 + 1], nz = N[i3 + 2]
      T[i3] = ny * qz - nz * qy; T[i3 + 1] = nz * qx - nx * qz; T[i3 + 2] = nx * qy - ny * qx
    }
    for (let it = 0; it < LEVEL_ITERATIONS; it++) {
      sweepPositions(level, Qn, T, scale, h.hasConstraints, progress, done, total)
      done += n
    }
    if (l > 0) {
      const fine = h.levels[l - 1]
      const toUpper = fine.toUpper!
      const src = level.O, dst = fine.O, Nf = fine.N, Vf = fine.V
      for (let j = 0; j < n; j++) {
        const ox = src[3 * j], oy = src[3 * j + 1], oz = src[3 * j + 2]
        for (let k = 0; k < 2; k++) {
          const dest = toUpper[2 * j + k]
          if (dest === INVALID) continue
          const nx = Nf[3 * dest], ny = Nf[3 * dest + 1], nz = Nf[3 * dest + 2]
          const d = nx * (ox - Vf[3 * dest]) + ny * (oy - Vf[3 * dest + 1]) + nz * (oz - Vf[3 * dest + 2])
          dst[3 * dest] = ox - nx * d
          dst[3 * dest + 1] = oy - ny * d
          dst[3 * dest + 2] = oz - nz * d
        }
      }
    }
  }
  progress.report('position', 1)
}
