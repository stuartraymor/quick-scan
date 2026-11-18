// SPDX-License-Identifier: AGPL-3.0-only
// Edits of a finished spline (2D Sketch overhaul 7): a fit point added on
// the curve where clicked, a fit point removed, the curve rebuilt through a
// chosen number of points evenly spaced by arc length (with the largest
// shape change reported), and an end's tangent direction set or freed.
// Inputs are never changed; relations holding the spline's points follow
// their points' new numbers, and those on a removed point are dropped.

import type { Vec2 } from '../../../src/core/flat/types'
import { type DisplayUnits, fmtLen } from '../../../src/core/units'
import { curveOf } from './curveEval'
import { cloneSketch, damagedPiece, entityOf, type Sketch, type SketchSpline } from './sketch'
import { isClosed, nearestOnSpline, splineAt, splineCurve } from './sketchSpline'
import type { SketchEditResult } from './sketchEdits'

export const MAX_SPLINE_POINTS = 400

type Result = SketchEditResult & { note?: string }
const fail = (error: string): Result => ({ ok: false, error })

function splineOf(sketch: Sketch, id: number): SketchSpline | string {
  const e = entityOf(sketch, id)
  if (!e) return 'That spline is no longer in the sketch.'
  if (e.kind !== 'spline') return 'That piece is not a spline.'
  return damagedPiece(sketch, [id]) ?? e
}

/** Every anchor `{ entity: id, at: 'pK' }` in the relations renumbered by
 *  `map` (null drops the relation holding it). */
function renumberAnchors(sketch: Sketch, id: number, map: (k: number) => number | null): number {
  let dropped = 0
  sketch.constraints = sketch.constraints.filter((c) => {
    let keep = true
    const walk = (v: unknown): void => {
      if (!keep || typeof v !== 'object' || v === null) return
      const o = v as Record<string, unknown>
      if (o.entity === id && typeof o.at === 'string' && /^p\d+$/.test(o.at)) {
        const k = map(Number(o.at.slice(1)))
        if (k === null) { keep = false; return }
        o.at = `p${k}`
      }
      for (const x of Object.values(o)) walk(x)
    }
    walk(c)
    if (!keep) dropped++
    return keep
  })
  return dropped
}

const plain = (e: SketchSpline): SketchSpline => {
  const { points: _p, scatter: _s, ...rest } = e
  void _p; void _s
  return rest as SketchSpline
}

/** A fit point added where the curve passes nearest `spot`: the curve keeps
 *  its shape there (the point lies on it). */
export function insertSplinePoint(input: Sketch, id: number, spot: Vec2): Result {
  const e = splineOf(input, id)
  if (typeof e === 'string') return fail(e)
  if (e.controlKnots) return fail('This spline is defined by control poles. Rebuild it through fit points first.')
  if (e.pts.length >= MAX_SPLINE_POINTS) return fail(`A spline holds at most ${MAX_SPLINE_POINTS} points.`)
  if (!spot.every(Number.isFinite)) return fail('That spot is not on the sheet.')
  const fit = splineCurve(e)
  const near = nearestOnSpline(fit, spot)
  const n = e.pts.length, closed = isClosed(e)
  const segs = closed ? n : n - 1
  const t = Math.min(Math.max(near.t, 0), segs)
  const k = Math.min(Math.floor(t), segs - 1)
  const u = t - k
  if (u < 1e-3 || u > 1 - 1e-3) return fail('There is a point there already. Click between two points.')
  const at = splineAt(fit, t)
  const sketch = cloneSketch(input)
  const pts = [...e.pts.slice(0, k + 1), at, ...e.pts.slice(k + 1)].map((p): Vec2 => [p[0], p[1]])
  sketch.entities = sketch.entities.map((x) => (x.id === id ? { ...plain(e), pts } : x))
  renumberAnchors(sketch, id, (j) => (j > k ? j + 1 : j))
  return { ok: true, sketch, ids: [id], note: `Point added (${pts.length} points).` }
}

/** Fit point `index` removed; an open spline keeps two points at least, a
 *  closed one three. */
export function removeSplinePoint(input: Sketch, id: number, index: number): Result {
  const e = splineOf(input, id)
  if (typeof e === 'string') return fail(e)
  if (e.controlKnots) return fail('This spline is defined by control poles. Rebuild it through fit points first.')
  const closed = isClosed(e), min = closed ? 3 : 2
  if (!Number.isInteger(index) || index < 0 || index >= e.pts.length) return fail('Pick one of the spline\'s points.')
  if (e.pts.length <= min) return fail(`A ${closed ? 'closed' : 'open'} spline needs ${min} points at least.`)
  const sketch = cloneSketch(input)
  const pts = e.pts.filter((_, i) => i !== index).map((p): Vec2 => [p[0], p[1]])
  sketch.entities = sketch.entities.map((x) => (x.id === id ? { ...plain(e), pts } : x))
  const dropped = renumberAnchors(sketch, id, (j) => (j === index ? null : j > index ? j - 1 : j))
  return { ok: true, sketch, ids: [id], note: `Point removed (${pts.length} points)${dropped ? `; ${dropped} relation${dropped === 1 ? '' : 's'} on it removed` : ''}.` }
}

