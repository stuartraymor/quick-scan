// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it } from 'vitest'
import { useReverse } from '../state/reStore'
import { useSketchBrush } from '../state/sketchBrushStore'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'
import { useSketchProject } from '../state/sketchProjectStore'
import { useSketchPresentation } from '../state/sketchPresentation'
import { useRePrefs } from '../state/rePrefs'
import { activateSketchTool, closeSketchToolOverlays } from '../state/sketchToolActions'
import { reverseKeyboard } from '../app/keyboard'
import { XY } from './reKit'
const key=(key:string)=>reverseKeyboard.keydown!({key,ctrlKey:false,altKey:false,metaKey:false} as KeyboardEvent,{confirmButton:()=>null})
beforeEach(()=>{
  closeSketchToolOverlays()
  useReverse.setState({features:[],sketchDraft:null,past:[],future:[]})
  useReverse.getState().startSketch({kind:'world',axis:'z',offset:0},XY,[{kind:'line',a:[0,0],b:[10,0]}])
})
it('cancels every provisional overlay without editing the sketch or consuming undo',()=>{
  const original=useReverse.getState().sketchDraft!
  useSketchBrush.setState({open:true});useSketchCornerTrim.setState({open:true});useSketchProject.setState({open:true});useSketchPresentation.setState({tool:'trim',edit:'offset'})
  activateSketchTool('circle')
  const d=useReverse.getState().sketchDraft!
  expect(d.tool).toBe('circle');expect(d.sketch).toEqual(original.sketch);expect(d.history).toEqual(original.history)
  expect([useSketchBrush.getState().open,useSketchCornerTrim.getState().open,useSketchProject.getState().open]).toEqual([false,false,false])
  expect(useSketchPresentation.getState().tool).toBeNull();expect(useSketchPresentation.getState().edit).toBeNull()
})
it('D preserves selected geometry when leaving a projection preview to place a dimension',()=>{
  const s=useReverse.getState();useReverse.setState({sketchDraft:{...s.sketchDraft!,selection:[s.sketchDraft!.sketch.entities[0].id]}})
  useSketchProject.setState({open:true});key('d')
  expect(useSketchProject.getState().open).toBe(false);expect(useReverse.getState().sketchDraft!.dimMade).not.toBeNull()
  key('Escape');expect(useReverse.getState().sketchDraft!.sketch.constraints).toHaveLength(0);expect(useReverse.getState().sketchDraft!.sketch.entities).toHaveLength(1)
})
it('native C and R choose their toolbar draw modes instead of carrying unrelated prior modes',()=>{
  useRePrefs.getState().setDrawMode('circle','threePoint');useReverse.getState().setSketchTool('circle');key('c')
  expect(useReverse.getState().sketchDraft!.tool).toBe('circle');expect(useRePrefs.getState().drawModes.circle).toBe('center')
  useRePrefs.getState().setDrawMode('arc','center');useReverse.getState().setSketchTool('arc');key('r')
  expect(useReverse.getState().sketchDraft!.tool).toBe('arc');expect(useRePrefs.getState().drawModes.arc).toBe('threePoint')
})
it('T owns the extra tool, O shares the offset panel, and empty-selection M/O do nothing',()=>{
  key('t');expect(useSketchPresentation.getState().tool).toBe('trim')
  key('m');key('o');expect(useSketchPresentation.getState().tool).toBe('trim');expect(useSketchPresentation.getState().edit).toBeNull()
  const d=useReverse.getState().sketchDraft!;useReverse.setState({sketchDraft:{...d,selection:[d.sketch.entities[0].id]}});key('o')
  expect(useSketchPresentation.getState().tool).toBeNull();expect(useSketchPresentation.getState().edit).toBe('offset')
  key('o');expect(useSketchPresentation.getState().edit).toBeNull()
})
it('drawing and modify shortcuts cannot arm overlays or edit geometry while choosing the sketch plane',()=>{
  const d=useReverse.getState().sketchDraft!
  useReverse.setState({sketchDraft:{...d,placing:true,selection:[d.sketch.entities[0].id]}})
  const before=useReverse.getState().sketchDraft!
  for(const letter of ['l','c','r','d','s','f','t','m','o'])key(letter)
  expect(useReverse.getState().sketchDraft).toBe(before)
  expect(useSketchPresentation.getState().tool).toBeNull();expect(useSketchPresentation.getState().edit).toBeNull()
  expect([useSketchBrush.getState().open,useSketchCornerTrim.getState().open,useSketchProject.getState().open]).toEqual([false,false,false])
})
