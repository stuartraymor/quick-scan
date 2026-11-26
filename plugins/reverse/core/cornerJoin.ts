// SPDX-License-Identifier: AGPL-3.0-only
// Corner Trim between any two open pieces: lines, arcs and open splines.
// Each painted end is moved to the exact crossing of the two carriers nearest
// the painted ends — a line runs on along its direction, an arc round its
// circle, a spline along the cubic of its end span — and the two ends are
// made coincident. The far ends and the kept parts never move.
import type { Vec2 } from '../../../src/core/flat/types'
import { arcPoint, entityOf, type Sketch, type SketchArc, type SketchEntity, type SketchLine, type SketchSpline } from './sketch'
import { bezierChainToBSpline, isClosed, splineAt, splineDerivAt, splineEnd, splineCurve, splineStretchBeziers, type Bezier } from './sketchSpline'
import { validControlSpline } from './controlSpline'

type End = 'a' | 'b'
const TAU = 2 * Math.PI

/** One piece seen from its kept (far) end: s = 0 at the far end, s = `paint`
 *  at the painted end, s past `paint` running on beyond it. */
interface Carrier {
  at: (s: number) => Vec2
  d: (s: number) => Vec2
  /** Search range of s; the far end itself (s = 0) is never a valid cut. */
  lo: number
  hi: number
  paint: number
  /** Coarse sample count for crossing detection over [lo, hi]. */
  samples: number
  /** The piece after moving its painted end to parameter s. */
  rebuild: (s: number) => SketchEntity | string
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])

function lineCarrier(e: SketchLine, painted: End): Carrier | null {
  const far = painted === 'a' ? e.b : e.a, near = e[painted]
  const length = dist(far, near)
  if (!(length > 1e-9)) return null
  const u: Vec2 = [(near[0] - far[0]) / length, (near[1] - far[1]) / length]
  const at = (s: number): Vec2 => [far[0] + u[0] * s, far[1] + u[1] * s]
  return {
    at, d: () => u, lo: 0, hi: 0, paint: length, samples: 2,
    rebuild: (s) => ({ ...e, [painted]: at(s) }),
  }
}

/** An arc runs from its far end towards the painted end, round its circle. */
function arcCarrier(e: SketchArc, painted: End): Carrier | null {
  if (!(e.r > 1e-9) || !(e.sweep > 1e-12)) return null
  // s is the angle travelled from the far end, in the direction of the painted end.
  const sign = painted === 'b' ? 1 : -1, from = painted === 'b' ? e.start : e.start + e.sweep
  const at = (s: number): Vec2 => arcPoint(e, from + sign * s)
  const d = (s: number): Vec2 => { const a = from + sign * s; return [-Math.sin(a) * e.r * sign, Math.cos(a) * e.r * sign] }
  return {
    at, d, lo: 0, hi: TAU, paint: e.sweep, samples: 256,
    rebuild: (s) => {
      if (!(s > 1e-9) || !(s < TAU - 1e-9)) return 'The corner would leave no arc.'
      return painted === 'b' ? { ...e, sweep: s } : { ...e, start: e.start + e.sweep - s, sweep: s, gripT: undefined }
    },
  }
}

/** A cubic Bézier's blossom: the polar form at three parameters. Values
 *  outside [0, 1] extrapolate the same cubic polynomial. */
function blossom(b: Bezier, u: readonly [number, number, number]): Vec2 {
  let level = b.map((p): Vec2 => [p[0], p[1]])
  for (let r = 0; r < 3; r++) level = level.slice(0, -1).map((p, i) => [p[0] + (level[i + 1][0] - p[0]) * u[r], p[1] + (level[i + 1][1] - p[1]) * u[r]])
  return level[0]
}
/** The same cubic over [u0, u1], for any real u0 < u1 (extrapolating past 0 or 1). */
const reparam = (b: Bezier, u0: number, u1: number): Bezier => [blossom(b, [u0, u0, u0]), blossom(b, [u0, u0, u1]), blossom(b, [u0, u1, u1]), blossom(b, [u1, u1, u1])]
const bezierAt = (b: Bezier, u: number): Vec2 => blossom(b, [u, u, u])
function bezierDeriv(b: Bezier, u: number): Vec2 {
  const q = reparam(b, u, u + 1) // derivative of the cubic at u is 3(q1 − q0) over a unit span
  return [3 * (q[1][0] - q[0][0]), 3 * (q[1][1] - q[0][1])]
}

