// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import type { Vec3 } from '../../../src/core/types'
import { createBoundarySketch } from '../app/boundarySketches'
import { undo, useHistory } from '../../../src/state/historyStore'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { useMeshTools } from '../state/meshStore'
import { boundaryLoops, rimSphereDiameter } from '../core/boundary'
import type { RimOperation } from '../core/rimEdit'
import type { RimFillMethod } from '../core/fillHoles'
import { useRimOverlay, type RimHit, type RimMode } from './useRimOverlay'

export interface RimActions {
  change:(op:RimOperation)=>Promise<boolean>
  fill:(start:number|undefined,method:RimFillMethod,diameter:number)=>Promise<boolean>
}

function simplified(points:Vec3[], tolerance:number):Vec3[] {
  const keep=new Set([0,points.length-1]),pending=[[0,points.length-1]]
  while(pending.length){
    const [a,b]=pending.pop()!,p=points[a],q=points[b]
    const dx=q[0]-p[0],dy=q[1]-p[1],dz=q[2]-p[2],len=dx*dx+dy*dy+dz*dz
    let worst=tolerance,at=-1
    for(let i=a+1;i<b;i++){
      const x=points[i][0]-p[0],y=points[i][1]-p[1],z=points[i][2]-p[2]
      const t=Math.max(0,Math.min(1,(x*dx+y*dy+z*dz)/(len||1)))
      const d=Math.hypot(x-t*dx,y-t*dy,z-t*dz)
      if(d>worst){worst=d;at=i}
    }
    if(at!==-1){keep.add(at);pending.push([a,at],[at,b])}
  }
  return [...keep].sort((a,b)=>a-b).map(i=>points[i])
}

