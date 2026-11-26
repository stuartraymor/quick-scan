// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import type { Vec3 } from '../../../src/core/types'
export type RimHit={ring:number;vertex:number}
export type RimMode='select'|'semi'|'bridge'|'anchor'|'zip'|'measure'
export type RimData={points:Float32Array;rings:Uint32Array[]}

export function useRimOverlay(scene:SceneManager|null,data:RimData|null, selected:number, mode:RimMode, anchors:number[], guides:number[][],
  onGesture:(start:RimHit|null,end:RimHit|null,x:number,y:number,double:boolean,rect:[number,number,number,number])=>void, busy:boolean) {
  const state=useRef({selected,mode,onGesture,busy})
  state.current={selected,mode,onGesture,busy}
  const refresh=useRef<(()=>void)|null>(null)
  useEffect(()=>{
    if(!scene||!data)return
    const host=scene.layerHost(), group=new THREE.Group()
    const vertices:number[]=[],rimIds:number[]=[],ends:number[]=[]
    const point=(v:number):Vec3=>[data.points[v*3],data.points[v*3+1],data.points[v*3+2]]
    data.rings.forEach((ring,idx)=>ring.forEach((a,j)=>{
      const b=ring[(j+1)%ring.length]
      vertices.push(...point(a),...point(b));ends.push(a,b);rimIds.push(idx)
    }))
    const colors=new THREE.BufferAttribute(new Float32Array(vertices.length),3)
    const geom=new THREE.BufferGeometry()
    geom.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geom.setAttribute('color',colors)
    const mat=new THREE.LineBasicMaterial({vertexColors:true,depthTest:false,depthWrite:false})
    const lines=new THREE.LineSegments(geom,mat)
    lines.renderOrder=120;group.add(lines)
    const marks=new THREE.Points(geom,new THREE.PointsMaterial({color:0xc6cbd0,size:3,sizeAttenuation:false,depthTest:false,depthWrite:false}))
    marks.renderOrder=121;group.add(marks)
    const pinned=new THREE.BufferGeometry().setFromPoints([...new Set([...anchors,...guides.flat()])].map(v=>new THREE.Vector3(...point(v))))
    const pins=new THREE.Points(pinned,new THREE.PointsMaterial({color:0xffbe57,size:8,sizeAttenuation:false,depthTest:false,depthWrite:false}))
    pins.renderOrder=123;group.add(pins)
    const guideGeom=new THREE.BufferGeometry().setFromPoints(guides.flat().map(v=>new THREE.Vector3(...point(v))))
    const strokes=new THREE.LineSegments(guideGeom,new THREE.LineBasicMaterial({color:0xffbe57,depthTest:false,depthWrite:false}))
    strokes.renderOrder=122;group.add(strokes)
    host.partGroup.add(group)
    let hover=-1
    const repaint=()=>{
      rimIds.forEach((ring,i)=>{
        const hot=ring===hover||ring===state.current.selected
        for(const j of [2*i,2*i+1])colors.setXYZ(j,hot?1:.35,hot?.13:.45,hot?.11:.56)
      })
      marks.visible=!['select','measure'].includes(state.current.mode)
      colors.needsUpdate=true;host.invalidate()
    }
    refresh.current=repaint;repaint()
    const ray=new THREE.Raycaster()
    const hit=(x:number,y:number):RimHit|null=>{
      const camera=host.camera(),rect=host.canvas.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(2*(x-rect.left)/rect.width-1,1-2*(y-rect.top)/rect.height),camera)
      const scale=host.partGroup.getWorldScale(new THREE.Vector3()).x||1
      ray.params.Line.threshold=9*(camera.top-camera.bottom)/(rect.height*camera.zoom)
      lines.updateWorldMatrix(true,false)
      let best:RimHit|null=null,score=Infinity
      for(const inter of ray.intersectObject(lines,false)){
        const i=inter.index;if(i===undefined)continue
        const a=ends[i],b=ends[i+1],u=scene.screenPointOf(point(a)),v=scene.screenPointOf(point(b))
        if(!u||!v)continue
        const dx=v.x-u.x,dy=v.y-u.y,t=Math.max(0,Math.min(1,((x-u.x)*dx+(y-u.y)*dy)/(dx*dx+dy*dy||1)))
        const distance=Math.hypot(x-u.x-t*dx,y-u.y-t*dy)+inter.distance*1e-10/scale
        if(distance<score && distance<=10){score=distance;best={ring:rimIds[i/2],vertex:t<=.5?a:b}}
      }
      return best
    }
    let down:{p:RimHit|null;x:number;y:number;id:number}|null=null
    let previous={time:-Infinity,ring:-1,x:0,y:0}
    const el=host.container,canvas=host.canvas
    const drag=document.createElement('div');drag.className='scan-rim-drag';document.body.append(drag)
    const release=()=>{if(down&&canvas.hasPointerCapture(down.id))canvas.releasePointerCapture(down.id);down=null;drag.hidden=true;drag.style.display='none'}
    const press=(e:PointerEvent)=>{
      if(e.target!==canvas||e.button!==0||e.altKey||e.ctrlKey||e.shiftKey)return
      if(state.current.busy){e.preventDefault();e.stopImmediatePropagation();return}
      const p=hit(e.clientX,e.clientY)
      e.preventDefault();e.stopImmediatePropagation()
      down={p,x:e.clientX,y:e.clientY,id:e.pointerId};canvas.setPointerCapture(e.pointerId)
    }
    const move=(e:PointerEvent)=>{
      if(e.target!==canvas&&!down)return
      const at=hit(e.clientX,e.clientY),id=at?.ring??-1
      if(hover!==id){hover=id;repaint()}
      host.setCursor(at?'crosshair':'')
      if(!down)return
      e.stopImmediatePropagation()
      if(['semi','zip','bridge','measure'].includes(state.current.mode)){
        const dx=e.clientX-down.x,dy=e.clientY-down.y,measure=state.current.mode==='measure'
        drag.hidden=false;Object.assign(drag.style,{display:'block',left:(measure?Math.min(e.clientX,down.x):down.x)+'px',top:(measure?Math.min(e.clientY,down.y):down.y)+'px',
          width:(measure?Math.abs(dx):Math.hypot(dx,dy))+'px',height:(measure?Math.abs(dy):0)+'px',borderWidth:measure?'1px':'1px 0 0',transform:measure?'none':'rotate('+Math.atan2(dy,dx)+'rad)'})
      }
    }
    const up=(e:PointerEvent)=>{
      if(!down||e.pointerId!==down.id)return
      e.preventDefault();e.stopImmediatePropagation()
      const start=down,at=hit(e.clientX,e.clientY),now=performance.now()
      release()
      const double=!!at&&at.ring===previous.ring&&now-previous.time<450&&Math.hypot(e.clientX-previous.x,e.clientY-previous.y)<6
      previous={ring:at?.ring??-1,time:now,x:e.clientX,y:e.clientY}
      state.current.onGesture(start.p,at,e.clientX,e.clientY,double,[start.x,start.y,e.clientX,e.clientY])
    }
    const block=(e:MouseEvent)=>{if(e.target===canvas&&e.button===0&&!e.ctrlKey&&!e.shiftKey&&!e.altKey)e.stopImmediatePropagation()}
    el.addEventListener('pointerdown',press,true);el.addEventListener('pointermove',move,true);el.addEventListener('pointerup',up,true)
    el.addEventListener('pointercancel',release,true);el.addEventListener('click',block,true);el.addEventListener('dblclick',block,true)
    return ()=>{
      release();drag.remove();refresh.current=null;el.removeEventListener('pointerdown',press,true);el.removeEventListener('pointermove',move,true);el.removeEventListener('pointerup',up,true)
      el.removeEventListener('pointercancel',release,true);el.removeEventListener('click',block,true);el.removeEventListener('dblclick',block,true)
      host.partGroup.remove(group);geom.dispose();mat.dispose();marks.material.dispose();pins.material.dispose();pinned.dispose();guideGeom.dispose();strokes.material.dispose();host.setCursor('');host.invalidate()
    }
  },[scene,data,anchors,guides])
  useEffect(()=>refresh.current?.(),[selected,mode])
}
