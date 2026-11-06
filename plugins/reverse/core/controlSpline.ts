// SPDX-License-Identifier: AGPL-3.0-only
// Independent least-squares cubic fitting. Chord-length parameterization and
// initializes the fit; geometric refinement removes parameterization bias.
// Fixed section-length weights avoid favoring densely tessellated regions.
import type { Vec2 } from '../../../src/core/flat/types'

export function validControlSpline(e: { pts?: unknown; controlKnots?: unknown; closed?: unknown; startDir?: unknown; endDir?: unknown }): boolean {
  if (e.controlKnots === undefined) return true
  const p = e.pts, k = e.controlKnots
  return !e.closed && e.startDir === undefined && e.endDir === undefined && Array.isArray(p) && p.length >= 4 && p.every((v) => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) && Array.isArray(k) && k.length === p.length - 2 && k.every((x, i) => typeof x === 'number' && Number.isFinite(x) && (i === 0 || x > k[i - 1]))
}

function basis(knots: number[], count: number, t: number): number[] {
  let b: number[] = Array.from({ length: knots.length - 1 }, (_, i) => t >= knots[i] && t < knots[i + 1] ? 1 : 0)
  if (t === knots[count]) { b.fill(0); b[count - 1] = 1 }
  for (let degree = 1; degree <= 3; degree++) {
    b = Array.from({ length: b.length - 1 }, (_, i) => {
      const a = knots[i + degree] - knots[i], c = knots[i + degree + 1] - knots[i + 1]
      return (a > 0 ? (t - knots[i]) / a * b[i] : 0) + (c > 0 ? (knots[i + degree + 1] - t) / c * b[i + 1] : 0)
    })
  }
  return b
}

/** Weighted QR, using Givens rotations on each row. Two right-hand sides
 * share the factorization; no normal equations or regularization drift. */
function leastSquares(rows: number[][], rhs: Vec2[], n: number): Vec2[] {
  const r = Array.from({ length: n }, () => new Float64Array(n + 2))
  for (let i = 0; i < rows.length; i++) {
    const a = Float64Array.from([...rows[i], ...rhs[i]])
    for (let j = 0; j < n; j++) {
      if (a[j] === 0) continue
      const h = Math.hypot(r[j][j], a[j]), c = r[j][j] / h, s = a[j] / h
      for (let k = j; k < n + 2; k++) { const v = r[j][k]; r[j][k] = c * v + s * a[k]; a[k] = -s * v + c * a[k] }
    }
  }
  const scale = Math.max(...r.map((v, i) => Math.abs(v[i])))
  const x: Vec2[] = Array.from({ length: n }, () => [0, 0])
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(r[i][i]) <= scale * 1e-12) throw new Error('The highlighted points do not support that many curve control points.')
    for (let d = 0; d < 2; d++) { let v = r[i][n + d]; for (let j = i + 1; j < n; j++) v -= r[i][j] * x[j][d]; x[i][d] = v / r[i][i] }
  }
  return x
}

/** Open, clamped cubic with fixed end samples. The displayed handles are
 * these poles, not points interpolated by a second, different curve. */
