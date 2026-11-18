// SPDX-License-Identifier: AGPL-3.0-only
// One sketch piece as an exact curve: its point, first and second
// derivative at a parameter, its length, and the inverse — the parameter
// at a given distance along it. Lines and arcs are evaluated in closed
// form; a spline segment by segment as the exact cubic Bézier each segment
// is. Used where the true curve matters rather than a polyline: the
// curvature comb (κ from the derivatives, 0 on a line, 1/R on an arc) and
// equal arc-length spacing of a pattern along a curve.

import type { Vec2 } from '../../../src/core/flat/types'
import type { SketchEntity } from './sketch'
import { splineCurve, splineEnd, splineStretchBeziers, type Bezier } from './sketchSpline'

/** A piece of curve, parameter 0 to `end`. Segments meet at whole numbers
 *  (one segment for a line or an arc). */
export interface CurveEval {
  end: number
  closed: boolean
  at(t: number): Vec2
  d1(t: number): Vec2
  d2(t: number): Vec2
  /** Length from 0 to t. */
  lengthTo(t: number): number
  length: number
  /** The parameter at distance s from the start (clamped). */
  paramAt(s: number): number
}

const GL5: [number, number][] = [
  [0, 0.5688888888888889],
  [-0.5384693101056831, 0.47862867049936647],
  [0.5384693101056831, 0.47862867049936647],
  [-0.906179845938664, 0.23692688505618908],
  [0.906179845938664, 0.23692688505618908],
]
const SUB = 8

/** Arc length helper over pieces of parameter [k, k+1], each split into
 *  SUB parts integrated by 5-point Gauss–Legendre (exact to round-off for
 *  lines and arcs, ~1e-12 relative on a smooth cubic). */
function lengthTable(end: number, speed: (t: number) => number): number[] {
  const n = Math.max(1, Math.ceil(end)) * SUB
  const table = [0]
  for (let i = 0; i < n; i++) {
    const a = (end * i) / n, b = (end * (i + 1)) / n, h = (b - a) / 2, m = (a + b) / 2
    let s = 0
    for (const [x, w] of GL5) s += w * speed(m + h * x)
    table.push(table[i] + s * h)
  }
  return table
}

function build(end: number, closed: boolean, at: (t: number) => Vec2, d1: (t: number) => Vec2, d2: (t: number) => Vec2): CurveEval {
  const speed = (t: number) => { const d = d1(t); return Math.hypot(d[0], d[1]) }
  const table = lengthTable(end, speed)
  const n = table.length - 1
  const length = table[n]
  const lengthTo = (t: number): number => {
    const c = Math.min(Math.max(t, 0), end)
    const i = Math.min(n - 1, Math.floor((c / end) * n))
    const a = (end * i) / n
    if (c - a < 1e-15) return table[i]
    const h = (c - a) / 2, m = (a + c) / 2
    let s = 0
    for (const [x, w] of GL5) s += w * speed(m + h * x)
    return table[i] + s * h
  }
  const paramAt = (s: number): number => {
    if (!(length > 0)) return 0
    const target = Math.min(Math.max(s, 0), length)
    // The sub-interval holding it, then Newton (ds/dt = speed) kept inside.
    let lo = 0, hi = n
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (table[mid] <= target) lo = mid; else hi = mid }
    let a = (end * lo) / n, b = (end * hi) / n
    const span = table[hi] - table[lo]
    let t = span > 0 ? a + ((target - table[lo]) / span) * (b - a) : a
    for (let k = 0; k < 30; k++) {
      const f = lengthTo(t) - target
      if (Math.abs(f) < 1e-12 * Math.max(1, length)) break
      if (f > 0) b = t; else a = t
      const v = speed(t)
      let next = v > 1e-14 ? t - f / v : (a + b) / 2
      if (!(next > a && next < b)) next = (a + b) / 2
      t = next
    }
    return t
  }
  return { end, closed, at, d1, d2, length, lengthTo, paramAt }
}

