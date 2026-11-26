// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { addEntity, emptySketch, nearestOnEntity, type SketchSpline } from '../core/sketch'
import { trimAt, trimStroke } from '../core/sketchEdits'
import { splineAt, splineCurve } from '../core/sketchSpline'

it('cuts an interpolated spline twice and keeps exact cubic stretches', () => {
  const sketch = emptySketch()
  const id = addEntity(sketch, { kind: 'spline', pts: [[-4,0],[-2,2],[0,0],[2,-2],[4,0]] })
  for (const x of [-2,2]) addEntity(sketch, { kind: 'line', a:[x,-3], b:[x,3] })
  const result = trimStroke(sketch, [[0,-1],[0,1]], .01)
  expect(result.ok).toBe(true)
  if (!result.ok) return
  const kept = result.sketch.entities.filter(e => e.kind === 'spline')
  expect(kept).toHaveLength(2)
  const fit = splineCurve(sketch.entities.find(e => e.id === id) as SketchSpline)
  for (let i = 0; i <= 20; i++) {
    expect(nearestOnEntity(kept[0], splineAt(fit,i/20)).dist).toBeLessThan(1e-7)
    expect(nearestOnEntity(kept[1], splineAt(fit,3+i/20)).dist).toBeLessThan(1e-7)
  }
  expect(result.sketch.constraints.filter(c => c.kind === 'pointOn')).toHaveLength(2)
})

it('uses a spline as a cutter and holds the new end on it', () => {
  const s = emptySketch()
  const id = addEntity(s,{kind:'line',a:[-5,0],b:[5,0]})
  const spline = addEntity(s,{kind:'spline',pts:[[-2,-2],[1,0],[2,2]]})
  const r = trimAt(s,id,[3,0],true)
  expect(r.ok).toBe(true)
  if (!r.ok) return
  expect(r.sketch.entities.find(e=>e.kind==='line')).toMatchObject({a:[-5,0],b:[1,0]})
  expect(r.sketch.constraints).toContainEqual(expect.objectContaining({kind:'pointOn',on:{curve:spline}}))
})

it('trims across the seam of a closed spline and deletes an isolated spline', () => {
  const s = emptySketch()
  const id = addEntity(s,{kind:'spline',pts:[[3,0],[0,3],[-3,0],[0,-3]],closed:true})
  const before = JSON.stringify(s)
  const deleted = trimStroke(s,[[2,0],[4,0]],.01)
  expect(deleted.ok && deleted.sketch.entities.length).toBe(0)
  expect(JSON.stringify(s)).toBe(before)
  addEntity(s,{kind:'line',a:[0,-5],b:[0,5]})
  const r = trimAt(s,id,[3,0])
  expect(r.ok).toBe(true)
  if (!r.ok) return
  const kept = r.sketch.entities.find(e=>e.kind==='spline')!
  expect(nearestOnEntity(kept,[-3,0]).dist).toBeLessThan(1e-7)
  expect(nearestOnEntity(kept,[3,0]).dist).toBeGreaterThan(3)
})

it('uses the geometry at press even when an earlier cut removes part of a cutter', () => {
  const s = emptySketch()
  addEntity(s,{kind:'line',a:[0,-4],b:[0,4]})
  addEntity(s,{kind:'line',a:[-4,0],b:[4,0]})
  const result = trimStroke(s,[[-2,2],[2,2],[2,-2]],.01)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.sketch.entities).toEqual([
    expect.objectContaining({a:[0,-4],b:[0,0]}),
    expect.objectContaining({a:[-4,0],b:[0,0]}),
  ])
})
