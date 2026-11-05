// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it } from 'vitest'
import { useReverse } from '../state/reStore'
import { XY } from './reKit'
import { addConstraint, addEntity, anchorPoint, type SketchLine, type SketchArc } from '../core/sketch'
import { autoJoinLinePairs, canAutoJoin } from '../core/corners'
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
it('joins nearby mixed line and arc corners without changing the analytic carriers', () => {
  s().startSketch({kind:'world',axis:'z',offset:0},XY,[
    {kind:'line',a:[9.99,-10],b:[9.99,-.5]},
    {kind:'arc',c:[0,0],r:10,start:.05,sweep:Math.PI/2-.1},
    {kind:'line',a:[-.5,9.99],b:[-10,9.99]},
  ])
  const before=structuredClone(d().sketch)
  s().joinSelected()
  const [a,b,c]=d().sketch.entities as [SketchLine,SketchArc,SketchLine]
  const h=Math.sqrt(100-9.99**2)
  expect(a.b[0]).toBe(9.99); expect(a.b[1]).toBeCloseTo(-h,10); expect(a.a).toEqual([9.99,-10])
  expect(b.c).toEqual([0,0]); expect(b.r).toBe(10)
  expect(anchorPoint(b,'a')[0]).toBeCloseTo(9.99,10)
  expect(anchorPoint(b,'b')[1]).toBeCloseTo(9.99,10)
  expect(c.a[0]).toBeCloseTo(-h,10); expect(c.a[1]).toBe(9.99); expect(c.b).toEqual([-10,9.99])
  expect(d().sketch.constraints.filter(c=>c.kind==='coincident')).toHaveLength(2)
  expect(d().report?.ok).toBe(true)
  const after=structuredClone(d().sketch)
  s().joinSelected(); expect(d().sketch).toEqual(after); expect(d().history).toHaveLength(1)
  s().undoSketch(); expect(d().sketch).toEqual(before)
  s().redoSketch(); expect(d().sketch).toEqual(after)
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

it('leaves the native tangent and disjoint line/arc examples unchanged, selected or automatic', () => {
  for (const offset of [0,.0001,1]) for (const selected of [false,true]) {
    s().startSketch({kind:'world',axis:'z',offset:0},XY,[
      {kind:'arc',c:[193.36214447,-78.143215179],r:32.177696228,start:0,sweep:Math.PI},
      {kind:'line',a:[225.539840698+offset,-84.578757763],b:[225.539840698+offset,-142.498615265]},
    ])
    if (selected) useReverse.setState({sketchDraft:{...d(),selection:d().sketch.entities.map(e=>e.id)}})
    const before=structuredClone(d().sketch)
    expect(canAutoJoin(before,d().selection)).toBe(false)
    s().joinSelected()
    expect(d().sketch).toEqual(before); expect(d().history).toHaveLength(0)
  }
})

it('matches the exported native secant join without refitting or adding false tangency', () => {
  for (const selected of [false,true]) {
    s().startSketch({kind:'world',axis:'z',offset:0},XY,[
      {kind:'arc',c:[193.36214447,-78.143215179],r:32.177696228,start:0,sweep:Math.PI},
      {kind:'line',a:[222.322067261,-84.578757763],b:[222.322067261,-142.498615265]},
    ])
    if(selected) useReverse.setState({sketchDraft:{...d(),selection:d().sketch.entities.map(e=>e.id)}})
    const before=structuredClone(d().sketch),arcBefore=before.entities[0] as SketchArc
    expect(canAutoJoin(before,d().selection)).toBe(true)
    s().joinSelected()
    const [arc,line]=d().sketch.entities as [SketchArc,SketchLine]
    expect(arc.c).toEqual(arcBefore.c); expect(arc.r).toBe(arcBefore.r)
    expect(line.b).toEqual((before.entities[1] as SketchLine).b)
    expect(anchorPoint(arc,'b')[0]).toBeCloseTo(anchorPoint(arcBefore,'b')[0],10)
    expect(Math.hypot(line.a[0]-222.322067261,line.a[1]+92.169155665)).toBeLessThan(.00001)
    expect(Math.hypot(...anchorPoint(arc,'a').map((v,i)=>v-line.a[i]))).toBeLessThan(1e-10)
    expect(d().sketch.constraints.filter(c=>c.kind==='tangent')).toHaveLength(0)
    expect(d().sketch.constraints.filter(c=>c.kind==='coincident')).toHaveLength(1)
    expect(d().report?.ok).toBe(true)
    const after=structuredClone(d().sketch)
    s().joinSelected();expect(d().sketch).toEqual(after);expect(d().history).toHaveLength(1)
    s().undoSketch();expect(d().sketch).toEqual(before)
    s().redoSketch();expect(d().sketch).toEqual(after)
  }
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

it('joins the native three-line profile without disturbing the existing corner or top ends', () => {
  s().joinSelected()
  const sketch = d().sketch
  addEntity(sketch, {kind:'line', a:[98.747143117,-174.992423452], b:[98.747143117,-42.77440059]})
  const before = structuredClone(sketch), history = d().history.length
  expect(canAutoJoin(sketch, [])).toBe(true)
  s().joinSelected()
  const [h,left,right] = d().sketch.entities as SketchLine[]
  expect(h.a).toEqual([98.747143117,-181.675616739]); expect(right.a).toEqual(h.a)
  expect(h.b).toEqual((before.entities[0] as SketchLine).b)
  expect(left).toEqual(before.entities[1]); expect(right.b).toEqual((before.entities[2] as SketchLine).b)
  expect(d().history).toHaveLength(history+1)
  expect(d().sketch.constraints.filter(c=>c.kind==='coincident')).toHaveLength(2)
  const joined=structuredClone(d().sketch)
  for(let i=0;i<5;i++) s().joinSelected()
  expect(d().sketch).toEqual(joined); expect(d().history).toHaveLength(history+1)
  s().undoSketch(); expect(d().sketch).toEqual(before)
  s().redoSketch(); expect(d().sketch).toEqual(joined)
})

it('joins a four-line profile in one undo step regardless of entity order, leaving parallel open ends alone', () => {
  const sketch=d().sketch
  sketch.entities=[]; sketch.constraints=[]
  const lines: Omit<SketchLine,'id'>[] = [
    {kind:'line',a:[2,0],b:[18,0]}, {kind:'line',a:[20,2],b:[20,18]},
    {kind:'line',a:[18,20],b:[2,20]}, {kind:'line',a:[0,18],b:[0,2]},
  ]
  for (const i of [2,0,3,1]) addEntity(sketch,lines[i])
  const before=structuredClone(sketch)
  s().joinSelected()
  expect(d().sketch.constraints.filter(c=>c.kind==='coincident')).toHaveLength(4)
  expect(d().report?.ok).toBe(true); expect(d().history).toHaveLength(1)
  expect(autoJoinLinePairs(d().sketch,[])).toEqual([])
  s().undoSketch(); expect(d().sketch).toEqual(before)
})

it('excludes remote, construction, fixed and projected lines from automatic profile joining', () => {
  const sketch=d().sketch
  addEntity(sketch,{kind:'line',a:[500,500],b:[500,600]})
  expect(autoJoinLinePairs(sketch,[])).toHaveLength(1)
  for(const flag of ['construction','fixed','projected'] as const){
    const copy=structuredClone(sketch)
    Object.assign(copy.entities[1],{[flag]:true})
    expect(autoJoinLinePairs(copy,[])).toEqual([])
  }
  expect(autoJoinLinePairs(sketch,[sketch.entities[2].id])).toEqual([])
})