const bez = (p: Bezier, u: number): Vec2 => {
  const v = 1 - u
  return [0, 1].map((j) => v * v * v * p[0][j] + 3 * v * v * u * p[1][j] + 3 * v * u * u * p[2][j] + u * u * u * p[3][j]) as Vec2
}
const bez1 = (p: Bezier, u: number): Vec2 => {
  const v = 1 - u
  return [0, 1].map((j) => 3 * (v * v * (p[1][j] - p[0][j]) + 2 * v * u * (p[2][j] - p[1][j]) + u * u * (p[3][j] - p[2][j]))) as Vec2
}
const bez2 = (p: Bezier, u: number): Vec2 => [0, 1].map((j) => 6 * ((1 - u) * (p[2][j] - 2 * p[1][j] + p[0][j]) + u * (p[3][j] - 2 * p[2][j] + p[1][j]))) as Vec2

/** The piece as an exact curve, or null for a point or a curve of no
 *  length. */
export function curveOf(e: SketchEntity): CurveEval | null {
  if (e.kind === 'line') {
    const d: Vec2 = [e.b[0] - e.a[0], e.b[1] - e.a[1]]
    if (!(Math.hypot(d[0], d[1]) > 0)) return null
    return build(1, false, (t) => [e.a[0] + d[0] * t, e.a[1] + d[1] * t], () => d, () => [0, 0])
  }
  if (e.kind === 'arc' || e.kind === 'circle') {
    const start = e.kind === 'arc' ? e.start : 0, sweep = e.kind === 'arc' ? e.sweep : 2 * Math.PI
    if (!(e.r > 0) || !(Math.abs(sweep) > 0)) return null
    const r = e.r, c = e.c
    return build(1, e.kind === 'circle', (t) => { const a = start + sweep * t; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] },
      (t) => { const a = start + sweep * t; return [-r * sweep * Math.sin(a), r * sweep * Math.cos(a)] },
      (t) => { const a = start + sweep * t; return [-r * sweep * sweep * Math.cos(a), -r * sweep * sweep * Math.sin(a)] })
  }
  if (e.kind === 'spline') {
    const fit = splineCurve(e)
    const end = splineEnd(fit)
    if (!(end > 0)) return null
    const segs: (Bezier | null)[] = []
    for (let k = 0; k < end; k++) segs.push(splineStretchBeziers(fit, k, k + 1).pieces[0] ?? null)
    const locate = (t: number): [Bezier | null, number] => {
      const c = Math.min(Math.max(t, 0), end)
      const k = Math.min(Math.floor(c), end - 1)
      return [segs[k], c - k]
    }
    const zero: Vec2 = [0, 0]
    const fallback: Vec2 = e.pts[0] ? [e.pts[0][0], e.pts[0][1]] : zero
    const curve = build(end, Boolean(fit.closed),
      (t) => { const [b, u] = locate(t); return b ? bez(b, u) : fallback },
      (t) => { const [b, u] = locate(t); return b ? bez1(b, u) : zero },
      (t) => { const [b, u] = locate(t); return b ? bez2(b, u) : zero })
    return curve.length > 0 ? curve : null
  }
  return null
}

/** Signed curvature at t (1/length; positive turning left), 0 where the
 *  curve stands still. */
export function curvatureOf(c: CurveEval, t: number): number {
  const a = c.d1(t), b = c.d2(t)
  const v = Math.hypot(a[0], a[1])
  if (!(v > 1e-12)) return 0
  const k = (a[0] * b[1] - a[1] * b[0]) / (v * v * v)
  return Number.isFinite(k) ? k : 0
}

/** The unit direction at t, or null where the curve stands still. */
export function tangentOf(c: CurveEval, t: number): Vec2 | null {
  const a = c.d1(t)
  const v = Math.hypot(a[0], a[1])
  return v > 1e-12 ? [a[0] / v, a[1] / v] : null
}
