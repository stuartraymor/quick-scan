// SPDX-License-Identifier: AGPL-3.0-only
// Constraining a fitted primitive, as the Extract primitives dialog offers it:
// hold a plane's normal or a cylinder's / line's axis parallel or
// perpendicular to a coordinate plane (OXY, OYZ, OXZ), or — Auto Constrain —
// snap a new primitive to the ones already made when it lies within a tilt
// tolerance of parallel or perpendicular, and onto them when it lies within a
// coincidence tolerance. The primitive is measured again on the same marked
// points with the direction held, so its σ says how well the scan agrees with
// the constraint, not what it was before.

import type { CylinderFit, FitData, LineFit, PlaneFit, Vec3 } from '../types'
import { add, dot, len, normalize, scale, sub } from '../vec'
import { orthoBasis } from '../fit/linalg'

export type ConstraintId = 'none' | 'parallel-oxy' | 'parallel-oyz' | 'parallel-oxz' | 'perpendicular-oxy' | 'perpendicular-oyz' | 'perpendicular-oxz'

export const CONSTRAINTS: { id: ConstraintId; label: string }[] = [
  { id: 'none', label: 'Not constrained' },
  { id: 'parallel-oxy', label: 'Parallel to (OXY)' },
  { id: 'parallel-oyz', label: 'Parallel to (OYZ)' },
  { id: 'parallel-oxz', label: 'Parallel to (OXZ)' },
  { id: 'perpendicular-oxy', label: 'Perpendicular to (OXY)' },
  { id: 'perpendicular-oyz', label: 'Perpendicular to (OYZ)' },
  { id: 'perpendicular-oxz', label: 'Perpendicular to (OXZ)' },
]

/** The normal of each coordinate plane. */
const DATUM_NORMAL: Record<'oxy' | 'oyz' | 'oxz', Vec3> = { oxy: [0, 0, 1], oyz: [1, 0, 0], oxz: [0, 1, 0] }

export interface ConstraintTolerances {
  tiltDeg: number
  coincidenceMm: number
}
export const DEFAULT_TOLERANCES: ConstraintTolerances = { tiltDeg: 0.5, coincidenceMm: 1 }

/** The direction a primitive is held by — a plane's normal, an axis — or null
 *  for one with none (a sphere, a point) or whose constraint is not built (a cone). */
export function directionOf(fit: FitData): Vec3 | null {
  if (fit.kind === 'plane') return fit.normal
  if (fit.kind === 'cylinder' || fit.kind === 'cone') return fit.axis
  if (fit.kind === 'line') return fit.dir
  return null
}
/** Kinds a constraint can be applied to: a cone's half-angle would have to be
 *  fitted again with its axis held, which is not built. */
export const canConstrain = (fit: FitData): boolean => fit.kind === 'plane' || fit.kind === 'cylinder' || fit.kind === 'line'

const unit = (v: Vec3): Vec3 | null => {
  const n = normalize(v)
  return n && Number.isFinite(n[0]) ? n : null
}
const alike = (v: Vec3, like: Vec3): Vec3 => (dot(v, like) < 0 ? scale(v, -1) : v)
const angleDeg = (a: Vec3, b: Vec3): number => (Math.acos(Math.min(1, Math.abs(dot(a, b)))) * 180) / Math.PI
/** Degrees off a right angle between two directions. */
const offRightDeg = (a: Vec3, b: Vec3): number => (Math.asin(Math.min(1, Math.abs(dot(a, b)))) * 180) / Math.PI

/** The direction the constraint asks for, nearest to `current`; null when
 *  `current` leaves it undetermined (a normal along the datum's own normal
 *  cannot be made perpendicular to it) or the fit has no direction. */
export function constrainedDirection(fit: FitData, constraint: ConstraintId): Vec3 | null {
  const current = directionOf(fit)
  if (!current || !canConstrain(fit) || constraint === 'none') return null
  const [mode, plane] = constraint.split('-') as ['parallel' | 'perpendicular', 'oxy' | 'oyz' | 'oxz']
  const N = DATUM_NORMAL[plane]
  // A plane parallel to a datum has its normal along the datum's; an axis
  // parallel to it lies in it, so the roles swap.
  const along = fit.kind === 'plane' ? mode === 'parallel' : mode === 'perpendicular'
  if (along) return alike(N, current)
  return unit(sub(current, scale(N, dot(current, N))))
}

const centroid = (pos: Float32Array, idx: ArrayLike<number>): Vec3 => {
  let x = 0, y = 0, z = 0
  for (let i = 0; i < idx.length; i++) { const j = idx[i] * 3; x += pos[j]; y += pos[j + 1]; z += pos[j + 2] }
  const n = Math.max(1, idx.length)
  return [x / n, y / n, z / n]
}
const point = (pos: Float32Array, i: number): Vec3 => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]

