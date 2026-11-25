// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { ReKernel } from '../core/kernel'
import type { Feature, ThickenConstraint } from '../core/features'
import { fitSurface, INTERACTIVE_SURFACE_FIT } from '../core/surfaceFit'
import { build, rectangleSketch } from './reKit'

const kernel = ReKernel.load()
const sheet: Feature = { id: 2, kind: 'sheet', name: 'Face', sketchId: 1, from: 0, to: 0, planar: true, visible: true }
const z = (offset: number) => ({ kind: 'world' as const, axis: 'z' as const, offset })
const wall = (constraint: ThickenConstraint): Feature => ({ id: 3, kind: 'thicken', name: 'Wall', sheet: 2, side: 'both', thickness: 4, constraint, op: 'new', visible: true })

describe('surfacing workflow', () => {
  it('fits a clean tilted quadratic and refuses an edge-on selection', () => {
    const pts: number[] = [], edge: number[] = []
    for (let x = -5; x <= 5; x++) for (let y = -4; y <= 4; y++) {
      pts.push(x, y, 0.02*x*x + 0.1*y)
      edge.push(x, x, y)
    }
    const fit = fitSurface(Float64Array.from(pts), INTERACTIVE_SURFACE_FIT)
    expect([fit.nu, fit.nv, fit.degree]).toEqual([5, 5, 4])
    expect(fit.rms).toBeLessThan(0.03)
    expect(() => fitSurface(Float64Array.from(edge), { ...INTERACTIVE_SURFACE_FIT, orientation: 'oxy' })).toThrow(/projects to a line/)
  })
  it.each([
    ['direction', { mode: 'direction', plane: z(0) }, -2, 2],
    ['up to', { mode: 'toPlane', plane: z(8) }, 0, 8],
    ['up to negative', { mode: 'toPlane', plane: z(-3) }, -3, 0],
    ['between on same side', { mode: 'betweenPlanes', plane: z(9), end: z(3) }, 3, 9],
  ] as const)('%s produces the expected closed wall and plane caps', async (_, c, lo, hi) => {
    const b = new Builder(await kernel)
    try {
      const result = await build(b, [rectangleSketch(1, 4, 5), sheet, wall(c)])
      expect(result.results.map(r => r.message ?? r.status)).toEqual(['ok', 'ok'])
      const solid = result.bodies.find(body => body.id === 3)!
      expect(solid.closed).toBe(true)
      expect(solid.volume).toBeCloseTo(20*(hi-lo), 4)
      expect(solid.box!.min[2]).toBeCloseTo(lo, 4)
      expect(solid.box!.max[2]).toBeCloseTo(hi, 4)
    } finally { b.dispose() }
  })
  it.each([true, false])('offsets a sheet with keep = %s', async keep => {
    const b = new Builder(await kernel)
    try {
      const out = await build(b, [rectangleSketch(1,4,5), sheet, { id:3, kind:'offsetBody', name:'Offset', body:2, distance:-2, keep, visible:true }])
      expect(out.results.map(r=>r.message ?? r.status)).toEqual(['ok','ok'])
      expect(out.bodies.length).toBe(keep ? 2 : 1)
      const moved = out.bodies.find(x=>x.id === (keep ? 3 : 2))!
      expect(moved.surface).toBe(true)
      expect(Math.abs(moved.box!.min[2])).toBeCloseTo(2,4)
    } finally { b.dispose() }
  })
})
