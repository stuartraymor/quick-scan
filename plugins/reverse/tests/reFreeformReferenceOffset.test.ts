// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import type { PlaneFit } from '../../../src/core/types'
import type { Cage } from '../core/freeform/cage'
import { offsetBoundaryToPlanes, offsetByPrimitives } from '../core/freeform/referenceOffset'

// Six poles from the native 640-triangle cylinder offset trials.
const cage: Cage = {
  positions: Float64Array.of(
    4.483991146, -10.038787842, 4.208672047,
    9.630768776, -5.304003716, 4.376503944,
    9.646294594, -5.279682636, -0.573809624,
    6.490129948, -8.868551254, 0.693376482,
    7.619541645, -8.300878525, 4.251563072,
    8.348759651, -7.349685669, -0.017106790,
  ),
  faces: [[0, 4, 5, 3], [4, 1, 2, 5]],
  creases: [],
}
const plane = (z: number): PlaneFit => ({
  kind: 'plane', center: [0, 0, z], normal: [0, 0, 1],
  basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 10, extentV: 10,
  sigma: 0, usedPoints: 0, regionSize: 0,
})
const references = [plane(0), plane(5)]

describe('Freeform reference offsets', () => {
  it('matches the native moved perimeter and preserves the two faces', () => {
    const expected = [
      4.4839931, -10.0387878, 7,
      9.6307650, -5.3040037, 7,
      9.6462946, -5.2796807, 2,
      6.4901280, -8.8685513, -2,
      7.4321523, -8.0910511, 7,
      8.2552443, -7.2577167, -2,
    ]
    const next = offsetBoundaryToPlanes(cage, references, 2)
    expect(next.faces).toBe(cage.faces)
    for (let i = 0; i < expected.length; i += 3) {
      expect(Math.hypot(...expected.slice(i, i + 3).map((p, axis) => p - next.positions[i + axis]))).toBeLessThan(.00012)
    }
    expect(offsetBoundaryToPlanes(cage, references, .5).positions).toEqual(cage.positions)
  })

  it('matches both native movement magnitudes and flips only the near-plane pole', () => {
    const half = offsetByPrimitives(cage, references, .5)
    const quarter = offsetByPrimitives(cage, references, .25)
    const expected = [
      [.2426047325, -.4371414185, -.0070719719],
      [.4149684906, -.2789287567, -.0000686646],
      [.4231519699, -.2663502693, .0000185370],
      [.2982335091, -.3995933533, .0371742249],
      [.3354825974, -.3706645966, -.0076851845],
      [-.3738608360, .3319253922, -.0073186941],
    ]
    expect(quarter.faces).toBe(cage.faces)
    expected.forEach((native, vertex) => {
      const delta = native.map((_, axis) => quarter.positions[vertex * 3 + axis] - cage.positions[vertex * 3 + axis])
      expect(Math.hypot(...delta)).toBeCloseTo(.5, 10)
      expect(delta[0] * native[0] + delta[1] * native[1] + delta[2] * native[2]).toBeGreaterThan(.24)
      expect(Math.hypot(...delta.map((value, axis) => value - native[axis]))).toBeLessThan(.005)
      for (let axis = 0; axis < 3; axis++) {
        const i = vertex * 3 + axis
        expect(half.positions[i] - cage.positions[i]).toBeCloseTo(2 * delta[axis], 12)
      }
    })
  })
})
