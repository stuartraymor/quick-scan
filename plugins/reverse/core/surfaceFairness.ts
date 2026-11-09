// SPDX-License-Identifier: AGPL-3.0-only
// Integrals of B-spline derivative products over a normalized knot domain.
// This mathematical building block does not choose a smoothing model or weight.
export function surfaceDerivativeGram(knots: ArrayLike<number>, count: number, degree: number, derivative: 0 | 1 | 2): Float64Array {
  if (!Number.isInteger(count) || count < 2 || count > 20 || !Number.isInteger(degree) || degree < 1 || degree > 9 || count <= degree || knots.length !== count + degree + 1 || ![0, 1, 2].includes(derivative)) throw new Error('Invalid surface basis.')
  const raw = Array.from(knots)
  if (raw.some((x, i) => !Number.isFinite(x) || (i > 0 && x < raw[i - 1]))) throw new Error('Invalid surface knots.')
  const lo = raw[degree], span = raw[count] - lo
  if (!(span > 0) || !Number.isFinite(span) || raw.slice(0, degree + 1).some(x => x !== lo) || raw.slice(count).some(x => x !== raw[count])) throw new Error('Expected a clamped surface basis.')
  const k = raw.map(x => (x - lo) / span), gram = new Float64Array(count * count)
  if (derivative > degree) return gram
  const quadrature = gaussLegendre(degree + 1)
  for (let interval = degree; interval < count; interval++) {
    const a = k[interval], b = k[interval + 1]
    if (b === a) continue
    for (const [node, weight] of quadrature) {
      const t = (a + b + node * (b - a)) / 2, cache = new Map<number, number>()
      const basis = (i: number, p: number, d: number): number => {
        const key = (i * 10 + p) * 3 + d, previous = cache.get(key)
        if (previous !== undefined) return previous
        let value = 0
        if (d > p) value = 0
        else if (p === 0) value = k[i] <= t && t < k[i + 1] ? 1 : 0
        else {
          const left = k[i + p] - k[i], right = k[i + p + 1] - k[i + 1]
          value = d > 0
            ? (left ? p * basis(i, p - 1, d - 1) / left : 0) - (right ? p * basis(i + 1, p - 1, d - 1) / right : 0)
            : (left ? (t - k[i]) * basis(i, p - 1, 0) / left : 0) + (right ? (k[i + p + 1] - t) * basis(i + 1, p - 1, 0) / right : 0)
        }
        cache.set(key, value)
        return value
      }
      const values = Array.from({ length: count }, (_, i) => basis(i, degree, derivative))
      const scale = weight * (b - a) / 2
      for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) gram[i * count + j] += scale * values[i] * values[j]
    }
  }
  return gram
}

/** Candidate for native slider levels, not exact native equivalence.
 * Fixed parameter-domain penalty: native99/357/1353point fixtures reject
 * per-point normalization. Full-domain boundary errors remain, including
 * a slight coarse-mesh maximum regression despite lower mean error.
 * Uniform2x scaling was verified for6x6 degree4 level3, zero expansion. */
export function addSurfaceLevelFairness(system: Float64Array, knotsU: ArrayLike<number>, knotsV: ArrayLike<number>, nu: number, nv: number, degree: number, level: number): void {
  if (!Number.isInteger(level) || level < 0 || level > 5 || system.length !== (nu * nv) ** 2) throw new Error('Invalid surface smoothing system.')
  if (level === 0) return
  const u = [0, 1, 2].map(d => surfaceDerivativeGram(knotsU, nu, degree, d as 0 | 1 | 2))
  const v = [0, 1, 2].map(d => surfaceDerivativeGram(knotsV, nv, degree, d as 0 | 1 | 2))
  const factor = (level / 5) ** 3, size = nu * nv
  const weights = [0.0011680326785557216, 0.0010256799575500495, 0.003579877246636782]
  for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) {
    const a = Math.floor(i / nv) * nu + Math.floor(j / nv), b = (i % nv) * nv + j % nv
    system[i * size + j] += factor * (weights[0] * u[2][a] * v[0][b] + weights[1] * u[0][a] * v[2][b] + weights[2] * u[1][a] * v[1][b])
  }
}

/** n nodes integrate each span's polynomial products through degree 2n-1. */
function gaussLegendre(n: number): [number, number][] {
  const result: [number, number][] = []
  for (let i = 0; i < n; i++) {
    let x = Math.cos(Math.PI * (i + 0.75) / (n + 0.5)), slope = 0
    for (let iteration = 0; iteration < 30; iteration++) {
      let previous = 1, current = x
      for (let p = 2; p <= n; p++) [previous, current] = [current, ((2 * p - 1) * x * current - (p - 1) * previous) / p]
      slope = n * (x * current - previous) / (x * x - 1)
      const change = current / slope
      x -= change
      if (Math.abs(change) < 1e-15) break
    }
    result.push([x, 2 / ((1 - x * x) * slope * slope)])
  }
  return result
}
