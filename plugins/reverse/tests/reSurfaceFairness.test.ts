// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { surfaceDerivativeGram } from '../core/surfaceFairness'
const knots = (p: number) => [...Array(p + 1).fill(0), ...Array(p + 1).fill(1)]
const choose = (n: number, k: number): number => { let x = 1; for (let i = 1; i <= k; i++) x *= (n - i + 1) / i; return x }
const energy = (g: Float64Array, c: number[]) => c.reduce((sum, a, i) => sum + c.reduce((v, b, j) => v + a * b * g[i * c.length + j], 0), 0)
it.each([2, 3, 4, 5, 9])('integrates the analytic Bernstein mass matrix and quadratic curvature at degree %i', p => {
  const n = p + 1, mass = surfaceDerivativeGram(knots(p), n, p, 0)
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) expect(mass[i * n + j]).toBeCloseTo(choose(p, i) * choose(p, j) / ((2 * p + 1) * choose(2 * p, i + j)), 12)
  const curvature = surfaceDerivativeGram(knots(p), n, p, 2)
  expect(energy(curvature, Array.from({ length: n }, (_, i) => i * (i - 1) / (p * (p - 1))))).toBeCloseTo(4, 9)
  expect(energy(curvature, Array.from({ length: n }, (_, i) => i / p))).toBeCloseTo(0, 9)
})
it('handles interior knots, normalized domains and positive curvature energy', () => {
  const k = [0, 0, 0, 0, 0, 0.5, 1, 1, 1, 1, 1], n = 6
  const a = surfaceDerivativeGram(k, n, 4, 2), b = surfaceDerivativeGram(k.map(x => 17 + 31 * x), n, 4, 2)
  expect(Array.from(a)).toEqual(Array.from(b))
  const greville = Array.from({ length: n }, (_, i) => k.slice(i + 1, i + 5).reduce((s, x) => s + x, 0) / 4)
  expect(energy(a, greville)).toBeCloseTo(0, 9)
  expect(energy(a, [1, -3, 2, 4, -1, 0])).toBeGreaterThan(0)
  expect(energy(surfaceDerivativeGram(k, n, 4, 0), Array(n).fill(1))).toBeCloseTo(1, 12)
})
it('rejects invalid bases and returns zero second derivative for linear spans', () => {
  expect(() => surfaceDerivativeGram([0, 0, NaN, 1], 2, 1, 1)).toThrow()
  expect(() => surfaceDerivativeGram([0, 0, 0, 0], 2, 1, 1)).toThrow()
  expect(Array.from(surfaceDerivativeGram([0, 0, 1, 1], 2, 1, 2))).toEqual([0, 0, 0, 0])
})
