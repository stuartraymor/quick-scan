// SPDX-License-Identifier: AGPL-3.0-only
// CAD → Scale body: Move body's uniform scale about the pivot, before the
// turn and the carry; the kernel keeps every face through it.
import { describe, expect, it } from 'vitest'
import { moveMatrix, movesNothing } from '../core/move'
import { ReKernel } from '../core/kernel'

const kernelPromise = ReKernel.load()

describe('Scale body', () => {
  it('scales about the pivot, leaving the pivot where it is', () => {
    const m = moveMatrix({ pivot: [5, 5, 5], translate: [0, 0, 0], rotate: [0, 0, 0], scale: 2 })
    const at = (p: number[]) => [0, 1, 2].map((r) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3])
    expect(at([5, 5, 5])).toEqual([5, 5, 5])
    expect(at([10, 5, 5])).toEqual([15, 5, 5])
    expect(movesNothing({ translate: [0, 0, 0], rotate: [0, 0, 0], scale: 2 })).toBe(false)
    expect(movesNothing({ translate: [0, 0, 0], rotate: [0, 0, 0] })).toBe(true)
  })

  it('comes out of the kernel the cube of the factor in volume, every face kept', async () => {
    const k = await kernelPromise
    const box = k.box([0, 0, 0], [10, 10, 10])
    const made = k.transformTracked(box, moveMatrix({ pivot: [5, 5, 5], translate: [0, 0, 0], rotate: [0, 0, 0], scale: 1.5 }))
    expect(k.volume(made.shape)).toBeCloseTo(3375, 3)
    expect(made.history.size).toBe(6)
  })
})
