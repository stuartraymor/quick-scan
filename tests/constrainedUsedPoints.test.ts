// SPDX-License-Identifier: AGPL-3.0-only
// A primitive held to a direction is measured again on the points the free fit
// KEPT after its used-points cut-off, not on the whole marking. QUICKSURFACE
// 8.0.128 on basic_part: a cylinder auto-constrained parallel + coincident to
// its own free fit keeps the same radius (difference 5e-7 mm); Quick Scan
// 0.0.147 refitted on all marked points, re-admitted 185 dropped outliers and
// moved the radius by 0.0018 mm (analysis/quick-scan-v0.0.148).
import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import { fitCylinderOnSelection } from '../src/core/fit/fitCylinderFromSeed'
import { autoConstrainFit, canHoldCoincidentAxis, constrainFit, constraintOptions, withDirection } from '../src/core/elements/constrain'
import type { FitData } from '../src/core/types'

let seed = 777
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
function cylinderWithOutliers(): Float32Array {
  const R = 50, nu = 180, nz = 40, H = 40
  const node = (i: number, j: number): number[] => {
    const a = (2 * Math.PI * i) / nu, z = (H * j) / nz
    // Noise, plus a sparse band of points standing 2 mm proud (a scan defect).
    const r = R + 0.02 * (rand() - 0.5) + ((i * 7 + j * 13) % 97 === 0 ? 2 : 0)
    return [r * Math.cos(a), r * Math.sin(a), z]
  }
  const grid = Array.from({ length: nu }, (_, i) => Array.from({ length: nz + 1 }, (_, j) => node(i, j)))
  const out: number[] = []
  for (let i = 0; i < nu; i++) for (let j = 0; j < nz; j++) {
    const p = grid[i][j], q = grid[(i + 1) % nu][j], r = grid[(i + 1) % nu][j + 1], s = grid[i][j + 1]
    out.push(...p, ...q, ...r, ...p, ...r, ...s)
  }
  return new Float32Array(out)
}

describe('constrained refit uses the free fit\'s used points', () => {
  const g = buildMeshGraph({ kind: 'soup', positions: cylinderWithOutliers() })
  const all = new Uint32Array(g.vertexCount).map((_, i) => i)
  const free = fitCylinderOnSelection(g, all, { method: 'gaussian', sigma: 3 })

  it('exposes the used set, smaller than the marking when outliers are cut', () => {
    expect(free.used).toBeDefined()
    expect(free.used!.length).toBe(free.usedPoints)
    expect(free.used!.length).toBeLessThan(all.length)
  })

  it('a coaxial refit on the used points keeps the free radius; on every point it does not', () => {
    const fit = { ...free } as unknown as FitData
    const onUsed = withDirection(fit, g.positions, free.used!, free.axis, { through: free.center })
    const onAll = withDirection(fit, g.positions, all, free.axis, { through: free.center })
    if (!onUsed || onUsed.kind !== 'cylinder' || !onAll || onAll.kind !== 'cylinder') throw new Error('no refit')
    expect(Math.abs(onUsed.radius - free.radius)).toBeLessThan(1e-4)
    expect(Math.abs(onAll.radius - free.radius)).toBeGreaterThan(1e-3)
  })
})

describe('Coincident axis (QUICKSURFACE Extract primitives, cylinder parallel to a cylinder)', () => {
  const g = buildMeshGraph({ kind: 'soup', positions: cylinderWithOutliers() })
  const all = new Uint32Array(g.vertexCount).map((_, i) => i)
  const free = fitCylinderOnSelection(g, all, { method: 'gaussian', sigma: 3 })
  // A reference cylinder 0.3 mm to the side with a parallel axis.
  const ref = { id: 1, name: 'Cylinder(1)', fit: { ...free, center: [free.center[0] + 0.3, free.center[1], free.center[2]] } as unknown as FitData }
  const fit = { ...free } as unknown as FitData
  const offAxis = (c: number[]) => { const d = [c[0] - ref.fit.center[0], c[1] - ref.fit.center[1], c[2] - ref.fit.center[2]]; const t = d[0] * free.axis[0] + d[1] * free.axis[1] + d[2] * free.axis[2]; return Math.hypot(d[0] - t * free.axis[0], d[1] - t * free.axis[1], d[2] - t * free.axis[2]) }

  it('applies only to a cylinder held parallel to another axis', () => {
    expect(canHoldCoincidentAxis(fit, 'parallel-el1', [ref])).toBe(true)
    expect(canHoldCoincidentAxis(fit, 'perpendicular-el1', [ref])).toBe(false)
    expect(canHoldCoincidentAxis(fit, 'parallel-oxy', [ref])).toBe(false)
  })
  it('holds the axis on the reference axis when ticked, and leaves it free when not', () => {
    const on = constrainFit(fit, g.positions, free.used!, 'parallel-el1', [ref], true)
    const off = constrainFit(fit, g.positions, free.used!, 'parallel-el1', [ref], false)
    if (!on || on.kind !== 'cylinder' || !off || off.kind !== 'cylinder') throw new Error('no fit')
    expect(offAxis(on.center)).toBeLessThan(1e-9)
    expect(offAxis(off.center)).toBeGreaterThan(0.25)
  })
})

