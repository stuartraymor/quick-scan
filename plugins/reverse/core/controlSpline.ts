// SPDX-License-Identifier: AGPL-3.0-only
// Independent least-squares cubic fitting. Chord-length parameterization and
// section-length weights prevent tessellation density becoming a fit weight.
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
  const params = distances.map((d) => d / length)
  const controlKnots = Array.from({ length: count - 2 }, (_, i) => i / (count - 3))
  const knots = [0, 0, 0, ...controlKnots, 1, 1, 1]
  const first = points[0], last = points.at(-1)!, rows: number[][] = [], rhs: Vec2[] = []
  for (let i = 1; i + 1 < points.length; i++) {
    const b = basis(knots, count, params[i]), w = Math.sqrt((params[i + 1] - params[i - 1]) / 2)
    rows.push(b.slice(1, -1).map((v) => v * w))
    rhs.push([0, 1].map((d) => ((points[i][d] - first[d]) - b[count - 1] * (last[d] - first[d])) * w) as Vec2)
  }
  const inner = leastSquares(rows, rhs, count - 2)
  return { pts: [[...first], ...inner.map((p): Vec2 => [p[0] + first[0], p[1] + first[1]]), [...last]], controlKnots }
}
