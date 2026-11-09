// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { ReKernel } from '../core/kernel'
import { polynomialOfFit } from '../core/editedSurface'
import { surfaceAxis, type PolynomialSurface } from '../core/surfaceStep'
import { basisFunctions, DEFAULT_SURFACE_FIT, findSpan, fitSurface } from '../core/surfaceFit'
import fixture from './fixtures/native-surface-smoothing.json'

function sample(s: PolynomialSurface, U: number[], V: number[], u: number, v: number): [number, number, number] {
  const p = s.u.degree, q = s.v.degree, ku = Float64Array.from(U), kv = Float64Array.from(V)
  const a = findSpan(ku, s.u.count, p, u), b = findSpan(kv, s.v.count, q, v)
  const bu = new Float64Array(p + 1), bv = new Float64Array(q + 1)
  basisFunctions(ku, a, p, u, bu); basisFunctions(kv, b, q, v, bv)
  const out: [number, number, number] = [0, 0, 0]
  for (let i = 0; i <= p; i++) for (let j = 0; j <= q; j++) for (let k = 0; k < 3; k++) out[k] += bu[i] * bv[j] * s.poles[(a - p + i) * s.v.count + b - q + j][k]
  return out
}

it('measures both bounded faces without excluding native boundary samples', async () => {
  const kernel = await ReKernel.load(), reports = []
  for (const native of fixture.surfaces) {
    const points: number[] = [], [width, height] = native.grid
    for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
      const x = -30 + 60 * i / (width - 1), y = -20 + 40 * j / (height - 1)
      points.push(x, y, .006 * x * x + .009 * y * y + .003 * x * y)
    }
    const fit = fitSurface(Float32Array.from(points), { ...DEFAULT_SURFACE_FIT, net: { u: native.net, v: native.net }, degree: native.degree, smoothingLevel: native.level, expandPct: 0, orientation: 'oxy' })
    const candidate = polynomialOfFit(fit)
    const reference: PolynomialSurface = {
      u: surfaceAxis(native.knotsU, native.degree, native.net), v: surfaceAxis(native.knotsV, native.degree, native.net),
      poles: Array.from({ length: native.net ** 2 }, (_, n) => native.polesVmajor[(n % native.net) * native.net + Math.floor(n / native.net)]),
    }
    const a = kernel.surfaceFromControlNet(candidate), b = kernel.surfaceFromControlNet(reference)
    try {
      const forward: number[] = [], reverse: number[] = [], boundary: number[] = []
      let worst: { at: number[]; uv: number[]; distance: number } | undefined
      for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) {
        const at = sample(reference, native.knotsU, native.knotsV, i / 40, j / 40)
        const distance = kernel.distanceToPoint(a, at)
        expect(Number.isFinite(distance) && distance >= 0).toBe(true)
        forward.push(distance)
        if (!worst || distance > worst.distance) worst = { at, uv: [i / 40, j / 40], distance }
        if (i === 0 || i === 40 || j === 0 || j === 40) boundary.push(distance)
        const cp = sample(candidate, Array.from(fit.knotsU), Array.from(fit.knotsV), fit.uRange[0] + i / 40 * (fit.uRange[1] - fit.uRange[0]), fit.vRange[0] + j / 40 * (fit.vRange[1] - fit.vRange[0]))
        const other = kernel.distanceToPoint(b, cp)
        expect(Number.isFinite(other) && other >= 0).toBe(true); reverse.push(other)
        if (i % 10 === 0 && j % 10 === 0) {
          expect(kernel.distanceToPoint(b, at)).toBeLessThan(1e-7)
          expect(kernel.distanceToPoint(a, cp)).toBeLessThan(1e-7)
        }
      }
      const stats = (x: number[]) => ({ count: x.length, max: Math.max(...x), rms: Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length) })
      reports.push({ grid: native.grid, net: native.net, degree: native.degree, level: native.level, nativeToCandidate: stats(forward), candidateToNative: stats(reverse), nativeBoundary: stats(boundary), worst })
      // Regression ceiling above the measured bidirectional baseline, not parity acceptance.
      expect(Math.max(...forward, ...reverse)).toBeLessThan(width === 11 ? .0136 : width === 41 ? .0054 : native.level === 3 ? .0061 : .014)
      expect(forward.length).toBe(1681); expect(reverse.length).toBe(1681); expect(boundary.length).toBe(160)
    } finally { kernel.release(a); kernel.release(b) }
  }
  console.log('BOUNDED_SURFACE_BASELINE', JSON.stringify(reports))
}, 300_000)
