// SPDX-License-Identifier: AGPL-3.0-only
// Analysis → Measure on a sketch: what a click takes and what it reads.
// The click is taken exactly as the Dimension tool takes it (core/draw.ts
// `dimPickAt`, with ends, middles, centres and quadrant points all in
// play), so Measure and Smart Dimension name the same centre, the same
// quadrant point and the same piece from the same click — then read
// through core/measureEval, which changes nothing.
//
// One pick reads the thing itself (a circle's radius, diameter,
// circumference; a line's length; a point's place). A second pick reads
// the two together: a piece clicked on the square of its middle or of a
// quadrant point is that point once paired (draw.ts `pickAsPoint`), as in
// the Dimension tool. A click inside a closed loop, on nothing of the
// sketch, reads the loop: its perimeter, its holes', its area.

import type { Vec2 } from '../../../src/core/flat/types'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'
import { dimPickAt, pickAsPoint, type DimPick, type PickAllow } from './draw'
import { measureOne, measureRegion, measureTwo, refName, refPoint, type MeasureRef, type MeasureResult } from './measureEval'
import { findRegions, regionAt, type Region } from './regions'
import { entityOf, entityPolyline, type Sketch } from './sketch'

/** Every kind of point is a target for Measure, at the Dimension tool's
 *  reaches: an end's, and the square's own for a middle or a quadrant. */
export const MEASURE_ALLOW: PickAllow = { endpoint: true, midpoint: true, center: true, quadrant: true, curve: true }

/** What a click on a sketch took. */
export type MeasureHit =
  | { kind: 'pick'; pick: Extract<DimPick, { kind: 'piece' | 'point' }> }
  | { kind: 'origin' }
  | { kind: 'region'; region: Region }

/** A sketch's closed loops, found once for each state of its pieces: the
 *  cursor asks for them every frame it moves. Keyed by the pieces as they
 *  stand, not the sketch alone — an open sketch is edited in place. */
const loopsOf = new WeakMap<Sketch, { key: string; regions: Region[] }>()
function regionsOf(sketch: Sketch): Region[] {
  const key = JSON.stringify(sketch.entities)
  const kept = loopsOf.get(sketch)
  if (kept && kept.key === key) return kept.regions
  const regions = findRegions(sketch)
  loopsOf.set(sketch, { key, regions })
  return regions
}

/** The click's hit on one sketch: a piece or a point of it within
 *  `radius` (sheet millimetres), else the sheet's zero, else the closed
 *  loop it falls in; null where there is nothing of the sketch. `allow`
 *  is the snap bar's Pick switches, the Dimension tool's; every kind by
 *  default. */
export function measureHitAt(sketch: Sketch, spot: Vec2, radius: number, allow: PickAllow = MEASURE_ALLOW): MeasureHit | null {
  const pick = dimPickAt(sketch, spot, radius, [], allow)
  if (pick && (pick.kind === 'piece' || pick.kind === 'point')) return { kind: 'pick', pick }
  if (Math.hypot(spot[0], spot[1]) <= radius * 0.75) return { kind: 'origin' }
  const region = regionAt(regionsOf(sketch), spot)
  return region ? { kind: 'region', region } : null
}

/** What a hit lights before it is clicked, in the sheet: the piece's
 *  line (a square's piece too, which is the piece until it is paired),
 *  the loop's edges and its holes'; none for a point, which is shown as
 *  a dot (`pointOfHit`). */
export function outlineOfHit(sketch: Sketch, hit: MeasureHit): Vec2[][] {
  if (hit.kind === 'region') {
    const close = (pts: Vec2[]) => (pts.length > 2 ? [...pts, pts[0]] : pts)
    return [hit.region.outer, ...hit.region.holes].map((l) => close(l.polygon))
  }
  if (hit.kind !== 'pick' || hit.pick.kind !== 'piece') return []
  const e = entityOf(sketch, hit.pick.id)
  return e && e.kind !== 'point' ? [entityPolyline(e)] : []
}

/** Where a ray (in the part's coordinates) meets a sketch's plane, in the
 *  sheet's coordinates, and how far along the ray: null when it runs along
 *  the plane. */
