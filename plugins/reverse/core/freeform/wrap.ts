// SPDX-License-Identifier: AGPL-3.0-only
// Wrap Surface (F4 of audit-2026-11-07/FREEFORM_ROADMAP.md): the cage
// QUICKSURFACE sweeps round a selected region of the scan. The region is
// read as a cylinder — its axis from the surface normals, its radius from
// a circle fit across the axis, the region's extent along and round it —
// and a ring of quads is laid over that extent at Low, Medium or Fine
// density (4, 8 or 16 quads round a full turn). The cage's limit surface
// is drawn in from its control points, so they are set out far enough that
// it lands on the wall; the snap then makes the surface the scan's own.
// A region that goes all the way round gives a tube; one that does not
// gives a strip, open at its sides.

import { axisFromNormals, fitCylinderOnAxis, refineCylinderGeometric } from '../../../../src/core/fit/cylinder'
import { cross, orthoBasis } from '../../../../src/core/fit/linalg'
import type { Cylinder, Vec3 } from '../../../../src/core/types'
import type { FreeformSnapRegion } from '../features'
import type { Cage } from './cage'
import { snapCage } from './edit'
import { cylinderClosest } from './snap'

export type WrapDensity = 'low' | 'medium' | 'fine'
/** Quads round a full turn, by density. */
export const WRAP_AROUND: Record<WrapDensity, number> = { low: 4, medium: 8, fine: 16 }
/** The most quads a wrap cage takes: round × along. */
export const MAX_WRAP_QUADS = 20_000
/** The widest gap between points round the axis, radians, that still reads as a region going all the way round. */
const CLOSED_GAP = 0.45

export class WrapError extends Error {}

export interface WrapFit {
  axis: Cylinder
  /** The region's extent along the axis, from the axis point, mm. */
  t0: number
  t1: number
  /** Where the region starts round the axis (radians from the basis direction u) and how far it goes. */
  start: number
  sweep: number
  closed: boolean
  /** Points the fit was made of. */
  points: number
  /** The basis the angles are measured in; u × v = the axis. */
  u: Vec3
  v: Vec3
}

/** Area-weighted vertex normals of a triangle soup, for every vertex of the scan. */
export function scanVertexNormals(positions: Float32Array, indices: ArrayLike<number>): Float32Array {
  const n = new Float32Array(positions.length)
  const limit = positions.length / 3
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const ia = indices[t], ib = indices[t + 1], ic = indices[t + 2]
    if (!(ia >= 0 && ib >= 0 && ic >= 0 && ia < limit && ib < limit && ic < limit)) continue
    const a = ia * 3, b = ib * 3, c = ic * 3
    const e1: Vec3 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]]
    const e2: Vec3 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]
    const f = cross(e1, e2)
    for (const i of [a, b, c]) for (let k = 0; k < 3; k++) n[i + k] += f[k]
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i], n[i + 1], n[i + 2])
    if (len > 0) for (let k = 0; k < 3; k++) n[i + k] /= len
  }
  return n
}

const unit = (d: Vec3): Vec3 => {
  const l = Math.hypot(d[0], d[1], d[2])
  if (!(l > 0) || !Number.isFinite(l)) throw new WrapError('The axis needs a direction, not a zero vector.')
  return [d[0] / l, d[1] / l, d[2] / l]
}

/** The cylinder a region is, and how far along and round it goes. `normals` (per scan vertex)
 *  find the axis; `given` sets its direction (and its radius where named). */
