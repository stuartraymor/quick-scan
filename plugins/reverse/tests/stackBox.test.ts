// SPDX-License-Identifier: AGPL-3.0-only
// Stacked sections' box: its handles' arithmetic and the cuts kept inside it.
import { describe, expect, it } from 'vitest'
import { clipChainsToRect } from '../core/stackedReference'
import { draggedRect } from '../viewer/stackHandles'
import type { Vec2 } from '../../../src/core/flat/types'

const BOX = { u0: -10, u1: 10, v0: -5, v1: 5 }

describe('the stack box handles', () => {
  it('a corner moves its two sides, a side handle one, the centre the whole box', () => {
    expect(draggedRect(BOX, { su: 1, sv: 1 }, 20, 8, { a: 10, b: 5 })).toEqual({ u0: -10, u1: 20, v0: -5, v1: 8 })
    expect(draggedRect(BOX, { su: -1, sv: 0 }, -3, 99, { a: -10, b: 0 })).toEqual({ u0: -3, u1: 10, v0: -5, v1: 5 })
    expect(draggedRect(BOX, { su: 0, sv: -1 }, 99, 2, { a: 0, b: -5 })).toEqual({ u0: -10, u1: 10, v0: 2, v1: 5 })
    expect(draggedRect(BOX, { su: 0, sv: 0 }, 4, -1, { a: 0, b: 0 })).toEqual({ u0: -6, u1: 14, v0: -6, v1: 4 })
  })
  it('sides never pass each other: dragged past, the box keeps 1 mm', () => {
    const r = draggedRect(BOX, { su: 1, sv: 0 }, -50, 0, { a: 10, b: 0 })
    expect(r.u1).toBe(-9)
  })
})

describe('the cuts kept inside the box', () => {
  it('keeps a loop inside whole, cuts one across a side at the side, drops one outside', () => {
    const inside: Vec2[] = [[-2, -2], [2, -2], [2, 2], [-2, 2], [-2, -2]]
    const across: Vec2[] = [[0, 0], [20, 0]]
    const outside: Vec2[] = [[30, 30], [40, 30]]
    const kept = clipChainsToRect([inside, across, outside], BOX)
    expect(kept).toHaveLength(2)
    expect(kept[0]).toEqual(inside)
    expect(kept[1]).toEqual([[0, 0], [10, 0]])
  })
  it('splits a line that leaves and comes back into two pieces', () => {
    const wave: Vec2[] = [[-8, 0], [0, 0], [0, 9], [5, 9], [5, 0], [8, 0]]
    const kept = clipChainsToRect([wave], BOX)
    expect(kept).toHaveLength(2)
    expect(kept[0][kept[0].length - 1]).toEqual([0, 5])
    expect(kept[1][0]).toEqual([5, 5])
  })
})
