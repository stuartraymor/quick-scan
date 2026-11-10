// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import type { Vec2 } from '../../../src/core/flat/types'
export type ExtraSketchTool = 'slot'|'middle'|'trim'|'tangentArc'|null
export type SketchEditPanel = 'offset'|'duplicate'|null
export const useSketchPresentation = create<{
 tool:ExtraSketchTool; edit:SketchEditPanel; lineChain:boolean
 duplicateDelta:Vec2; offsetDistance:number
 setTool:(tool:ExtraSketchTool)=>void; setEdit:(edit:SketchEditPanel)=>void; setLineChain:(on:boolean)=>void
 setDuplicateDelta:(delta:Vec2)=>void; setOffsetDistance:(distance:number)=>void
}>((set)=>({
 tool:null,edit:null,lineChain:false,duplicateDelta:[10,0],offsetDistance:1,
 setTool:tool=>set({tool,edit:null}),setEdit:edit=>set({edit}),setLineChain:lineChain=>set({lineChain}),
 setDuplicateDelta:duplicateDelta=>set({duplicateDelta}),setOffsetDistance:offsetDistance=>set({offsetDistance}),
}))