export function fitWrap(positions: Float32Array, idx: ArrayLike<number>, normals: Float32Array | null, given?: { dir: Vec3; radius?: number }): WrapFit {
  if (idx.length < 12) throw new WrapError(`The region has ${idx.length} scan points; a wrap needs 12 at least.`)
  for (let i = 0; i < idx.length; i++) if (!(idx[i] >= 0 && idx[i] * 3 + 2 < positions.length)) throw new WrapError(`The region names scan point ${idx[i]}, which the scan does not have.`)
  let dir: Vec3 | null
  if (given) dir = unit(given.dir)
  else {
    if (!normals) throw new WrapError('The scan has no triangles to read normals from: give the axis.')
    dir = axisFromNormals(normals, idx)
    if (!dir) throw new WrapError('The region is too flat to have an axis: a wrap goes round a curved wall. Give the axis, or take a region that curves.')
  }
  const base = fitCylinderOnAxis(positions, idx, dir)
  let axis = base ? (given ? base : refineCylinderGeometric(positions, idx, base)) : null
  if (axis && given?.radius !== undefined) axis = { ...axis, r: given.radius }
  if (!axis || !(axis.r > 0) || !Number.isFinite(axis.r)) throw new WrapError('No cylinder fits the region.')
  const a: Vec3 = [axis.ax, axis.ay, axis.az]
  const [u, v0] = orthoBasis(a)
  // Keep u × v along the axis, so the angle runs the right-handed way round it.
  const h = cross(u, v0)
  const v: Vec3 = h[0] * a[0] + h[1] * a[1] + h[2] * a[2] >= 0 ? v0 : [-v0[0], -v0[1], -v0[2]]
  let t0 = Infinity, t1 = -Infinity
  const angles: number[] = []
  for (let i = 0; i < idx.length; i++) {
    const j = idx[i] * 3
    const q: Vec3 = [positions[j] - axis.px, positions[j + 1] - axis.py, positions[j + 2] - axis.pz]
    const t = q[0] * a[0] + q[1] * a[1] + q[2] * a[2]
    if (t < t0) t0 = t
    if (t > t1) t1 = t
    angles.push(Math.atan2(q[0] * v[0] + q[1] * v[1] + q[2] * v[2], q[0] * u[0] + q[1] * u[1] + q[2] * u[2]))
  }
  // A ring of quads over less than a hundredth of the radius would be slivers.
  if (!(t1 - t0 > Math.max(1e-6, axis.r * 0.01))) throw new WrapError(`The region is ${(t1 - t0).toFixed(3)} mm long along its axis, too thin to lay a ring of quads over.`)
  angles.sort((x, y) => x - y)
  let gap = angles[0] + 2 * Math.PI - angles[angles.length - 1]
  let after = 0
  for (let i = 1; i < angles.length; i++) {
    if (angles[i] - angles[i - 1] > gap) {
      gap = angles[i] - angles[i - 1]
      after = i
    }
  }
  const closed = gap < CLOSED_GAP
  return { axis, t0, t1, start: closed ? 0 : angles[after], sweep: closed ? 2 * Math.PI : 2 * Math.PI - gap, closed, points: idx.length, u, v }
}

/** The control radii of an open strip of `around` quads, `step` radians each: the two ends lie on the wall (a boundary
 *  vertex of the strip's side edge stays where it is), and the inside ones are set so the limit (c₋ + 4c + c₊) / 6 of
 *  each lands on it — 4 r + cos(step) (r₋ + r₊) = 6 R, a tridiagonal system solved outward in. */
function stripRadii(R: number, step: number, around: number): number[] {
  const n = around - 1
  const out = new Array<number>(around + 1).fill(R)
  if (n < 1) return out
  const c = Math.cos(step)
  // Thomas algorithm for the n inside radii: diagonal 4, off-diagonals cos(step), right-hand side 6R less the ends' share.
  const diag = new Array<number>(n).fill(4)
  const rhs = new Array<number>(n).fill(6 * R)
  rhs[0] -= c * R
  rhs[n - 1] -= c * R
  for (let i = 1; i < n; i++) {
    const m = c / diag[i - 1]
    diag[i] -= m * c
    rhs[i] -= m * rhs[i - 1]
  }
  const x = new Array<number>(n)
  x[n - 1] = rhs[n - 1] / diag[n - 1]
  for (let i = n - 2; i >= 0; i--) x[i] = (rhs[i] - c * x[i + 1]) / diag[i]
  for (let i = 0; i < n; i++) out[i + 1] = x[i]
  return out
}

/** How a region that does not go all the way round is closed: with a chord across the part, as QUICKSURFACE's
 *  Wrap does, or left an open strip. */
export type WrapClosure = 'chord' | 'none'

export interface WrapCage {
  cage: Cage
  /** Quads round and along. */
  around: number
  along: number
  fit: WrapFit
  closure: WrapClosure | 'whole'
  /** Cage vertices over the region's own arc: those the snap moves; the chord's are held. */
  onRegion: number[]
}

