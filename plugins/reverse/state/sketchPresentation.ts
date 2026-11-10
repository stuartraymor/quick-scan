// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
export type ExtraSketchTool = 'slot'|'middle'|'trim'|'tangentArc'|null
export type SketchEditPanel = 'offset'|'duplicate'|null
export const useSketchPresentation = create<{ tool:ExtraSketchTool; edit:SketchEditPanel; lineChain:boolean; setTool:(tool:ExtraSketchTool)=>void; setEdit:(edit:SketchEditPanel)=>void; setLineChain:(on:boolean)=>void }>((set)=>({tool:null,edit:null,lineChain:false,setTool:tool=>set({tool,edit:null}),setEdit:edit=>set({edit}),setLineChain:lineChain=>set({lineChain})}))
