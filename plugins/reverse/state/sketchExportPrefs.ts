// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import type { SketchExportFormat } from '../core/sketchExport'
const key='quickscan.sketchExportFormat'
const read=():SketchExportFormat=>{try{const value=localStorage.getItem(key);return value==='dxf-r14'||value==='dxf-r12'?value:'iges'}catch{return 'iges'}}
export const useSketchExportPrefs=create<{format:SketchExportFormat;setFormat:(format:SketchExportFormat)=>void}>(set=>({
 format:read(),setFormat:format=>{try{localStorage.setItem(key,format)}catch{/* Session preference still works without storage. */}set({format})},
}))
