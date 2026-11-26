// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { Euler, Vector3 } from 'three'
import { BASE_PLANES } from '../core/basePlanes'
import type { Vec3 } from '../core/types'
import { useStore } from '../state/store'
import { useLength } from '../app/useUnits'

type Seed = { normal: Vec3; point: Vec3 }
export function PrepareSymmetry({rebuild}:{rebuild:(seed?:Seed)=>Promise<void>}) {
  const draft=useStore(s=>s.draft), center=useStore(s=>s.modelCenter), size=useStore(s=>s.modelSize)
  const [base,setBase]=useState(0), [angles,setAngles]=useState<Vec3>([0,0,0]), [offset,setOffset]=useState(0)
  const [strength,setStrength]=useState(80), [interactive,setInteractive]=useState(false)
  const [analyse,setAnalyse]=useState(false), [tolerance,setTolerance]=useState('0.05')
  const [reading,setReading]=useState('')
  const len=useLength()
  const seed=(axis=base,rot=angles,dist=offset):Seed=>{
    const n=new Vector3(...BASE_PLANES[axis].normal).applyEuler(new Euler(...rot.map(v=>v*Math.PI/180) as Vec3))
    return {normal:n.toArray(),point:new Vector3(...center).addScaledVector(n,dist).toArray()}
  }
  const preview=(axis=base,rot=angles,dist=offset)=>{
    const plane=seed(axis,rot,dist)
    useStore.getState().setDraftParams([...plane.normal,...plane.point])
    setReading('')
  }
  const dragStart=useRef<{y:number;offset:number}|null>(null)
  useEffect(()=>{
    if(!interactive) return
    const stage=document.querySelector<HTMLElement>('.viewport')
    if(!stage) return
    const down=(e:PointerEvent)=>{if(e.button!==0)return;e.stopImmediatePropagation(); stage.setPointerCapture(e.pointerId);dragStart.current={y:e.clientY,offset}}
    const move=(e:PointerEvent)=>{const start=dragStart.current;if(!start)return;e.stopImmediatePropagation()
      const v=start.offset+(start.y-e.clientY)*size*(strength/100)/Math.max(1,stage.clientHeight);setOffset(v);preview(base,angles,v)}
    const up=(e:PointerEvent)=>{if(!dragStart.current)return;e.stopImmediatePropagation();dragStart.current=null;if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId)}
    stage.addEventListener('pointerdown',down,true);stage.addEventListener('pointermove',move,true);stage.addEventListener('pointerup',up,true);stage.addEventListener('pointercancel',up,true)
    return ()=>{stage.removeEventListener('pointerdown',down,true);stage.removeEventListener('pointermove',move,true);stage.removeEventListener('pointerup',up,true);stage.removeEventListener('pointercancel',up,true)}
  },[interactive,base,angles,offset,strength,size,center])
  const working=draft?.status==='fitting'
  return <div className="scan-symmetry" data-test="prepare-symmetry">
    <div className="scan-planes">{BASE_PLANES.map((p,i)=><button key={p.id} aria-pressed={i===base} disabled={working} onClick={()=>{setBase(i);useStore.getState().setDraftSeed(p.id);preview(i)}}>
      <svg viewBox="0 0 32 32" width="35" height="35" aria-hidden="true"><path d="M5 3v21l20 6M5 24 27 13" fill="none" stroke="#444"/><path d={['m5 22 12-7 10 4-12 7Z','m5 22 12-7V5L5 12Z','m5 22 12 5V16L5 11Z'][i]} fill="#cfbda5" stroke="#777"/><text x="2" y="6" fontSize="6">Z</text></svg>O{p.name.slice(0,2)}</button>)}</div>
    <button aria-pressed={interactive} disabled={working} onClick={()=>{setInteractive(!interactive);preview()}}>Define Interactive</button>
    <label>Drag Strength<input aria-label="Drag Strength" type="range" min="1" max="100" value={strength} onChange={e=>setStrength(+e.target.value)}/></label>
    <span>Rotation</span>
    {angles.map((v,i)=><label key={i} className="scan-axis"><span>{'XYZ'[i]}</span><input aria-label={`Rotation ${'XYZ'[i]}`} type="number" step="0.1" value={v} disabled={working} onChange={e=>{
      const a:Vec3=[...angles];a[i]=Number(e.target.value);setAngles(a);preview(base,a)
    }}/>deg</label>)}
    <label className="scan-axis">Offset<input type="number" aria-label="Offset" step="any" value={Number(len.toDisplay(offset).toFixed(5))} disabled={working} onChange={e=>{const v=len.fromDisplay(Number(e.target.value));setOffset(v);preview(base,angles,v)}}/>{len.word()}</label>
    <button disabled={working} onClick={()=>void rebuild(seed())}>Rebuild</button>
    <div className="scan-sym-analysis"><label><input type="checkbox" checked={analyse} onChange={e=>setAnalyse(e.target.checked)}/>Analysis</label>
      <input aria-label="Analysis tolerance" type="number" min="0" step="any" disabled={!analyse} value={tolerance} onChange={e=>setTolerance(e.target.value)}/>{len.word()}
      <button disabled={!analyse || working} onClick={async()=>{await rebuild(seed());const rms=useStore.getState().draft?.params[6];if(rms!==undefined)setReading(`RMS ${len.fmt(rms,3)} · ${rms<=len.fromDisplay(+tolerance)?'Within':'Outside'} tolerance`)}}>Apply</button></div>
    {reading && <output>{reading}</output>}

  </div>
}
