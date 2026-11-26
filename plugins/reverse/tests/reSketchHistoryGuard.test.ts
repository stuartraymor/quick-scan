// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach,expect,it} from 'vitest'
import {DEFAULT_DRAW_MODES,setCircularDimensioning} from '../core/draw'
import {cloneSketch} from '../core/sketch'
import {MAX_HISTORY} from '../state/reSketchDraft'
import {useRePrefs} from '../state/rePrefs'
import {useReverse} from '../state/reStore'
import {XY} from './reKit'
const s=()=>useReverse.getState()
beforeEach(()=>{
 useReverse.setState({...useReverse.getInitialState()},true)
 s().sketchDragEnd()
 useRePrefs.setState({drawModes:{...DEFAULT_DRAW_MODES},polygonSides:6,gridSnap:false})
 setCircularDimensioning('diameter')
 s().startSketch({kind:'world',axis:'z',offset:0},XY)
})
it.each([0,MAX_HISTORY])('refuses a destructive symmetry with %i retained undo entries',depth=>{
 s().setSketchTool('line')
 for(const p of [[-69.02531542535871,67.46907087350489],[-63.28861882089492,75.441914550058],[-51.10367439902034,75.56144730419531]] as [number,number][])s().sketchClick(p,.5,false,{off:true})
 useReverse.setState(state=>({sketchDraft:{...state.sketchDraft!,history:Array.from({length:depth},()=>cloneSketch(state.sketchDraft!.sketch))}}))
 const before=JSON.stringify(s().sketchDraft!.sketch)
 s().armRelation('symmetric')
 s().sketchClick([-65.76437154066116,72.02376975444363],.5,false)
 s().sketchClick([-58.49294501342804,75.4817587726314],.5,false)
 s().sketchClick([-32.17225872911513,0],.5,false)
 const d=s().sketchDraft!
 expect(d.error).toMatch(/was not applied.*Nothing was changed/)
 expect(JSON.stringify(d.sketch)).toBe(before)
 expect(d.history).toHaveLength(depth)
})
