// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import type { SketchChains } from '../app/useReverseWorkspace'
import { addConstraint, cloneSketch, entityOf, type ConstraintKind } from '../core/sketch'
import { useReverse } from '../state/reStore'
import { useRePrefs } from '../state/rePrefs'
import { useSketchBrush } from '../state/sketchBrushStore'
import { useSketchPresentation } from '../state/sketchPresentation'
import { mirrorSketchSelection, duplicateSketchSelection, offsetSketchSelection, middleLineSketchSelection } from '../state/sketchExtraTools'
import { SketchCommandIcon, type SketchCommandIconName } from './SketchCommandIcon'

export function SketchControls({chainsOf}:{chainsOf:()=>SketchChains|null}) {
 const d = useReverse(s=>s.sketchDraft), sliced=useReverse(s=>s.sketchSliced)
 const prefs=useRePrefs(), presentation=useSketchPresentation()
 const [edit,setEdit]=useState<'offset'|'duplicate'|null>(null), [distance,setDistance]=useState(1), [dx,setDx]=useState(10),[dy,setDy]=useState(10)
 if(!d)return null
 const re=useReverse.getState(), has=d.selection.length>0
 const tool=(t:Parameters<typeof re.setSketchTool>[0])=>{presentation.setTool(null);useSketchBrush.getState().setOpen(false);re.setSketchTool(t)}
 const extra=(t:'slot'|'middle'|'trim'|'tangentArc')=>{tool('select');presentation.setTool(t)}
 const key=(icon:SketchCommandIconName,label:string,id:string,action:()=>void,on=false,disabled=false)=><button key={id} type="button" data-test={id} aria-label={label} title={label} aria-pressed={on} className={on?'on':undefined} disabled={disabled} onClick={action}><SketchCommandIcon name={icon}/></button>
 const relation=(kind:ConstraintKind)=>{
   presentation.setTool(null)
   if(kind==='collinear') {
    if(d.selection.length<2){re.armRelation('coincident');return}
    const lines=d.selection.map(id=>entityOf(d.sketch,id))
    if(lines.some(e=>e?.kind!=='line')) {useReverse.setState({sketchDraft:{...d,error:'Collinear takes two or more lines.'}});return}
    const sketch=cloneSketch(d.sketch)
    for(const e of lines.slice(1)) addConstraint(sketch,{kind:'collinear',line:lines[0]!.id,on:{line:e!.id}})
    re.setSketch(sketch);return
   }
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
   {key('join','Auto Join — join the nearest selected endpoints','sketch-join',()=>re.joinSelected(),false,d.selection.length!==2)}
   {key('fillet','Fillet','sketch-tool-fillet',()=>{if(d.selection.length===2)re.filletSelected();else tool('fillet')},active('fillet'))}
   {key('trim','Trim — paint unwanted spans between intersections','sketch-trim',()=>extra('trim'),presentation.tool==='trim')}
   {key('dimension','Dimensions (D)','sketch-dimension',()=>{presentation.setTool(null);if(has)re.dimensionSelection();else tool('dimension')},active('dimension'))}
   {key('mirror','Mirror selected entities — include a construction line','sketch-mirror',()=>mirrorSketchSelection(),false,!has)}
   {key('duplicate','Duplicate selected entities','sketch-duplicate',()=>setEdit(edit==='duplicate'?null:'duplicate'),edit==='duplicate',!has)}
   {key('offset','Offset selected entities','sketch-offset-entities',()=>setEdit(edit==='offset'?null:'offset'),edit==='offset',!has)}
   {key('corner','Corner Trim — remove selected fillet or chamfer','sketch-sharpen',()=>re.sharpenSelected(),false,!has)}
   {key('project','Project another sketch or body edge','sketch-tool-project',()=>tool('project'),active('project'))}
  </div>
  {edit&&<div className="sketch-edit-values" data-test="sketch-edit-values">
   {edit==='offset'?<label>Offset <input data-test="sketch-offset-distance" type="number" value={distance} step="0.1" onChange={e=>setDistance(Number(e.target.value))}/> mm <button onClick={()=>setDistance(-distance)}>Flip</button></label>:<><label>X <input data-test="sketch-duplicate-x" type="number" value={dx} onChange={e=>setDx(Number(e.target.value))}/></label><label>Y <input data-test="sketch-duplicate-y" type="number" value={dy} onChange={e=>setDy(Number(e.target.value))}/></label></>}
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
    <label title="Curvature comb display is not implemented"><input type="checkbox" disabled/>Curvature</label><button disabled>Options …</button>
    <label title="Sketch deviation analysis is not implemented"><input type="checkbox" disabled/>Analysis</label><button disabled>Options …</button>
    <label><input data-test="sketch-show-relations" type="checkbox" checked={prefs.sketchRelations} onChange={e=>prefs.setSketchRelations(e.target.checked)}/>Constraints</label>
    <label><input data-test="sketch-show-dimensions" type="checkbox" checked={prefs.sketchDimensions} onChange={e=>prefs.setSketchDimensions(e.target.checked)}/>Dimensions</label>
   </div>
  </fieldset>
  <button className="sketch-overdefined" data-test="sketch-overdefined" disabled={!d.report?.unmet.length} onClick={()=>{const id=d.report?.unmet[0]?.id;if(id!==undefined)re.selectConstraint(id)}}>Select overdefining constraints</button>
 </div>
}