/** The residual figures of a fit, from its signed residuals. */
function figures(res: number[]): { sigma: number; formError: number; residualMin: number; residualMax: number } {
  let s = 0, lo = Infinity, hi = -Infinity
  for (const e of res) { s += e * e; if (e < lo) lo = e; if (e > hi) hi = e }
  return { sigma: Math.sqrt(s / Math.max(1, res.length)), formError: hi - lo, residualMin: lo, residualMax: hi }
}

/** A plane with its normal held to `n`, measured again on the points: through
 *  their mean, or at `offset` (n · x) when that is held too. */
function planeWith(fit: PlaneFit, pos: Float32Array, idx: ArrayLike<number>, n: Vec3, offset?: number): PlaneFit {
  const c = centroid(pos, idx)
  const d = offset ?? dot(n, c)
  const [bu, bv] = orthoBasis(n)
  const res: number[] = []
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity
  for (let i = 0; i < idx.length; i++) {
    const p = point(pos, idx[i])
    res.push(dot(n, p) - d)
    const pu = dot(bu, p), pv = dot(bv, p)
    if (pu < u0) u0 = pu
    if (pu > u1) u1 = pu
    if (pv < v0) v0 = pv
    if (pv > v1) v1 = pv
  }
  const center = add(add(scale(bu, (u0 + u1) / 2), scale(bv, (v0 + v1) / 2)), scale(n, d))
  return { ...fit, ...figures(res), center, normal: n, basisU: bu, basisV: bv, extentU: (u1 - u0) / 2, extentV: (v1 - v0) / 2 }
}

/** A cylinder with its axis held to `a`: the circle the points make seen down
 *  the axis, fitted again (algebraic least squares) — or about `through`, an
 *  axis point held too, with only the radius free. */
function cylinderWith(fit: CylinderFit, pos: Float32Array, idx: ArrayLike<number>, a: Vec3, through?: Vec3): CylinderFit | null {
  const [bu, bv] = orthoBasis(a)
  const n = idx.length
  if (n < 3) return null
  let cu: number, cv: number
  if (through) {
    cu = dot(bu, through)
    cv = dot(bv, through)
  } else {
    // Kåsa: x² + y² = 2·cu·x + 2·cv·y + k, least squares in (cu, cv, k).
    let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, sxz = 0, syz = 0, sz = 0
    for (let i = 0; i < n; i++) {
      const p = point(pos, idx[i])
      const x = dot(bu, p), y = dot(bv, p), z = x * x + y * y
      sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y; sxz += x * z; syz += y * z; sz += z
    }
    // Normal equations for [2cu, 2cv, k]; solved by Cramer's rule.
    const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]]
    const rhs = [sxz, syz, sz]
    const det3 = (q: number[][]) => q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) - q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) + q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0])
    const D = det3(m)
    if (!(Math.abs(D) > 1e-12)) return null
    const col = (k: number) => det3(m.map((row, r) => row.map((v, c) => (c === k ? rhs[r] : v))))
    cu = col(0) / D / 2
    cv = col(1) / D / 2
  }
  let rsum = 0, lo = Infinity, hi = -Infinity
  const dists: number[] = []
  for (let i = 0; i < n; i++) {
    const p = point(pos, idx[i])
    const r = Math.hypot(dot(bu, p) - cu, dot(bv, p) - cv)
    dists.push(r)
    rsum += r
    const t = dot(a, p)
    if (t < lo) lo = t
    if (t > hi) hi = t
  }
  const radius = rsum / n
  const t = (lo + hi) / 2
  const center = add(add(scale(bu, cu), scale(bv, cv)), scale(a, t))
  return { ...fit, ...figures(dists.map((r) => r - radius)), center, axis: a, radius, length: hi - lo }
}

/** A line with its direction held to `d`, through the points' mean. */
function lineWith(fit: LineFit, pos: Float32Array, idx: ArrayLike<number>, d: Vec3): LineFit {
  const c = centroid(pos, idx)
  const res: number[] = []
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < idx.length; i++) {
    const q = sub(point(pos, idx[i]), c)
    const t = dot(d, q)
    if (t < lo) lo = t
    if (t > hi) hi = t
    res.push(len(sub(q, scale(d, t))))
  }
  return { ...fit, ...figures(res), center: add(c, scale(d, (lo + hi) / 2)), dir: d, length: hi - lo }
}

/** The fit with its direction held to `dir`, measured again on the points. */
export function withDirection(fit: FitData, pos: Float32Array, idx: ArrayLike<number>, dir: Vec3, hold?: { offset?: number; through?: Vec3 }): FitData | null {
  const d = unit(dir)
  if (!d || idx.length < 3) return null
  if (fit.kind === 'plane') return planeWith(fit, pos, idx, d, hold?.offset)
  if (fit.kind === 'cylinder') return cylinderWith(fit, pos, idx, d, hold?.through)
  if (fit.kind === 'line') return lineWith(fit, pos, idx, d)
  return null
}

