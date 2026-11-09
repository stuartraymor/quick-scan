// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { basisFunctions, DEFAULT_SURFACE_FIT, evalSurface, findSpan, fitSurface } from '../core/surfaceFit'
import fixture from './fixtures/native-surface-smoothing.json'
const points: number[] = []
for (let j = 0; j < 17; j++) for (let i = 0; i < 21; i++) {
  const x = -30 + 3 * i, y = -20 + 2.5 * j
  points.push(x, y, .006 * x * x + .009 * y * y + .003 * x * y)
}
const xyz = Float32Array.from(points)
const settings = { ...DEFAULT_SURFACE_FIT, net: { u: 5, v: 5 }, degree: 4, expandPct: 0, orientation: 'oxy' as const }
it.each(fixture.surfaces.filter(s => s.grid[0] === 21))('compares integrated fitter to native $net x $net degree $degree level $level', native => {
  const fit = fitSurface(xyz, { ...settings, net: { u: native.net, v: native.net }, degree: native.degree, smoothingLevel: native.level })
  const ku = Float64Array.from(native.knotsU), kv = Float64Array.from(native.knotsV), bu = new Float64Array(native.degree + 1), bv = new Float64Array(native.degree + 1)
  const errors: number[] = []
  for (let a = 0; a <= 40; a++) for (let b = 0; b <= 40; b++) {
    const su = findSpan(ku, native.net, native.degree, a / 40), sv = findSpan(kv, native.net, native.degree, b / 40)
    basisFunctions(ku, su, native.degree, a / 40, bu); basisFunctions(kv, sv, native.degree, b / 40, bv)
    const p = [0, 0, 0]
    for (let i = 0; i <= native.degree; i++) for (let j = 0; j <= native.degree; j++) for (let k = 0; k < 3; k++) p[k] += bu[i] * bv[j] * native.polesVmajor[(sv - native.degree + j) * native.net + su - native.degree + i][k]
    const d = p.map((x, i) => x - fit.origin[i]), u = d.reduce((s, x, i) => s + x * fit.axisU[i], 0), v = d.reduce((s, x, i) => s + x * fit.axisV[i], 0)
    if (u < fit.uRange[0] || u > fit.uRange[1] || v < fit.vRange[0] || v > fit.vRange[1]) continue
    const q = evalSurface(fit, u, v)
    expect(Math.hypot(q[0] - p[0], q[1] - p[1])).toBeLessThan(1e-8)
    errors.push(q[2] - p[2])
  }
  expect(errors.length).toBeGreaterThan(1500)
  const rms = Math.sqrt(errors.reduce((s, x) => s + x * x, 0) / errors.length), max = Math.max(...errors.map(Math.abs))
  console.log({ net: native.net, degree: native.degree, level: native.level, samples: errors.length, rms, max })
  // Guard measured approximation, not a declaration of exact native parity.
  expect(rms).toBeLessThan(native.level === 3 ? .0005 : .004)
  expect(max).toBeLessThan(native.level === 3 ? .0031 : .009)
})
it('keeps the explicit level independent from legacy weight and rejects invalid levels', () => {
  const a = fitSurface(xyz, { ...settings, smoothingLevel: 3, smoothness: 0 })
  const b = fitSurface(xyz, { ...settings, smoothingLevel: 3, smoothness: 100 })
  expect(Array.from(a.heights)).toEqual(Array.from(b.heights))
  for (const smoothingLevel of [-1, .5, 6, NaN, Infinity]) expect(() => fitSurface(xyz, { ...settings, smoothingLevel })).toThrow(/integer/)
  expect(Array.from(fitSurface(xyz, { ...settings, smoothness: 0, smoothingLevel: 0 }).heights)).toEqual(Array.from(fitSurface(xyz, { ...settings, smoothness: 0 }).heights))
})

// Native 6x6/degree4/level3 exports at 1x and 2x agree after normalization
// within 8.7e-10 mm across 6561 UV samples, including all four boundaries.
// This checks that the candidate retains that observed scale behavior.
it('scales the measured level3 surface homogeneously including its boundary', () => {
  const params = { ...settings, net: { u: 6, v: 6 }, smoothingLevel: 3 }
  const a = fitSurface(xyz, params)
  const b = fitSurface(Float32Array.from(xyz, x => 2 * x), params)
  let max = 0
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
    const at = (fit: typeof a) => evalSurface(fit,
      fit.uRange[0] + i / 20 * (fit.uRange[1] - fit.uRange[0]),
      fit.vRange[0] + j / 20 * (fit.vRange[1] - fit.vRange[0]))
    const p = at(a), q = at(b)
    max = Math.max(max, Math.hypot(...p.map((x, k) => x - q[k] / 2)))
  }
  expect(max).toBeLessThan(1e-8)
})
