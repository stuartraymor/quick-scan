import { activeAlignmentScope } from '../../../src/core/alignmentScope'
import { rigidCompose } from '../../../src/core/deviation/rigid'
// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect} from 'react'
import {create} from 'zustand'
import * as THREE from 'three'
import type {Vec3} from '../../../src/core/types'
import type {SceneManager} from '../../../src/viewer/SceneManager'
import {useStore} from '../../../src/state/store'
import {historyAsync,historyBlocked,registerHistory} from '../../../src/state/historyStore'
import {onScan} from '../../../src/app/scanEvents'
import type {ProjectSection} from '../../../src/app/projectSections'
import {rigidApplyToPoints,rigidInvert} from '../../../src/core/deviation/rigid'

type Sketch={name:string;shown:boolean;loops:Vec3[][]}
const useSketches=create<{items:Sketch[]}>(()=>({items:[]}))
export function installBoundarySketches(){
  useStore.subscribe((s,prev)=>{
    if(activeAlignmentScope()?.features!==false||s.appliedAlignment===prev.appliedAlignment||!s.appliedAlignment)return
    const inverse=rigidInvert(s.appliedAlignment),rebase=prev.appliedAlignment?rigidCompose(inverse,prev.appliedAlignment):inverse
    useSketches.setState(state=>({items:state.items.map(item=>({...item,loops:item.loops.map(loop=>{
      const xyz=Float32Array.from(loop.flat());rigidApplyToPoints(rebase,xyz)
      return loop.map((_,i):Vec3=>[xyz[3*i],xyz[3*i+1],xyz[3*i+2]])
    })}))}))
  })
  onScan({loaded:()=>useSketches.setState({items:[]})})
  registerHistory({sections:[{key:'boundarySketches',capture:()=>useSketches.getState().items,
    apply:v=>useSketches.setState({items:v as Sketch[]}),compare:'identity'}]})
}
export const boundarySketchSection:ProjectSection<Sketch[]>={
  key:'boundarySketches',
  collect:()=>useSketches.getState().items.length?useSketches.getState().items:undefined,
  prepare(value){
    const items=value===undefined?[]:value
    if(!Array.isArray(items)||!items.every(s=>s&&typeof s.name==='string'&&typeof s.shown==='boolean'&&
      Array.isArray(s.loops)&&s.loops.length&&s.loops.every((r:unknown)=>Array.isArray(r)&&r.length>=3&&r.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))))
      throw Error('Invalid boundary sketch curves.')
    return ()=>useSketches.setState({items})
  },
  holdsWork:()=>!!useSketches.getState().items.length,watch:cb=>useSketches.subscribe(cb)
}
export async function createBoundarySketch(loops:Vec3[][]){
  if(historyBlocked()||!loops.length)return false
  const alignment=useStore.getState().appliedAlignment
  const inverse=alignment?rigidInvert(alignment):null
  const curves=loops.map(loop=>{
    const xyz=Float32Array.from(loop.flat());if(inverse)rigidApplyToPoints(inverse,xyz)
    return loop.map((_,i):Vec3=>[xyz[3*i],xyz[3*i+1],xyz[3*i+2]])
  })
  await historyAsync('3D sketch from boundaries',async()=>useSketches.setState(s=>({items:[...s.items,{name:'Boundary 3D sketch '+(s.items.length+1),shown:true,loops:curves}]})))
  return true
}
export function BoundarySketches({scene}:{scene:SceneManager|null}){
  const items=useSketches(s=>s.items),alignment=useStore(s=>s.appliedAlignment)
  useEffect(()=>{
    if(!scene||!items.length)return
    const host=scene.layerHost(),group=new THREE.Group(),material=new THREE.LineBasicMaterial({color:0x58b7f5,depthTest:false})
    const geometries:THREE.BufferGeometry[]=[]
    for(const item of items)if(item.shown)for(const loop of item.loops){
      const xyz=Float32Array.from(loop.flat());if(alignment)rigidApplyToPoints(alignment,xyz)
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(xyz,3));geometries.push(geometry)
      const line=new THREE.LineLoop(geometry,material);line.renderOrder=85;group.add(line)
    }
    host.partGroup.add(group);host.invalidate()
    return ()=>{host.partGroup.remove(group);geometries.forEach(g=>g.dispose());material.dispose();host.invalidate()}
  },[scene,items,alignment])
  return <>{items.map((item,i)=><label key={i} className="explorer-row" data-test="boundary-sketch-object"><input type="checkbox" checked={item.shown}
    onChange={e=>useSketches.setState({items:items.map((s,j)=>i===j?{...s,shown:e.target.checked}:s)})}/>{item.name}</label>)}</>
}
