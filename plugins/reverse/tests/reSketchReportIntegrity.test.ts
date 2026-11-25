// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest'
import { addConstraint, cloneSketch, entityOf, emptySketch, addEntity } from '../core/sketch'
import { inspectSketch, solveSketch } from '../core/solver'
import { restoreSettled } from '../state/reSketchDraft'
import { useReverse } from '../state/reStore'
import { resetReverse } from './reReset'
import { XY } from './reKit'

beforeEach(resetReverse)

describe('a restored sketch reports its actual geometry', () => {
  it('retains the saved points and reports an unmet horizontal instead of a solved copy', () => {
    useReverse.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY,
      [{ kind: 'line', a: [0, 0], b: [10, 0.5] }])
    const d = useReverse.getState().sketchDraft!
    const line = d.sketch.entities[0]
    const id = addConstraint(d.sketch, { kind: 'horizontal', entity: line.id })
    const original = JSON.stringify(d.sketch)
    // A real solve can close this relation. A restored report must not
    // describe that different geometry while retaining the original points.
    const solved = cloneSketch(d.sketch)
    expect(solveSketch(solved).ok).toBe(true)
    expect(JSON.stringify(solved)).not.toBe(original)
    const restored = restoreSettled(d)
    expect(JSON.stringify(restored.sketch)).toBe(original)
    const actual = entityOf(restored.sketch, line.id)!
    expect(actual.kind === 'line' && Math.abs(actual.b[1] - actual.a[1])).toBe(0.5)
    expect(restored.report?.ok).toBe(false)
    expect(restored.report?.unmet.find(u => u.id === id)?.residual).toBeCloseTo(0.5, 12)
  })
  it('inspects frozen geometry and driven values without changing either', () => {
    const sketch=emptySketch()
    const id=addEntity(sketch,{kind:'line',a:[0,0],b:[10,0]})
    addConstraint(sketch,{kind:'length',entity:id,value:99,driven:true})
    const saved=JSON.stringify(sketch)
    const freeze=(value:unknown):void=>{if(value && typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child)}}
    freeze(sketch)
    expect(inspectSketch(sketch).ok).toBe(true)
    expect(JSON.stringify(sketch)).toBe(saved)
  })
  it('does not retain an old OK report when the saved constraints cannot be inspected', () => {
    useReverse.getState().startSketch({kind:'world',axis:'z',offset:0},XY,[{kind:'line',a:[0,0],b:[10,0]}])
    const d=useReverse.getState().sketchDraft!
    expect(d.report?.ok).toBe(true)
    addConstraint(d.sketch,{kind:'horizontal',entity:999})
    const before=JSON.stringify(d.sketch)
    const result=restoreSettled(d)
    expect(result.error).toBeTruthy()
    expect(result.report).toBeNull()
    expect(JSON.stringify(result.sketch)).toBe(before)
  })
})
