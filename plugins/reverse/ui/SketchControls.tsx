// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { useMeasureTool } from '../../../src/state/measureToolStore'
import type { SketchChains } from '../app/useReverseWorkspace'
import { cloneSketch, entityOf, relationTakes, type ConstraintKind, type SketchEntity } from '../core/sketch'
import { useReverse } from '../state/reStore'
import { useRePrefs } from '../state/rePrefs'
import { useSketchBrush } from '../state/sketchBrushStore'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'
import { useSketchProject } from '../state/sketchProjectStore'
import { useSketchPresentation } from '../state/sketchPresentation'
import { duplicateSketchSelection, offsetSketchSelection, middleLineSketchSelection } from '../state/sketchExtraTools'
import { activateSketchTool, activateExtraSketchTool, closeSketchToolOverlays, dimensionSketchSelection, mirrorSelectedSketchEntities, openSketchEditPanel, openSketchPatternPanel } from '../state/sketchToolActions'
import { SketchCommandIcon, type SketchCommandIconName } from './SketchCommandIcon'
import { useLength } from '../../../src/app/useUnits'
import { saveFile } from '../../../src/app/exports'
import { exportSketch, SKETCH_EXPORT_FORMATS, type SketchExportFormat } from '../core/sketchExport'
import { useSketchExportPrefs } from '../state/sketchExportPrefs'
import { SketchAssistDialog } from './SketchAssistDialog'
import { createPortal } from 'react-dom'
import { useSketchCurvature } from '../state/sketchCurvatureStore'
import { useSketchAnalysis } from '../state/sketchAnalysisStore'
import { FAIL_COLOR, PASS_COLOR, gradientColor, sketchDeviation } from '../core/sketchDeviation'

