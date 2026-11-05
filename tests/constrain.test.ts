// SPDX-License-Identifier: AGPL-3.0-only
// Extract primitives' constraints: a plane's normal or an axis held parallel or
// perpendicular to a coordinate plane, Auto Constrain onto the primitives
// already made, and Analysis' points beyond a tolerance.
import { describe, expect, it } from 'vitest'
import { autoConstrainFit, constrainedDirection, constrainFit, constraintOptions, pointsBeyond, CONSTRAINTS } from '../src/core/elements/constrain'
import type { CylinderFit, PlaneFit, SphereFit, Vec3 } from '../src/core/types'

const base = { sigma: 0, usedPoints: 0, regionSize: 0 }
const idxOf = (n: number) => Uint32Array.from({ length: n }, (_, i) => i)

/** A grid of points on a plane through `c` with unit normal `n` (side ±50 mm). */
function planePoints(c: Vec3, n: Vec3, step = 10): { pos: Float32Array; idx: Uint32Array } {
  const l = Math.hypot(...n)
  const nn: Vec3 = [n[0] / l, n[1] / l, n[2] / l]
  const h: Vec3 = Math.abs(nn[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const u0 = [nn[1] * h[2] - nn[2] * h[1], nn[2] * h[0] - nn[0] * h[2], nn[0] * h[1] - nn[1] * h[0]]
  const ul = Math.hypot(...u0)
  const u: Vec3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul]
  const v: Vec3 = [nn[1] * u[2] - nn[2] * u[1], nn[2] * u[0] - nn[0] * u[2], nn[0] * u[1] - nn[1] * u[0]]
  const pts: number[] = []
  for (let a = -50; a <= 50; a += step) for (let b = -50; b <= 50; b += step) pts.push(c[0] + a * u[0] + b * v[0], c[1] + a * u[1] + b * v[1], c[2] + a * u[2] + b * v[2])
  return { pos: Float32Array.from(pts), idx: idxOf(pts.length / 3) }
}
const planeFit = (center: Vec3, normal: Vec3): PlaneFit => ({ ...base, kind: 'plane', center, normal, basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 50, extentV: 50 })
const tilt = (deg: number): Vec3 => [0, Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)]

describe('constraint list', () => {
  it('matches QUICKSURFACE’s dropdown in order', () => {
    expect(CONSTRAINTS.map((c) => c.label)).toEqual(['Not constrained', 'Parallel to (OXY)', 'Parallel to (OYZ)', 'Parallel to (OXZ)', 'Perpendicular to (OXY)', 'Perpendicular to (OYZ)', 'Perpendicular to (OXZ)'])
  })
})

describe('constrainFit on a plane', () => {
  it('holds the normal along the datum normal for Parallel and re-measures σ on the same points', () => {
    const { pos, idx } = planePoints([0, 0, 7], tilt(0.3))
    const fit = planeFit([0, 0, 7], tilt(0.3))
    const out = constrainFit(fit, pos, idx, 'parallel-oxy') as PlaneFit
    expect(out.normal).toEqual([0, 0, 1])
    expect(out.center[2]).toBeCloseTo(7, 1)
    // 0.3° over a 100 mm patch leaves ≈0.26 mm of scatter against the held plane.
    expect(out.sigma).toBeGreaterThan(0.1)
    expect(out.sigma).toBeLessThan(0.5)
  })

  it('makes a near-vertical plane square to the datum for Perpendicular', () => {
    const n: Vec3 = [Math.cos(0.01), 0, Math.sin(0.01)]
    const { pos, idx } = planePoints([3, 0, 0], n)
    const out = constrainFit(planeFit([3, 0, 0], n), pos, idx, 'perpendicular-oxy') as PlaneFit
    expect(out.normal[2]).toBeCloseTo(0, 12)
    expect(Math.hypot(...out.normal)).toBeCloseTo(1, 12)
    expect(out.normal[0]).toBeCloseTo(1, 4)
  })

  it('cannot make a plane square to a datum when its normal lies along the datum’s', () => {
    const { pos, idx } = planePoints([0, 0, 0], [0, 0, 1])
    expect(constrainFit(planeFit([0, 0, 0], [0, 0, 1]), pos, idx, 'perpendicular-oxy')).toBeNull()
  })

  it('does nothing for Not constrained, spheres and cones', () => {
    const { pos, idx } = planePoints([0, 0, 0], [0, 0, 1])
    expect(constrainFit(planeFit([0, 0, 0], [0, 0, 1]), pos, idx, 'none')).toBeNull()
    const sphere: SphereFit = { ...base, kind: 'sphere', center: [0, 0, 0], radius: 5 }
    expect(constrainFit(sphere, pos, idx, 'parallel-oxy')).toBeNull()
  })
})

describe('constrainFit on a cylinder', () => {
  it('holds a tilted axis square to OXY and keeps the radius and the axis position', () => {
    const r = 10, tiltRad = (0.4 * Math.PI) / 180
    const axis: Vec3 = [Math.sin(tiltRad), 0, Math.cos(tiltRad)]
    const pts: number[] = []
    for (let z = 0; z <= 40; z += 5) for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2
      pts.push(r * Math.cos(a) + 5, r * Math.sin(a) - 2, z)
    }
    const pos = Float32Array.from(pts), idx = idxOf(pts.length / 3)
    const fit: CylinderFit = { ...base, kind: 'cylinder', center: [5, -2, 20], axis, radius: r, length: 40, coverage: 360 }
    const out = constrainFit(fit, pos, idx, 'perpendicular-oxy') as CylinderFit
    expect(out.axis).toEqual([0, 0, 1])
    expect(out.radius).toBeCloseTo(10, 2)
    expect(out.center[0]).toBeCloseTo(5, 2)
    expect(out.center[1]).toBeCloseTo(-2, 2)
    expect(out.center[2]).toBeCloseTo(20, 2)
    expect(out.length).toBeCloseTo(40, 2)
    expect(out.sigma).toBeLessThan(1e-3)
  })
})