/** The ring of quads over the region the fit found, at `density`. Faces wind outward.
 *
 *  QUICKSURFACE lays the ring on a grid of 4, 8 or 16 steps a turn anchored at the axis' own basis, keeps
 *  the vertices whose angle falls in the region, adds one at each end of the region's arc, and closes the
 *  loop with a chord across the part: measured on basic_part's wall (170°, Low 4 × 1, Medium 8 × 2,
 *  Fine 16 × 4; analysis/freeform-2026-11-07/native-wrap-densities-quads.obj). */
export function wrapCage(fit: WrapFit, density: WrapDensity, closure: WrapClosure = 'chord'): WrapCage {
  const full = WRAP_AROUND[density]
  if (!full) throw new WrapError(`Density is low, medium or fine, not ${String(density)}.`)
  const { axis, u, v } = fit
  const seg = (2 * Math.PI) / full
  const length = fit.t1 - fit.t0
  const along = Math.max(1, Math.round(length / (axis.r * seg)))
  const a: Vec3 = [axis.ax, axis.ay, axis.az]
  const o: Vec3 = [axis.px, axis.py, axis.pz]
  // The ring in the plane across the axis: points as (cos, sin) coefficients of u and v, in radius rc.
  const rc = axis.r / ((4 + 2 * Math.cos(seg)) / 6)
  const ring: [number, number][] = []
  let onRegion = 0
  let kind: WrapCage['closure']
  if (fit.closed) {
    for (let j = 0; j < full; j++) ring.push([rc * Math.cos(seg * j), rc * Math.sin(seg * j)])
    onRegion = full
    kind = 'whole'
  } else if (closure === 'none') {
    const around = Math.max(1, Math.ceil(fit.sweep / seg - 1e-9))
    const step = fit.sweep / around
    const radii = stripRadii(axis.r, step, around)
    for (let j = 0; j <= around; j++) ring.push([radii[j] * Math.cos(fit.start + step * j), radii[j] * Math.sin(fit.start + step * j)])
    onRegion = ring.length
    kind = 'none'
  } else {
    // The arc as an open strip whose ends are on the wall (they are creases: the limit passes through them), and the
    // chord's vertices along the straight line closing it, so the ring has as many vertices as a full turn would.
    const arcQuads = Math.max(1, Math.ceil(fit.sweep / seg - 1e-9))
    const step = fit.sweep / arcQuads
    const radii = stripRadii(axis.r, step, arcQuads)
    for (let j = 0; j <= arcQuads; j++) ring.push([radii[j] * Math.cos(fit.start + step * j), radii[j] * Math.sin(fit.start + step * j)])
    onRegion = ring.length
    const chord = Math.max(0, full - ring.length)
    const [bx, by] = ring[ring.length - 1], [ax0, ay0] = ring[0]
    for (let k = 1; k <= chord; k++) ring.push([bx + ((ax0 - bx) * k) / (chord + 1), by + ((ay0 - by) * k) / (chord + 1)])
    kind = 'chord'
  }
  const around = ring.length
  if (around * along > MAX_WRAP_QUADS) throw new WrapError(`A wrap of ${around} × ${along} quads is more than the ${MAX_WRAP_QUADS} it takes: use a lower density or a smaller region.`)
  const closed = kind !== 'none'
  const cols = closed ? around : around
  const positions = new Float64Array((along + 1) * cols * 3)
  for (let k = 0; k <= along; k++) {
    const t = fit.t0 + (length * k) / along
    for (let j = 0; j < cols; j++) {
      const [c, s] = ring[j]
      for (let m = 0; m < 3; m++) positions[(k * cols + j) * 3 + m] = o[m] + a[m] * t + u[m] * c + v[m] * s
    }
  }
  const quadsAround = closed ? around : around - 1
  const at = (k: number, j: number) => k * cols + (j % cols)
  const faces: number[][] = []
  for (let k = 0; k < along; k++) for (let j = 0; j < quadsAround; j++) faces.push([at(k, j), at(k, j + 1), at(k + 1, j + 1), at(k + 1, j)])
  // Wound so the normal points away from the axis, read on the first face (on the arc).
  const p = (i: number): Vec3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]
  const [p0, p1, , p3] = faces[0].map(p)
  const n = cross([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]])
  const radial: Vec3 = [p0[0] - o[0], p0[1] - o[1], p0[2] - o[2]]
  if (n[0] * radial[0] + n[1] * radial[1] + n[2] * radial[2] < 0) for (const f of faces) f.reverse()
  const on: number[] = []
  for (let k = 0; k <= along; k++) for (let j = 0; j < onRegion; j++) on.push(k * cols + j)
  // Where the chord leaves the wall the surface turns a corner (QUICKSURFACE doubles the vertices there): the two
  // edges down the arc's ends are creases, so the limit has the corner and the blocks are made apart at it.
  const creases: [number, number][] = []
  if (kind === 'chord') for (let k = 0; k < along; k++) for (const j of [0, onRegion - 1]) creases.push([at(k, j), at(k + 1, j)])
  return { cage: { positions, faces, creases }, around: quadsAround, along, fit, closure: kind, onRegion: on }
}