export function SketchControls({chainsOf}:{chainsOf:()=>SketchChains|null}) {
 const d = useReverse(s=>s.sketchDraft), sliced=useReverse(s=>s.sketchSliced)
 const prefs=useRePrefs(), presentation=useSketchPresentation()
 // Analysis: how far each portion of the sketch lies from the scan's section.
 const analysis=useSketchAnalysis()
 const len=useLength()
 const comb=useSketchCurvature()
 const [assist,setAssist]=useState(false)
 const [overdefining,setOverdefining]=useState<number[]|null>(null)
 const [exportOptions,setExportOptions]=useState(false)
 const { format:exportFormat, setFormat:setExportFormat }=useSketchExportPrefs()
 const [draftFormat,setDraftFormat]=useState<SketchExportFormat>('iges')
 const {edit,setEdit}=presentation
 const {offsetDistance:distance,setOffsetDistance:setDistance,duplicateDelta:[dx,dy],setDuplicateDelta}=presentation
 if(!d)return null
 const re=useReverse.getState(), has=d.selection.length>0
 const tool=activateSketchTool
 const extra=activateExtraSketchTool
 const key=(icon:SketchCommandIconName,label:string,id:string,action:()=>void,on=false,disabled=false)=><button key={id} type="button" data-test={id} aria-label={label} title={label} aria-pressed={on} className={on?'on':undefined} disabled={disabled} onClick={action}><SketchCommandIcon name={icon}/></button>
 const picked=d.selection.map(id=>entityOf(d.sketch,id)).filter((e):e is SketchEntity=>Boolean(e))
 // One piece selected for a relation of two: the relation is taken in
 // hand with that piece as its first pick (the reference, which stays),
 // and the next click on the sheet is the second.
 const PAIRED:ReadonlySet<ConstraintKind>=new Set<ConstraintKind>(['parallel','perpendicular','tangent','equal','concentric','collinear','coincident'])
 const startsWith=(kind:ConstraintKind,e:SketchEntity)=>{
   const round=e.kind==='arc'||e.kind==='circle'
   if(kind==='concentric')return round
   if(kind==='parallel'||kind==='perpendicular'||kind==='collinear')return e.kind==='line'
   if(kind==='equal')return e.kind==='line'||round
   if(kind==='tangent')return e.kind==='line'||round||e.kind==='spline'
   return true
 }
 /** Whether a relation key applies to what is selected — the contextual
  *  relations: two circles offer Concentric and Equal, not Parallel. With
  *  nothing selected every key takes its relation in hand. */
 const applies=(kind:ConstraintKind)=>{
   if(!has)return true
   if(picked.length!==d.selection.length)return false
   if(picked.length===1&&PAIRED.has(kind))return startsWith(kind,picked[0])
   if(kind==='coincident')return picked.length===2
   if(kind==='symmetric')return picked.length===2||picked.length===3
   if(kind==='collinear')return picked.length>=2&&picked.every(e=>e.kind==='line')
   if(picked.length>2&&(kind==='parallel'||kind==='perpendicular'||kind==='equal'||kind==='concentric'))return picked.slice(1).every(e=>relationTakes(kind,[picked[0],e]))
   return relationTakes(kind,picked)
 }
 const relation=(kind:ConstraintKind)=>{
   closeSketchToolOverlays()
   if(has&&picked.length===1&&PAIRED.has(kind)&&kind!=='collinear'){
     const first=picked[0]
     re.armRelation(kind)
     useReverse.setState(s=>s.sketchDraft?{sketchDraft:{...s.sketchDraft,...(kind==='coincident'?{relPicks:[{kind:'piece' as const,id:first.id}]}:{selection:[first.id]})}}:{})
     return
   }
   if(has)re.addRelation(kind);else re.armRelation(kind)
 }
 const RELATION_TIPS:Partial<Record<ConstraintKind,string>>={
   coincident:'Make Coincident — two points meet (ends, centres, the origin), a point lies on a piece, or two circles share their centre',
   concentric:'Make Concentric — two circles or arcs share one centre; the first picked stays, radii unchanged',
 }
 const active=(t:string)=>!presentation.tool&&d.tool===t
 return <div className="sketch-controls">
  <div className="sketch-entry-row"><button data-test="sketch-extract" onClick={()=>{tool('select');useSketchBrush.getState().setOpen(true)}}>Extract primitives</button><button data-test="sketch-assist" title="Fit section chains using the existing segmentation and fit options" disabled={!chainsOf()?.chains.length} onClick={()=>setAssist(true)}>Sketch assist</button></div>
  <div className="sketch-section-label">Create</div>
  <div className="sketch-command-row create" data-test="sketch-tools">
   {key('line','Line','sketch-tool-line',()=>{presentation.setLineChain(false);tool('line')},active('line')&&!presentation.lineChain)}
   {key('polyline','Polyline','sketch-tool-polyline',()=>{presentation.setLineChain(true);tool('line')},active('line')&&presentation.lineChain)}
   {key('circle3','Circle - 3 Points','sketch-tool-circle-three',()=>{prefs.setDrawMode('circle','threePoint');tool('circle')},active('circle')&&prefs.drawModes.circle==='threePoint')}
   {key('circle','Circle - Centre, Radius','sketch-tool-circle',()=>{prefs.setDrawMode('circle','center');tool('circle')},active('circle')&&prefs.drawModes.circle==='center')}
   {key('tangentArc','Tangent Arc — start anywhere and set a tangent direction, or start at a line end','sketch-tool-tangent-arc',()=>extra('tangentArc'),presentation.tool==='tangentArc')}
   {key('arc','Arc — start, end, point on arc','sketch-tool-arc',()=>{prefs.setDrawMode('arc','threePoint');tool('arc')},active('arc'))}
   {key('spline','Freeform Curve','sketch-tool-spline',()=>tool('spline'),active('spline'))}
   {key('middle','Middle Line of two lines','sketch-tool-middle',()=>{if(d.selection.length===2)middleLineSketchSelection();else extra('middle')},presentation.tool==='middle')}
   {key('rectangle','Rectangle','sketch-tool-rectangle',()=>{prefs.setDrawMode('rectangle','corners');tool('rectangle')},active('rectangle'))}
   {key('slot','Slot — two centres, then width','sketch-tool-slot',()=>extra('slot'),presentation.tool==='slot')}
   {key('hexagon','Hexagon','sketch-tool-polygon',()=>{prefs.setPolygonSides(6);tool('polygon')},active('polygon'))}
  </div>
  <div className="sketch-section-label">Modify</div>
  <div className="sketch-command-row modify" data-test="sketch-edit">
   {key('select','Modify — select and drag sketch entities','sketch-tool-select',()=>tool('select'),active('select'))}
   {key('join','Auto Join — join eligible nearby ends','sketch-join',()=>re.joinSelected())}
   {key('corner','Corner Trim','sketch-sharpen',()=>{tool('select');useSketchProject.getState().setOpen(false);useSketchCornerTrim.getState().setOpen(true)})}
   {key('trim','Trim (T) — paint unwanted spans between intersections','sketch-trim',()=>extra('trim'),presentation.tool==='trim')}
   {key('dimension','Dimensions (D)','sketch-dimension',dimensionSketchSelection,active('dimension'))}
   {key('mirror','Mirror selected entities (M) — then pick the mirror line','sketch-mirror',mirrorSelectedSketchEntities,false,!has)}
   {key('duplicate','Duplicate selected entities','sketch-duplicate',()=>openSketchEditPanel(edit==='duplicate'?null:'duplicate'),edit==='duplicate',!has)}
   {key('offset','Offset selected entities (O)','sketch-offset-entities',()=>openSketchEditPanel(edit==='offset'?null:'offset'),edit==='offset',!has)}
   {key('fillet','Fillet','sketch-tool-fillet',()=>{if(d.selection.length===2)re.filletSelected();else tool('fillet')},active('fillet'))}
   {key('project','Project other visible sketches','sketch-tool-project',()=>{tool('select');useSketchCornerTrim.getState().setOpen(false);useSketchProject.getState().setOpen(true)})}
  </div>
  {edit&&<div className="sketch-edit-values" data-test="sketch-edit-values">
   {edit==='offset'?<label>Offset <input data-test="sketch-offset-distance" type="number" value={len.toDisplay(distance)} step={len.step(0.1)} onChange={e=>setDistance(len.fromDisplay(Number(e.target.value)))}/> {len.word()} <button onClick={()=>setDistance(-distance)}>Flip</button></label>:<><label>X ({len.word()}) <input data-test="sketch-duplicate-x" type="number" value={len.toDisplay(dx)} onChange={e=>setDuplicateDelta([len.fromDisplay(Number(e.target.value)),dy])}/></label><label>Y ({len.word()}) <input data-test="sketch-duplicate-y" type="number" value={len.toDisplay(dy)} onChange={e=>setDuplicateDelta([dx,len.fromDisplay(Number(e.target.value))])}/></label></>}
   {edit==='duplicate'&&<button data-test="sketch-duplicate-pattern" title="Linear, Circular, Angular or Along-curve copies, previewed" onClick={()=>{setEdit(null);openSketchPatternPanel()}}>Pattern…</button>}<button data-test="sketch-edit-apply" onClick={()=>{if(edit==='offset'?offsetSketchSelection(distance):duplicateSketchSelection([dx,dy]))setEdit(null)}}>Apply</button><button onClick={()=>setEdit(null)}>Cancel</button>
  </div>}
  <div className="sketch-section-label">Constraints</div>
  <div className="sketch-command-row constraints" data-test="sketch-relations">
   {key('construction','For Construction','sketch-construction',()=>re.toggleConstructionSelected(),has&&d.selection.every(id=>entityOf(d.sketch,id)?.construction),!has)}
   {key('fix','Fix Position','sketch-fix',()=>re.toggleFixedSelected(),has&&d.selection.every(id=>entityOf(d.sketch,id)?.fixed),!has)}
   {(['coincident','concentric','horizontal','vertical','tangent','collinear','equal','parallel','perpendicular','symmetric'] as const).map(kind=>{
     const label=RELATION_TIPS[kind]??(kind==='collinear'?'Make Colinear':`Make ${kind[0].toUpperCase()+kind.slice(1)}`)
     const ok=applies(kind)
     return key(kind,ok?label:`${label} — does not apply to the selection`,`sketch-rel-${kind}`,()=>relation(kind),d.tool==='relation'&&d.armedRelation===kind,!ok)
   })}
  </div>
  <div className="sketch-selection-count" data-test="sketch-selection-count">{d.selection.length>0?`${d.selection.length} selected`:''}</div>
  <fieldset className="sketch-display"><legend>Display</legend>
   <div className="sketch-entry-row"><button data-test="sketch-clip" aria-pressed={sliced} onClick={()=>re.setSketchSliced(!sliced)}>Clip</button><button data-test="sketch-normal" onClick={()=>window.dispatchEvent(new Event('quickscan-sketch-normal'))}>Normal to sketch</button><button data-test="sketch-open-measure" onClick={() => useMeasureTool.getState().setOpen(true)}>Measure</button></div>
   <label className="sketch-lock"><input type="checkbox" checked readOnly title="The sketch sheet remains normal to its plane"/>Lock view</label>
   <div className="sketch-display-grid">
    <label><input data-test="sketch-show-control-points" type="checkbox" checked={prefs.sketchControlPoints} onChange={e=>prefs.setSketchControlPoints(e.target.checked)}/>Control Points</label>
    <label title="A 3D sketch manipulator is not implemented"><input type="checkbox" disabled/>Manipulator</label>
    <label title="A comb along each arc, circle and spline: tooth length is the curvature there"><input data-test="sketch-curvature" type="checkbox" checked={comb.on} onChange={e=>comb.setOn(e.target.checked)}/>Curvature</label><span style={{display:'flex',gap:4,alignItems:'center',minWidth:0}}><input data-test="sketch-curvature-scale" style={{flex:1,minWidth:0}} type="range" min={5} max={500} step={5} value={comb.scale} disabled={!comb.on} aria-label="Curvature comb scale" onChange={e=>comb.setScale(Number(e.target.value))}/><button data-test="sketch-curvature-options" aria-expanded={comb.optionsOpen} onClick={()=>comb.set({optionsOpen:!comb.optionsOpen})}>Options …</button></span>
    <label title="Colour each portion of the sketch by its distance from the scan's section"><input data-test="sketch-analysis" type="checkbox" checked={analysis.on} onChange={e=>analysis.setOn(e.target.checked)}/>Analysis</label><button data-test="sketch-analysis-options" aria-expanded={analysis.optionsOpen} onClick={()=>analysis.setOptionsOpen(!analysis.optionsOpen)}>Options …</button>
    <label><input data-test="sketch-show-relations" type="checkbox" checked={prefs.sketchRelations} onChange={e=>prefs.setSketchRelations(e.target.checked)}/>Constraints</label>
    <label><input data-test="sketch-show-dimensions" type="checkbox" checked={prefs.sketchDimensions} onChange={e=>prefs.setSketchDimensions(e.target.checked)}/>Dimensions</label>
   </div>
  </fieldset>
  {comb.optionsOpen&&<fieldset className="sketch-display" data-test="sketch-curvature-options-panel"><legend>Curvature options</legend>
   <CombField label="Scale" value={comb.scale} kind="plain" testId="sketch-curvature-scale-value" unit="×" onValue={v=>comb.set({scale:v})}/>
   <CombField label="Density" value={comb.density} kind="count" testId="sketch-curvature-density" unit="teeth" onValue={v=>comb.set({density:v})}/>
   <CombField label="Max length (at 50×)" value={comb.maxLength} kind="length" testId="sketch-curvature-max" onValue={v=>comb.set({maxLength:v})}/>
   <CombField label="Noise filter" value={comb.smooth} kind="count0" testId="sketch-curvature-smooth" unit="± samples" onValue={v=>comb.set({smooth:v})}/>
   <div className="sketch-entry-row">
    <label title="Teeth point out of each bend and cross over at an inflection"><input type="checkbox" data-test="sketch-curvature-signed" checked={comb.signed} onChange={e=>comb.set({signed:e.target.checked})}/>Signed</label>
    <label title="Label the smallest radius on each curved piece"><input type="checkbox" data-test="sketch-curvature-labels" checked={comb.labels} onChange={e=>comb.set({labels:e.target.checked})}/>Labels</label>
   </div>
   <label><input type="checkbox" data-test="sketch-curvature-offset-on" checked={comb.offsetOn} onChange={e=>comb.set({offsetOn:e.target.checked})}/>Offset reference line</label>
   <div>
    <CombField label="Offset" value={comb.offset} kind="length" testId="sketch-curvature-offset" disabled={!comb.offsetOn} onValue={v=>comb.set({offset:v})}/>
   </div>
  </fieldset>}
  {analysis.optionsOpen&&<fieldset className="sketch-display" data-test="sketch-analysis-options-panel"><legend>Analysis options</legend>
   <ToleranceField/>
   <div role="radiogroup" aria-label="Analysis colouring" className="sketch-entry-row">
    {([['passFail','Pass / Fail'],['gradient','Gradient']] as const).map(([mode,label])=><label key={mode}><input type="radio" name="sketch-analysis-mode" data-test={`sketch-analysis-mode-${mode}`} checked={analysis.mode===mode} onChange={()=>analysis.setMode(mode)}/>{label}</label>)}
   </div>
  </fieldset>}
  {analysis.on&&(()=>{
   const chains=chainsOf()?.chains??[]
   const tol=analysis.toleranceMm
   const result=d.sketch.entities.some(e=>!e.construction&&e.kind!=='point')&&chains.length?sketchDeviation(d.sketch,chains,tol):null
   if(!result||!result.stats.samples)return <p className="hint" data-test="sketch-analysis-result">Analysis: draw on the section first.</p>
   const st=result.stats
   const swatch=(color:string)=><span aria-hidden style={{display:'inline-block',width:10,height:10,borderRadius:2,background:color,margin:'0 4px -1px 0'}}/>
   return <div className="hint" data-test="sketch-analysis-result">
    <div data-test="sketch-analysis-legend">{analysis.mode==='passFail'
     ?<>{swatch(PASS_COLOR)}within ±{len.fmt(tol,4)} &nbsp; {swatch(FAIL_COLOR)}outside</>
     :<>{swatch(gradientColor(0))}0 &nbsp; {swatch(gradientColor(1))}±{len.fmt(tol,4)} &nbsp; {swatch(gradientColor(2))}≥ {len.fmt(2*tol,4)}</>}</div>
    <div data-test="sketch-analysis-stats">Min {len.fmt(st.min,4)} · max {len.fmt(st.max,4)} · mean {len.fmt(st.mean,4)} · RMS {len.fmt(st.rms,4)}</div>
    <div data-test="sketch-analysis-pass">{(st.passShare*100).toFixed(1)} % of the length within tolerance{st.failing.length?` · ${st.failing.length} ${st.failing.length===1?'piece':'pieces'} outside`:''}{st.unread?` · ${st.unread} samples with no section within ${len.fmt(result.reach,3)}`:''}</div>
   </div>
  })()}
  <button className="sketch-overdefined" data-test="sketch-overdefined" disabled={!d.report?.unmet.length} onClick={()=>{const ids=re.overdefining();if(!ids.length)return;re.selectConstraint(ids[0]);setOverdefining(ids)}}>Select overdefining constraints</button>
  {overdefining&&d.report&&!d.report.ok&&<div className="sketch-overdefined-ask" data-test="sketch-overdefined-ask" role="alertdialog" aria-label="Sketch">
   <p>{overdefining.length} constraint{overdefining.length===1?'':'s'} overdefine{overdefining.length===1?'s':''} the sketch. Do you want to delete {overdefining.length===1?'it':'them'}?</p>
   <div className="sketch-entry-row"><button data-test="sketch-overdefined-yes" onClick={()=>{re.removeConstraints(overdefining);setOverdefining(null)}}>Yes</button><button data-test="sketch-overdefined-no" onClick={()=>setOverdefining(null)}>No</button></div>
  </div>}
  <div className="sketch-section-label">Sketch Reference points</div>
  <div className="sketch-entry-row"><button data-test="sketch-reference-clear" disabled={!chainsOf()?.chains.length} onClick={()=>{const sketch=cloneSketch(d.sketch);sketch.referenceChains=[];re.setSketch(sketch)}}>Clear</button><button disabled title="Reference-point cleanup behavior is still being compared with QUICKSURFACE">Clean up reference points …</button></div>
  {assist&&<SketchAssistDialog chains={chainsOf()?.chains??[]} onClose={()=>setAssist(false)}/>}
  <div className="sketch-section-label">{SKETCH_EXPORT_FORMATS[exportFormat]}</div>
  <div className="sketch-entry-row"><button data-test="sketch-export-iges" disabled={!d.sketch.entities.some(e=>!e.construction&&e.kind!=='point')} title="Export sketch geometry in its local XY coordinates" onClick={()=>{const name=(d.name||'sketch').replace(/[^\w.-]+/g,'_');const out=exportSketch(d.sketch.entities,exportFormat,name);saveFile(`${name}.${out.extension}`,new Blob([out.text],{type:out.mime}))}}>Export …</button><button data-test="sketch-export-options" onClick={()=>{setDraftFormat(exportFormat);setExportOptions(true)}}>Options …</button></div>
  {exportOptions&&createPortal(<div className="modalback" onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();setExportOptions(false)}}}>
    <form className="modal" role="dialog" aria-modal="true" aria-label="Export Sketch Options" data-test="sketch-export-options-dialog" style={{width:360,padding:14,display:'grid',gap:12}}
      onSubmit={e=>{e.preventDefault();e.stopPropagation();setExportFormat(draftFormat);setExportOptions(false)}}>
      <header>Export Sketch Options</header>
      <select autoFocus aria-label="Sketch export format" value={draftFormat} onChange={e=>setDraftFormat(e.target.value as SketchExportFormat)}>
        {Object.entries(SKETCH_EXPORT_FORMATS).map(([key,label])=><option key={key} value={key}>{label}</option>)}
      </select>
      <footer style={{display:'flex',gap:8,justifyContent:'flex-end'}}><button type="button" onClick={()=>setExportOptions(false)}>Cancel</button><button type="submit" data-test="sketch-export-options-ok">OK</button></footer>
    </form></div>,document.body)}
 </div>
}

