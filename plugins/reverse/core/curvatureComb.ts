// SPDX-License-Identifier: AGPL-3.0-only
// Edit Sketch → Display → Curvature, as QUICKSURFACE shows it: a comb along
// each curved piece — a tooth at every sample along the curve's normal, as
// long as the curvature there times `scale`, and a line joining the tips. A
// straight run has no teeth; a tight bend has long ones; a jump in curvature
// shows as a step in the line through the tips.

import type { Vec2 } from '../../../src/core/flat/types'
import type { SketchEntity } from './sketch'
import { curveOf, curvatureOf, type CurveEval } from './curveEval'

/** Signed curvature at the middle of three points (1 / radius of the circle
 *  through them; positive turning left), or 0 where they are in line. */
export function curvatureAt(a: Vec2, b: Vec2, c: Vec2): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], bcx = c[0] - b[0], bcy = c[1] - b[1], cax = a[0] - c[0], cay = a[1] - c[1]
  const cross = abx * bcy - aby * bcx
  const den = Math.hypot(abx, aby) * Math.hypot(bcx, bcy) * Math.hypot(cax, cay)
  return den > 1e-18 ? (2 * cross) / den : 0
}

/** The comb of a curve sampled as `poly`: the teeth (from the curve to the
 *  tip) and the segments joining the tips. Teeth point to the curve's
 *  outside — away from the centre of curvature — as they are usually drawn. */
export function curvatureComb(poly: readonly Vec2[], scale: number): { teeth: [Vec2, Vec2][]; envelope: [Vec2, Vec2][] } {
  const teeth: [Vec2, Vec2][] = []
  const tips: Vec2[] = []
  for (let i = 1; i + 1 < poly.length; i++) {
    const [a, b, c] = [poly[i - 1], poly[i], poly[i + 1]]
    const k = curvatureAt(a, b, c)
    const tx = c[0] - a[0], ty = c[1] - a[1]
    const tl = Math.hypot(tx, ty)
    if (!(tl > 0)) continue
    // The left normal; a left turn (k > 0) has its centre on the left, so the
    // tooth goes right — out of the bend — and the other way about.
    const nx = -ty / tl, ny = tx / tl
    const tip: Vec2 = [b[0] - nx * k * scale, b[1] - ny * k * scale]
    teeth.push([b, tip])
    tips.push(tip)
  }
  const envelope: [Vec2, Vec2][] = []
  for (let i = 0; i + 1 < tips.length; i++) envelope.push([tips[i], tips[i + 1]])
  return { teeth, envelope }
}

// ---------------------------------------------------------------------------
// The exact comb (2D Sketch overhaul 6). Curvature is the true derivative
// curvature of the piece (curveEval): 0 on a line, 1/R on an arc. Teeth are
// spaced evenly by arc length; each is clamped to `maxLength`, so a cusp
// can never throw a spike; non-finite values read as 0. The comb breaks
// where the curve turns a corner (a spline joint whose sides do not meet
// tangent, or where the curve stands still), and at an inflection the line
// through the tips touches the curve where the curvature changes sign.


export interface CombOptions {
  /** Tooth length per unit of curvature: mm of tooth per 1/mm. */
  scale: number
  /** Teeth along each piece. */
  density: number
  /** No tooth longer than this (mm). */
  maxLength: number
  /** Teeth out of the bend, crossing over at an inflection (signed), or
   *  all on one side, as long as |κ| (unsigned). */
  signed: boolean
  /** Moving-average half-width over the samples (0 = off), for curves
   *  fitted to noisy scans. */
  smooth: number
  /** A reference line this far from the curve on the comb's side (mm), or
   *  null. Visual only. */
  offset: number | null
}

export const DEFAULT_COMB: CombOptions = { scale: 50, density: 64, maxLength: 20, signed: true, smooth: 0, offset: null }

export interface ExactComb {
  teeth: [Vec2, Vec2][]
  /** The lines through the tips, one per unbroken stretch. */
  envelopes: Vec2[][]
  offsetLine: Vec2[] | null
  /** Where |κ| is greatest. */
  extreme: { at: Vec2; tip: Vec2; k: number } | null
  /** Teeth cut to the maximum length. */
  clamped: number
  /** Corners the comb breaks at. */
  breaks: number
}

const CORNER_COS = Math.cos((0.5 * Math.PI) / 180)