/** Where a wrap's snap reaches, as a feature keeps it; null for a region that goes all the way round (the whole wall is the region's). */
export function snapRegionOf(fit: WrapFit, density: WrapDensity): FreeformSnapRegion | null {
  if (fit.closed) return null
  const { axis } = fit
  return { point: [axis.px, axis.py, axis.pz], dir: [axis.ax, axis.ay, axis.az], radius: axis.r, u: fit.u, v: fit.v, t0: fit.t0, t1: fit.t1, start: fit.start, sweep: fit.sweep, margin: Math.PI / WRAP_AROUND[density] }
}

/** `closest` restricted to a snap region: null wherever the region has no say (snapWeight 0) — so a snap holds the
 *  chord, which runs through the part, and whatever else the ring reaches off the region. */
export function regionClosestIn<T extends { distance: number }>(region: FreeformSnapRegion, closest: (p: Vec3) => T | null): (p: Vec3) => T | null {
  return (p) => {
    if (!(snapWeight(region, p) > 0)) return null
    const c = closest(p)
    return c && c.distance <= REACH_NONE * region.radius ? c : null
  }
}

/** How far the scan's nearest point may be from the surface, as a fraction of the radius, for the snap to have all of
 *  its say, and none. A wall has relief of a few tenths of a millimetre to a couple of millimetres; a nearest point
 *  further than that is not the wall — a hole in the scan, the far side of a thin wall, a neighbouring face — and
 *  taking the surface there tears it. */
const REACH_FULL = 0.005
const REACH_NONE = 0.02

/** How far off the wall, as a fraction of the radius, the snap still has all of its say, and none. A wall's grooves are
 *  a few hundredths of the radius deep; past a tenth the nearest scan is a neighbouring face or the far side. */
const RADIAL_FULL = 0.04
const RADIAL_FADE = 0.06

/** The band's two edges for a region, as fractions of the radius: a coarse cage's surface stands off the wall by up to
 *  its sag between control points — about half of 1 − cos(π/N), which the margin (π/N) carries — and the snap is to
 *  bring all of it back, so the band is whole out to that and fades over a further 6 %. */
const radialBand = (region: FreeformSnapRegion): [number, number] => {
  const full = Math.max(RADIAL_FULL, 0.55 * (1 - Math.cos(region.margin)))
  return [full, full + RADIAL_FADE]
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))

/** How far a point is the snap region's to move, 0–1: 1 over the arc and near the wall, falling smoothly to 0 across
 *  the margin either side of the arc and from 4 % to 10 % of the radius off the wall. A surface taken onto the scan
 *  by this weight has no tear where the region ends. */
