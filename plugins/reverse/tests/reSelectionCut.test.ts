// SPDX-License-Identifier: AGPL-3.0-only
// Create Sketch → Through selection only: the cut kept where it crosses the
// marked surface, split where it leaves it.

import { describe, expect, it } from 'vitest'
import { edgesThroughSelection } from '../core/selectionCut'

const frame = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], basisU: [1, 0, 0] as [number, number, number], basisV: [0, 1, 0] as [number, number, number] }

describe('Through selection only', () => {
  it('keeps the marked stretch of a chain and drops the rest', () => {
    // One chain along u from 0 to 10; marked vertices cover u 6..10 on the plane.
    const pts: number[] = []
    for (let x = 0; x <= 10; x++) pts.push(x, 0)
    const edges = { points: Float32Array.from(pts), offsets: Uint32Array.from([0, 11]) }
    const marked = Float32Array.from([6, 0, 0, 7, 0, 0, 8, 0, 0, 9, 0, 0, 10, 0, 0])
    const kept = edgesThroughSelection(edges, frame, marked, 0.5)
    expect(Array.from(kept.offsets)).toEqual([0, 5])
    expect(kept.points[0]).toBe(6)
  })
  it('ignores marked surface far off the plane', () => {
    const edges = { points: Float32Array.from([0, 0, 1, 0, 2, 0]), offsets: Uint32Array.from([0, 3]) }
    const marked = Float32Array.from([0, 0, 50, 1, 0, 50, 2, 0, 50])
    expect(edgesThroughSelection(edges, frame, marked).offsets.length).toBe(1)
  })
})

describe('Outline Mesh small segments', () => {
  it('drops chains with fewer points than asked', async () => {
    const { longChains } = await import('../core/selectionCut')
    const edges = { points: Float32Array.from([0, 0, 1, 0, 5, 5, 6, 5, 7, 5, 8, 5]), offsets: Uint32Array.from([0, 2, 6]) }
    const kept = longChains(edges, 3)
    expect(Array.from(kept.offsets)).toEqual([0, 4])
    expect(kept.points[0]).toBe(5)
  })
})