/** The largest distance from curve `a` to curve `b`, sampled densely. */
function deviation(a: SketchSpline, b: SketchSpline): number {
  const ca = curveOf(a), cb = curveOf(b)
  if (!ca || !cb) return Infinity
  const pb: Vec2[] = []
  for (let i = 0; i <= 1200; i++) pb.push(cb.at((cb.end * i) / 1200))
  let worst = 0
  for (let i = 0; i <= 400; i++) {
    const p = ca.at((ca.end * i) / 400)
    let best = Infinity
    for (let j = 0; j + 1 < pb.length; j++) {
      const q = pb[j], r = pb[j + 1], dx = r[0] - q[0], dy = r[1] - q[1], l2 = dx * dx + dy * dy
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - q[0]) * dx + (p[1] - q[1]) * dy) / l2)) : 0
      best = Math.min(best, Math.hypot(p[0] - q[0] - t * dx, p[1] - q[1] - t * dy))
    }
    worst = Math.max(worst, best)
  }
  return worst
}

/** The spline rebuilt through `count` fit points evenly spaced by arc
 *  length along the curve as it is (a control-pole spline becomes a fit
 *  spline). Its ends stay where they are; relations on its ends follow;
 *  those on inner points are dropped. The note gives the largest change. */
export function rebuildSpline(input: Sketch, id: number, count: number, units: DisplayUnits = 'mm'): Result & { deviation?: number } {
  const e = splineOf(input, id)
  if (typeof e === 'string') return fail(e)
  const closed = isClosed(e), min = closed ? 3 : 2
  if (!Number.isInteger(count) || count < min || count > MAX_SPLINE_POINTS) return fail(`Rebuild through ${min} to ${MAX_SPLINE_POINTS} points.`)
  const c = curveOf(e)
  if (!c) return fail('That spline has no length to rebuild.')
  const gaps = closed ? count : count - 1
  const pts: Vec2[] = []
  for (let i = 0; i < count; i++) {
    if (!closed && i === count - 1) { const last = e.pts[e.pts.length - 1]; pts.push([last[0], last[1]]); continue }
    if (i === 0) { pts.push([e.pts[0][0], e.pts[0][1]]); continue }
    pts.push(c.at(c.paramAt((c.length * i) / gaps)))
  }
  const { controlKnots: _k, ...rest } = plain(e)
  void _k
  const made: SketchSpline = { ...(rest as SketchSpline), pts }
  const sketch = cloneSketch(input)
  sketch.entities = sketch.entities.map((x) => (x.id === id ? made : x))
  const last = e.pts.length - 1
  const dropped = renumberAnchors(sketch, id, (j) => (j === 0 ? 0 : !closed && j === last ? count - 1 : null))
  const dev = deviation(e, made)
  return { ok: true, sketch, ids: [id], deviation: dev, note: `Rebuilt through ${count} points; the curve moved ${fmtLen(dev, units, 4)} at most${dropped ? `; ${dropped} relation${dropped === 1 ? '' : 's'} on inner points removed` : ''}.` }
}

/** The direction an open spline leaves its first point ('a') or reaches
 *  its last ('b'), radians, or null to let it run naturally. */
export function setSplineEndDirection(input: Sketch, id: number, end: 'a' | 'b', angle: number | null): Result {
  const e = splineOf(input, id)
  if (typeof e === 'string') return fail(e)
  if (isClosed(e)) return fail('A closed spline has no ends.')
  if (e.controlKnots) return fail('This spline is defined by control poles; its end directions follow them.')
  if (angle !== null && !Number.isFinite(angle)) return fail('The direction must be a finite angle.')
  const held = input.constraints.some((c) => c.kind === 'tangent' && (c.a === id || c.b === id))
  if (held) return fail('A tangent relation holds this spline\'s end. Remove it to set the direction by hand.')
  const sketch = cloneSketch(input)
  const key = end === 'a' ? 'startDir' : 'endDir', flag = end === 'a' ? 'startSet' : 'endSet'
  sketch.entities = sketch.entities.map((x) => {
    if (x.id !== id || x.kind !== 'spline') return x
    const next = { ...plain(x) } as SketchSpline & { startDir?: number; endDir?: number }
    if (angle === null) { delete next[key]; delete next[flag] }
    else { next[key] = angle; next[flag] = true }
    return next
  })
  return { ok: true, sketch, ids: [id] }
}

/** The fit point of the spline nearest `spot` within `reach`, or null. */
export function splinePointNear(e: SketchSpline, spot: Vec2, reach: number): number | null {
  let best: number | null = null, d = reach
  e.pts.forEach((p, i) => { const at = Math.hypot(p[0] - spot[0], p[1] - spot[1]); if (at <= d) { d = at; best = i } })
  return best
}
