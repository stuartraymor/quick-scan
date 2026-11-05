// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it } from 'vitest'
import { useReverse } from '../state/reStore'
import { addConstraint, type SketchLine, type SketchSpline } from '../core/sketch'
import { XY } from './reKit'

const s = () => useReverse.getState(), d = () => s().sketchDraft!
beforeEach(() => {
  s().sketchDragEnd()
  useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
})
it('dragging an independent pole leaves satisfied fitted lines and other poles exactly unchanged', () => {
  const line: SketchLine = { id: 1, kind: 'line', a: [0, -10], b: [20, -10], points: [[0, -9.98], [10, -10.01], [20, -9.98]], scatter: 0.03 }
  const curve: SketchSpline = { id: 2, kind: 'spline', pts: [[0, 0], [2, 2], [5, 3], [8, 2], [10, 0]], controlKnots: [0, 0.5, 1] }
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [line, curve])
  addConstraint(d().sketch, { kind: 'horizontal', entity: 1 })
  const before = structuredClone(d().sketch)
  expect(s().sketchDragStart([5, 3], 0.2)).toBe(true)
  s().sketchDrag([5, 6], 0.2, { off: true })
  s().sketchDragEnd()
  const after = structuredClone(d().sketch)
  expect(after.entities[0]).toEqual(before.entities[0])
  const result = after.entities[1] as SketchSpline
  expect(result.pts[2]).toEqual([5, 6])
  expect(result.pts.filter((_, i) => i !== 2)).toEqual(curve.pts.filter((_, i) => i !== 2))
  expect(d().report?.ok).toBe(true)
  s().undoSketch(); expect(d().sketch).toEqual(before)
  s().redoSketch(); expect(d().sketch).toEqual(after)
})

it('still propagates a drag through a connected coincident relation', () => {
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [
    { kind: 'line', a: [0, 0], b: [10, 0] },
    { kind: 'line', a: [10, 0], b: [10, 10] },
  ])
  addConstraint(d().sketch, { kind: 'coincident', p: { entity: 1, at: 'b' }, q: { entity: 2, at: 'a' } })
  expect(s().sketchDragStart([10, 0], 0.2)).toBe(true)
  s().sketchDrag([12, 3], 0.2, { off: true }); s().sketchDragEnd()
  const [a, b] = d().sketch.entities as SketchLine[]
  expect(Math.hypot(a.b[0] - b.a[0], a.b[1] - b.a[1])).toBeLessThan(1e-7)
  expect(Math.hypot(a.b[0] - 12, a.b[1] - 3)).toBeLessThan(0.01)
})