export function planeSpot(frame: SectionFrame, origin: Vec3, dir: Vec3): { spot: Vec2; t: number } | null {
  const n = frame.normal
  const denom = dir[0] * n[0] + dir[1] * n[1] + dir[2] * n[2]
  if (Math.abs(denom) < 1e-9) return null
  const w: Vec3 = [frame.origin[0] - origin[0], frame.origin[1] - origin[1], frame.origin[2] - origin[2]]
  const t = (w[0] * n[0] + w[1] * n[1] + w[2] * n[2]) / denom
  const p: Vec3 = [origin[0] + dir[0] * t - frame.origin[0], origin[1] + dir[1] * t - frame.origin[1], origin[2] + dir[2] * t - frame.origin[2]]
  const u = frame.basisU
  const v = frame.basisV
  return { spot: [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]], t }
}

/** A hit as a Measure reference, by itself (`paired` false: a piece is the
 *  piece) or as one of two (`paired`: a piece clicked on a square is the
 *  square's point). Null for a region, which pairs with nothing. */
export function refOfHit(hit: MeasureHit, paired: boolean): MeasureRef | null {
  if (hit.kind === 'origin') return { kind: 'origin' }
  if (hit.kind === 'region') return null
  const p = paired ? pickAsPoint(hit.pick) : hit.pick
  if (p.kind === 'point') return { kind: 'point', anchor: p.anchor }
  if (p.kind === 'piece') return { kind: 'piece', id: p.id }
  return null
}

/** One readout: what it is of, and its results. */
export interface SketchReadout {
  title: string
  rows: MeasureResult[]
}

/** The short sign put before the figure laid over the view. */
const SHORT: Record<string, string> = {
  radius: 'R', diameter: 'Ø', circumference: 'C', arcLength: 'Arc', chord: 'Chord', sweep: '∠', centralAngle: '∠', angle: '∠',
  length: 'L', perimeter: 'P', area: 'A', centerDistance: '', distance: '', minDistance: 'min', lineDistance: '⊥',
}
export const shortOf = (key: string): string => SHORT[key] ?? ''

/** What one click reads by itself. */
export function readoutOne(sketch: Sketch, hit: MeasureHit, name: string): SketchReadout {
  if (hit.kind === 'region') {
    const holes = hit.region.holes.length
    return { title: `${name}: closed loop${holes ? ` with ${holes} hole${holes > 1 ? 's' : ''}` : ''}`, rows: measureRegion(hit.region, sketch) }
  }
  const ref = refOfHit(hit, false)!
  return { title: `${name}: ${refName(sketch, ref)}`, rows: measureOne(sketch, ref) }
}

/** What two clicks on one sketch read together. */
export function readoutTwo(sketch: Sketch, a: MeasureHit, b: MeasureHit, name: string): SketchReadout {
  const ra = refOfHit(a, true)
  const rb = refOfHit(b, true)
  if (!ra || !rb) return { title: name, rows: [] }
  const rows = measureTwo(sketch, ra, rb)
  return {
    title: `${name}: ${refName(sketch, ra)} → ${refName(sketch, rb)}`,
    rows: rows.length ? rows : [{ label: 'Nothing to read between these two', key: 'none', value: NaN, unit: 'length', exact: false, note: 'pick points (ends, centres, quadrant points) to measure between them' }],
  }
}

/** A hit's point in the sheet, for a pair across two sketches: a point,
 *  a point piece, a square's point, the zero. Null for a whole piece. */
export function pointOfHit(sketch: Sketch, hit: MeasureHit): Vec2 | null {
  const ref = refOfHit(hit, true)
  return ref ? refPoint(sketch, ref) : null
}

/** Two points of different sketches, in the part: the straight distance
 *  and its X, Y and Z parts, the sketches' own axes not being shared. */
export function readoutAcross(pa: Vec3, pb: Vec3, title: string): SketchReadout {
  const d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]]
  return {
    title,
    rows: [
      { label: 'Straight-line distance (3D)', key: 'distance', value: Math.hypot(d[0], d[1], d[2]), unit: 'length', exact: true },
      { label: 'ΔX (part X)', key: 'dx', value: Math.abs(d[0]), unit: 'length', exact: true },
      { label: 'ΔY (part Y)', key: 'dy', value: Math.abs(d[1]), unit: 'length', exact: true },
      { label: 'ΔZ (part Z)', key: 'dz', value: Math.abs(d[2]), unit: 'length', exact: true },
    ],
  }
}
