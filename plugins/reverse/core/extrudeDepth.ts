// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec2 } from '../../../src/core/flat/types'
import type { ExtrudeExtent } from './features'
import { findRegions, type Region } from './regions'
import { sketchBounds, type Sketch } from './sketch'

export type DistanceExtent = Extract<ExtrudeExtent, { kind: 'distance' }>

/** The depth an extrude opens on, as a share of the profile's longest side.
 *  QUICKSURFACE 8.0.128, measured 2026-11-07 (analysis/quick-scan-v0.0.155/
 *  native-extrude-default.json): a 32.905672 × 72.292770 mm rectangle opened
 *  at 21.687829 mm, a 100.9 × 33.6 one at 29.615103 and a 50.5 mm square at
 *  14.807552 — 0.3 of the longer side every time, well past the scan's own
 *  depth, and a 20 mm circle at 6. */
export const OPENING_DEPTH_RATIO = 0.3

/** The axis-aligned bounds of the regions' outer loops, exact on lines, arcs
 *  and circles (the loop's sampled polygon stands in for a spline). */
export function regionsBounds(sketch: Pick<Sketch, 'entities'>, regions: readonly Region[]): { min: Vec2; max: Vec2 } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const take = (x: number, y: number) => {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  for (const region of regions) {
    for (const p of region.outer.polygon) take(p[0], p[1])
    for (const piece of region.outer.pieces) {
      take(piece.p0[0], piece.p0[1])
      take(piece.p1[0], piece.p1[1])
      const e = sketch.entities.find((x) => x.id === piece.entity)
      if (!e || (e.kind !== 'arc' && e.kind !== 'circle')) continue
      // The stretch of the circle from t0 to t1: wherever an axis direction
      // falls inside it, the circle's extreme there bounds the loop.
      const lo = Math.min(piece.t0, piece.t1), hi = Math.max(piece.t0, piece.t1)
      for (let k = 0; k < 4; k++) {
        const axis = (k * Math.PI) / 2
        const turns = Math.ceil((lo - axis) / (2 * Math.PI))
        const theta = axis + turns * 2 * Math.PI
        if (theta <= hi + 1e-9) take(e.c[0] + e.r * Math.cos(axis), e.c[1] + e.r * Math.sin(axis))
      }
    }
  }
  return Number.isFinite(x0) && Number.isFinite(y0) && Number.isFinite(x1) && Number.isFinite(y1) ? { min: [x0, y0], max: [x1, y1] } : null
}

/** The distance a new extrude of `regionKeys` (every closed region when
 *  empty or unknown) opens on: OPENING_DEPTH_RATIO of the longest side of the
 *  profile's bounds, as QUICKSURFACE opens it; null when the sketch has no
 *  extent to measure. */
export function openingDepth(sketch: Pick<Sketch, 'entities'>, regionKeys: readonly string[] = []): number | null {
  const all = findRegions(sketch)
  const picked = all.filter((r) => regionKeys.includes(r.key))
  const bounds = regionsBounds(sketch, picked.length > 0 ? picked : all) ?? sketchBounds(sketch)
  if (!bounds) return null
  const side = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1])
  if (!Number.isFinite(side) || side <= 0) return null
  return OPENING_DEPTH_RATIO * side
}

export function spansSketch({ from, to }: DistanceExtent): boolean {
  return Math.min(from, to) <= 0 && Math.max(from, to) >= 0
}

/** Resize the two physical sides about the sketch, keeping their proportions
 *  and orientation. An empty interval at the sketch grows along its normal. */
export function resizeFullDepth(extent: DistanceExtent, total: number): DistanceExtent {
  if (!spansSketch(extent) || !Number.isFinite(total) || total <= 0) return extent
  const span = Math.abs(extent.to - extent.from)
  if (span === 0) return { kind: 'distance', from: 0, to: total }
  return { kind: 'distance', from: (extent.from / span) * total, to: (extent.to / span) * total }
}

/** A reversed coordinate and its displayed depth use the same expression with
 *  opposite signs. Only unwrap a complete negation, not `-(a) + (b)`. */
export function negateExpression(expression: string): string {
  const text = expression.trim()
  if (text.startsWith('-(')) {
    let depth = 0
    for (let i = 1; i < text.length; i++) {
      if (text[i] === '(') depth++
      if (text[i] === ')' && --depth === 0) {
        if (i === text.length - 1) return text.slice(2, -1)
        break
      }
    }
  }
  return `-(${text})`
}
