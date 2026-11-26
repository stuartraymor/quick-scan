// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest'
import {useReverse} from '../state/reStore'
import {inspectSketch,solveSketch} from '../core/solver'
import {addConstraint,addEntity,emptySketch} from '../core/sketch'
import {XY} from './reKit'
const s=()=>useReverse.getState()
const selectedDimension=()=>{
 const id=s().sketchDraft?.selectedConstraint
 if(id==null)throw new Error('Replay expected a selected dimension')
 return id
}
it('reports the retained geometry after a concentric reference hold (workflow 1332)',()=>{
useReverse.setState({...useReverse.getInitialState()},true)
s().startSketch({"kind":"world","axis":"z","offset":0}, XY)
// draw arc
s().setSketchTool("arc")
s().sketchClick([-0.5546204490979898,20.26730084740327], 0.5, false, {"off":true})
s().sketchClick([14.253563785887412,12.4690777268751], 0.5, false, {"off":true})
s().sketchClick([-4.760119731087197,5.016719009142624], 0.5, false, {"off":true})
// draw circle
s().setSketchTool("circle")
s().sketchClick([56.63489208556712,-4.78899514535442], 0.5, false, {"off":true})
s().sketchClick([78.4303118456155,-4.78899514535442], 0.5, false, {"off":true})
// dimension tool
s().setSketchTool("dimension")
s().sketchClick([-135.9714075550437,0], 0.5, false)
s().sketchClick([-0.5546204490979894,20.26730084740327], 0.5, false)
s().setDimensionValue(selectedDimension(), 5)
// relation equal on selection
s().setSketchTool("select")
s().sketchClick([8.706114626811344,3.0910771532204557], 0.5, false)
s().sketchClick([55.49527622913939,-26.554600999924293], 0.5, true)
s().addRelation("equal")
// remove 3
s().selectConstraint(3)
s().removeSelectedConstraint()
// dimension tool
s().setSketchTool("dimension")
s().sketchClick([17.462069148222863,4.917682337160649], 0.5, false)
s().sketchClick([47.60485521832035,5.3025160156081], 0.5, false)
s().setDimensionValue(selectedDimension(), 38.259751879471175)
s().setSketchTool("select")
// relation concentric on selection
s().sketchClick([3.1294790407395676,-0.5669466307551616], 0.5, false)
s().sketchClick([71.5788164657816,-19.82308332989751], 0.5, true)
const beforeConcentric=JSON.stringify(s().sketchDraft!.sketch)
s().addRelation("concentric")
const d=s().sketchDraft!
const actual=inspectSketch(d.sketch)
expect(d.error).toMatch(/Nothing was changed/)
expect(JSON.stringify(d.sketch)).toBe(beforeConcentric)
expect(d.report?.ok).toBe(actual.ok)
expect(d.report?.unmet).toEqual(actual.unmet)
})

it('cannot satisfy a positive nearest-rim gap by making concentric radii negative',()=>{
 const sketch=emptySketch()
 const a=addEntity(sketch,{kind:'circle',c:[0,0],r:2})
 const b=addEntity(sketch,{kind:'circle',c:[0,0],r:2})
 addConstraint(sketch,{kind:'equal',a,b})
 addConstraint(sketch,{kind:'concentric',a,b})
 addConstraint(sketch,{kind:'distance',p:{entity:a,at:'center'},q:{entity:b,at:'center'},edge:'near',value:4})
 const report=solveSketch(sketch)
 expect(report.ok).toBe(false)
 expect(inspectSketch(sketch).ok).toBe(false)
})
