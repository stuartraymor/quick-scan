// SPDX-License-Identifier: AGPL-3.0-only
// Edit Sketch → Curvature comb: teeth as long as the curvature times the
// scale, out of the bend; none on a straight run.

import { describe, expect, it } from 'vitest'
import { curvatureAt, curvatureComb } from '../core/curvatureComb'

describe('curvature comb', () => {
  it('reads 1/r on a circle and 0 on a line', () => {
    const r = 10
    const pt = (t: number): [number, number] => [r * Math.cos(t), r * Math.sin(t)]
    expect(curvatureAt(pt(0), pt(0.1), pt(0.2))).toBeCloseTo(1 / r, 6)
    expect(curvatureAt([0, 0], [1, 0], [2, 0])).toBe(0)
  })
  it('points the teeth out of the bend, scale times the curvature long', () => {
    const r = 5
    const poly = Array.from({ length: 9 }, (_, i): [number, number] => [r * Math.cos(i * 0.2), r * Math.sin(i * 0.2)])
    const { teeth, envelope } = curvatureComb(poly, 20)
    expect(teeth.length).toBe(7)
    expect(envelope.length).toBe(6)
    for (const [a, b] of teeth) {
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(20 / r, 3)
      expect(Math.hypot(b[0], b[1])).toBeGreaterThan(Math.hypot(a[0], a[1]))
    }
  })
})
