// SPDX-License-Identifier: AGPL-3.0-only
// Fit Surface at its default smoothness (G-04 / RM-08 of
// audit-2026-11-07/QUICKSCAN_DEVELOPMENT_ROADMAP.md). The audit's smooth
// 100 × 80 mm height field, measured against the exact truth (not the noisy
// points), with the slider where a new Fit Surface opens it. Before: clean
// 0.048 mm worst, σ 0.02 noise 0.049; none of the fairing 0.00013 / 0.013.
// Acceptance: clean worst ≤ 0.005 mm, noisy worst ≤ 3σ — and no worse than
// with no fairing at all.
import { describe, expect, it } from 'vitest'
import { DEFAULT_SURFACE_FIT, evalSurface, fitSurface } from '../core/surfaceFit'

let seed = 7
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())
const truth = (x: number, y: number) => 3 * Math.sin(x / 20) * Math.cos(y / 25) + 0.002 * x * y
const dot = (a: number[], b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

function worst(noise: number, smoothness: number): { max: number; rms: number } {
  seed = 7
  const pts: number[] = []
  for (let x = 0; x <= 100; x += 1) for (let y = 0; y <= 80; y += 1) pts.push(x, y, truth(x, y) + noise * gauss())
  const fit = fitSurface(new Float64Array(pts), { ...DEFAULT_SURFACE_FIT, smoothness })
  let max = 0
  let sq = 0
  let n = 0
  for (let x = 1; x <= 99; x += 2) {
    for (let y = 1; y <= 79; y += 2) {
      const p = [x, y, truth(x, y)]
      const d = [p[0] - fit.origin[0], p[1] - fit.origin[1], p[2] - fit.origin[2]]
      const s = evalSurface(fit, dot(d, fit.axisU), dot(d, fit.axisV))
      const e = dot([p[0] - s[0], p[1] - s[1], p[2] - s[2]], fit.normal)
      max = Math.max(max, Math.abs(e))
      sq += e * e
      n++
    }
  }
  return { max, rms: Math.sqrt(sq / n) }
}

describe('Fit Surface at the default smoothness', () => {
  it('lies within 0.005 mm of a clean smooth surface (was 0.048)', () => {
    expect(DEFAULT_SURFACE_FIT.smoothness).toBe(0.01)
    expect(worst(0, DEFAULT_SURFACE_FIT.smoothness).max).toBeLessThan(0.005)
  })

  it('lies within 3σ of the truth through noisy points, and no further than no fairing', () => {
    const faired = worst(0.02, DEFAULT_SURFACE_FIT.smoothness)
    const none = worst(0.02, 0)
    expect(faired.max).toBeLessThan(3 * 0.02)
    expect(faired.max).toBeLessThan(none.max * 1.01)
    expect(faired.rms).toBeLessThan(none.rms)
  })

  it('still fairs as much as the slider says where the data is thin (a net finer than its points)', () => {
    seed = 3
    const pts: number[] = []
    for (let x = 0; x < 11; x++) for (let y = 0; y < 11; y++) pts.push(x * 5, y * 5, 0.2 * gauss())
    const smooth = fitSurface(new Float64Array(pts), { ...DEFAULT_SURFACE_FIT, net: { u: 20, v: 20 }, smoothness: 0.05 })
    const light = fitSurface(new Float64Array(pts), { ...DEFAULT_SURFACE_FIT, net: { u: 20, v: 20 }, smoothness: 0.0005 })
    expect(smooth.rms).toBeGreaterThan(light.rms)
  })
})
