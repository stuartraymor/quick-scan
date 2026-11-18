// SPDX-License-Identifier: AGPL-3.0-only
// Duplicate / Pattern in the sketch: the selected pieces copied by exact
// rigid motions in one of four modes.
//
// Convention: every instance count INCLUDES the original. A count of 4
// makes 3 copies; the original is never moved or copied onto itself.
//
//  - Linear: up to two directions, each its own reference (sheet X, sheet Y
//    or a picked line), count, spacing (a real distance) and flip. Two
//    directions make a grid.
//  - Circular: N instances distributed over a total angle about a centre
//    (default the sheet origin, or a picked point / circle centre). A full
//    360° holds N evenly with no copy on the original; a partial span puts
//    the last instance at its end. CW or CCW; optionally the copies keep
//    the original's orientation (moved round, not turned).
//  - Angular: rotational steps about a pivot — a fixed increment per copy
//    (range = increment × (N − 1)), pivot by default the selection's own
//    centre, so the pieces turn in place. Flip reverses the turn.
//  - Along Curve: instances along a guide curve from its start (or its end,
//    reversed), the original standing for the first; spaced by a distance
//    or equally by arc length between the start and end offsets (no
//    instance doubled at the seam of a closed curve). Each copy follows the
//    curve's tangent or keeps the original orientation.

import type { Vec2 } from '../../../src/core/flat/types'
import { curveOf, tangentOf } from './curveEval'
import { cloneSketch, copyPiecesAt, damagedPiece, entityOf, sketchBounds, type SheetMotion, type Sketch } from './sketch'
import type { SketchEditResult } from './sketchEdits'

/** At most this many instances in one direction, and this many pieces made
 *  in all, so a typo cannot freeze the sheet. */
export const MAX_INSTANCES = 500
export const MAX_NEW_PIECES = 5000

export type DirectionRef = { kind: 'x' } | { kind: 'y' } | { kind: 'line'; id: number }

export interface LinearDirection {
  on: boolean
  ref: DirectionRef
  /** Instances along it, the original counted. */
  count: number
  /** Distance between neighbours, model units (mm). */
  spacing: number
  flip: boolean
}

export type CentreRef = { kind: 'origin' } | { kind: 'point'; id: number } | { kind: 'circle'; id: number } | { kind: 'selection' } | { kind: 'typed' }

export type PatternSpec =
  | { mode: 'linear'; d1: LinearDirection; d2: LinearDirection }
  | { mode: 'circular'; centre: Vec2; centreRef: CentreRef; count: number; totalDeg: number; ccw: boolean; keepOrientation: boolean }
  | { mode: 'angular'; pivot: Vec2 | null; pivotRef: CentreRef; count: number; stepDeg: number; flip: boolean; keepOrientation: boolean }
  | { mode: 'alongCurve'; curve: number | null; count: number; equal: boolean; spacing: number; reverse: boolean; tangent: boolean; startOffset: number; endOffset: number }

export type PatternMode = PatternSpec['mode']

export const defaultDirection = (ref: DirectionRef, on: boolean, spacing: number): LinearDirection => ({ on, ref, count: on ? 3 : 2, spacing, flip: false })

/** A new spec of a mode, its distances scaled to the selection's size. */
export function defaultPattern(mode: PatternMode, size: number): PatternSpec {
  const step = niceStep(size)
  switch (mode) {
    case 'linear': return { mode, d1: defaultDirection({ kind: 'x' }, true, step), d2: defaultDirection({ kind: 'y' }, false, step) }
    case 'circular': return { mode, centre: [0, 0], centreRef: { kind: 'origin' }, count: 6, totalDeg: 360, ccw: true, keepOrientation: false }
    case 'angular': return { mode, pivot: null, pivotRef: { kind: 'selection' }, count: 3, stepDeg: 30, flip: false, keepOrientation: false }
    case 'alongCurve': return { mode, curve: null, count: 5, equal: true, spacing: step, reverse: false, tangent: true, startOffset: 0, endOffset: 0 }
  }
}

/** Round steps per decade the default spacing is taken from: fine enough
 *  that the copies start close by (a 140 mm selection starts at 200 mm,
 *  not 500 mm, and a 90 mm one at 120 mm, not 200 mm). */
const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]

/** A round spacing a little over the selection's size (about 1.2×), so
 *  the first copies sit just clear of the original and on screen. */
export function niceStep(size: number): number {
  if (!(size > 0) || !Number.isFinite(size)) return 10
  const raw = size * 1.2, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p
  const n = NICE.find((x) => m <= x + 1e-9) ?? 10
  return Number((n * p).toPrecision(12))
}

