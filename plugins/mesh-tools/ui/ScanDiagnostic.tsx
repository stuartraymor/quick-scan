// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect,useMemo, useState } from 'react'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { vertexComponents } from '../../../src/core/geometry/unionFind'
import { useMeshTools } from '../state/meshStore'
import { useStore } from '../../../src/state/store'
import { useMark } from '../../../src/state/markStore'
import { useLength } from '../../../src/app/useUnits'

type Diagnostic = 'islands'
export function ScanDiagnostic({kind,scene,busy,back,remove,flip,create}: {
  kind:Diagnostic;scene: SceneManager|null;busy:boolean;back:()=>void
  remove:(v:Uint32Array)=>void;flip:()=>void;create:()=>void
}) {
  const geom=scene?.scanMesh()
  const copy=useMeshTools(s=>s.copyTriangles)
  const len=useLength(), wire=useStore(s=>s.wireframe)
  const [index,setIndex]=useState(-1), [criterion,setCriterion]=useState('area'), [area,setArea]=useState(1),[maximum,setMaximum]=useState(10)
  const data=useMemo(()=>{
    if(!geom)return null
    const faces=geom.indices,points=geom.positions
    const roots=vertexComponents(faces,points.length/3), groups=new Map<number,{v:Set<number>;area:number;count:number}>()
    for(let i=0;i<faces.length;i+=3){
      const a=faces[i],b=faces[i+1],c=faces[i+2],key=roots.find(a)
      let g=groups.get(key);if(!g){g={v:new Set(),area:0,count:0};groups.set(key,g)}
      g.v.add(a);g.v.add(b);g.v.add(c);g.count++
      const ux=points[b*3]-points[a*3],uy=points[b*3+1]-points[a*3+1],uz=points[b*3+2]-points[a*3+2]
      const vx=points[c*3]-points[a*3],vy=points[c*3+1]-points[a*3+1],vz=points[c*3+2]-points[a*3+2]
      g.area+=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2
    }
    const regions=Array.from(groups.entries(),([root,g])=>({root,vertices:Uint32Array.from(g.v),size:0,count:g.count,area:g.area})).sort((a,b)=>b.count-a.count)
    const byRoot=new Map(regions.map((g,i)=>[g.root,i]))
    return {points,regions,atFace:(face:number)=>byRoot.get(roots.find(faces[3*face]))}
  },[geom,copy,kind])
  const regions=data?.regions??[], current=regions[index]
  const mark=(ids:Uint32Array)=>{scene?.setPaintedVertices(ids,'#d53534');useMark.getState().setCount(ids.length)}
  useEffect(()=>{
    setIndex(-1)
    if(!scene||!data||busy)return
    const canvas=scene.layerHost().canvas
    const pick=(e:PointerEvent)=>{
      if(e.button!==0||e.altKey||e.ctrlKey||e.shiftKey)return
      const hit=scene.scanHitAt(e.clientX,e.clientY)
      if(!hit)return
      const i=data.atFace(hit.faceIndex)
      if(i===undefined)return
      e.stopImmediatePropagation();e.preventDefault()
      setIndex(i);scene.setPaintedVertices(data.regions[i].vertices,'#d53534');useMark.getState().setCount(data.regions[i].vertices.length)
    }
    canvas.addEventListener('pointerdown',pick,true)
    return ()=>canvas.removeEventListener('pointerdown',pick,true)
  },[data,scene,busy])
  const select=(d:number)=>{if(!regions.length)return;const next=index<0?(d>0?0:regions.length-1):(index+d+regions.length)%regions.length;setIndex(next);mark(regions[next].vertices)}
  const collect=(all:typeof regions)=>Uint32Array.from(all.flatMap(r=>Array.from(r.vertices)))
  const cleanup=regions.filter(r=>criterion==='area'?r.area<len.fromDisplay(1)**2*area:r.count<=maximum)
  const nav=<div className="scan-pair"><button disabled={busy||!regions.length} onClick={()=>select(-1)}>&lt;</button><button disabled={busy||!regions.length} onClick={()=>select(1)}>&gt;</button></div>
  const meshFlags=<><label><input type="checkbox" checked={wire} onChange={e=>useStore.getState().setWireframe(e.target.checked)}/>Show mesh wireframe</label></>
  return <aside className={'scan-detail diagnostic-'+kind} data-test="scan-detail">
      <div className="scan-piece-nav"><span>Individual meshes</span><output>{regions.length}</output>{nav}</div>
      <div className="scan-pair"><button disabled={busy||!current} onClick={()=>{mark(current.vertices);flip()}}>Flip Normals</button>
        <button disabled={busy||!current||regions.length<2} onClick={()=>remove(collect(regions.filter(r=>r!==current)))}>Leave selected only</button></div>
      <button disabled={busy||!current} onClick={()=>{mark(current.vertices);create()}}>Create new object</button>
      <fieldset><legend>Multiple meshes cleanup</legend>
        <label><input type="radio" checked={criterion==='count'} onChange={()=>setCriterion('count')}/>By maximum triangles<input type="number" min="1" value={maximum} disabled={criterion!=='count'} onChange={e=>setMaximum(+e.target.value)}/></label>
        <label><input type="radio" checked={criterion==='area'} onChange={()=>setCriterion('area')}/>By area smaller than<input type="number" min="0" value={area} disabled={criterion!=='area'} onChange={e=>setArea(+e.target.value)}/>{len.word()}²</label>
        <button disabled={!current} onClick={()=>criterion==='area'?setArea(current.area/len.fromDisplay(1)**2):setMaximum(current.count)}>Measure</button>
        <button disabled={busy||!cleanup.length||cleanup.length===regions.length} onClick={()=>remove(collect(cleanup))}>Remove</button>
      </fieldset>
    {meshFlags}
    <footer><button onClick={back} disabled={busy}>Back</button></footer>
  </aside>
}