/** Builds the saved form of a run of Béziers: an exact control-pole spline. */
function splineFromBeziers(e: SketchSpline, pieces: Bezier[], spans: number[]): SketchSpline | string {
  if (!pieces.length) return 'The corner would leave no curve.'
  const b = bezierChainToBSpline(pieces, spans)
  if (b.mults.some((m, i) => i > 0 && i < b.mults.length - 1 && m !== 1)) return 'This curve is not smooth enough to trim exactly. Rebuild it first.'
  const pts = b.poles.map((p): Vec2 => [p[0], p[1]])
  // Two-span curves and longer carry ≥ 4 poles; a single span gives exactly 4.
  const out: SketchSpline = { ...e, pts, controlKnots: [...b.knots], closed: undefined, startDir: undefined, endDir: undefined }
  return validControlSpline(out) ? out : 'The trimmed curve could not be represented exactly.'
}

/** An open spline from its far end; past its painted end the end span's own
 *  cubic runs on (up to one more span), the curve's natural continuation. */
function splineCarrier(e: SketchSpline, painted: End): Carrier | null {
  if (isClosed(e) || e.pts.length < 2) return null
  let fit
  try { fit = splineCurve(e) } catch { return null }
  const s = fit.closed ? fit.points.length : fit.points.length - 1
  const whole = splineStretchBeziers(fit, painted === 'b' ? 0 : s, painted === 'b' ? s : 0)
  const pieces = whole.pieces, spans = whole.spans
  if (!pieces.length) return null
  const m = pieces.length
  // Parameter s runs piece by piece: piece k covers [k, k + 1]; past m the
  // last piece extrapolates.
  const locate = (x: number): [number, number] => { const k = Math.min(Math.max(Math.floor(x), 0), m - 1); return [k, x - k] }
  const at = (x: number) => { const [k, u] = locate(x); return bezierAt(pieces[k], u) }
  const d = (x: number) => { const [k, u] = locate(x); return bezierDeriv(pieces[k], u) }
  return {
    at, d, lo: 0, hi: m + 1, paint: m, samples: 48 * (m + 1),
    rebuild: (x) => {
      if (!(x > 1e-9)) return 'The corner would leave no curve.'
      const [k, u] = locate(x)
      const kept = pieces.slice(0, k).concat([reparam(pieces[k], 0, u)])
      const keptSpans = spans.slice(0, k).concat([spans[k] * u])
      if (!(keptSpans[k] > 1e-12)) { kept.pop(); keptSpans.pop() }
      // Saved curves run from `a` to `b`: a painted `a` was walked backwards.
      if (painted === 'a') {
        kept.reverse(); keptSpans.reverse()
        for (let i = 0; i < kept.length; i++) kept[i] = [kept[i][3], kept[i][2], kept[i][1], kept[i][0]]
      }
      return splineFromBeziers(e, kept, keptSpans)
    },
  }
}

function carrierOf(e: SketchEntity, painted: End): Carrier | null {
  if (e.kind === 'line') return lineCarrier(e, painted)
  if (e.kind === 'arc') return arcCarrier(e, painted)
  if (e.kind === 'spline') return splineCarrier(e, painted)
  return null
}

/** Refines a crossing A(s) = B(u) by Newton's method from a coarse guess. */
type SearchCurve = Pick<Carrier, 'at' | 'd' | 'lo' | 'hi' | 'samples'>
function refine(A: SearchCurve, B: SearchCurve, s0: number, u0: number): [number, number] | null {
  let s = s0, u = u0
  for (let i = 0; i < 60; i++) {
    const p = A.at(s), q = B.at(u), f = sub(p, q)
    if (Math.hypot(f[0], f[1]) < 1e-13 * Math.max(1, Math.abs(p[0]), Math.abs(p[1]))) return [s, u]
    const da = A.d(s), db = B.d(u)
    // Solve [da, −db] [Δs, Δu]ᵀ = −f
    const det = -da[0] * db[1] + da[1] * db[0]
    if (!(Math.abs(det) > 1e-18)) return null
    const ds = (-f[0] * -db[1] - -f[1] * -db[0]) / det
    const du = (da[0] * -f[1] - da[1] * -f[0]) / det
    s += ds; u += du
    if (!Number.isFinite(s) || !Number.isFinite(u)) return null
  }
  const f = sub(A.at(s), B.at(u))
  return Math.hypot(f[0], f[1]) < 1e-9 ? [s, u] : null
}

function segmentCross(p: Vec2, q: Vec2, r: Vec2, t: Vec2): [number, number] | null {
  const d1 = sub(q, p), d2 = sub(t, r), den = d1[0] * d2[1] - d1[1] * d2[0]
  if (Math.abs(den) < 1e-300) return null
  const w = sub(r, p)
  const a = (w[0] * d2[1] - w[1] * d2[0]) / den, b = (w[0] * d1[1] - w[1] * d1[0]) / den
  return a >= -1e-9 && a <= 1 + 1e-9 && b >= -1e-9 && b <= 1 + 1e-9 ? [a, b] : null
}