const rad = (deg: number) => (deg * Math.PI) / 180
const rot = (v: Vec2, a: number): Vec2 => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]
const okCount = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_INSTANCES

/** The selection's centre (middle of its extent), or null. */
export function selectionCentre(sketch: Sketch, ids: readonly number[]): Vec2 | null {
  const set = new Set(ids)
  const b = sketchBounds({ entities: sketch.entities.filter((e) => set.has(e.id)) })
  return b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] : null
}

/** The unit vector of a direction reference, flip applied, or an error. */
export function directionOf(sketch: Sketch, d: LinearDirection): Vec2 | string {
  let v: Vec2
  if (d.ref.kind === 'x') v = [1, 0]
  else if (d.ref.kind === 'y') v = [0, 1]
  else {
    const e = entityOf(sketch, d.ref.id)
    if (!e || e.kind !== 'line') return 'The direction line is no longer in the sketch.'
    const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], l = Math.hypot(dx, dy)
    if (!(l > 1e-9)) return 'The direction line has no length.'
    v = [dx / l, dy / l]
  }
  return d.flip ? [-v[0], -v[1]] : v
}

/** Where a centre reference stands now, or an error. */
export function centreOf(sketch: Sketch, ids: readonly number[], ref: CentreRef, typed: Vec2 | null): Vec2 | string {
  switch (ref.kind) {
    case 'origin': return [0, 0]
    case 'selection': return selectionCentre(sketch, ids) ?? 'Select the pieces to pattern.'
    case 'typed': return typed && typed.every(Number.isFinite) ? typed : 'Type a finite centre.'
    case 'point': { const e = entityOf(sketch, ref.id); return e?.kind === 'point' ? e.p : 'The picked centre point is no longer in the sketch.' }
    case 'circle': { const e = entityOf(sketch, ref.id); return e && (e.kind === 'circle' || e.kind === 'arc') ? e.c : 'The picked circle is no longer in the sketch.' }
  }
}

export interface PatternPlan { ok: true; motions: SheetMotion[]; note: string | null }
export type PatternPlanResult = PatternPlan | { ok: false; error: string }

/** The motions of every copy (the original left out), or why there are
 *  none. */
