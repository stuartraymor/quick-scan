// SPDX-License-Identifier: AGPL-3.0-only
// How well a corner made by Corner Trim's Auto Fillet follows the scan, and
// the geometry its radius handle works on. The fillet is always a circular
// arc (as QUICKSURFACE makes it); when the scan's round is not circular the
// best arc can still be off the scan by more than the sketch tolerance, and
// that is said rather than left silent. The check reads the scan points the
// round was fitted to against the finished corner: the two pieces and the
// arc between them, at their exact distances (no sampling).
import type { Vec2 } from '../../../src/core/flat/types'
import { arcPoint, entityOf, nearestOnEntity, type Sketch, type SketchArc } from './sketch'

export interface FilletScanFit {
  /** Largest distance of a scan point from the finished corner, mm. */
  maxMm: number
  /** RMS of those distances, mm. */
  rmsMm: number
  /** Scan points further off than the tolerance. */
  over: number
  /** Scan points read. */
  points: number
  toleranceMm: number
  exceeds: boolean
}

/** Distance of each scan point to the nearest of `ids` in `sketch`. */
export function cornerDistances(sketch: Sketch, ids: readonly number[], points: readonly Vec2[]): number[] {
  const pieces = ids.map((id) => entityOf(sketch, id)).filter((e) => e !== undefined)
  if (!pieces.length) return []
  return points.filter((p) => p.every(Number.isFinite)).map((p) => Math.min(...pieces.map((e) => nearestOnEntity(e, p).dist)))
}

/** The scan points against the finished corner, within `toleranceMm`. */
export function filletScanFit(sketch: Sketch, ids: readonly number[], points: readonly Vec2[], toleranceMm: number): FilletScanFit | null {
  const d = cornerDistances(sketch, ids, points)
  if (!d.length || !(toleranceMm > 0)) return null
  const maxMm = Math.max(...d)
  const rmsMm = Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length)
  const over = d.filter((x) => x > toleranceMm).length
  return { maxMm, rmsMm, over, points: d.length, toleranceMm, exceeds: over > 0 }
}

/** The middle of an arc's sweep: where its radius handle sits. */
export function arcMiddle(arc: Pick<SketchArc, 'c' | 'r' | 'start' | 'sweep'>): Vec2 {
  return arcPoint(arc, arc.start + arc.sweep / 2)
}

/** The radius a handle dragged to `at` asks for. The handle sits at the
 *  middle of the fillet arc; as the radius grows that point runs away from
 *  the corner point along the line through both (exactly so between two
 *  lines, where it runs down the bisector in proportion to the radius), so
 *  the radius is scaled by how far along that line the cursor is. The
 *  geometry itself is always rebuilt exactly at the radius returned. */
export function radiusFromHandle(corner: Vec2, middle: Vec2, radiusMm: number, at: Vec2): number | null {
  const ux = middle[0] - corner[0], uy = middle[1] - corner[1], reach = Math.hypot(ux, uy)
  if (!(reach > 1e-12) || !(radiusMm > 0) || !at.every(Number.isFinite)) return null
  const along = ((at[0] - corner[0]) * ux + (at[1] - corner[1]) * uy) / reach
  const r = (radiusMm * along) / reach
  return r > 0 && Number.isFinite(r) ? r : null
}

/** A radius rounded to a tidy step in the units shown: 0.01 mm, or
 *  0.001 in (0.0254 mm). Drags land on readable numbers; typed values are
 *  used as typed. */
export function tidyRadius(radiusMm: number, units: 'mm' | 'in' | 'm'): number {
  const step = units === 'in' ? 0.0254 : 0.01
  const r = Math.round(radiusMm / step) * step
  return r > 0 ? r : step
}
