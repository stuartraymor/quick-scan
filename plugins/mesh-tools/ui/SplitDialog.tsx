// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect,useMemo,useRef,useState} from 'react'
import * as THREE from 'three'
import {useSolids} from '../../../src/app/solids'
import type {SceneManager} from '../../../src/viewer/SceneManager'
import {useLength} from '../../../src/app/useUnits'
import {rigidApplyToPoints} from '../../../src/core/deviation/rigid'
import {useStore} from '../../../src/state/store'
import {elementSolids} from '../app/booleanSolids'
import {usePieces} from '../app/selectionMeshes'
import type {ScanEdited,ScanEditRequest} from '../core/protocol'
import type {SplitTool} from '../core/splitMesh'
import {useMeshTools} from '../state/meshStore'

type Method='split'|'subtract'|'add'
type Cutter={version:unknown;id:string;name:string;solid:boolean;load:()=>Promise<SplitTool>}
export interface SplitActions {
  blocked:boolean
  preview:(request:ScanEditRequest)=>Promise<ScanEdited>
  commit:(mesh:ScanEdited,method:Method,name:string)=>Promise<boolean>
}
const palette=[0x97d680,0x6eacd8,0xe8b968,0xc58ecb,0x73c9bb]

function geometryOf(p:Float32Array,i:Uint32Array){
  const g=new THREE.BufferGeometry()
  g.setAttribute('position',new THREE.BufferAttribute(p,3))
  g.setIndex(new THREE.BufferAttribute(i,1))
  return g
}
export function SplitDialog({scene,actions,back,busy}:{scene:SceneManager|null;actions:SplitActions;back:()=>void;busy:boolean}){
  const bySource=useSolids(s=>s.bySource),elements=useStore(s=>s.elements),pieces=usePieces(s=>s.pieces)
  const pose=useStore(s=>s.appliedAlignment),scan=useStore(s=>s.fileName),edits=useMeshTools(s=>s.pending)
  const [method,setMethod]=useState<Method>('split'),[key,setKey]=useState(''),[help,setHelp]=useState(false)
  const [result,setResult]=useState<ScanEdited|null>(null),[running,setRunning]=useState(false),[error,setError]=useState('')
  const generation=useRef(0),len=useLength()
  const [envelope,setEnvelope]=useState(false),[distance,setDistance]=useState(1)
  const offers=useMemo(()=>{
    const all:Cutter[]=[...Object.values(bySource).flat(),...elementSolids(elements)].map(b=>({
      version:b.version,id:b.key,name:b.name,solid:!b.surface,load:()=>b.mesh(.05)
    }))
    for(const e of elements){
      if(!e.visible||e.fit?.kind!=='plane')continue
      const plane={origin:e.fit.center,normal:e.fit.normal}
      all.push({version:e.fit,id:'plane:'+e.id,name:e.name,solid:false,load:async()=>({plane})})
    }
    pieces.forEach((p,i)=>{if(p.shown)all.push({version:p.positions,id:'mesh:'+i,name:p.name,solid:false,load:async()=>{
      const positions=p.positions.slice();if(pose)rigidApplyToPoints(pose,positions)
      return {positions,indices:p.indices}
    }})})
    const g=scene?.nominalGeometry(),pos=g?.getAttribute('position'),idx=g?.getIndex()
    if(pos&&idx)all.push({version:pos.array,id:'reference',name:'Reference mesh',solid:false,load:async()=>({positions:Float32Array.from(pos.array),indices:Uint32Array.from(idx.array)})})
    return method==='split'?all:all.filter(o=>o.solid)
  },[bySource,elements,pieces,pose,method,scene])
  const cutter=offers.find(o=>o.id===key)??(offers.length===1?offers[0]:undefined)
  useEffect(()=>{
    generation.current++;setResult(null);setError('');setRunning(false)
    return ()=>{generation.current++}
  },[cutter?.id,cutter?.version,method,edits,pose,scan,envelope,distance])

  // Viewport picking uses each offered object's triangles in the scan's local frame.
  useEffect(()=>{
    if(!scene||running||result)return
    const host=scene.layerHost(), canvas=host.canvas
    let active=true, serial=0
    const pick=async(e:PointerEvent)=>{
      if(e.button!==0||e.target!==canvas||e.altKey||e.ctrlKey||e.shiftKey)return
      e.stopImmediatePropagation();e.preventDefault()
      const token=++serial, rect=canvas.getBoundingClientRect(),ray=new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)*2/rect.width-1,1-(e.clientY-rect.top)*2/rect.height),host.camera())
      const local=ray.ray.clone().applyMatrix4(host.partGroup.matrixWorld.clone().invert())
      let nearest=Infinity,selected=''
      for(const o of offers){
        if(!active||token!==serial)return
        const t=await o.load()
        let distance=Infinity
        if('plane' in t){
          const p=new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(...t.plane.normal),new THREE.Vector3(...t.plane.origin))
          const hit=local.intersectPlane(p,new THREE.Vector3())
          if(hit)distance=local.origin.distanceTo(hit)
        }else{
          const geometry=geometryOf(t.positions,t.indices), material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide})
          const proxy=new THREE.Mesh(geometry,material);proxy.matrixWorld.copy(host.partGroup.matrixWorld)
          try{const hit=ray.intersectObject(proxy,false)[0];if(hit)distance=local.origin.distanceTo(host.partGroup.worldToLocal(hit.point))}
          finally{geometry.dispose();material.dispose()}
        }
        if(distance<nearest){selected=o.id;nearest=distance}
      }
      if(active&&token===serial&&selected)setKey(selected)
    }
    const down=(e:PointerEvent)=>{void pick(e).catch(err=>{if(active)setError(String(err))})}
    canvas.addEventListener('pointerdown',down,true)
    return ()=>{active=false;canvas.removeEventListener('pointerdown',down,true)}
  },[offers,running,result,scene])

  useEffect(()=>{
    if(!scene||!result)return
    const host=scene.layerHost(),g=geometryOf(result.positions,result.indices)
    const colors=new Float32Array(result.positions.length),report=result.report
    for(let i=0;i<result.indices.length;i++){
      const region=report.kind==='split'?report.regions[Math.floor(i/3)]:0
      const c=palette[region%palette.length],v=result.indices[i]*3
      colors[v]=((c>>16)&255)/255;colors[v+1]=((c>>8)&255)/255;colors[v+2]=(c&255)/255
    }
    g.setAttribute('color',new THREE.BufferAttribute(colors,3));g.computeVertexNormals()
    const material=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide})
    const overlay=new THREE.Mesh(g,material),visible=scene.scanShown()
    host.partGroup.add(overlay);scene.setScanVisible(false);host.invalidate()
    return ()=>{overlay.removeFromParent();g.dispose();material.dispose();scene.setScanVisible(visible);host.invalidate()}
  },[scene,result])
  const preview=async(apply=false)=>{
    if(!cutter||busy||running)return
    const token=++generation.current;setRunning(true);setError('');setResult(null)
    try{
      const tool=await cutter.load()
      let request:ScanEditRequest
      const options=envelope?{envelope:distance}:{}
      if(method==='split')request={type:'split',cutter:tool,...options}
      else {
        if('plane' in tool)throw Error('Choose a solid for this operation.')
        request={type:'boolean',op:method,tools:[{...tool,name:cutter.name}],...options}
      }
      const mesh=await actions.preview(request)
      if(token!==generation.current)return
      if(!apply)setResult(mesh)
      else if(await actions.commit(mesh,method,cutter.name))back()
      else setError(useStore.getState().statusText)
    }catch(err){if(token===generation.current)setError(err instanceof Error?err.message:String(err))}
    finally{if(token===generation.current)setRunning(false)}
  }
  const commit=async()=>{
    if(!cutter||busy||running||actions.blocked)return
    if(!result){await preview(true);return}
    setRunning(true)
    try{if(await actions.commit(result,method,cutter.name))back();else setError(useStore.getState().statusText||'Could not apply the split.')}
    finally{setRunning(false)}
  }
  return <aside className="scan-detail diagnostic-split" data-test="split-dialog">
    <span>Select another object or mesh and press Preview</span>
    <label>Split the mesh using<select data-test="split-cutter" value={cutter?.id??''} disabled={running||busy} onChange={e=>setKey(e.target.value)}>
      <option value="">Select object…</option>{offers.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
    </select></label>
    <div className="split-envelope"><label><input type="checkbox" data-test="split-envelope" checked={envelope} disabled={busy||running} onChange={e=>setEnvelope(e.target.checked)}/>Envelope</label>
      <input aria-label="Envelope distance" data-test="split-distance" type="number" min="0" step="any" value={Number(len.toDisplay(distance).toPrecision(8))} disabled={busy||running} onChange={e=>setDistance(len.fromDisplay(+e.target.value))}/><span>{len.word()}</span></div>
    <select aria-label="Split method" data-test="split-method" value={method} disabled={running||busy} onChange={e=>setMethod(e.target.value as Method)}>
      <option value="split">Split with another body or a mesh</option><option value="subtract">Cut (solids only)</option><option value="add">Combine (solids only)</option>
    </select>
    {error&&<small role="alert">{error}</small>}
    {result&&<output data-test="split-result">{result.report.kind==='split'?result.report.parts+' individual meshes':method==='subtract'?'Cut preview':'Combine preview'}</output>}
    {help&&<small>Pick a cutter in the viewport or object list. Preview the result, then press OK to keep it.</small>}
    <button data-test="split-preview" disabled={!cutter||running||busy||(envelope&&distance<=0)} onClick={()=>void preview()}>Preview</button>
    <footer><button title="Help" onClick={()=>setHelp(!help)}>?</button><button data-test="split-ok" disabled={!cutter||running||busy||actions.blocked||(envelope&&distance<=0)} onClick={()=>void commit()}>OK</button><button data-test="split-cancel" disabled={busy||running} onClick={back}>Cancel</button></footer>
  </aside>
}
