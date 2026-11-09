// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { buildEditedSurface } from '../core/editedSurface'
import { ReKernel } from '../core/kernel'
import { Builder } from '../core/build'
import { DEFAULT_SURFACE_FIT } from '../core/surfaceFit'
import { moveSurfacePole } from '../core/surfaceStep'
import { build } from './reKit'
import type { SurfaceFeature } from '../core/features'
import { OcctKernel } from 'occt-wasm'
import { writeSurfaceStep } from '../core/surfaceStep'

it('builds the explicit translated net and measures every point against the bounded face', async () => {
  const k = await ReKernel.load()
  const axis = { degree: 1, count: 2, knots: [-2, 3], mults: [2, 2] }
  const surface = { u: structuredClone(axis), v: structuredClone(axis), poles: [[10, 0, 3], [10, 10, 3], [20, 0, 3], [20, 10, 3]] }
  // Three points below the translated sheet and one outside its boundary:
  // distances 3,3,3,5 (3 vertical, 4 horizontal), not a height-field residual.
  const xyz = Float32Array.from([11, 1, 0, 15, 5, 0, 19, 9, 0, 6, 5, 0])
  const { face, report } = buildEditedSurface(k, surface, xyz)
  try {
    expect(report.metric).toBe('closest-surface')
    expect(report.points).toBe(4)
    expect(report.rms).toBeCloseTo(Math.sqrt(13), 10)
    expect(report.max).toBeCloseTo(5, 10)
    expect(report.worst![0]).toEqual({ at: [6, 5, 0], off: 5 })
    expect(report.controlSurface).toEqual(surface)
    expect(report.controlNet!.points).toEqual(Float64Array.from(surface.poles.flat()))
    expect(k.exportStep([face])).toContain('B_SPLINE_SURFACE_WITH_KNOTS')
    report.controlSurface!.poles[0][0] = 100
    expect(surface.poles[0][0]).toBe(10)
  } finally { k.release(face) }
}, 60_000)

it('resolves and rebuilds a curved fitted sheet with its edited pole preserved', async () => {
  const k = await ReKernel.load(), builder = new Builder(k)
  const xyz: number[] = []
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
    const x = i - 10, y = j - 10
    xyz.push(x, y, 0.02 * x * x + 0.03 * y * y)
  }
  const points = Float32Array.from(xyz)
  builder.setScan(null, points)
  const f: SurfaceFeature = { id: 1, kind: 'surface', name: 'Curved sheet', region: Uint32Array.from({ length: xyz.length / 3 }, (_, i) => i), fit: { ...DEFAULT_SURFACE_FIT, net: { u: 5, v: 5 }, degree: 4, expandPct: 0 }, visible: true }
  try {
    const before = await build(builder, [f])
    expect(before.results[0].status).toBe('ok')
    const original = before.results[0].surface!.controlSurface!
    expect(original.u.degree).toBe(4)
    expect(original.poles).toHaveLength(25)
    f.controlSurface = moveSurfacePole(original, 1, 1, [3, 2, 1])
    const started = performance.now()
    const after = await build(builder, [f])
    console.log(`Edited curved sheet: ${xyz.length / 3} points measured and meshed in ${(performance.now() - started).toFixed(1)} ms`)
    expect(after.results[0].status).toBe('ok')
    expect(after.results[0].surface!.controlSurface).toEqual(f.controlSurface)
    expect(after.results[0].surface!.metric).toBe('closest-surface')
    expect(after.results[0].surface!.max).toBeGreaterThan(0.01)
    expect(after.bodies).toHaveLength(1)
    expect(original.poles[6]).not.toEqual(f.controlSurface.poles[6])
    const raw = await OcctKernel.init()
    const shapes = [raw.importStep(builder.exportStep([1])), raw.importStep(writeSurfaceStep(f.controlSurface))]
    const faces = shapes.map(s => raw.getSubShapes(s, 'face'))
    try {
      expect(faces[0]).toHaveLength(1)
      for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) {
        const u = original.u.knots[0] + i / 5 * (original.u.knots.at(-1)! - original.u.knots[0])
        const v = original.v.knots[0] + j / 5 * (original.v.knots.at(-1)! - original.v.knots[0])
        const a = raw.pointOnSurface(faces[0][0], u, v), b = raw.pointOnSurface(faces[1][0], u, v)
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-8)
      }
    } finally { faces.flat().forEach(f => raw.release(f)); shapes.forEach(s => raw.release(s)); raw[Symbol.dispose]() }
  } finally { builder.dispose() }
}, 60_000)