/** Step 2's dropdown: the fit held parallel or perpendicular to a coordinate
 *  plane, or null when it cannot be (no direction, or it lies along the
 *  datum's normal and perpendicular is then undetermined). */
export function constrainFit(fit: FitData, pos: Float32Array, idx: ArrayLike<number>, constraint: ConstraintId): FitData | null {
  const dir = constrainedDirection(fit, constraint)
  return dir ? withDirection(fit, pos, idx, dir) : null
}

export interface Neighbour { name: string; fit: FitData }

/** Auto Constrain: the new fit snapped to the primitives already made. A
 *  direction within `tiltDeg` of parallel — or of perpendicular — to one of
 *  theirs is held to it (the nearest wins); a plane then within
 *  `coincidenceMm` of a parallel one's is moved onto it, and a cylinder whose
 *  axis then lies within it of a parallel one's onto that axis. `notes` say
 *  what was done, for the status line. */
export function autoConstrainFit(fit: FitData, pos: Float32Array, idx: ArrayLike<number>, others: readonly Neighbour[], tol: ConstraintTolerances = DEFAULT_TOLERANCES): { fit: FitData; notes: string[] } {
  const own = directionOf(fit)
  if (!own || !canConstrain(fit)) return { fit, notes: [] }
  let best: { dir: Vec3; off: number; how: 'parallel' | 'perpendicular'; to: Neighbour } | null = null
  for (const o of others) {
    const od = directionOf(o.fit)
    if (!od || o.fit.kind === 'cone') continue
    const par = angleDeg(own, od)
    if (par <= tol.tiltDeg && (!best || par < best.off)) best = { dir: alike(od, own), off: par, how: 'parallel', to: o }
    const perp = offRightDeg(own, od)
    if (perp <= tol.tiltDeg && (!best || perp < best.off)) {
      const flat = unit(sub(own, scale(od, dot(own, od))))
      if (flat) best = { dir: flat, off: perp, how: 'perpendicular', to: o }
    }
  }
  if (!best) return { fit, notes: [] }
  const notes: string[] = [`${best.how} to ${best.to.name}${best.off > 0.005 ? ` (${best.off.toFixed(2)}° off)` : ''}`]
  let out = withDirection(fit, pos, idx, best.dir)
  if (!out) return { fit, notes: [] }
  if (best.how === 'parallel') {
    if (out.kind === 'plane' && best.to.fit.kind === 'plane') {
      const gap = dot(out.normal, sub(out.center, best.to.fit.center))
      if (Math.abs(gap) <= tol.coincidenceMm) {
        const held = withDirection(fit, pos, idx, best.dir, { offset: dot(out.normal, best.to.fit.center) })
        if (held) { out = held; notes.push(`coincident with ${best.to.name}`) }
      }
    } else if (out.kind === 'cylinder' && best.to.fit.kind === 'cylinder') {
      const a = out.axis
      const apart = sub(out.center, best.to.fit.center)
      const across = len(sub(apart, scale(a, dot(a, apart))))
      if (across <= tol.coincidenceMm) {
        const held = withDirection(fit, pos, idx, best.dir, { through: best.to.fit.center })
        if (held) { out = held; notes.push(`on the axis of ${best.to.name}`) }
      }
    }
  }
  return { fit: out, notes }
}

/** Analysis: the indices (positions in `idx`) of marked points lying further
 *  than `toleranceMm` from the fit, with the worst distance. */
export function pointsBeyond(fit: FitData, pos: Float32Array, idx: ArrayLike<number>, toleranceMm: number): { far: number[]; worst: number } {
  const far: number[] = []
  let worst = 0
  for (let i = 0; i < idx.length; i++) {
    const p = point(pos, idx[i])
    const e = Math.abs(distanceTo(fit, p))
    if (!Number.isFinite(e)) continue
    if (e > worst) worst = e
    if (e > toleranceMm) far.push(i)
  }
  return { far, worst }
}

/** How far a point lies from the fit's surface. NaN for kinds with no surface here. */
function distanceTo(fit: FitData, p: Vec3): number {
  if (fit.kind === 'plane') return dot(fit.normal, sub(p, fit.center))
  if (fit.kind === 'sphere') return len(sub(p, fit.center)) - fit.radius
  if (fit.kind === 'cylinder') {
    const q = sub(p, fit.center)
    return len(sub(q, scale(fit.axis, dot(fit.axis, q)))) - fit.radius
  }
  if (fit.kind === 'cone') {
    const q = sub(p, fit.center)
    const t = dot(fit.axis, q)
    const rho = len(sub(q, scale(fit.axis, t)))
    const half = (fit.halfAngle * Math.PI) / 180
    // The radius at t along the axis, and the distance to the slanted wall.
    return (rho - (fit.radius + t * Math.tan(half))) * Math.cos(half)
  }
  if (fit.kind === 'line') {
    const q = sub(p, fit.center)
    return len(sub(q, scale(fit.dir, dot(fit.dir, q))))
  }
  return NaN
}

