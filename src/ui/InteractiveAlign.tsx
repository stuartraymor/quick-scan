// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect,useState} from 'react'
import {useInteractiveAlign,type InteractiveAxis,type MirrorPlane} from '../state/interactiveAlignStore'
import {useStore} from '../state/store'
import {useLength} from '../app/useUnits'
import type {Rigid} from '../core/deviation/rigid'
export function InteractiveAlign({onApply,onCurrentView}:{onApply:(m:Rigid)=>void|Promise<boolean>;onCurrentView?:()=>void}){
 const s=useInteractiveAlign(),busy=useStore(v=>v.busy),len=useLength()
 const [rotateAxis,setRotateAxis]=useState<InteractiveAxis>('z'),[moveAxis,setMoveAxis]=useState<InteractiveAxis>('x')
 const [angle,setAngle]=useState('1'),[distance,setDistance]=useState('1'),[applying,setApplying]=useState(false)
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!useStore.getState().busy&&!applying){e.preventDefault();e.stopPropagation();useInteractiveAlign.getState().close()}}
  window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)
 },[applying])
 const apply=async()=>{if(busy||applying)return;setApplying(true);try{if(await onApply(s.rigid)!==false)useInteractiveAlign.getState().close()}finally{setApplying(false)}}
 const step=(kind:'rotate'|'move',sign:number)=>{
  const value=Number(kind==='rotate'?angle:distance)
  if(busy||applying||!Number.isFinite(value))return
  if(kind==='rotate')s.rotate(rotateAxis,value*sign);else s.move(moveAxis,len.fromDisplay(value)*sign)
 }
 return <form className="interactive-align" data-test="interactive-align" onSubmit={e=>{e.preventDefault();void apply()}}>
  <div>Active meshes: <b data-test="interactive-mesh-count">1</b></div>
  <label className="interactive-strength">Drag Strength<input data-test="interactive-strength" aria-label="Drag Strength" type="range" min="0" max="1" step="0.01" value={s.strength} onChange={e=>s.setStrength(Number(e.target.value))}/></label>
  <label className="checkrow"><input data-test="interactive-mirror" type="checkbox" checked={s.mirror} disabled={busy||applying} onChange={e=>s.setMirror(e.target.checked)}/>Show mirrored mesh<select data-test="interactive-mirror-plane" disabled={!s.mirror||busy||applying} aria-label="Mirror plane" value={s.mirrorPlane} onChange={e=>s.setMirrorPlane(e.target.value as MirrorPlane)}>{(['OYZ','OXZ','OXY'] as const).map(p=><option key={p}>{p}</option>)}</select></label>
  <button type="button" className="block" data-test="interactive-current-view" aria-pressed={s.asView} disabled={!onCurrentView||busy||applying} onClick={onCurrentView}>As Current View</button>
  <fieldset disabled={busy||applying}><legend>Manual</legend>
   <label className="field"><span>Rotate around</span><select data-test="interactive-rotate-axis" value={rotateAxis} onChange={e=>setRotateAxis(e.target.value as InteractiveAxis)}>{(['x','y','z'] as const).map(a=><option key={a} value={a}>{a.toUpperCase()} Axis</option>)}</select></label>
   <div className="interactive-step"><input data-test="interactive-angle" aria-label="Rotation increment" type="number" step="any" value={angle} onChange={e=>setAngle(e.target.value)}/><span>degrees</span><button type="button" data-test="interactive-rotate-minus" onClick={()=>step('rotate',-1)}>&lt;&lt;</button><button type="button" data-test="interactive-rotate-plus" onClick={()=>step('rotate',1)}>&gt;&gt;</button></div>
   <label className="field"><span>Move along</span><select data-test="interactive-move-axis" value={moveAxis} onChange={e=>setMoveAxis(e.target.value as InteractiveAxis)}>{(['x','y','z'] as const).map(a=><option key={a} value={a}>{a.toUpperCase()} Direction</option>)}</select></label>
   <div className="interactive-step"><input data-test="interactive-distance" aria-label="Movement increment" type="number" step="any" value={distance} onChange={e=>setDistance(e.target.value)}/><span>{len.word()}</span><button type="button" data-test="interactive-move-minus" onClick={()=>step('move',-1)}>&lt;&lt;</button><button type="button" data-test="interactive-move-plus" onClick={()=>step('move',1)}>&gt;&gt;</button></div>
  </fieldset>
  <footer><span title="Drag a colored arrow to move, or an arc to rotate the scan">?</span><button type="submit" data-test="interactive-apply" disabled={busy||applying}>OK</button><button type="button" data-test="interactive-cancel" disabled={busy||applying} onClick={s.close}>Cancel</button></footer>
 </form>
}