export function fitControlSpline(points: readonly Vec2[], requestedCount: number): { pts: Vec2[]; controlKnots: number[] } {
  if (points.length < 4 || points.some((p) => !p.every(Number.isFinite)) || !Number.isFinite(requestedCount)) throw new Error('Fit Curve needs at least four finite points.')
  const count = Math.max(4, Math.min(64, points.length, Math.round(requestedCount)))
  const distances = [0]
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  const length = distances.at(-1)!
  if (!(length > 1e-10)) throw new Error('Those points do not span a curve.')
  let params = distances.map((d) => d / length)
  const controlKnots = Array.from({ length: count - 2 }, (_, i) => i / (count - 3))
  const knots = [0, 0, 0, ...controlKnots, 1, 1, 1]
  const first = points[0], last = points.at(-1)!
  // Keep all optimization in a local frame, including polynomial evaluation.
  const local = points.map((p): Vec2 => [p[0] - first[0], p[1] - first[1]])
  const weights = params.map((_, i) => i > 0 && i + 1 < params.length ? Math.sqrt((params[i + 1] - params[i - 1]) / 2) : 0)
  const solve = (ts: number[]): Vec2[] => {
    const rows: number[][] = [], rhs: Vec2[] = []
    for (let i = 1; i + 1 < points.length; i++) {
      const b = basis(knots, count, ts[i]), w = weights[i]
      rows.push(b.slice(1, -1).map(v => v * w))
      rhs.push([0, 1].map(d => (local[i][d] - b[count - 1] * local.at(-1)![d]) * w) as Vec2)
    }
    return [[0, 0], ...leastSquares(rows, rhs, count - 2), [...local.at(-1)!]]
  }
  const value = (poles: Vec2[], t: number): Vec2 => {
    const b = basis(knots, count, t)
    return [0, 1].map(d => poles.reduce((sum, p, j) => sum + p[d] * b[j], 0)) as Vec2
  }
  const objective = (poles: Vec2[], ts: number[]): number => {
    let sum = 0
    for (let i = 1; i + 1 < points.length; i++) {
      const p = value(poles, ts[i])
      sum += weights[i] ** 2 * ((p[0] - local[i][0]) ** 2 + (p[1] - local[i][1]) ** 2)
    }
    return sum
  }
  let poles = solve(params), cost = objective(poles, params)
  // Alternating bounded Newton projections and weighted QR. Each accepted
  // step reduces the SAME objective; sample weights and endpoints stay fixed.
  // A finite iteration cap keeps difficult or noisy selections predictable.
  // QR grows with samples × poles². Cap total refinement work as well as
  // iterations so large handle counts cannot freeze the interactive editor.
  const iterations = Math.max(1, Math.min(150, Math.floor(5_000_000 / (points.length * count * count))))
  for (let iteration = 0; iteration < iterations && cost > length * length * 1e-24; iteration++) {
    const spans = controlKnots.length - 1
    // Each span is exactly cubic. Cache Horner coefficients so projections
    // and derivatives need no repeated B-spline basis construction.
    const polynomial = Array.from({ length: spans }, (_, j) => {
      const v = Array.from({ length: 4 }, (_, i) => value(poles, (j + i / 3) / spans))
      return [0, 1].map(d => {
        const z = v[0][d], a = v[1][d] - z, b = v[2][d] - z, c = v[3][d] - z
        return [4.5 * (c - 3 * b + 3 * a), 4.5 * (4 * b - 5 * a - c), 9 * a - 4.5 * b + c, z]
      })
    })
    const evaluate = (t: number) => {
      const j = Math.min(spans - 1, Math.floor(t * spans)), u = t * spans - j
      return polynomial[j].map(([a, b, c, d]) => [((a * u + b) * u + c) * u + d, (3 * a * u + 2 * b) * u + c, 6 * a * u + 2 * b])
    }
    const next = [...params]
    for (let i = 1; i + 1 < points.length; i++) {
      const v = evaluate(params[i]), ex = v[0][0] - local[i][0], ey = v[1][0] - local[i][1]
      const gradient = ex * v[0][1] + ey * v[1][1]
      const hessian = v[0][1] ** 2 + v[1][1] ** 2 + ex * v[0][2] + ey * v[1][2]
      if (!(hessian > 0)) continue
      let delta = -gradient / hessian / spans
      for (let trial = 0; trial < 8; trial++) {
        // Bound movement by span size, not sample spacing: densification or
        // duplicate samples must not artificially slow geometric refinement.
        const t = Math.max(0, Math.min(1, params[i] + Math.max(-0.5 / spans, Math.min(0.5 / spans, delta))))
        const q = evaluate(t)
        if ((q[0][0] - local[i][0]) ** 2 + (q[1][0] - local[i][1]) ** 2 < ex * ex + ey * ey) { next[i] = t; break }
        delta *= 0.5
      }
    }
    // Backtrack the whole update if independently projected samples cross.
    // Equal parameters (duplicate data) remain allowed and ordered.
    const unordered = () => next.some((t, i) => i > 0 && t < next[i - 1])
    for (let trial = 0; trial < 20 && unordered(); trial++) {
      for (let i = 1; i + 1 < next.length; i++) next[i] = (next[i] + params[i]) / 2
    }
    if (unordered()) break
    let candidate: Vec2[]
    try { candidate = solve(next) } catch { break } // Retain the last valid fit on rank loss.
    const candidateCost = objective(candidate, next)
    if (!Number.isFinite(candidateCost) || candidateCost >= cost) break
    const improvement = cost - candidateCost
    poles = candidate; params = next; cost = candidateCost
    if (improvement <= cost * 1e-9 + length * length * 1e-24) break
  }
  return { pts: [[...first], ...poles.slice(1, -1).map((p): Vec2 => [p[0] + first[0], p[1] + first[1]]), [...last]], controlKnots }
}
