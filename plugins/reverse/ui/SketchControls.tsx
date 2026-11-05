// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import type { SketchChains } from '../app/useReverseWorkspace'
import { cloneSketch, entityOf, nearestOnEntity, type ConstraintKind } from '../core/sketch'
import { useReverse } from '../state/reStore'
import { useRePrefs } from '../state/rePrefs'
import { useSketchBrush } from '../state/sketchBrushStore'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'
import { useSketchProject } from '../state/sketchProjectStore'
import { useSketchPresentation } from '../state/sketchPresentation'
import { mirrorSketchSelection, duplicateSketchSelection, offsetSketchSelection, middleLineSketchSelection } from '../state/sketchExtraTools'
import { SketchCommandIcon, type SketchCommandIconName } from './SketchCommandIcon'
import { useLength } from '../../../src/app/useUnits'
import { saveFile } from '../../../src/app/exports'
import { sketchToIges } from '../core/igesExport'
import { useSketchCurvature } from '../state/sketchCurvatureStore'

export function SketchControls({chainsOf}:{chainsOf:()=>SketchChains|null}) {
 const d = useReverse(s=>s.sketchDraft), sliced=useReverse(s=>s.sketchSliced)
 const prefs=useRePrefs(), presentation=useSketchPresentation()
 // Analysis: how far the scan's section points lie from the drawn sketch.
 const [analysis,setAnalysis]=useState(false)
 const len=useLength()
 const comb=useSketchCurvature()
 const [edit,setEdit]=useState<'offset'|'duplicate'|null>(null), [distance,setDistance]=useState(1), [dx,setDx]=useState(10),[dy,setDy]=useState(10)
 if(!d)return null
 const re=useReverse.getState(), has=d.selection.length>0
 const tool=(t:Parameters<typeof re.setSketchTool>[0])=>{presentation.setTool(null);useSketchBrush.getState().setOpen(false);re.setSketchTool(t)}
 const extra=(t:'slot'|'middle'|'trim'|'tangentArc')=>{tool('select');presentation.setTool(t)}
 const key=(icon:SketchCommandIconName,label:string,id:string,action:()=>void,on=false,disabled=false)=><button key={id} type="button" data-test={id} aria-label={label} title={label} aria-pressed={on} className={on?'on':undefined} disabled={disabled} onClick={action}><SketchCommandIcon name={icon}/></button>
 const relation=(kind:ConstraintKind)=>{
   presentation.setTool(null)
   if(has)re.addRelation(kind);else re.armRelation(kind)
 }
 const active=(t:string)=>!presentation.tool&&d.tool===t
 return <div className="sketch-controls">
  <div className="sketch-entry-row"><button data-test="sketch-extract" onClick={()=>{presentation.setTool(null);re.setSketchTool('select');useSketchBrush.getState().setOpen(true)}}>Extract primitives</button><button data-test="sketch-assist" title="Fit section chains using the existing segmentation and fit options" disabled={!chainsOf()?.chains.length} onClick={()=>{const c=chainsOf();if(c)re.autoFit(c.chains,'all',prefs.fitOptions)}}>Sketch assist</button></div>
  <div className="sketch-section-label">Create</div>
  <div className="sketch-command-row create" data-test="sketch-tools">
   {key('line','Line','sketch-tool-line',()=>{presentation.setLineChain(false);tool('line')},active('line')&&!presentation.lineChain)}
   {key('polyline','Polyline','sketch-tool-polyline',()=>{presentation.setLineChain(true);tool('line')},active('line')&&presentation.lineChain)}
   {key('circle3','Circle - 3 Points','sketch-tool-circle-three',()=>{prefs.setDrawMode('circle','threePoint');tool('circle')},active('circle')&&prefs.drawModes.circle==='threePoint')}
   {key('circle','Circle - Centre, Radius','sketch-tool-circle',()=>{prefs.setDrawMode('circle','center');tool('circle')},active('circle')&&prefs.drawModes.circle==='center')}
   {key('tangentArc','Tangent Arc — pick a line end, then the arc end','sketch-tool-tangent-arc',()=>extra('tangentArc'),presentation.tool==='tangentArc')}
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
   {key('trim','Trim — paint unwanted spans between intersections','sketch-trim',()=>extra('trim'),presentation.tool==='trim')}
   {key('dimension','Dimensions (D)','sketch-dimension',()=>{presentation.setTool(null);if(has)re.dimensionSelection();else tool('dimension')},active('dimension'))}
   {key('mirror','Mirror selected entities — include a construction line','sketch-mirror',()=>mirrorSketchSelection(),false,!has)}
   {key('duplicate','Duplicate selected entities','sketch-duplicate',()=>setEdit(edit==='duplicate'?null:'duplicate'),edit==='duplicate',!has)}
   {key('offset','Offset selected entities','sketch-offset-entities',()=>setEdit(edit==='offset'?null:'offset'),edit==='offset',!has)}
   {key('fillet','Fillet','sketch-tool-fillet',()=>{if(d.selection.length===2)re.filletSelected();else tool('fillet')},active('fillet'))}
   {key('project','Project other visible sketches','sketch-tool-project',()=>{tool('select');useSketchCornerTrim.getState().setOpen(false);useSketchProject.getState().setOpen(true)})}
  </div>
  {edit&&<div className="sketch-edit-values" data-test="sketch-edit-values">
   {edit==='offset'?<label>Offset <input data-test="sketch-offset-distance" type="number" value={len.toDisplay(distance)} step={len.step(0.1)} onChange={e=>setDistance(len.fromDisplay(Number(e.target.value)))}/> {len.word()} <button onClick={()=>setDistance(-distance)}>Flip</button></label>:<><label>X ({len.word()}) <input data-test="sketch-duplicate-x" type="number" value={len.toDisplay(dx)} onChange={e=>setDx(len.fromDisplay(Number(e.target.value)))}/></label><label>Y ({len.word()}) <input data-test="sketch-duplicate-y" type="number" value={len.toDisplay(dy)} onChange={e=>setDy(len.fromDisplay(Number(e.target.value)))}/></label></>}
   <button data-test="sketch-edit-apply" onClick={()=>{if(edit==='offset'?offsetSketchSelection(distance):duplicateSketchSelection([dx,dy]))setEdit(null)}}>Apply</button><button onClick={()=>setEdit(null)}>Cancel</button>
  </div>}
  <div className="sketch-section-label">Constraints</div>
  <div className="sketch-command-row constraints" data-test="sketch-relations">
   {key('construction','For Construction','sketch-construction',()=>re.toggleConstructionSelected(),has&&d.selection.every(id=>entityOf(d.sketch,id)?.construction),!has)}
   {key('fix','Fix Position','sketch-fix',()=>re.toggleFixedSelected(),has&&d.selection.every(id=>entityOf(d.sketch,id)?.fixed),!has)}
   {(['horizontal','vertical','tangent','collinear','equal','parallel','perpendicular','symmetric'] as const).map(kind=>key(kind,kind==='collinear'?'Make Colinear':`Make ${kind[0].toUpperCase()+kind.slice(1)}`,`sketch-rel-${kind}`,()=>relation(kind),d.tool==='relation'&&d.armedRelation===kind))}
  </div>
  <div className="sketch-selection-count" data-test="sketch-selection-count">{d.selection.length>0?`${d.selection.length} selected`:''}</div>
  <fieldset className="sketch-display"><legend>Display</legend>
   <div className="sketch-entry-row"><button data-test="sketch-clip" aria-pressed={sliced} onClick={()=>re.setSketchSliced(!sliced)}>Clip</button><button data-test="sketch-normal" onClick={()=>window.dispatchEvent(new Event('quickscan-sketch-normal'))}>Normal to sketch</button></div>
   <label className="sketch-lock"><input type="checkbox" checked readOnly title="The sketch sheet remains normal to its plane"/>Lock view</label>
   <div className="sketch-display-grid">
    <label><input data-test="sketch-show-control-points" type="checkbox" checked={prefs.sketchControlPoints} onChange={e=>prefs.setSketchControlPoints(e.target.checked)}/>Control Points</label>
    <label title="A 3D sketch manipulator is not implemented"><input type="checkbox" disabled/>Manipulator</label>
    <label title="A comb along each arc, circle and spline: tooth length is the curvature there"><input data-test="sketch-curvature" type="checkbox" checked={comb.on} onChange={e=>comb.setOn(e.target.checked)}/>Curvature</label><input data-test="sketch-curvature-scale" type="range" min={5} max={500} step={5} value={comb.scale} disabled={!comb.on} aria-label="Curvature comb scale" onChange={e=>comb.setScale(Number(e.target.value))}/>
    <label title="How far the scan's section points lie from the sketch"><input data-test="sketch-analysis" type="checkbox" checked={analysis} onChange={e=>setAnalysis(e.target.checked)}/>Analysis</label><button disabled title="No analysis options yet">Options …</button>
    <label><input data-test="sketch-show-relations" type="checkbox" checked={prefs.sketchRelations} onChange={e=>prefs.setSketchRelations(e.target.checked)}/>Constraints</label>
    <label><input data-test="sketch-show-dimensions" type="checkbox" checked={prefs.sketchDimensions} onChange={e=>prefs.setSketchDimensions(e.target.checked)}/>Dimensions</label>
   </div>
  </fieldset>
  {analysis&&(()=>{
   const drawn=d.sketch.entities.filter(e=>!e.construction)
   const pts=(chainsOf()?.chains??[]).flat()
   if(!drawn.length||!pts.length)return <p className="hint" data-test="sketch-analysis-result">Analysis: draw on the section first.</p>
   let worst=0,sum=0
   for(const p of pts){let best=Infinity;for(const e of drawn){const q=nearestOnEntity(e,p).dist;if(q<best)best=q}if(best>worst)worst=best;sum+=best}
   return <p className="hint" data-test="sketch-analysis-result">Analysis: scan section to sketch — max {len.fmt(worst,3)}, mean {len.fmt(sum/pts.length,3)} over {pts.length} points.</p>
  })()}
  <button className="sketch-overdefined" data-test="sketch-overdefined" disabled={!d.report?.unmet.length} onClick={()=>{const id=d.report?.unmet[0]?.id;if(id!==undefined)re.selectConstraint(id)}}>Select overdefining constraints</button>
  <div className="sketch-section-label">Sketch Reference points</div>
  <div className="sketch-entry-row"><button data-test="sketch-reference-clear" disabled={!chainsOf()?.chains.length} onClick={()=>{const sketch=cloneSketch(d.sketch);sketch.referenceChains=[];re.setSketch(sketch)}}>Clear</button><button disabled title="Reference-point cleanup behavior is still being compared with QUICKSURFACE">Clean up reference points …</button></div>
  <div className="sketch-section-label">Export in IGES</div>
  <div className="sketch-entry-row"><button data-test="sketch-export-iges" disabled={!d.sketch.entities.some(e=>!e.construction&&e.kind!=='point')} title="Save the sketch's lines, arcs and circles as an IGES file, placed on the sketch plane" onClick={()=>{const name=(d.name||'sketch').replace(/[^\w.-]+/g,'_');saveFile(`${name}.igs`,new Blob([sketchToIges(d.sketch.entities,d.frame,name)],{type:'model/iges'}))}}>Export …</button><button disabled title="No IGES options yet">Options …</button></div>
 </div>
}
