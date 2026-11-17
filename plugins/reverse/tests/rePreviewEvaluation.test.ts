// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { type Cage } from '../core/freeform/cage'
import { addRectangle } from '../core/freeform/edit'
import { subdivided } from '../core/freeform/subdivide'
import { cageVertexLimits } from '../core/freeform/limit'
import { previewEvaluation, previewTopologyKey } from '../core/freeform/previewEvaluation'

const empty = (): Cage => ({ positions: new Float64Array(), faces: [], creases: [] })
const curved = () => {
  const c = addRectangle(empty(), [0,0,0], [10,0,0], [0,10,0], 10, 10)
  for (let i=0;i<c.positions.length;i+=3) c.positions[i+2] = Math.sin(c.positions[i]*.4)*Math.cos(c.positions[i+1]*.3)
  return c
}

it('matches every original evaluated coordinate through local edits, cancellation and crease motion', () => {
  for (const creased of [false, true]) {
    const c = curved()
    if (creased) c.creases = [[12,13],[13,14],[14,15]]
    const plan = previewEvaluation(c, 2), original = c.positions.slice(); plan.evaluate(c.positions)
    for (const v of [12,13,60,0,120,60]) {
      c.positions[v*3+2] += .23
      const result = plan.evaluate(c.positions)
      expect(result.points).toEqual(cageVertexLimits(subdivided(c, 2)))
      expect(result.changed.size).toBeLessThan(result.points.length)
    }
    c.positions.set(original)
    expect(plan.evaluate(c.positions).points).toEqual(cageVertexLimits(subdivided(c, 2)))
    expect(plan.evaluate(c.positions).changed.size).toBe(0)
  }
})

it('leaves unrelated evaluated points untouched and preserves topology/winding/creases in the plan identity', () => {
  const c=curved(), plan=previewEvaluation(c,2), before=plan.evaluate(c.positions)
  c.positions[0]+=1
  const after=plan.evaluate(c.positions)
  expect(after.changed.size).toBeGreaterThan(0)
  expect(after.changed.size).toBeLessThan(after.points.length/5)
  for(let i=0;i<before.points.length;i++) if(!after.changed.has(i)) expect(after.points[i]).toBe(before.points[i])
  expect(previewTopologyKey(c,2)).toBe(plan.key)
  c.faces[0].reverse()
  expect(previewTopologyKey(c,2)).not.toBe(plan.key)
  c.faces[0].reverse();c.creases.push([0,1])
  expect(previewTopologyKey(c,2)).not.toBe(plan.key)
})

it('matches nonquad, extraordinary and disconnected surfaces at both display densities', () => {
  const c:Cage={positions:Float64Array.of(0,0,0, 2,0,.2, 1,1,.3, -1,1,0, -2,0,-.2, -1,-1,0, 1,-1,0, 9,0,0, 10,0,0, 10,1,0, 9,1,0),
    faces:[[0,1,2],[0,2,3,4],[0,4,5,6,1],[7,8,9,10]],creases:[[0,1]]}
  for(const steps of [2,4]) {
    const plan=previewEvaluation(c,steps)
    expect(plan.evaluate(c.positions).points).toEqual(cageVertexLimits(subdivided(c,steps)))
    c.positions[2]+=.2
    expect(plan.evaluate(c.positions).points).toEqual(cageVertexLimits(subdivided(c,steps)))
  }
})
