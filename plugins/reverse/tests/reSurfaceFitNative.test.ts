// SPDX-License-Identifier: AGPL-3.0-only
// The fit controls QUICKSURFACE 8.0.128's Fit Surface edit dialog has, read
// live on 2026-11-09: Method (Simple, Refined), Degree with Max degree (one
// less than the net's smaller side — 4 at 5 × 5, 9 at 10 × 10 there),
// Auto… (a target tolerance, 0.100 mm), and Surface orientation (Selection
// bounds, Axis aligned, OXY, OYZ, OXZ).
import { describe, expect, it } from 'vitest'
import { validate } from '../../../src/commands/schema'
import { featureOf } from '../app/reSchemas'
import { Builder } from '../core/build'
import type { Feature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { build } from './reKit'
import { DEFAULT_SURFACE_FIT, fitSurface, MAX_DEGREE, orientationNormal } from '../core/surfaceFit'

/** Points on a grid w × h, z = f(x, y). */
function patch(f: (x: number, y: number) => number, w: number, h: number, step: number): Float64Array {
  const pts: number[] = []
  for (let x = -w / 2; x <= w / 2; x += step) for (let y = -h / 2; y <= h / 2; y += step) pts.push(x, y, f(x, y))
  return Float64Array.from(pts)
}
const net = (u: number, v: number) => ({ ...DEFAULT_SURFACE_FIT, net: { u, v } })

describe('Method', () => {
  // A ring of points with nothing in the middle: the empty cells are where the pull acts.
  const ring = (() => {
    const pts: number[] = []
    for (let a = 0; a < 360; a += 3) for (const r of [14, 16, 18]) pts.push(r * Math.cos((a * Math.PI) / 180), r * Math.sin((a * Math.PI) / 180), 0.02 * Math.cos((a * Math.PI) / 90) + 0.001 * r)
    return Float64Array.from(pts)
  })()

  it('refined is what a fit was before there was a choice', () => {
    const was = fitSurface(ring, net(8, 8), 0.02)
    const refined = fitSurface(ring, { ...net(8, 8), method: 'refined' }, 0.02)
    expect(Array.from(refined.heights)).toEqual(Array.from(was.heights))
  })

  it('simple is the plain fit, with no pull toward the plane', () => {
    const plain = fitSurface(ring, net(8, 8), 0.02, 0)
    const simple = fitSurface(ring, { ...net(8, 8), method: 'simple' }, 0.02)
    expect(Array.from(simple.heights)).toEqual(Array.from(plain.heights))
  })
})

describe('Degree and Max degree', () => {
  const xyz = patch((x, y) => 0.02 * x * x + 0.01 * y, 60, 40, 1)

  it('takes a degree up to what the kernel carries', () => {
    expect(MAX_DEGREE).toBe(8)
    expect(fitSurface(xyz, { ...net(10, 10), degree: 7 }, 0.01).degree).toBe(7)
    expect(fitSurface(xyz, { ...net(10, 10), degree: 40 }, 0.01).degree).toBe(MAX_DEGREE)
  })

  it('Max degree is one less than the net’s smaller side', () => {
    expect(fitSurface(xyz, { ...net(5, 5), maxDegree: true }, 0.01).degree).toBe(4)
    expect(fitSurface(xyz, { ...net(4, 9), maxDegree: true }, 0.01).degree).toBe(3)
    expect(fitSurface(xyz, { ...net(10, 10), maxDegree: true }, 0.01).degree).toBe(8)
  })

  it('Max degree sets the degree aside', () => {
    expect(fitSurface(xyz, { ...net(6, 6), degree: 2, maxDegree: true }, 0.01).degree).toBe(5)
    expect(fitSurface(xyz, { ...net(6, 6), degree: 2 }, 0.01).degree).toBe(2)
  })

  it('still follows a gentle surface at the highest degree', () => {
    expect(fitSurface(xyz, { ...net(10, 10), maxDegree: true }, 0.01).rms).toBeLessThan(0.05)
  })
})

describe('Auto… with a target tolerance', () => {
  const xyz = patch((x, y) => 3 * Math.sin(x / 9) + 2 * Math.cos(y / 7), 80, 60, 1)
  const auto = (tolerance: number) => fitSurface(xyz, { ...DEFAULT_SURFACE_FIT, net: null, tolerance, smoothness: 0 }, 0.01)

  it('chooses a smaller net for a looser tolerance and one inside the tolerance', () => {
    const loose = auto(0.5)
    const tight = auto(0.02)
    expect(loose.max).toBeLessThanOrEqual(0.5)
    expect(loose.net.u * loose.net.v).toBeLessThanOrEqual(tight.net.u * tight.net.v)
    expect(loose.net.u).toBeLessThan(tight.net.u)
    expect(tight.max).toBeLessThanOrEqual(0.02)
  })

  it('keeps the region’s proportions, the longer side getting the more', () => {
    const fit = auto(0.1)
    expect(fit.net.u).toBeGreaterThanOrEqual(fit.net.v)
  })

  it('gives the largest net when nothing smaller is within it', () => {
    const noisy = Float64Array.from(xyz, (v, i) => v + (i % 3 === 2 ? 0.5 * Math.sin(i * 12.9898) : 0))
    const fit = fitSurface(noisy, { ...DEFAULT_SURFACE_FIT, net: null, tolerance: 1e-6, smoothness: 0 }, 0.01)
    expect(Math.max(fit.net.u, fit.net.v)).toBe(20)
  })
})

describe('Surface orientation', () => {
  it('names the direction of each entry of the list', () => {
    expect(orientationNormal('oxy', [0, 0.6, 0.8])).toEqual([0, 0, 1])
    expect(orientationNormal('oyz', [0, 0.6, 0.8])).toEqual([1, 0, 0])
    expect(orientationNormal('oxz', [0, 0.6, 0.8])).toEqual([0, 1, 0])
    expect(orientationNormal('bounds', [0, 0.6, 0.8])).toBeUndefined()
    expect(orientationNormal(undefined, [0, 0.6, 0.8])).toBeUndefined()
  })

  it('Axis aligned is the world axis nearest the principal normal, on its side', () => {
    expect(orientationNormal('axis', [0.1, -0.9, 0.2])).toEqual([0, -1, 0])
    expect(orientationNormal('axis', [0.3, 0.2, 0.9])).toEqual([0, 0, 1])
    expect(orientationNormal('axis', [-0.8, 0.1, 0.1])).toEqual([-1, 0, 0])
  })

  // A plane z = 0.3 x: its principal normal leans 16.7° off z.
  const slope = patch((x) => 0.3 * x, 40, 30, 1)

  it('Selection bounds is the region’s own normal; OXY and Axis aligned lay it along z', () => {
    const bounds = fitSurface(slope, net(5, 5), 0.01)
    expect(Math.abs(bounds.normal[2])).toBeLessThan(0.97)
    const oxy = fitSurface(slope, { ...net(5, 5), orientation: 'oxy' }, 0.01)
    expect(oxy.normal).toEqual([0, 0, 1])
    const axis = fitSurface(slope, { ...net(5, 5), orientation: 'axis' }, 0.01)
    expect(Math.abs(axis.normal[2])).toBeCloseTo(1, 12)
    expect(oxy.rms).toBeLessThan(0.01)
  })

  it('OYZ and OXZ fit along x and along y', () => {
    expect(fitSurface(slope, { ...net(5, 5), orientation: 'oyz' }, 0.01).normal[0]).toBeCloseTo(1, 12)
    expect(fitSurface(slope, { ...net(5, 5), orientation: 'oxz' }, 0.01).normal[1]).toBeCloseTo(1, 12)
  })

  it('a normal given outright wins over the list', () => {
    expect(fitSurface(slope, { ...net(5, 5), orientation: 'oyz', normal: [0, 0, 2] }, 0.01).normal).toEqual([0, 0, 1])
  })
})

describe('the kernel builds what the new controls fit', () => {
  const kernelPromise = ReKernel.load()
  async function built(xyz: Float64Array, fit: Partial<typeof DEFAULT_SURFACE_FIT>) {
    const builder = new Builder(await kernelPromise)
    const positions = Float32Array.from(xyz)
    builder.setScan(null, positions)
    const region = Uint32Array.from({ length: positions.length / 3 }, (_, i) => i)
    const f = { id: 1, kind: 'surface', name: 'Surface 1', region, fit: { ...DEFAULT_SURFACE_FIT, ...fit }, visible: true } as unknown as Feature
    const out = await build(builder, [f])
    builder.dispose()
    return { result: out.results[0], body: out.bodies[0] }
  }
  const xyz = patch((x, y) => 2 * Math.sin(x / 15) + 0.02 * y, 60, 40, 1)

  it('Max degree at 10 × 10, degree 8, makes a face that stands where the points do', async () => {
    const { result, body } = await built(xyz, { net: { u: 10, v: 10 }, maxDegree: true })
    expect(result.status).toBe('ok')
    expect(body.box!.min[2]).toBeGreaterThan(-4)
    expect(body.box!.max[2]).toBeLessThan(5)
  })

  it('Simple, an orientation and Auto… all build', async () => {
    for (const fit of [{ method: 'simple' as const }, { orientation: 'oxy' as const }, { net: null, tolerance: 0.1 }]) {
      const { result, body } = await built(xyz, fit)
      expect(result.status, JSON.stringify(fit)).toBe('ok')
      expect(body).toBeDefined()
    }
  })
})

describe('the command schema', () => {
  const surface = (fit: object) => ({ kind: 'surface', region: { box: { min: [0, 0, 0], max: [1, 1, 1] } }, fit })
  it('takes the new fit parameters', () => {
    expect(validate(featureOf('surface'), surface({ method: 'simple', maxDegree: true, tolerance: 0.1, orientation: 'oyz', degree: 8 }), 'feature')).toEqual([])
  })
  it('refuses a method, an orientation or a degree it does not have', () => {
    expect(validate(featureOf('surface'), surface({ method: 'fancy' }), 'feature')).not.toEqual([])
    expect(validate(featureOf('surface'), surface({ orientation: 'oxx' }), 'feature')).not.toEqual([])
    expect(validate(featureOf('surface'), surface({ degree: 9 }), 'feature')).not.toEqual([])
    expect(validate(featureOf('surface'), surface({ tolerance: 0 }), 'feature')).not.toEqual([])
  })
})