/** A line's search range: far enough to reach any crossing the other piece
 *  can offer, both ways along its carrier. */
function bound(A: Carrier, B: Carrier) {
  if (A.samples !== 2) return
  const pts: Vec2[] = []
  for (let i = 0; i <= B.samples; i++) pts.push(B.at(B.lo + (B.hi - B.lo) * i / B.samples))
  pts.push(A.at(0), A.at(A.paint))
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const span = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  A.lo = -2 * span - A.paint; A.hi = 2 * span + A.paint
}

function crossings(A: SearchCurve, B: SearchCurve): [number, number][] {
  const sample = (C: SearchCurve) => Array.from({ length: C.samples + 1 }, (_, i) => C.lo + (C.hi - C.lo) * i / C.samples)
  const sa = sample(A), sb = sample(B)
  const pa = sa.map((s) => A.at(s)), pb = sb.map((s) => B.at(s))
  const out: [number, number][] = []
  for (let i = 1; i < pa.length; i++) for (let j = 1; j < pb.length; j++) {
    const hit = segmentCross(pa[i - 1], pa[i], pb[j - 1], pb[j])
    if (!hit) continue
    const r = refine(A, B, sa[i - 1] + (sa[i] - sa[i - 1]) * hit[0], sb[j - 1] + (sb[j] - sb[j - 1]) * hit[1])
    if (!r || r[0] < A.lo - 1e-9 || r[0] > A.hi + 1e-9 || r[1] < B.lo - 1e-9 || r[1] > B.hi + 1e-9) continue
    if (!out.some((o) => Math.abs(o[0] - r[0]) < 1e-9 && Math.abs(o[1] - r[1]) < 1e-9)) out.push(r)
  }
  return out
}

/** Crossings restricted to the drawn geometry, including closed splines. */
export function finiteSplineCrossings(a: SketchEntity, b: SketchEntity): Vec2[] {
  const finite = (e: SketchEntity): SearchCurve | null => {
    if (e.kind === 'spline') {
      if (e.pts.length < 2) return null
      const fit = splineCurve(e), end = splineEnd(fit)
      return { at: t => splineAt(fit, t), d: t => splineDerivAt(fit, t), lo: 0, hi: end, samples: 32 * end }
    }
    const c = e.kind === 'line' ? lineCarrier(e, 'b') : e.kind === 'arc' ? arcCarrier(e, 'b')
      : e.kind === 'circle' ? arcCarrier({ ...e, kind: 'arc', start: 0, sweep: TAU }, 'b') : null
    return c && { ...c, lo: 0, hi: c.paint }
  }
  const A = finite(a), B = finite(b)
  return A && B ? crossings(A, B).map(([t]) => A.at(t)) : []
}

export type CurveJoin = { ok: true; a: SketchEntity; b: SketchEntity; corner: Vec2 } | { ok: false; error: string }

/** Joins the painted ends of two open pieces at their nearest true crossing,
 *  or the crossing inside the painted area when `painted` is given. */
export function joinCurveEnds(sketch: Sketch, first: { entity: number; at: End }, second: { entity: number; at: End }, painted?: (p: Vec2) => boolean): CurveJoin {
  const ea = entityOf(sketch, first.entity), eb = entityOf(sketch, second.entity)
  if (!ea || !eb) return { ok: false, error: 'Paint over one end of each of two pieces.' }
  const A = carrierOf(ea, first.at), B = carrierOf(eb, second.at)
  if (!A || !B) return { ok: false, error: 'Corner Trim joins the ends of lines, arcs and open curves. Circles and closed curves have no ends.' }
  bound(A, B); bound(B, A)
  if (A.samples === 2 && B.samples === 2) return { ok: false, error: 'Use the line corner path for two lines.' }
  const pa = A.at(A.paint), pb = B.at(B.paint)
  const candidates = crossings(A, B)
    .filter(([s, u]) => s > 1e-9 && u > 1e-9)
    .map(([s, u]) => ({ s, u, x: A.at(s), cost: Math.max(dist(A.at(s), pa), dist(B.at(u), pb)) }))
    // A crossing the user painted over is the corner they mean (a line meets
    // a circle twice); otherwise the one nearest the painted ends.
    .sort((p, q) => (painted ? Number(!painted(p.x)) - Number(!painted(q.x)) : 0) || p.cost - q.cost)
  if (!candidates.length) return { ok: false, error: 'These pieces do not meet, even extended along their own shapes. Nothing was changed.' }
  for (const c of candidates) {
    const a = A.rebuild(c.s), b = B.rebuild(c.u)
    if (typeof a === 'string' || typeof b === 'string') continue
    return { ok: true, a, b, corner: [c.x[0], c.x[1]] }
  }
  return { ok: false, error: 'Every crossing would remove a whole piece. Nothing was changed.' }
}
