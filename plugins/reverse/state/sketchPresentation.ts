// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
export type ExtraSketchTool = 'slot'|'middle'|'trim'|'tangentArc'|null
export const useSketchPresentation = create<{ tool:ExtraSketchTool; lineChain:boolean; setTool:(tool:ExtraSketchTool)=>void; setLineChain:(on:boolean)=>void }>((set)=>({tool:null,lineChain:false,setTool:tool=>set({tool}),setLineChain:lineChain=>set({lineChain})}))
