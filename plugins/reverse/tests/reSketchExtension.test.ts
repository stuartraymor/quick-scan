// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest'
import { lineDragCrossings, snapLineDrag } from '../core/snap'
import { type SketchLine } from '../core/sketch'
import { sketchDragGuide } from '../state/reSketchSlice'
import { useReverse } from '../state/reStore'
import { XY } from './reKit'
const s = () => useReverse.getState()
const d = () => s().sketchDraft!
const line = () => d().sketch.entities[0] as SketchLine
const a: SketchLine = { id: 1, kind: 'line', a: [10, 10], b: [20, 10] }
const b: SketchLine = { id: 2, kind: 'line', a: [25, 15], b: [25, 30] }
beforeEach(() => {
 s().sketchDragEnd()
 useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, extrudeDraft: null, revolveDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
 s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [a,b])
})
describe('extension intersections', () => {
 it('offers a crossing beyond both segments, without parallel or duplicate targets', () => {
  const sketch = d().sketch
  sketch.entities.push({...b, id: 40}, {...a, id: 41, a: [10,20], b: [20,20]})
  expect(lineDragCrossings(line(), sketch)).toEqual([[25,10]])
  expect(snapLineDrag(a, 'b', [25.2,10.1], .5, false, [[25,10]])).toEqual({point:[25,10],kind:'intersection'})
  expect(snapLineDrag(a, 'b', [25.2,10.1], .05, false, [[25,10]]).kind).toBeNull()
 })
 it('extends to the exact virtual crossing, holds the opposite end and undoes as one edit', () => {
  s().sketchDragStart([20,10], .5)
  s().sketchDrag([25.2,10.1], .5, {})
  expect(sketchDragGuide()?.snapped).toBe('intersection')
  s().sketchDragEnd()
  expect(line().a).toEqual([10,10]); expect(line().b).toEqual([25,10])
  expect(d().sketch.constraints).toHaveLength(0)
  expect(d().history).toHaveLength(1)
  s().undoSketch(); expect(line().b).toEqual([20,10])
 })
 it('acquires the crossing rather than a nearby point on the other segment', () => {
  (d().sketch.entities[1] as SketchLine).a = [25,5]
  s().sketchDragStart([20,10], .5); s().sketchDrag([25.1,10.2], .5, {}); s().sketchDragEnd()
  expect(line().b).toEqual([25,10])
 })
 it('keeps Ctrl raw and does not create virtual endpoint constraints', () => {
  s().sketchDragStart([20,10], .5); s().sketchDrag([25.2,10.1], .5, {off:true}); s().sketchDragEnd()
  expect(line().b).toEqual([25.2,10.1]); expect(d().sketch.constraints).toHaveLength(0)
 })
})
describe('finished curve editing', () => {
 it('exposes the new spline handles and allows immediate point reshaping with undo', () => {
  s().setSketchTool('spline')
  for(const p of [[40,40],[50,50],[60,40]] as [number,number][]) s().sketchClick(p,.01,false,{off:true})
  s().finishSpline()
  expect(d().tool).toBe('select')
  const curve = d().sketch.entities.find(e=>e.kind==='spline')!
  expect(d().selection).toEqual([curve.id])
  expect(s().sketchDragStart([50,50], .5)).toBe(true)
  s().sketchDrag([50,55], .5, {off:true}); s().sketchDragEnd()
  const changed = d().sketch.entities.find(e=>e.id===curve.id)!
  expect(changed.kind==='spline' && changed.pts).toEqual([[40,40],[50,55],[60,40]])
  s().undoSketch()
  const restored = d().sketch.entities.find(e=>e.id===curve.id)!
  expect(restored.kind==='spline' && restored.pts).toEqual([[40,40],[50,50],[60,40]])
 })
})
