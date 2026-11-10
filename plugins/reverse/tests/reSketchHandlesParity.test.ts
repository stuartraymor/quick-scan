// SPDX-License-Identifier: AGPL-3.0-only
// 2D sketch handles, the mark round a caught handle, and Ctrl selection, as
// QUICKSURFACE 8.0.128 does them (read live, 2026-11-10): ends and centres
// drawn all the time with Control Points off; a dragged end that catches a
// point ringed, one that catches a piece's body boxed; a plain click takes
// one piece, Ctrl+click adds.
import { beforeEach, describe, expect, it } from 'vitest'
import type { EntityInput } from '../core/sketch'
import { sketchGrips } from '../core/drag'
import { useReverse } from '../state/reStore'
import { handleSnapOf, sketchDragSnap } from '../state/reSketchSlice'
import { HANDLE_BOX, HANDLE_RING, handleSnapMark, sketchGripShown } from '../app/useSketchSceneSync'
import { XY } from './reKit'

const s = () => useReverse.getState()
const d = () => s().sketchDraft!
const pieces: EntityInput[] = [
  { kind: 'line', a: [0, 0], b: [10, 0] },
  { kind: 'line', a: [20, 0], b: [20, 10] },
  { kind: 'circle', c: [40, 0], r: 5 },
]

beforeEach(() => {
  useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, extrudeDraft: null, revolveDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, pieces)
})

describe('handles drawn all the time', () => {
  it('shows every end and centre without selection, hover or Control Points', () => {
    for (const e of d().sketch.entities) {
      const shown = sketchGrips(e).filter((g) => sketchGripShown(e.kind, g.at, false)).map((g) => g.at)
      if (e.kind === 'line') expect(shown).toEqual(['a', 'b'])
      if (e.kind === 'circle') expect(shown).toEqual(['center'])
    }
  })

  it('keeps a line’s middle grip for the line in hand only', () => {
    expect(sketchGripShown('line', 'body', false)).toBe(false)
    expect(sketchGripShown('line', 'body', true)).toBe(true)
    expect(sketchGripShown('point', 'center', true)).toBe(false)
  })
})

describe('the mark round a caught handle', () => {
  it('rings a point and boxes a piece; sliding on its own line, the grid or nothing has none', () => {
    expect(handleSnapOf(null, 'anchor')).toBe('point')
    expect(handleSnapOf('intersection', null)).toBe('point')
    expect(handleSnapOf('original', null)).toBe('point')
    expect(handleSnapOf(null, 'origin')).toBe('point')
    expect(handleSnapOf(null, 'entity')).toBe('curve')
    expect(handleSnapOf(null, 'datum')).toBe('curve')
    expect(handleSnapOf('carrier', null)).toBeNull()
    expect(handleSnapOf(null, 'grid')).toBeNull()
    expect(handleSnapOf(null, null)).toBeNull()
  })

  it('draws a ring well clear of the end square, and a box', () => {
    const [ring] = handleSnapMark('point', [1, 2], 0.5)
    expect(ring).toMatchObject({ kind: 'circle', center: [1, 2], radius: 0.5 * HANDLE_RING })
    expect(HANDLE_RING).toBeGreaterThan(1)
    expect(handleSnapMark('curve', [1, 2], 0.5)).toHaveLength(4)
    expect(HANDLE_BOX).toBeGreaterThan(1)
    expect(handleSnapMark('point', [1, 2], Number.NaN)).toEqual([])
  })

  it('a dragged end over another line’s end is ringed; over its body boxed; let go, nothing', () => {
    expect(s().sketchDragStart([10, 0], 0.5)).toBe(true)
    s().sketchDrag([15, 3], 0.5, {})
    s().sketchDrag([19.9, 10.1], 0.5, {})
    expect(sketchDragSnap()).toMatchObject({ kind: 'point' })
    expect(sketchDragSnap()!.at[0]).toBeCloseTo(20, 9)
    expect(sketchDragSnap()!.at[1]).toBeCloseTo(10, 9)
    s().sketchDrag([20.1, 2.5], 0.5, {})
    expect(sketchDragSnap()).toMatchObject({ kind: 'curve' })
    s().sketchDrag([30, 20], 0.5, {})
    expect(sketchDragSnap()).toBeNull()
    s().sketchDragEnd()
    expect(sketchDragSnap()).toBeNull()
  })

  it('with snapping off (Ctrl held) the hand catches nothing', () => {
    expect(s().sketchDragStart([10, 0], 0.5)).toBe(true)
    s().sketchDrag([19.9, 10.1], 0.5, { off: true })
    expect(sketchDragSnap()).toBeNull()
    s().sketchDragEnd()
  })
})

describe('Ctrl to select several', () => {
  it('a plain click replaces, Ctrl+click adds and takes back, a click on nothing lets go', () => {
    s().sketchClick([5, 0], 0.5, false)
    s().sketchClick([20, 5], 0.5, false)
    expect(d().selection).toEqual([2])
    s().sketchClick([5, 0], 0.5, true)
    expect(d().selection).toEqual([2, 1])
    s().sketchClick([45, 0], 0.5, true)
    expect(d().selection).toEqual([2, 1, 3])
    s().sketchClick([20, 5], 0.5, true)
    expect(d().selection).toEqual([1, 3])
    s().sketchClick([60, 60], 0.5, true)
    expect(d().selection).toEqual([1, 3])
    s().sketchClick([60, 60], 0.5, false)
    expect(d().selection).toEqual([])
  })
})