/** A number of the curvature options: a length in the units shown, a
 *  plain factor, or a whole count. Valid values are taken at once; the
 *  field follows the units when they change. */
function CombField({label,value,kind,testId,unit,disabled,onValue}:{label:string;value:number;kind:'length'|'plain'|'count'|'count0';testId:string;unit?:string;disabled?:boolean;onValue:(v:number)=>void}){
 const len=useLength()
 const shown=()=>String(Number((kind==='length'?len.toDisplay(value):value).toFixed(6)))
 const [text,setText]=useState(shown)
 const word=kind==='length'?len.word():unit??''
 const [seen,setSeen]=useState(word)
 if(seen!==word){setSeen(word);setText(shown())}
 const parse=(t:string)=>{const n=Number(t);if(t.trim()===''||!Number.isFinite(n))return null
  if(kind==='count')return Number.isInteger(n)&&n>=4&&n<=2000?n:null
  if(kind==='count0')return Number.isInteger(n)&&n>=0&&n<=20?n:null
  return n>0?(kind==='length'?len.fromDisplay(n):n):null}
 const [last,setLast]=useState(value)
 if(last!==value){setLast(value);const v=parse(text);if(v===null||Math.abs(v-value)>1e-9*Math.max(1,Math.abs(value)))setText(shown())}
 const bad=parse(text)===null
 return <label className="field"><span>{label}</span><input data-test={testId} type="number" disabled={disabled} aria-invalid={bad} value={text}
  onChange={e=>{const t=e.currentTarget.value;setText(t);const v=parse(t);if(v!==null)onValue(v)}} onBlur={()=>{if(bad)setText(shown())}}/><span>{word}</span></label>
}

/** The analysis tolerance, typed in the units shown. The text is the
 *  field's own while it is typed; a valid number is taken at once, and the
 *  field follows the units when they change. */
function ToleranceField() {
 const len=useLength()
 const tol=useSketchAnalysis(s=>s.toleranceMm), setTol=useSketchAnalysis(s=>s.setToleranceMm)
 const shown=()=>String(Number(len.toDisplay(tol).toFixed(6)))
 const [text,setText]=useState(shown)
 const unit=len.word()
 const [seen,setSeen]=useState(unit)
 if(seen!==unit){setSeen(unit);setText(shown())}
 const v=Number(text), bad=text.trim()===''||!Number.isFinite(v)||v<=0
 return <label className="field"><span>Tolerance ±</span><input data-test="sketch-analysis-tolerance" type="number" min={0} step={len.step(0.01)} value={text} aria-invalid={bad}
  onChange={e=>{const t=e.currentTarget.value;setText(t);const n=Number(t);if(t.trim()!==''&&Number.isFinite(n)&&n>0)setTol(len.fromDisplay(n))}}
  onBlur={()=>{if(bad)setText(shown())}}/><span>{unit}</span></label>
}
