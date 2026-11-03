// SPDX-License-Identifier: AGPL-3.0-only
// Analysis → Measure, as QUICKSURFACE 8.0.128 behaves (recorded live): two
// clicks a distance, one a point; Delete Last takes the newest (or the
// first point waiting); closing clears everything, the mode stays.
import { beforeEach, describe, expect, it } from 'vitest'
import { measuredDistance, useMeasureTool } from '../src/state/measureToolStore'

const t = () => useMeasureTool.getState()
beforeEach(() => { t().setOpen(true); t().setMode('3d') })

describe('Measure', () => {
  it('makes a 3D distance of two picks and a point of one', () => {
    expect(t().pick([0, 0, 0])).toBeNull()
    expect(t().pick([3, 4, 12])).toEqual({ kind: '3d', a: [0, 0, 0], b: [3, 4, 12] })
    t().setMode('point')
    t().pick([1, 2, 3])
    expect(t().items.map((m) => m.kind)).toEqual(['3d', 'point'])
  })

  it('splits an extended distance into its X, Y and Z parts', () => {
    const d = measuredDistance([10, 0, 5], [117.8818, 95.5304, 39.6736])
    expect(d.dx).toBeCloseTo(107.8818, 4)
    expect(d.d).toBeCloseTo(Math.hypot(107.8818, 95.5304, 34.6736), 6)
  })

  it('deletes the last, then all, and forgets everything on close but the mode', () => {
    t().pick([0, 0, 0]); t().pick([1, 0, 0]); t().pick([2, 0, 0])
    expect(t().pending).toEqual([2, 0, 0])
    t().deleteLast()
    expect(t().pending).toBeNull()
    expect(t().items).toHaveLength(1)
    t().deleteLast()
    expect(t().items).toHaveLength(0)
    t().setMode('extended'); t().pick([0, 0, 0]); t().pick([1, 1, 1])
    t().setOpen(false)
    expect(t().items).toEqual([])
    expect(t().mode).toBe('extended')
  })
})
