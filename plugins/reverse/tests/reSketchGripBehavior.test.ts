// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it } from 'vitest'
import { useReverse } from '../state/reStore'
import { anchorPoint, type SketchArc } from '../core/sketch'
import { XY } from './reKit'
import { controlPolygonMarks } from '../app/useSketchSceneSync'
import { reshapeArc } from '../core/drag'
const s = () => useReverse.getState()
const d = () => s().sketchDraft!
const arc = () => d().sketch.entities[0] as SketchArc
beforeEach(() => {
  s().sketchDragEnd()
  useReverse.setState({features:[],nextFeatureId:1,nextOfKind:{},results:{},bodies:[],sketchDraft:null,extrudeDraft:null,revolveDraft:null,past:[],future:[],selection:null,gripField:null,buildVersion:0})
  s().startSketch({kind:'world',axis:'z',offset:0},XY,[
    {kind:'arc',c:[17,23],r:10,start:0,sweep:Math.PI/2},
    {kind:'line',a:[50,60],b:[70,80]},
  ])
})
it('reshapes an arc by its endpoint while preserving the other two defining points', () => {
  const before=structuredClone(d().sketch), other=anchorPoint(arc(),'a'), through=anchorPoint(arc(),'p0')
  expect(s().sketchDragStart(anchorPoint(arc(),'b'),.1)).toBe(true)
  s().sketchDrag([5,30],.1,{off:true})
  s().sketchDrag([3,28],.1,{off:true})
  s().sketchDragEnd()
  for (const [actual,expected] of [[anchorPoint(arc(),'a'),other],[anchorPoint(arc(),'b'),[3,28]],[anchorPoint(arc(),'p0'),through]])
    actual.forEach((v,i)=>expect(v).toBeCloseTo(expected[i],9))
  expect(d().sketch.entities[1]).toEqual(before.entities[1])
  expect(d().history).toHaveLength(1)
  const after=structuredClone(d().sketch)
  s().undoSketch(); expect(d().sketch).toEqual(before)
  s().redoSketch(); expect(d().sketch).toEqual(after)
})
it('draws a bounded dashed control polygon through the actual poles', () => {
  const marks=controlPolygonMarks([[0,0],[10,10],[20,0]],.1)
  expect(marks.length).toBeGreaterThan(20)
  for(const mark of marks) {
    expect(mark.kind).toBe('line')
    if(mark.kind!=='line') continue
    const [x,y]=mark.center
    expect(Math.min(Math.abs(x-y),Math.abs(x+y-20))).toBeLessThan(1e-10)
    expect(mark.length).toBeLessThan(.4)
  }
  expect(controlPolygonMarks([[0,0],[1e9,1e9]],1e-8).length).toBeLessThanOrEqual(160)
  expect(controlPolygonMarks([[0,0],[1,1]],0)).toEqual([])
})
it('agrees with the native exported three-point arc drag within one micrometre', () => {
  const before: SketchArc={id:1,kind:'arc',c:[193.36214447,-78.143215179],r:32.177696228,start:0,sweep:Math.PI}
  const after=reshapeArc(before,'b',[167.61999510130215,-110.32091521891374])
  expect(Math.hypot(after.c[0]-189.684694018,after.c[1]+81.820665632)).toBeLessThan(.00001)
  expect(Math.abs(after.r-36.043240202)).toBeLessThan(.00001)
})
it('moves an arc through-point while keeping both endpoints and persists that grip', () => {
  const a=anchorPoint(arc(),'a'),b=anchorPoint(arc(),'b')
  expect(s().sketchDragStart(anchorPoint(arc(),'p0'),.1)).toBe(true)
  s().sketchDrag([27,33],.1,{off:true});s().sketchDragEnd()
  for(const [actual,expected] of [[anchorPoint(arc(),'a'),a],[anchorPoint(arc(),'b'),b],[anchorPoint(arc(),'p0'),[27,33]]])
    actual.forEach((v,i)=>expect(v).toBeCloseTo(expected[i],9))
  const saved=structuredClone(arc()),id=s().commitSketch()!
  s().editSketch(id);expect(arc()).toEqual(saved)
})
