// SPDX-License-Identifier: AGPL-3.0-only
// The depth a new extrude opens on: 0.3 of the profile's longest side, as
// QUICKSURFACE 8.0.128 opens it (analysis/quick-scan-v0.0.155/
// native-extrude-default.json — a 32.905672 × 72.292770 mm rectangle at
// 21.687829 mm, exactly 0.3 of the longer side; a 20 mm circle at 6).
import { beforeEach, describe, expect, it } from 'vitest'
import { OPENING_DEPTH_RATIO, openingDepth } from '../core/extrudeDepth'
import { findRegions } from '../core/regions'
import { useReverse } from '../state/reStore'
import { XY } from './reKit'

const s = () => useReverse.getState()

function finishRectangle(a: [number, number], b: [number, number]): number {
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
  s().setSketchTool('rectangle')
  s().sketchClick(a, 0.5, false, { off: true })
  s().sketchClick(b, 0.5, false, { off: true })
  const id = s().commitSketch()
  if (id === null) throw new Error('the rectangle did not finish')
  return id
}

beforeEach(() => {
  useReverse.setState({ features: [], rolledBack: [], featureDraft: null, nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, extrudeDraft: null, revolveDraft: null, past: [] })
})

describe('the depth a new extrude opens on', () => {
  it('is 0.3 of the longer side of the rectangle QUICKSURFACE opened at 21.687829', () => {
    expect(OPENING_DEPTH_RATIO).toBe(0.3)
    // native-sketch5.iges: the four lines QUICKSURFACE exported.
    const x0 = -22.756404877, x1 = 10.149267197, y0 = -194.806282043, y1 = -122.513511658
    const sketch = {
      entities: [
        { id: 1, kind: 'line' as const, a: [x0, y1] as [number, number], b: [x1, y1] as [number, number] },
        { id: 2, kind: 'line' as const, a: [x1, y1] as [number, number], b: [x1, y0] as [number, number] },
        { id: 3, kind: 'line' as const, a: [x1, y0] as [number, number], b: [x0, y0] as [number, number] },
        { id: 4, kind: 'line' as const, a: [x0, y0] as [number, number], b: [x0, y1] as [number, number] },
      ],
    }
    // 0.3 × 72.292770385 = 21.6878311; the box showed 21.687829 (its lines
    // are exported to 9 decimals, its depth shown to 6): within 3e-6.
    expect(openingDepth(sketch as never)).toBeCloseTo(21.687829, 5)
  })

  it('takes the width when that is the longer side, and halves with the profile', () => {
    const wide = finishRectangle([0, 0], [100, 30])
    s().startExtrude(wide)
    expect(s().extrudeDraft?.extent).toEqual({ kind: 'distance', from: 0, to: expect.closeTo(30, 9) })
    const half = finishRectangle([0, 0], [50, 50])
    s().startExtrude(half)
    expect(s().extrudeDraft?.extent).toEqual({ kind: 'distance', from: 0, to: expect.closeTo(15, 9) })
  })

  it('measures the regions picked, not the whole sketch, and a circle by its diameter', () => {
    const sketch = {
      entities: [
        { id: 1, kind: 'circle' as const, c: [0, 0] as [number, number], r: 10 },
        { id: 2, kind: 'line' as const, a: [40, 0] as [number, number], b: [140, 0] as [number, number] },
        { id: 3, kind: 'line' as const, a: [140, 0] as [number, number], b: [140, 5] as [number, number] },
        { id: 4, kind: 'line' as const, a: [140, 5] as [number, number], b: [40, 5] as [number, number] },
        { id: 5, kind: 'line' as const, a: [40, 5] as [number, number], b: [40, 0] as [number, number] },
      ],
    }
    const regions = findRegions(sketch as never)
    expect(regions).toHaveLength(2)
    const circle = regions.find((r) => Math.abs(r.area - Math.PI * 100) < 1)!, strip = regions.find((r) => Math.abs(r.area - 500) < 1)!
    expect(circle && strip).toBeTruthy()
    expect(openingDepth(sketch as never, [circle.key])).toBeCloseTo(6, 9)
    expect(openingDepth(sketch as never, [strip.key])).toBeCloseTo(30, 9)
    // Both, or none named: the whole profile from −10 to 140.
    expect(openingDepth(sketch as never, [circle.key, strip.key])).toBeCloseTo(45, 9)
    expect(openingDepth(sketch as never)).toBeCloseTo(45, 9)
  })

  it('has nothing to say for an empty sketch, and the box then opens on 10', () => {
    expect(openingDepth({ entities: [] })).toBeNull()
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    const id = s().commitSketch()
    if (id !== null) {
      s().startExtrude(id)
      expect(s().extrudeDraft?.extent).toEqual({ kind: 'distance', from: 0, to: 10 })
    }
  })
})