/** Where the curve turns a corner: parameters of spline joints whose two
 *  sides do not run on tangent (or where it stands still). */
function cornersOf(c: CurveEval): number[] {
  const out: number[] = []
  for (let k = 1; k < c.end; k++) {
    const a = c.d1(k - 1e-9), b = c.d1(k + 1e-9)
    const la = Math.hypot(a[0], a[1]), lb = Math.hypot(b[0], b[1])
    if (!(la > 1e-12 && lb > 1e-12) || (a[0] * b[0] + a[1] * b[1]) / (la * lb) < CORNER_COS) out.push(k)
  }
  return out
}

/** The comb of one piece, or null when it has none (a point, a curve of
 *  no length). A line gives teeth of length 0. */
export function exactComb(e: SketchEntity, options: CombOptions): ExactComb | null {
  const c = curveOf(e)
  if (!c) return null
  const scale = Number.isFinite(options.scale) && options.scale > 0 ? options.scale : 0
  const maxLength = Number.isFinite(options.maxLength) && options.maxLength > 0 ? options.maxLength : Infinity
  const density = Math.max(4, Math.min(2000, Math.round(Number.isFinite(options.density) ? options.density : 64)))
  const smooth = Math.max(0, Math.min(20, Math.round(Number.isFinite(options.smooth) ? options.smooth : 0)))
  const corners = cornersOf(c)
  const edges = [0, ...corners.map((k) => c.lengthTo(k)), c.length]
  const result: ExactComb = { teeth: [], envelopes: [], offsetLine: options.offset !== null && Number.isFinite(options.offset) ? [] : null, extreme: null, clamped: 0, breaks: corners.length }
  let best = -1
  for (let span = 0; span + 1 < edges.length; span++) {
    const s0 = edges[span], s1 = edges[span + 1]
    const n = Math.max(2, Math.round((density * (s1 - s0)) / c.length) + 1)
    const samples: { p: Vec2; nrm: Vec2; k: number }[] = []
    for (let i = 0; i < n; i++) {
      // A hair inside the span's ends, so a corner reads its own side.
      const s = s0 + ((s1 - s0) * i) / (n - 1)
      const t = c.paramAt(Math.min(Math.max(s, s0 + 1e-9 * c.length), s1 - 1e-9 * c.length))
      const d = c.d1(t), v = Math.hypot(d[0], d[1])
      if (!(v > 1e-12)) continue
      const k = curvatureOf(c, t)
      samples.push({ p: c.at(t), nrm: [-d[1] / v, d[0] / v], k: Number.isFinite(k) ? k : 0 })
    }
    if (smooth > 0) {
      const raw = samples.map((q) => q.k)
      for (let i = 0; i < samples.length; i++) {
        let sum = 0, m = 0
        for (let j = Math.max(0, i - smooth); j <= Math.min(samples.length - 1, i + smooth); j++) { sum += raw[j]; m++ }
        samples[i].k = sum / m
      }
    }
    const tips: Vec2[] = []
    let prev: { p: Vec2; k: number } | null = null
    for (const q of samples) {
      let len = q.k * scale
      if (Math.abs(len) > maxLength) { len = Math.sign(len) * maxLength; result.clamped++ }
      // Signed: out of the bend (away from the centre of curvature).
      const out = options.signed ? -len : -Math.abs(len)
      const tip: Vec2 = [q.p[0] + q.nrm[0] * out, q.p[1] + q.nrm[1] * out]
      if (options.signed && prev && prev.k * q.k < 0) {
        // The inflection: the tips' line meets the curve where κ = 0.
        const f = prev.k / (prev.k - q.k)
        tips.push([prev.p[0] + (q.p[0] - prev.p[0]) * f, prev.p[1] + (q.p[1] - prev.p[1]) * f])
      }
      tips.push(tip)
      result.teeth.push([q.p, tip])
      if (result.offsetLine && options.offset !== null) {
        const side = options.signed ? -Math.sign(q.k || 1) : -1
        result.offsetLine.push([q.p[0] + q.nrm[0] * side * options.offset, q.p[1] + q.nrm[1] * side * options.offset])
      }
      if (Math.abs(q.k) > best) { best = Math.abs(q.k); result.extreme = { at: q.p, tip, k: q.k } }
      prev = q
    }
    if (tips.length > 1) result.envelopes.push(tips)
  }
  return result
}
