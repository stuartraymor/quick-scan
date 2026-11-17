// SPDX-License-Identifier: AGPL-3.0-only
// Which of the angles between two lines a dimension measures (2D Sketch
// overhaul 3.1). Two lines that cross make four sectors: two of the angle θ
// and two of its supplement 180° − θ. Two lines that meet at a corner (an
// end of each at the crossing) also have the reflex angle 360° − θ outside
// the corner. The sector the cursor stands in when the dimension is put
// down is the one it keeps; moving its number later never changes it.
//
// A sector is the counter-clockwise sweep from the ray sa·dirA to the ray
// sb·dirB (`flip`: from sb·dirB to sa·dirA instead), dirX the line's own
// direction from its end a to its end b. A dimension without a sector is
// the old folded 0–180° angle.

import type { Vec2 } from '../../../src/core/flat/types'
import { entityOf, type Sketch, type SketchLine } from './sketch'

export interface AngleSector { sa: 1 | -1; sb: 1 | -1; flip: boolean }

const TAU = 2 * Math.PI
const mod = (x: number) => ((x % TAU) + TAU) % TAU
const unit = (l: Pick<SketchLine, 'a' | 'b'>): Vec2 | null => {
  const dx = l.b[0] - l.a[0], dy = l.b[1] - l.a[1], n = Math.hypot(dx, dy)
  return n > 1e-12 ? [dx / n, dy / n] : null
}

/** The sector's sweep, radians in [0, 2π), for directions da, db. */
export function sectorSweep(da: Vec2, db: Vec2, s: AngleSector): number {
  const ra: Vec2 = [s.sa * da[0], s.sa * da[1]], rb: Vec2 = [s.sb * db[0], s.sb * db[1]]
  const psi = Math.atan2(ra[0] * rb[1] - ra[1] * rb[0], ra[0] * rb[0] + ra[1] * rb[1])
  return mod(s.flip ? -psi : psi)
}

/** The folded 0–π angle the solver holds a dimension without a sector at. */
export function foldedAngle(da: Vec2, db: Vec2): number {
  const angle = Math.atan2(da[0] * db[1] - da[1] * db[0], da[0] * db[0] + da[1] * db[1])
  return ((angle % Math.PI) + Math.PI) % Math.PI
}

/** The angle a dimension reads, radians: its sector's, or the folded one. */
export function dimensionAngle(da: Vec2, db: Vec2, sector: AngleSector | undefined): number {
  return sector ? sectorSweep(da, db, sector) : foldedAngle(da, db)
}

/** Where the two carriers cross, or null for parallel lines. */
export function carrierCrossing(a: Pick<SketchLine, 'a' | 'b'>, b: Pick<SketchLine, 'a' | 'b'>): Vec2 | null {
  const da = unit(a), db = unit(b)
  if (!da || !db) return null
  const cross = da[0] * db[1] - da[1] * db[0]
  if (Math.abs(cross) < 1e-9) return null
  const w: Vec2 = [b.a[0] - a.a[0], b.a[1] - a.a[1]]
  const t = (w[0] * db[1] - w[1] * db[0]) / cross
  return [a.a[0] + t * da[0], a.a[1] + t * da[1]]
}

/** The sign along a line's direction of its body from the vertex, when one
 *  end of it is at the vertex (a corner); 0 when the line runs through or
 *  stops short of it. */
function cornerSign(l: Pick<SketchLine, 'a' | 'b'>, d: Vec2, vertex: Vec2): 0 | 1 | -1 {
  const len = Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]), tol = Math.max(1e-6, len * 1e-6)
  if (Math.hypot(l.a[0] - vertex[0], l.a[1] - vertex[1]) <= tol) return 1
  if (Math.hypot(l.b[0] - vertex[0], l.b[1] - vertex[1]) <= tol) return -1
  void d
  return 0
}

/** The sector the sheet point `at` stands in, between lines a and b. */
export function sectorAt(a: Pick<SketchLine, 'a' | 'b'>, b: Pick<SketchLine, 'a' | 'b'>, at: Vec2): AngleSector | null {
  const da = unit(a), db = unit(b), vertex = carrierCrossing(a, b)
  if (!da || !db || !vertex) return null
  const u: Vec2 = [at[0] - vertex[0], at[1] - vertex[1]]
  if (Math.hypot(u[0], u[1]) < 1e-12) return null
  // u = α·da + β·db: the signs pick the quadrant whose rays bound u.
  const det = da[0] * db[1] - da[1] * db[0]
  const alpha = (u[0] * db[1] - u[1] * db[0]) / det, beta = (da[0] * u[1] - da[1] * u[0]) / det
  let sa: 1 | -1 = alpha >= 0 ? 1 : -1, sb: 1 | -1 = beta >= 0 ? 1 : -1
  let reflex = false
  // A corner's rays run from the vertex along each line's body; the
  // quadrant behind both is the outside of the corner: its reflex angle.
  const ca = cornerSign(a, da, vertex), cb = cornerSign(b, db, vertex)
  if (ca !== 0 && cb !== 0 && sa === -ca && sb === -cb) { sa = ca; sb = cb; reflex = true }
  // Minor sweep from ra to rb, or the other way round.
  const psi = Math.atan2(sa * sb * det, sa * sb * (da[0] * db[0] + da[1] * db[1]))
  const flip = (psi < 0) !== reflex
  return { sa, sb, flip }
}

/** An angle dimension between lines `a` and `b` set to the sector `at`
 *  stands in, its value the angle the lines make there, degrees. */
export function angleForSector(sketch: Sketch, aId: number, bId: number, at: Vec2): { sector: AngleSector; value: number } | null {
  const a = entityOf(sketch, aId), b = entityOf(sketch, bId)
  if (a?.kind !== 'line' || b?.kind !== 'line') return null
  const sector = sectorAt(a, b, at), da = unit(a), db = unit(b)
  if (!sector || !da || !db) return null
  return { sector, value: (sectorSweep(da, db, sector) * 180) / Math.PI }
}

/** The angle the lines of a dimension make in its sector, degrees. */
export function measureAngleDimension(sketch: Sketch, aId: number, bId: number, sector: AngleSector | undefined): number | null {
  const a = entityOf(sketch, aId), b = entityOf(sketch, bId)
  if (a?.kind !== 'line' || b?.kind !== 'line') return null
  const da = unit(a), db = unit(b)
  return da && db ? (dimensionAngle(da, db, sector) * 180) / Math.PI : null
}
