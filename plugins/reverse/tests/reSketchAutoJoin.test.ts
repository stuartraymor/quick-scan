// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it } from 'vitest'
import { useReverse } from '../state/reStore'
import { XY } from './reKit'
import { addConstraint, type SketchLine } from '../core/sketch'
import { solveSketch } from '../core/solver'
const s = () => useReverse.getState()
const d = () => s().sketchDraft!
beforeEach(() => {
  useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, extrudeDraft: null, revolveDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [
    { kind: 'line', a: [88.673011713,-181.675616739], b: [-87.57373005,-181.675616739] },
    { kind: 'line', a: [-96.44214408,-174.075319788], b: [-96.44214408,-44.335401858] },
  ])
})
it('joins the two open pieces without preselection, keeping carriers and opposite ends', () => {
  s().joinSelected()
  const [a,b] = d().sketch.entities as SketchLine[]
  expect(a.a).toEqual([88.673011713,-181.675616739])
  expect(b.b).toEqual([-96.44214408,-44.335401858])
  expect(a.b[0]).toBeCloseTo(-96.44214408, 10); expect(a.b[1]).toBeCloseTo(-181.675616739, 10)
  expect(b.a).toEqual(a.b)
  expect(d().sketch.constraints.filter(c=>c.kind==='coincident')).toHaveLength(1)
  expect(d().report?.ok).toBe(true)
  expect(d().history).toHaveLength(1)
  s().undoSketch(); expect((d().sketch.entities[0] as SketchLine).b).toEqual([-87.57373005,-181.675616739])
  s().redoSketch(); expect((d().sketch.entities[0] as SketchLine).b).toEqual(a.b)
})
it('repeated selected joins do not duplicate constraints, drift, or consume undo', () => {
  useReverse.setState({sketchDraft:{...d(),selection:d().sketch.entities.map(e=>e.id)}})
  s().joinSelected()
  const saved = structuredClone(d().sketch)
  const history = d().history.length
  for(let i=0;i<5;i++) s().joinSelected()
  expect(d().sketch).toEqual(saved)
  expect(d().history).toHaveLength(history)
  expect(d().report?.redundant).toBe(0)
})
it('preserves fitted carriers through join, undo, redo, commit and reopening', () => {
  const [h,v] = d().sketch.entities as SketchLine[]
  h.points = Array.from({length:40},(_,i)=>[80-i*4,-181.67561+Math.sin(i)*.001])
  v.points = Array.from({length:40},(_,i)=>[-96.44214+Math.cos(i)*.001,-170+i*3])
  h.pointWeights = v.pointWeights = Array(40).fill(1)
  h.scatter = v.scatter = .001
  addConstraint(d().sketch,{kind:'horizontal',entity:h.id})
  addConstraint(d().sketch,{kind:'vertical',entity:v.id})
  const baseline=structuredClone(d().sketch)
  s().joinSelected()
  const joined=structuredClone(d().sketch)
  expect((joined.entities[0] as SketchLine).a).toEqual(h.a)
  expect((joined.entities[1] as SketchLine).b).toEqual(v.b)
  expect(d().report?.iterations).toBe(0)
  s().undoSketch(); expect(d().sketch).toEqual(baseline)
  s().redoSketch(); expect(d().sketch).toEqual(joined)
  const id=s().commitSketch()!
  s().editSketch(id); expect(d().sketch).toEqual(joined)
})
it('still solves unsatisfied constraints and explicit refits', () => {
  const sketch=d().sketch, line=sketch.entities[0] as SketchLine
  addConstraint(sketch,{kind:'length',entity:line.id,value:150})
  const report=solveSketch(sketch,{preserveSatisfied:true})
  expect(report.ok).toBe(true); expect(report.iterations).toBeGreaterThan(0)
  const changed=sketch.entities[0] as SketchLine
  expect(Math.hypot(changed.b[0]-changed.a[0],changed.b[1]-changed.a[1])).toBeCloseTo(150,6)
  changed.points=[[0,4],[1,4],[2,4]]; changed.pointWeights=[1,1,1]; changed.scatter=.01
  sketch.constraints=[]
  const explicit=solveSketch(sketch)
  expect(explicit.iterations).toBeGreaterThan(0)
})