export function planPattern(sketch: Sketch, ids: readonly number[], spec: PatternSpec): PatternPlanResult {
  const fail = (error: string): PatternPlanResult => ({ ok: false, error })
  if (!ids.some((id) => entityOf(sketch, id))) return fail('Select the pieces to pattern.')
  const damaged = damagedPiece(sketch, spec.mode === 'alongCurve' && spec.curve !== null ? [...ids, spec.curve] : ids)
  if (damaged) return fail(damaged)
  const motions: SheetMotion[] = []
  let note: string | null = null
  if (spec.mode === 'linear') {
    const dirs = [spec.d1, spec.d2].filter((d) => d.on)
    if (!dirs.length) return fail('Turn on Direction 1 or Direction 2.')
    const steps: { v: Vec2; n: number }[] = []
    for (const [i, d] of dirs.entries()) {
      if (!okCount(d.count)) return fail(`Instances must be a whole number from 1 to ${MAX_INSTANCES}.`)
      if (!Number.isFinite(d.spacing) || !(Math.abs(d.spacing) > 1e-9)) return fail(`Direction ${i + 1} needs a spacing other than 0.`)
      const v = directionOf(sketch, d)
      if (typeof v === 'string') return fail(v)
      steps.push({ v: [v[0] * d.spacing, v[1] * d.spacing], n: d.count })
    }
    if (steps.length === 2 && Math.abs(steps[0].v[0] * steps[1].v[1] - steps[0].v[1] * steps[1].v[0]) < 1e-9 * Math.hypot(...steps[0].v) * Math.hypot(...steps[1].v))
      return fail('The two directions are parallel: the copies would land on each other.')
    const n2 = steps[1]?.n ?? 1, v2 = steps[1]?.v ?? [0, 0]
    for (let j = 0; j < n2; j++) for (let i = 0; i < steps[0].n; i++) {
      if (!i && !j) continue
      motions.push({ move: [steps[0].v[0] * i + v2[0] * j, steps[0].v[1] * i + v2[1] * j], turn: 0, about: [0, 0] })
    }
  } else if (spec.mode === 'circular' || spec.mode === 'angular') {
    if (!okCount(spec.count)) return fail(`Instances must be a whole number from 1 to ${MAX_INSTANCES}.`)
    const typed = spec.mode === 'circular' ? spec.centre : spec.pivot
    const centre = centreOf(sketch, ids, spec.mode === 'circular' ? spec.centreRef : spec.pivotRef, typed)
    if (typeof centre === 'string') return fail(centre)
    let step: number
    if (spec.mode === 'circular') {
      if (!Number.isFinite(spec.totalDeg) || !(Math.abs(spec.totalDeg) > 1e-9) || Math.abs(spec.totalDeg) > 360 + 1e-9) return fail('The total angle must be more than 0° and at most 360°.')
      const full = Math.abs(Math.abs(spec.totalDeg) - 360) < 1e-9
      step = spec.count > 1 ? rad(spec.totalDeg) / (full ? spec.count : spec.count - 1) : 0
      if (!spec.ccw) step = -step
    } else {
      if (!Number.isFinite(spec.stepDeg) || !(Math.abs(spec.stepDeg) > 1e-9)) return fail('The angle step must be other than 0°.')
      if (Math.abs(spec.stepDeg * (spec.count - 1)) > 360 + 1e-9) note = 'The copies go round more than once and overlap.'
      step = rad(spec.stepDeg) * (spec.flip ? -1 : 1)
    }
    const ref = selectionCentre(sketch, ids) ?? centre
    for (let i = 1; i < spec.count; i++) {
      const turn = step * i
      if (spec.keepOrientation) {
        const to = rot([ref[0] - centre[0], ref[1] - centre[1]], turn)
        motions.push({ move: [centre[0] + to[0] - ref[0], centre[1] + to[1] - ref[1]], turn: 0, about: [0, 0] })
      } else motions.push({ move: [0, 0], turn, about: centre })
    }
  } else {
    if (!okCount(spec.count)) return fail(`Instances must be a whole number from 1 to ${MAX_INSTANCES}.`)
    if (spec.curve === null) return fail('Pick the guide curve on the sheet.')
    if (ids.includes(spec.curve)) return fail('The guide curve is one of the pieces being copied. Pick another curve or leave it out of the selection.')
    const e = entityOf(sketch, spec.curve)
    if (!e) return fail('The guide curve is no longer in the sketch.')
    const c = curveOf(e)
    if (!c) return fail('That piece is not a curve to pattern along (a point, or a curve of no length).')
    const L = c.length
    if (![spec.startOffset, spec.endOffset].every((x) => Number.isFinite(x) && x >= 0)) return fail('Offsets must be 0 or more.')
    const usable = L - spec.startOffset - spec.endOffset
    if (!(usable >= 0)) return fail('The start and end offsets are longer than the curve.')
    const closed = c.closed && spec.startOffset === 0 && spec.endOffset === 0
    const along: number[] = []
    if (spec.equal) {
      const gaps = closed ? spec.count : spec.count - 1
      for (let i = 0; i < spec.count; i++) along.push(spec.startOffset + (gaps > 0 ? (usable * i) / gaps : 0))
    } else {
      if (!Number.isFinite(spec.spacing) || !(spec.spacing > 1e-9)) return fail('The spacing must be more than 0.')
      for (let i = 0; i < spec.count; i++) {
        const s = spec.startOffset + spec.spacing * i
        if (s > spec.startOffset + usable + 1e-9 || (closed && i > 0 && s >= L - 1e-9)) { note = `Only ${i} instances fit on the curve at this spacing.`; break }
        along.push(s)
      }
    }
    const frame = (s: number) => {
      const t = c.paramAt(spec.reverse ? L - s : s)
      const p = c.at(t), d = tangentOf(c, t) ?? [1, 0]
      return { p, a: Math.atan2(d[1], d[0]) }
    }
    const f0 = frame(along[0] ?? spec.startOffset)
    for (let i = 1; i < along.length; i++) {
      const f = frame(along[i])
      motions.push(spec.tangent
        ? { move: [f.p[0] - f0.p[0], f.p[1] - f0.p[1]], turn: f.a - f0.a, about: f0.p }
        : { move: [f.p[0] - f0.p[0], f.p[1] - f0.p[1]], turn: 0, about: [0, 0] })
    }
  }
  const pieces = ids.filter((id) => entityOf(sketch, id)).length
  if (motions.length * pieces > MAX_NEW_PIECES) return fail(`That would make ${motions.length * pieces} pieces; at most ${MAX_NEW_PIECES} at once.`)
  if (!motions.length) return fail(note ?? 'The pattern makes no copies: give it 2 instances or more.')
  return { ok: true, motions, note }
}

/** The pattern laid on a copy of the sketch; the input is never changed. */
export function applyPattern(input: Sketch, ids: readonly number[], spec: PatternSpec): SketchEditResult & { note?: string | null } {
  const plan = planPattern(input, ids, spec)
  if (!plan.ok) return plan
  const sketch = cloneSketch(input)
  const made = copyPiecesAt(sketch, ids.filter((id) => entityOf(input, id)), plan.motions).flat()
  return { ok: true, sketch, ids: made, note: plan.note }
}
