// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach, expect, it} from 'vitest'
import {addConstraint, addEntity, emptySketch} from '../core/sketch'
import {useReverse} from '../state/reStore'
import {XY} from './reKit'

const s = () => useReverse.getState()
beforeEach(() => {
  useReverse.setState({...useReverse.getInitialState()}, true)
  s().sketchDragEnd()
  s().startSketch({kind:'world', axis:'z', offset:0}, XY)
  const sketch = emptySketch()
  const a = addEntity(sketch, {kind:'circle', c:[10,10], r:2})
  const b = addEntity(sketch, {kind:'circle', c:[13,14], r:1})
  addConstraint(sketch, {kind:'distance', p:{entity:a,at:'center'}, q:{entity:b,at:'center'}, value:5})
  s().setSketch(sketch)
})

it.each(['x','y'] as const)('rejects invalid typed values when changing to %s without altering history or geometry', form => {
  for (const value of [NaN, Infinity, -Infinity, -1]) {
    const before = s().sketchDraft!
    const bytes = JSON.stringify(before.sketch)
    const id = before.sketch.constraints[0].id
    s().setDimensionForm(id, form, value)
    const after = s().sketchDraft!
    expect(after.error).toMatch(/number|negative/)
    expect(JSON.stringify(after.sketch)).toBe(bytes)
    expect(after.history).toBe(before.history)
    expect(after.future).toBe(before.future)
  }
})

it('refuses a typed form change on a driven dimension just as a value edit does', () => {
  const id = s().sketchDraft!.sketch.constraints[0].id
  s().setDimensionDriven(id, true)
  const before = s().sketchDraft!
  const bytes = JSON.stringify(before.sketch)
  s().setDimensionForm(id, 'x', 20)
  expect(s().sketchDraft!.error).toMatch(/driven dimension only reads/)
  expect(JSON.stringify(s().sketchDraft!.sketch)).toBe(bytes)
  expect(s().sketchDraft!.history).toBe(before.history)
})

it('refuses a negative distance within roundoff of a valid zero', () => {
  const id = s().sketchDraft!.sketch.constraints[0].id
  s().setDimensionValue(id, 0)
  const before = s().sketchDraft!
  expect(before.sketch.constraints[0]).toMatchObject({value:0})
  const saved = JSON.stringify(before.sketch)
  s().setDimensionValue(id, -3e-13)
  const after = s().sketchDraft!
  expect(after.error).toMatch(/negative|zero or greater/i)
  expect(after.history).toBe(before.history)
  expect(JSON.stringify(after.sketch)).toBe(saved)
})

it('allows a read-only driven form change and measures its new axis', () => {
  const id = s().sketchDraft!.sketch.constraints[0].id
  s().setDimensionDriven(id, true)
  const before = JSON.stringify(s().sketchDraft!.sketch.entities)
  s().setDimensionForm(id, 'x')
  const after = s().sketchDraft!
  expect(JSON.stringify(after.sketch.entities)).toBe(before)
  expect(after.sketch.constraints[0]).toMatchObject({axis:'x',value:3,driven:true})
})