export function snapWeight(region: FreeformSnapRegion, p: Vec3): number {
  const { point, dir, u, v, radius } = region
  const q: Vec3 = [p[0] - point[0], p[1] - point[1], p[2] - point[2]]
  const t = q[0] * dir[0] + q[1] * dir[1] + q[2] * dir[2]
  const slack = (region.t1 - region.t0) * 0.02 + 1e-6
  if (t < region.t0 - slack || t > region.t1 + slack) return 0
  const rho = Math.hypot(q[0] - t * dir[0], q[1] - t * dir[1], q[2] - t * dir[2])
  const [full, none] = radialBand(region)
  const wr = smooth((none - Math.abs(rho - radius) / radius) / (none - full))
  if (wr === 0) return 0
  let th = Math.atan2(q[0] * v[0] + q[1] * v[1] + q[2] * v[2], q[0] * u[0] + q[1] * u[1] + q[2] * u[2]) - (region.start - region.margin)
  th = ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const span = region.sweep + 2 * region.margin
  if (th > span) return 0
  const wa = region.margin > 0 ? Math.min(smooth(th / region.margin), smooth((span - th) / region.margin)) : 1
  return wr * wa
}

/** The point of the region's cylinder nearest p. */
function onCylinder(region: FreeformSnapRegion, p: Vec3): Vec3 {
  const { point, dir, radius } = region
  const q: Vec3 = [p[0] - point[0], p[1] - point[1], p[2] - point[2]]
  const t = q[0] * dir[0] + q[1] * dir[1] + q[2] * dir[2]
  const r: Vec3 = [q[0] - t * dir[0], q[1] - t * dir[1], q[2] - t * dir[2]]
  const len = Math.hypot(r[0], r[1], r[2])
  if (!(len > 1e-12)) return p
  const s = radius / len
  return [point[0] + dir[0] * t + r[0] * s, point[1] + dir[1] * t + r[1] * s, point[2] + dir[2] * t + r[2] * s]
}

/** The scan's nearest point drawn to the surface by the region's weight: the surface point itself where the region
 *  has no say, the scan's point where it has all of it. */
export function regionSnap(region: FreeformSnapRegion, closest: (p: Vec3) => Vec3 | null): (p: Vec3) => Vec3 | null {
  return (p) => {
    const w = snapWeight(region, p)
    if (!(w > 0)) return null
    // The wall first: the point drawn radially onto the fitted cylinder, which is where a coarse cage's surface
    // would be were it fine; then the scan's relief about that, where the scan is near.
    const on = onCylinder(region, p)
    let target: Vec3 = on
    const c = closest(on)
    if (c) {
      const reach = Math.hypot(c[0] - on[0], c[1] - on[1], c[2] - on[2]) / region.radius
      const k = smooth((REACH_NONE - reach) / (REACH_NONE - REACH_FULL))
      if (k > 0) target = [on[0] + (c[0] - on[0]) * k, on[1] + (c[1] - on[1]) * k, on[2] + (c[2] - on[2]) * k]
    }
    return w >= 1 ? target : [p[0] + (target[0] - p[0]) * w, p[1] + (target[1] - p[1]) * w, p[2] + (target[2] - p[2]) * w]
  }
}

/** `closest` restricted to the region the fit found; a whole-turn region reaches everywhere. */
export function regionClosest<T extends { distance: number }>(fit: WrapFit, density: WrapDensity, closest: (p: Vec3) => T | null): (p: Vec3) => T | null {
  const region = snapRegionOf(fit, density)
  return region ? regionClosestIn(region, closest) : closest
}

/** The cage with its control points moved so its limit surface lies on the fitted cylinder over the region — the
 *  snap's start. A ring of quads laid out for a full turn (rc above) has its limit on the wall only where the ring
 *  is regular: at the ends of a part-turn arc, where the chord pulls on it, and at the open ends of a tube, the limit
 *  falls several millimetres inside, and the scan's nearest point from there may be the wall's far side. Settled
 *  first, the scan snap moves each point by the wall's own relief (tenths of a millimetre) and nearest is unambiguous. */
export function settleWrap(w: WrapCage, density: WrapDensity): Cage {
  const { axis } = w.fit
  const cyl = cylinderClosest([axis.px, axis.py, axis.pz], [axis.ax, axis.ay, axis.az], axis.r)
  const region = snapRegionOf(w.fit, density)
  const closest = (p: Vec3): { point: Vec3; distance: number } | null => {
    if (region && !(snapWeight(region, p) > 0)) return null
    const q = cyl(p, [0, 0, 0])
    return q ? { point: q, distance: Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) } : null
  }
  return snapCage(w.cage, closest, 40, 1e-4).cage
}