export function RimDiagnostic({kind,scene,busy,back,actions}:{kind:'holes'|'boundaries';scene:SceneManager|null;busy:boolean;back:()=>void;actions:RimActions}){
  // The displayed welded copy has the same vertex indices as the worker's subject.
  useMeshTools(s=>s.pending)
  const mesh=scene?.scanMesh(),len=useLength(),wire=useStore(s=>s.wireframe),transparent=useStore(s=>s.translucent)
  const data=useMemo(()=>mesh?{points:mesh.positions,rings:boundaryLoops(mesh.indices,mesh.positions.length/3).loops.map(l=>l.vertices)}:null,[mesh])
  const [index,setIndex]=useState(-1),[mode,setMode]=useState<RimMode>('select'),[anchors,setAnchors]=useState<number[]>([]),[guides,setGuides]=useState<[number,number][]>([])
  const [method,setMethod]=useState<RimFillMethod>('auto'),[diameter,setDiameter]=useState(0),[strength,setStrength]=useState(3),[tolerance,setTolerance]=useState(.05)
  const [popup,setPopup]=useState<[number,number]|null>(null),[feedback,setFeedback]=useState(''),[working,setWorking]=useState(false)
  const [showHelp,setShowHelp]=useState(false)
  const [startEntry]=useState(()=>useHistory.getState().past.at(-1))
  const ownSteps=useRef(new Set<object>())
  const locked=busy||working
  const rings=data?.rings??[],current=rings[index]
  const point=(v:number):Vec3=>[data!.points[3*v],data!.points[3*v+1],data!.points[3*v+2]]
  const choose=(m:RimMode)=>{setMode(m);setGuides([]);setPopup(null);setFeedback('')}
  const previousData=useRef(data)
  const pinned=useRef(anchors);pinned.current=anchors
  useEffect(()=>{
    const before=previousData.current;previousData.current=data
    if(before && data && pinned.current.length){
      const key=(pts:Float32Array,v:number)=>pts[3*v]+','+pts[3*v+1]+','+pts[3*v+2]
      const keys=new Set(pinned.current.map(v=>key(before.points,v))),restored=new Set<number>()
      for(const ring of data.rings)for(const v of ring)if(keys.has(key(data.points,v)))restored.add(v)
      setAnchors([...restored])
    }else setAnchors([])
    setIndex(-1);setGuides([]);setPopup(null)
  },[data])
  const execute=async(task:()=>Promise<boolean>)=>{
    if(locked)return
    setWorking(true);setPopup(null);setFeedback('')
    const previous=useHistory.getState().past.at(-1)
    try{if(await task()){
      const entry=useHistory.getState().past.at(-1)
      if(entry&&entry!==previous)ownSteps.current.add(entry)
      setGuides([])
    }else setFeedback(useStore.getState().statusText||'The mesh edit could not be applied.')}
    catch(e){setFeedback(e instanceof Error?e.message:String(e))}
    finally{setWorking(false)}
  }
  const cancel=async()=>{
    const past=useHistory.getState().past
    const start=startEntry?past.indexOf(startEntry):-1
    const recent=past.slice(start+1)
    if((startEntry&&start<0)||recent.some(entry=>!ownSteps.current.has(entry))){
      setFeedback('Other history steps changed. Use Back to keep your work or Undo to review the edits.')
      return
    }
    setWorking(true)
    try{
      for(const entry of recent.reverse()){
        if(useHistory.getState().past.at(-1)!==entry)return
        await undo()
        if(useHistory.getState().past.at(-1)===entry){setFeedback('The edit could not be undone.');return}
      }
      back()
    }finally{setWorking(false)}
  }
  const edit=(op:RimOperation)=>void execute(()=>actions.change(op))
  const fill=(ring:Uint32Array)=>void execute(()=>actions.fill(ring[0],method,Math.max(1,diameter)))
  const smooth=(selected:Uint32Array[])=>edit({action:'smooth',starts:selected.map(r=>r[0]),anchors,strength})
  const cycle=(direction:number)=>{
    if(!rings.length)return
    const i=index<0?(direction>0?0:rings.length-1):(index+direction+rings.length)%rings.length
    setIndex(i)
    const p=scene?.screenPointOf(point(rings[i][0]))
    if(kind==='holes'&&mode==='select'&&p)setPopup([p.x,p.y])
  }
  const gesture=(a:RimHit|null,b:RimHit|null,x:number,y:number,double:boolean,rect:[number,number,number,number])=>{
    if(locked)return
    setPopup(null);setFeedback('')
    if(mode==='measure'){
      const [x0,y0,x1,y1]=rect
      const within=rings.filter(r=>r.every(v=>{const p=scene?.screenPointOf(point(v));return p&&p.x>=Math.min(x0,x1)&&p.x<=Math.max(x0,x1)&&p.y>=Math.min(y0,y1)&&p.y<=Math.max(y0,y1)}))
      if(!within.length&&b)within.push(rings[b.ring])
      if(!within.length){setFeedback('Enclose a complete boundary or click its rim.');return}
      setDiameter(within.reduce((n,r)=>Math.max(n,rimSphereDiameter(data!.points,r)),0));choose('select');return
    }
    if(!b){if(mode!=='select')setFeedback('Finish the stroke on a boundary point.');return}
    setIndex(b.ring)
    if(mode==='select'){
      if(kind==='holes'){if(double)fill(rings[b.ring]);else setPopup([x,y])}
    }else if(mode==='anchor'){
      setAnchors(v=>v.includes(b.vertex)?v:[...v,b.vertex])
    }else if(mode==='bridge'&&guides.length===2){
      edit({action:'bridge',first:guides[0],second:guides[1],side:b.vertex})
    }else if(a && a.vertex!==b.vertex){
      if(mode==='semi'||mode==='zip'){edit({action:mode,ends:[a.vertex,b.vertex],anchors});return}
      if(mode==='bridge'){
        if(a.ring===b.ring){setFeedback('Draw the guide between two different rims.');return}
        let pair:[number,number]=[a.vertex,b.vertex]
        if(guides.length){
          const first=rings.find(r=>r.includes(guides[0][0])),second=rings.find(r=>r.includes(guides[0][1]))
          if(first?.includes(b.vertex))pair=[b.vertex,a.vertex]
          if(!first?.includes(pair[0])||!second?.includes(pair[1])||pair.some((v,i)=>v===guides[0][i])){setFeedback('Use a different point on each of the same two rims.');return}
        }
        setGuides(g=>[...g,pair])
      }
    }
  }
  useRimOverlay(scene,data,index,mode,anchors,guides,gesture,locked)
  const makeSketch=(list:Uint32Array[])=>void execute(async()=>{
    const loops=list.map(r=>{
      const corners=Math.min(4,r.length),samples:Vec3[]=[]
      for(let j=0;j<corners;j++){
        const a=Math.floor(j*r.length/corners),b=Math.floor((j+1)*r.length/corners)
        const arc=Array.from({length:b-a+1},(_,i)=>point(r[(a+i)%r.length]))
        for(const p of simplified(arc,tolerance).slice(0,-1))samples.push(p)
      }
      return samples
    })
    if(!await createBoundarySketch(loops))return false
    setFeedback('Created the boundary curves in the Objects tree.');return true
  })
  const nav=<div className="scan-pair">{[-1,1].map(d=><button key={d} disabled={locked||!rings.length} aria-label={d<0?'Previous boundary':'Next boundary'} onClick={()=>cycle(d)}>{d<0?'<':'>'}</button>)}</div>
  const title=kind==='holes'?'Holes':'Boundaries'
  const modeButton=(m:RimMode,label:string,icon?:'whole'|'semi'|'bridge')=><button key={m} type="button" data-test={'rim-mode-'+m} disabled={locked} aria-label={label} title={label} aria-pressed={mode===m} onClick={()=>choose(m)}>{icon?<svg width="23" height="23" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10.4" fill="none" stroke="currentColor"/>
      <path d={icon==='whole'?'M20.3 12a8.3 8.3 0 1 1-16.6 0 8.3 8.3 0 1 1 16.6 0Z':icon==='semi'?'M3.7 12a8.3 8.3 0 0 1 16.6 0Z':'M3.8 8.6h16.4v6.8H3.8Z'} fill="var(--rim-icon-fill, #b39a87)" stroke="currentColor" strokeWidth=".9"/>
    </svg>:label}</button>
  const hint=feedback||(mode==='bridge'?guides.length===2?'Click the side to bridge on the first rim.':'Draw two guides between the same two rims.':mode==='semi'?'Drag between two points across one rim.':mode==='zip'?'Drag between opposing seam edges to weld them.':mode==='anchor'?'Click a boundary point to pin it during smoothing.':mode==='measure'?'Drag a box around the hole to measure it.':'')
  return <aside className={'scan-detail diagnostic-'+kind} data-test="scan-detail" aria-label={title}>
    {kind==='holes'?<>
      <div className="scan-hole-line"><span className="rim-mode-icons">{modeButton('select','Fill hole','whole')}{modeButton('semi','Fill semi-hole','semi')}{modeButton('bridge','Bridge holes','bridge')}</span>Holes <output data-test="rim-count">{rings.length}</output></div>{nav}
      <button disabled={locked||!current} data-test="rim-fill" onClick={()=>fill(current)}>Fill selected hole</button>
      <label>Fill algorithm<select value={method} onChange={e=>setMethod(e.target.value as RimFillMethod)}>{Object.entries({auto:'Automatically decided',flat:'Flat',tangent:'Tangent',curvature:'Curvature'}).map(([id,text])=><option key={id} value={id}>{text}</option>)}</select></label>
      <fieldset><legend>Fill multiple holes</legend><div className="rim-measure-label"><span>Diameter of bounding sphere</span><span>Measure</span></div>
      <label><input type="number" min="0" value={Number(len.toDisplay(diameter).toPrecision(8))} onChange={e=>setDiameter(Math.max(0,len.fromDisplay(+e.target.value)))}/>{len.word()} <button className="rim-measure-button" aria-label="Measure diameter" aria-pressed={mode==='measure'} onClick={()=>choose('measure')}>[ ... ]</button></label>
      <div className="scan-pair"><button disabled={locked||!rings.length} onClick={()=>setDiameter(rings.reduce((n,r)=>Math.max(n,rimSphereDiameter(data!.points,r)),0))}>Expand All</button>
      <button disabled={locked||diameter<=0} onClick={()=>void execute(()=>actions.fill(undefined,method,diameter))}>Fill holes</button></div></fieldset>
    </>:<>
      <fieldset><legend>Mode</legend><div className="scan-pair">{modeButton('select','Select')}{modeButton('anchor','Add anchor point')}{modeButton('zip','Zip')}</div>
      <button disabled={!anchors.length||locked} data-test="rim-clear-anchors" onClick={()=>setAnchors([])}>Clear all anchor points</button></fieldset>
      <label>Boundaries <output data-test="rim-count">{rings.length}</output></label>{nav}
      <div className="scan-pair"><button disabled={locked||!rings.length} onClick={()=>smooth(rings)}>Smooth all</button><button disabled={locked||!current} onClick={()=>smooth([current])}>Smooth selected</button></div>
      <label>Smooth strength<input type="range" min="1" max="10" value={strength} onChange={e=>setStrength(+e.target.value)}/></label>
      <div className="scan-pair"><button disabled={locked||!rings.length} onClick={()=>makeSketch(rings)}>3D Sketch from all</button><button disabled={locked||!current} onClick={()=>makeSketch([current])}>3D Sketch from selected</button></div>
      <label>Fit tolerance<input type="number" min="0" step="any" value={len.toDisplay(tolerance)} onChange={e=>setTolerance(Math.max(0,len.fromDisplay(+e.target.value)))}/>{len.word()}</label>
    </>}
    <label><input type="checkbox" checked={transparent} onChange={e=>useStore.getState().setTranslucent(e.target.checked)}/>Draw mesh transparent</label>
    <label><input type="checkbox" checked={wire} onChange={e=>useStore.getState().setWireframe(e.target.checked)}/>Show mesh wireframe</label>
    {hint&&<small role="status">{hint}</small>}
    <footer><button aria-label="Tool help" aria-expanded={showHelp} onClick={()=>setShowHelp(!showHelp)}>?</button>
      {kind==='boundaries'&&<button data-test="rim-cancel" onClick={()=>void cancel()} disabled={locked}>Cancel</button>}
      <button data-test="rim-back" onClick={back} disabled={locked}>Back</button></footer>
    {showHelp&&<small>{kind==='holes'?'Click a rim for its tools. Double-click to fill it. Use a stroke to split a hole, or two guides and a side pick to bridge rims.':'Select a rim to smooth or trace it. Add anchors to hold points fixed. Drag across a seam to zip two edges. Back keeps your edits.'}</small>}
    {popup&&current&&createPortal(<div className="rim-quick" data-test="rim-quick" role="toolbar" aria-label="Hole tools" style={{left:Math.max(4,Math.min(innerWidth-240,popup[0]-85)),top:Math.max(4,Math.min(innerHeight-36,popup[1]-40))}}>
      <button onClick={()=>cycle(-1)} aria-label="Previous hole">‹</button><button onClick={()=>cycle(1)} aria-label="Next hole">›</button>
      <button onClick={()=>fill(current)}>Fill</button><button onClick={()=>edit({action:'expand',start:current[0]})}>Expand</button><button onClick={()=>smooth([current])}>Smooth</button>
    </div>,document.body)}
  </aside>
}