describe('autoConstrainFit', () => {
  const existing = { name: 'Plane 1', fit: planeFit([0, 0, 5], [0, 0, 1]) }

  it('snaps a nearly parallel plane parallel and onto the existing plane inside the coincidence tolerance', () => {
    const { pos, idx } = planePoints([0, 0, 5.4], tilt(0.2))
    const { fit, notes } = autoConstrainFit(planeFit([0, 0, 5.4], tilt(0.2)), pos, idx, [existing]) as { fit: PlaneFit; notes: string[] }
    expect(fit.normal).toEqual([0, 0, 1])
    expect(fit.center[2]).toBeCloseTo(5, 6)
    expect(notes.join(' ')).toContain('parallel to Plane 1')
    expect(notes.join(' ')).toContain('coincident with Plane 1')
  })

  it('stays parallel but off the plane when the gap is over the coincidence tolerance', () => {
    const { pos, idx } = planePoints([0, 0, 9], tilt(0.2))
    const { fit, notes } = autoConstrainFit(planeFit([0, 0, 9], tilt(0.2)), pos, idx, [existing]) as { fit: PlaneFit; notes: string[] }
    expect(fit.normal).toEqual([0, 0, 1])
    expect(fit.center[2]).toBeCloseTo(9, 1)
    expect(notes.join(' ')).not.toContain('coincident')
  })

  it('leaves a plane alone when it is further than the tilt tolerance off', () => {
    const { pos, idx } = planePoints([0, 0, 5], tilt(2))
    const own = planeFit([0, 0, 5], tilt(2))
    const out = autoConstrainFit(own, pos, idx, [existing])
    expect(out.fit).toBe(own)
    expect(out.notes).toEqual([])
  })

  it('squares a plane that is nearly perpendicular to an existing one', () => {
    const n: Vec3 = [Math.cos(0.005), 0, Math.sin(0.005)]
    const { pos, idx } = planePoints([20, 0, 0], n)
    const { fit, notes } = autoConstrainFit(planeFit([20, 0, 0], n), pos, idx, [existing]) as { fit: PlaneFit; notes: string[] }
    expect(fit.normal[2]).toBeCloseTo(0, 12)
    expect(notes[0]).toContain('perpendicular to Plane 1')
  })

  it('holds a first plane to the coordinate system inside the tolerance, measuring its offset and residual', () => {
    const { pos, idx } = planePoints([0, 0, 5], tilt(0.3))
    const own = planeFit([0, 0, 5], tilt(0.3))
    const result = autoConstrainFit(own, pos, idx, [])
    expect(result.choice?.id).toBe('parallel-oxy')
    expect((result.fit as PlaneFit).normal).toEqual([0, 0, 1])
    expect((result.fit as PlaneFit).center[2]).toBeCloseTo(5, 4)
    expect(result.fit.sigma).toBeGreaterThan(0.001)
    expect(autoConstrainFit(own, pos, idx, [], { tiltDeg: 0.1, coincidenceMm: 1 }).fit).toBe(own)
  })
})

describe('pointsBeyond (Analysis)', () => {
  it('lists the marked points further than the tolerance from the plane', () => {
    const { pos, idx } = planePoints([0, 0, 0], [0, 0, 1])
    const moved = Float32Array.from(pos)
    moved[2] = 0.5 // the first point sits 0.5 mm off the plane
    const out = pointsBeyond(planeFit([0, 0, 0], [0, 0, 1]), moved, idx, 0.1)
    expect(out.far).toEqual([0])
    expect(out.worst).toBeCloseTo(0.5, 6)
  })
})

describe('constraints to primitives already made', () => {
  const plane = (n: [number, number, number]) => ({ kind: 'plane', normal: n, center: [0, 0, 0], basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 1, extentV: 1, sigma: 0, formError: 0, residualMin: 0, residualMax: 0 }) as never
  const tilted: [number, number, number] = [0, Math.SQRT1_2, Math.SQRT1_2]
  const refs = [{ id: 7, name: 'Plane 1', fit: plane(tilted) }, { id: 8, name: 'Cylinder 1', fit: { kind: 'cylinder', axis: [1, 0, 0], center: [0, 0, 0], radius: 1, length: 1 } as never }]
  it('lists each primitive as QUICKSURFACE does', () => {
    const labels = constraintOptions(refs).map((o) => o.label)
    expect(labels).toEqual(expect.arrayContaining(['Parallel to Plane 1', 'Perpendicular to Plane 1', 'Perpendicular to Cylinder 1']))
    expect(labels).not.toContain('Parallel to Cylinder 1')
  })
  it('holds a plane parallel to a plane, and perpendicular to a cylinder axis', () => {
    const d = constrainedDirection(plane([0, 0.6, 0.8]), 'parallel-el7', refs)!
    expect(Math.abs(d[1] - tilted[1]) + Math.abs(d[2] - tilted[2])).toBeLessThan(1e-9)
    const p = constrainedDirection(plane([0.9, 0.1, 0]), 'perpendicular-el8', refs)!
    expect(Math.abs(p[0])).toBeCloseTo(1, 9)
  })
})
