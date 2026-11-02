// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest'
import { dragCarrierMarks } from '../app/useSketchSceneSync'
import { snapLineDrag } from '../core/snap'
import { type SketchLine } from '../core/sketch'
import { sketchDragGuide } from '../state/reSketchSlice'
import { useReverse } from '../state/reStore'
import { XY } from './reKit'

const original: SketchLine = { id: 1, kind: 'line', a: [2, 3], b: [12, 8] }
const s = () => useReverse.getState()
const d = () => s().sketchDraft!
const line = () => d().sketch.entities[0] as SketchLine
const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 5))

beforeEach(() => {
  s().sketchDragEnd()
  useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, extrudeDraft: null, revolveDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [original])
})

describe('original carrier drag acquisition', () => {
  it('extends an oblique line along its original infinite carrier within screen reach', () => {
    const snapped = snapLineDrag(original, 'b', [22, 13.2], 0.5)
    expect(snapped.kind).toBe('carrier')
    expect((snapped.point[0] - 2) * 5 - (snapped.point[1] - 3) * 10).toBeCloseTo(0, 9)
    expect(snapped.point[0]).toBeGreaterThan(original.b[0])
    expect(snapLineDrag(original, 'b', [22, 14], 0.5).kind).toBeNull()
    expect(snapLineDrag(original, 'b', [22, 13.2], 0.5, true)).toMatchObject({ point: [22, 13.2], kind: null })
  })

  it('acquires the original endpoint before its carrier and scales with zoom', () => {
    expect(snapLineDrag(original, 'b', [12.3, 8.2], 0.5)).toEqual({ point: [12, 8], kind: 'original' })
    expect(snapLineDrag(original, 'b', [22, 13.2], 0.1).kind).toBeNull()
    expect(snapLineDrag(original, 'b', [22, 13.2], 0.5).kind).toBe('carrier')
  })

  it('drags and commits the acquired endpoint while preserving the opposite endpoint and one undo step', () => {
    const expected = snapLineDrag(original, 'b', [22, 13.2], 0.5).point
    expect(s().sketchDragStart([12, 8], 0.5)).toBe(true)
    s().sketchDrag([22, 13.2], 0.5, {})
    close(line().a, original.a)
    close(line().b, expected)
    expect(sketchDragGuide()).toMatchObject({ a: original.a, b: original.b, snapped: 'carrier' })
    s().sketchDragEnd()
    close(line().a, original.a)
    close(line().b, expected)
    expect(sketchDragGuide()).toBeNull()
    expect(d().history).toHaveLength(1)
    expect(d().sketch.constraints).toHaveLength(0)
    s().undoSketch()
    close(line().a, original.a)
    close(line().b, original.b)
  })

  it('can move off the carrier and return exactly to the original endpoint', () => {
    s().sketchDragStart([12, 8], 0.5)
    s().sketchDrag([17, 17], 0.5, {})
    s().sketchDrag([12.2, 8.2], 0.5, {})
    s().sketchDragEnd()
    close(line().a, original.a)
    close(line().b, original.b)
  })

  it('Ctrl bypasses the aid in geometry and feedback', () => {
    s().sketchDragStart([12, 8], 0.5)
    s().sketchDrag([22, 13.2], 0.5, { off: true })
    expect(sketchDragGuide()).toBeNull()
    s().sketchDragEnd()
    close(line().b, [22, 13.2])
  })

  it('keeps a real endpoint snap and coincidence ahead of an extension aid', () => {
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [original, { kind: 'line', a: [22, 13.3], b: [26, 19] }])
    s().sketchDragStart([12, 8], 0.5)
    s().sketchDrag([22, 13.2], 0.5, {})
    s().sketchDragEnd()
    close(line().b, [22, 13.3])
    expect(d().sketch.constraints.some((c) => c.kind === 'coincident')).toBe(true)
  })

  it('returns a whole carried line to its original position near the initial press', () => {
    s().sketchDragStart([7, 5.5], 0.5)
    s().sketchDrag([14, 12], 0.5, {})
    s().sketchDrag([7.2, 5.6], 0.5, {})
    s().sketchDragEnd()
    close(line().a, original.a)
    close(line().b, original.b)
  })

  it('draws bounded dotted segments on the exact original carrier with genuine gaps', () => {
    const fits = dragCarrierMarks(original.a, original.b, [22, 13], 0.5)
    expect(fits.length).toBeGreaterThan(10)
    expect(fits.length).toBeLessThanOrEqual(181)
    const lines = fits.filter((f) => f.kind === 'line')
    for (const f of lines) {
      expect((f.center[0] - 2) * 5 - (f.center[1] - 3) * 10).toBeCloseTo(0, 7)
      expect(f.length).toBeLessThan(0.4)
    }
    expect(dragCarrierMarks(original.a, original.b, [1e9, 1e9], 1e-4).length).toBeLessThanOrEqual(181)
    expect(dragCarrierMarks(original.a, original.a, original.b, 0.5)).toEqual([])
  })
})