describe('cylinder constraint list and Auto Constrain, as QUICKSURFACE 8.0.128 shows them', () => {
  const g = buildMeshGraph({ kind: 'soup', positions: cylinderWithOutliers() })
  const all = new Uint32Array(g.vertexCount).map((_, i) => i)
  const free = fitCylinderOnSelection(g, all, { method: 'gaussian', sigma: 3 })
  const plane = { id: 4, name: 'Plane(1)', fit: { kind: 'plane', center: [0, 0, 0], normal: [0, 0, 1] } as unknown as FitData }
  const cyl = { id: 6, name: 'Cylinder(1)', fit: { ...free } as unknown as FitData }

  it('lists axes, perpendicular planes and parallel cylinders for a cylinder', () => {
    expect(constraintOptions([plane, cyl], 'cylinder').map((o) => o.label)).toEqual([
      'Not constrained', 'Parallel to X Axis', 'Parallel to Y Axis', 'Parallel to Z Axis', 'Perpendicular to Plane(1)', 'Parallel to Cylinder(1)'])
  })
  it('a first cylinder near Z snaps to the Z axis (a world axis wins a tie with a Z-normal plane) and onto it within the coincidence tolerance', () => {
    const fit = { ...free } as unknown as FitData
    const auto = autoConstrainFit(fit, g.positions, free.used!, [plane], { tiltDeg: 0.5, coincidenceMm: 1 })
    expect(auto.choice?.label).toBe('Parallel to Z Axis')
    if (auto.fit.kind !== 'cylinder') throw new Error('not a cylinder')
    expect(Math.abs(Math.abs(auto.fit.axis[2]) - 1)).toBeLessThan(1e-12)
    expect(Math.hypot(auto.fit.center[0], auto.fit.center[1])).toBeLessThan(1e-9)
  })
  it('an existing cylinder exactly parallel wins over the world axis', () => {
    const fit = { ...free } as unknown as FitData
    const tilted = { ...cyl, fit: { ...free, axis: [Math.sin(0.001), 0, Math.cos(0.001)] } as unknown as FitData }
    const own = { ...free, axis: [Math.sin(0.001), 0, Math.cos(0.001)] } as unknown as FitData
    const auto = autoConstrainFit(own, g.positions, free.used!, [plane, tilted], { tiltDeg: 0.5, coincidenceMm: 1 })
    expect(auto.choice?.label).toBe('Parallel to Cylinder(1)')
    void fit
  })
})

describe('0.0.150: Auto Constrain never lays a cylinder in a plane; Coincident axis on a world axis', () => {
  const g = buildMeshGraph({ kind: 'soup', positions: cylinderWithOutliers() })
  const all = new Uint32Array(g.vertexCount).map((_, i) => i)
  const free = fitCylinderOnSelection(g, all, { method: 'gaussian', sigma: 3 })
  it('chooses Parallel to Z Axis, not a plane the axis nearly lies in (0.0.149 regression)', () => {
    // Axis tilted 0.06° from Z; a vertical plane whose normal is 0.05° off perpendicular to it.
    const t = 0.06 * Math.PI / 180
    const own = { ...free, axis: [Math.sin(t), 0, Math.cos(t)] } as unknown as FitData
    const n = 0.05 * Math.PI / 180
    const wall = { id: 5, name: 'Plane(2)', fit: { kind: 'plane', center: [0, 0, 0], normal: [Math.cos(t + n), 0, -Math.sin(t + n)] } as unknown as FitData }
    const auto = autoConstrainFit(own, g.positions, free.used!, [wall], { tiltDeg: 0.5, coincidenceMm: 1 })
    expect(auto.choice?.label).toBe('Parallel to Z Axis')
  })
  it('Parallel to Z Axis with Coincident axis puts the axis on the Z axis', () => {
    const shifted = { ...free, center: [3, 2, free.center[2]] } as unknown as FitData
    expect(canHoldCoincidentAxis(shifted, 'perpendicular-oxy')).toBe(true)
    const on = constrainFit(shifted, g.positions, free.used!, 'perpendicular-oxy', [], true)
    if (!on || on.kind !== 'cylinder') throw new Error('no fit')
    expect(Math.hypot(on.center[0], on.center[1])).toBeLessThan(1e-9)
  })
})
