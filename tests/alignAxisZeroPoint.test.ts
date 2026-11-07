// SPDX-License-Identifier: AGPL-3.0-only
// A cylinder as the tertiary (zero point) feature fixes the open coordinate
// where its axis crosses the primary plane — QUICKSURFACE 8.0.128, basic_part:
// primary Plane/Top, secondary Plane/Front, tertiary Cylinder/X Axis put x = 0
// where the axis meets z = 0. Quick Scan 0.0.150 used the cylinder's mid-length
// centre, and the slightly tilted axis left the whole part 0.06 mm off in X.
import { describe, expect, it } from 'vitest'
import { computeDatumAlignment } from '../src/core/alignment'
import { rigidApply } from '../src/core/deviation/rigid'
import type { FitData } from '../src/core/types'

const plane = (center: number[], normal: number[]) => ({ kind: 'plane', center, normal, basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 50, extentV: 50, sigma: 0, usedPoints: 0, regionSize: 0 }) as unknown as FitData
const t = 0.002 // axis tilt, rad
const cylinder = { kind: 'cylinder', center: [3, 20, -100], axis: [Math.sin(t), 0, Math.cos(t)], radius: 100, length: 300, sigma: 0, usedPoints: 0, regionSize: 0 } as unknown as FitData

describe('tertiary axis zero point', () => {
  it('puts x = 0 where the cylinder axis crosses the primary plane', () => {
    const m = computeDatumAlignment({ fit: plane([0, 0, 0], [0, 0, 1]), axis: 'z+' }, { fit: plane([0, 0, 0], [0, 1, 0]), axis: 'y+' }, cylinder)
    // Where the (moved) axis meets z = 0.
    const c = new Float64Array(3), e = new Float64Array(3)
    rigidApply(m, ...(cylinder.center as [number, number, number]), c)
    const a = cylinder.kind === 'cylinder' ? cylinder.axis : [0, 0, 1]
    rigidApply(m, cylinder.center[0] + a[0], cylinder.center[1] + a[1], cylinder.center[2] + a[2], e)
    const d = [e[0] - c[0], e[1] - c[1], e[2] - c[2]], s = -c[2] / d[2]
    expect(c[0] + s * d[0]).toBeCloseTo(0, 9)
    // The centre itself (mid-length) is NOT at x = 0: the tilt carries it 0.2 mm.
    expect(Math.abs(c[0])).toBeGreaterThan(0.1)
  })
})
