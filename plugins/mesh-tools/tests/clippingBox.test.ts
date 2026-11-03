// SPDX-License-Identifier: AGPL-3.0-only
// Clipping Box: a handle on each face's middle, each dragging its own face
// along its axis, never past the other.
import { describe, expect, it } from 'vitest'
import { boxHandles, dragFace } from '../ui/ClippingBox'

const box = { min: [0, 0, 0] as [number, number, number], max: [10, 20, 30] as [number, number, number] }

describe('Clipping Box', () => {
  it('puts a handle on the middle of each of the six faces', () => {
    const h = boxHandles(box)
    expect(h).toHaveLength(6)
    expect(h.find((x) => x.axis === 2 && x.end === 'max')!.at).toEqual([5, 10, 30])
    expect(h.find((x) => x.axis === 0 && x.end === 'min')!.at).toEqual([0, 10, 15])
  })

  it('drags one face along its axis and stops it short of the other', () => {
    expect(dragFace(box, 2, 'max', -5)).toEqual({ min: [0, 0, 0], max: [10, 20, 25] })
    expect(dragFace(box, 0, 'min', 50).min[0]).toBeCloseTo(10 - 1e-3)
    expect(box.max[2]).toBe(30)
  })
})
