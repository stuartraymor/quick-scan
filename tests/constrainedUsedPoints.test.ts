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
import { canHoldCoincidentAxis, constrainFit, withDirection } from '../src/core/elements/constrain'
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
