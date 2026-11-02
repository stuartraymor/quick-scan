// SPDX-License-Identifier: AGPL-3.0-only
// Independently drawn compact glyphs for the observed extraction tool rows.
import type {ReactNode} from 'react'
export type ExtractIconName='navigate'|'wand'|'brush'|'lasso'|'line'|'window'|'circle'|'through'|'enlarge'|'shrink'|'isolate'|'hide'|'show'|'deselect'|'all'|'plane'|'cylinder'|'axis'|'cone'|'sphere'
const glyphs:Record<ExtractIconName,ReactNode>={
 navigate:<><path fill="var(--extract-blue)" d="m3 7 9-5 9 5v10l-9 5-9-5Z"/><path d="m3 7 9 5 9-5M12 12v10" stroke="var(--extract-pale)"/><path fill="var(--extract-pale)" d="m3 7 9-5 9 5-9 5Z"/></>,
 wand:<><path fill="var(--extract-blue)" stroke="none" d="m10 1 2 5 5-3-1 6 6 1-5 3 4 5-6-1-1 6-3-6-5 4 1-6-6-1 5-3-3-5 6 1Z"/><path stroke="var(--extract-edge)" strokeWidth="2.2" d="m14 14 8 8"/></>,
 brush:<><path fill="var(--extract-blue)" d="m4 4 5 1 9 12-3 3L5 10Z"/><path d="m4 4 5 6M15 15l4 2"/></>,
 lasso:<><path d="M5 18 6 6l9-3 5 7-8 4-7 4 2 4"/><path stroke="var(--extract-blue)" d="m3 17 7-3 6 5 5-2"/></>,
 line:<><path d="m3 3 2 17 16 1"/><path stroke="var(--extract-blue)" d="m3 18 7-4 5-8 7-3"/></>,
 window:<><path fill="var(--extract-blue)" fillOpacity=".6" d="M3 5h18v14H3Z"/><path stroke="var(--extract-blue)" strokeDasharray="1 2" d="M3 5h18v14H3Z"/><path stroke="var(--extract-pale)" strokeWidth=".8" d="m5 7 14 10M5 11l9 6M10 7l9 6m-14 3 12-9M5 11l6-4m1 10 7-5"/></>,
 circle:<><circle cx="12" cy="12" r="9" fill="var(--extract-blue)" fillOpacity=".55" strokeDasharray="1 1"/><path stroke="var(--extract-pale)" strokeWidth=".8" d="m5 7 14 10M3 11l13 9M8 4l13 10M4 16 12 3m-3 18 10-17m-4 17 6-10"/></>,
 through:<><path fill="var(--extract-blue)" d="M2 8h14v14H2Z"/><path fill="var(--extract-pale)" d="M8 2h14v14H8Z"/><path fill="var(--extract-blue)" fillOpacity=".5" d="M8 8h8v8H8Z"/></>,
 enlarge:<><path fill="var(--extract-blue)" d="m10 2 5 1 2 3 4 2-1 5 1 3-5 2-2 4-4-1-3 1-2-4-3-3 1-4-1-3 5-2Z"/><circle cx="12" cy="12" r="4" fill="var(--extract-well)"/></>,
 shrink:<><circle cx="12" cy="12" r="9" fill="var(--extract-blue)"/><circle cx="12" cy="12" r="5" fill="var(--extract-well)"/><circle cx="12" cy="12" r="3" fill="var(--extract-blue)"/></>,
 isolate:<><path fill="var(--extract-blue)" d="M2 2h20v20H2Z"/><path fill="var(--extract-pale)" d="M5 5h14v14H5Z"/><path fill="var(--extract-blue)" d="M7 7h10v10H7Z"/></>,
 hide:<><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path d="m3 3 18 18"/></>,
 show:<><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></>,
 deselect:<circle cx="12" cy="12" r="9" fill="var(--extract-muted)" strokeDasharray="3 2"/>,
 all:<circle cx="12" cy="12" r="9" fill="var(--extract-blue)"/>,
 plane:<path fill="var(--extract-pale)" stroke="var(--extract-edge)" d="m3 18 5-12h13l-5 12Z"/>,
 cylinder:<><path fill="var(--extract-pale)" stroke="var(--extract-edge)" d="M5 5v14c0 4 14 4 14 0V5"/><ellipse cx="12" cy="5" rx="7" ry="3" fill="var(--extract-pale)" stroke="var(--extract-edge)"/></>,
 axis:<><path stroke="var(--extract-edge)" d="m4 20 16-16"/><circle cx="5" cy="19" r="1.8" fill="var(--extract-well)" stroke="var(--extract-edge)"/><circle cx="19" cy="5" r="1.8" fill="var(--extract-well)" stroke="var(--extract-edge)"/></>,
 cone:<><path fill="var(--extract-pale)" stroke="var(--extract-edge)" d="m12 3 9 17c-5 4-13 4-18 0Z"/><path d="M3 20q9 3 18 0" stroke="var(--extract-edge)"/></>,
 sphere:<><circle cx="12" cy="12" r="9" fill="var(--extract-pale)" stroke="var(--extract-edge)"/><path d="M6 6q3-3 6-3" stroke="var(--extract-well)"/></>,
}
export function ExtractIcon({name,size=20}:{name:ExtractIconName;size?:number}){
 return <svg className="extract-icon" data-extract-icon={name} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--extract-blue)" strokeWidth="1.1" strokeLinejoin="round" aria-hidden="true">{glyphs[name]}</svg>
}
