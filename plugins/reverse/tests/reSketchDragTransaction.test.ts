// SPDX-License-Identifier: AGPL-3.0-only
// Full original seed-95 workflow, with complete press/move/release sequences.
import {expect,it} from 'vitest'
import {useReverse} from '../state/reStore'
import {inspectSketch} from '../core/solver'
import {cloneSketch} from '../core/sketch'
import {XY} from './reKit'
const s=()=>useReverse.getState()
const selectedDimension=()=>{const id=s().sketchDraft?.selectedConstraint;if(id==null)throw Error('Missing selected dimension');return id}
it.each([0,40])('a mouse-style drag release never leaves a solved sketch broken with %i undo entries (seed 95)',depth=>{
useReverse.setState({...useReverse.getInitialState()},true)
s().sketchDragEnd()
s().startSketch({"kind":"world","axis":"z","offset":0}, XY)
// draw rectangle
s().setSketchTool("rectangle")
s().sketchClick([50.87113888585009,46.707064813112304], 0.5, false, {"off":true})
s().sketchClick([83.98257799330167,85.04249595001579], 0.5, false, {"off":true})
s().setSketchTool("select")
// draw rectangle
s().setSketchTool("rectangle")
s().sketchClick([-2.193311359733343,50.930642293687555], 0.5, false, {"off":true})
s().sketchClick([29.053986580111086,79.03094962805918], 0.5, false, {"off":true})
s().setSketchTool("select")
// drag line 2
s().sketchDragStart([83.98257799330167,85.04249595001579], 0.5)
s().sketchDrag([83.03124836469244,83.02624061478234], 0.5, {"off":true})
s().sketchDrag([82.0799187360832,81.00998527954889], 0.5, {"off":true})
s().sketchDrag([81.12858910747397,78.99372994431545], 0.5, {"off":true})
s().sketchDrag([80.17725947886473,76.977474609082], 0.5, {"off":true})
s().sketchDrag([79.2259298502555,74.96121927384854], 0.5, {"off":true})
s().sketchDragEnd()
// relation concentric in hand
s().clearSelection()
s().armRelation("concentric")
// relation parallel on selection
s().setSketchTool("select")
s().sketchClick([79.22593312513058,59.41579530861859], 0.5, false)
s().sketchClick([64.17117513100962,46.707064813112304], 0.5, true)
s().addRelation("parallel")
s().setSketchTool("select")
// addDimension length
s().sketchClick([11.982342652995088,50.930642293687555], 0.5, false)
s().addDimension("length")
// dimension the selection
s().sketchClick([79.22593312513054,59.32762211268725], 0.5, false)
s().dimensionSelection()
s().sketchClick([136.58937656320632,-110.43161265552044], 0.5, false)
s().setSketchTool("select")
// fix
s().sketchClick([14.931223185516828,79.03094962805918], 0.5, false)
s().toggleFixedSelected()
// dimension tool
s().setSketchTool("dimension")
s().sketchClick([-2.193311359733343,79.03094962805918], 0.5, false)
s().sketchClick([-2.193311359733343,67.44637047799594], 0.5, false)
s().setSketchTool("select")
// dimension tool
s().setSketchTool("dimension")
s().sketchClick([-2.193311359733343,65.5741268746972], 0.5, false)
s().sketchClick([14.737518895808346,79.03094962805918], 0.5, false)
s().sketchClick([-3.662930958760232,82.53208125653347], 0.5, false)
s().setDimensionValue(selectedDimension(), 149.77251318329945)
// relation symmetric in hand
s().armRelation("symmetric")
// relation vertical in hand
s().armRelation("vertical")
s().sketchClick([79.22593312513054,61.43560534883061], 0.5, false)
s().sketchClick([-2.193311359733343,65.97927047507815], 0.5, false)
s().setSketchTool("select")
// dimension the selection
s().sketchClick([64.61201821048535,74.96122406769872], 0.5, false)
s().dimensionSelection()
s().putDownDimension()
s().setDimensionValue(selectedDimension(), 48.10430597036089)
s().setSketchTool("select")
// relation tangent in hand
s().armRelation("tangent")
s().setSketchTool("select")
// remove 21
s().selectConstraint(21)
s().removeSelectedConstraint()
// drag line 14
s().sketchDragStart([29.053986580111086,64.98079596087337], 0.5)
s().sketchDrag([28.56539216827762,65.65880510413669], 0.5, {"off":true})
s().sketchDrag([28.07679775644415,66.33681424740003], 0.5, {"off":true})
s().sketchDrag([27.588203344610683,67.01482339066335], 0.5, {"off":true})
s().sketchDragEnd()
// relation vertical on selection
s().sketchClick([10.384363382449038,79.03094962805918], 0.5, false)
s().sketchClick([-2.1933113597342078,65.176742594522], 0.5, true)
s().addRelation("vertical")
// drag line 13
useReverse.setState(state=>({sketchDraft:{...state.sketchDraft!,history:Array.from({length:depth},()=>cloneSketch(state.sketchDraft!.sketch)),future:[cloneSketch(state.sketchDraft!.sketch)]}}))
const beforeDrag=JSON.stringify(s().sketchDraft!.sketch)
const historyBefore=s().sketchDraft!.history,futureBefore=s().sketchDraft!.future
expect(inspectSketch(s().sketchDraft!.sketch).ok).toBe(true)
s().sketchDragStart([-2.193311359734124,52.96466757938784], 0.5)
s().sketchDrag([-9.244628379727644,62.15245787658637], 0.5, {"off":true})
s().sketchDrag([-16.295945399721163,71.34024817378489], 0.5, {"off":true})
s().sketchDrag([-23.347262419714685,80.52803847098342], 0.5, {"off":true})
s().sketchDragEnd()
const d=s().sketchDraft!
expect(inspectSketch(d.sketch).ok).toBe(true)
expect(d.error).toMatch(/drag.*Nothing was changed/)
expect(JSON.stringify(d.sketch)).toBe(beforeDrag)
expect(d.history).toBe(historyBefore)
expect(d.future).toBe(futureBefore)
})
