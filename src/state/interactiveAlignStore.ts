// SPDX-License-Identifier: AGPL-3.0-only
// Transient preview only. The existing alignment session commits the transform.
import {create} from 'zustand'
import {identityRigid,rigidApply,rigidCompose,rigidFromAxisAngle,type Rigid} from '../core/deviation/rigid'
import type {Vec3} from '../core/types'
export type InteractiveAxis='x'|'y'|'z'
export type MirrorPlane='OYZ'|'OXZ'|'OXY'
const axes:Record<InteractiveAxis,Vec3>={x:[1,0,0],y:[0,1,0],z:[0,0,1]}
/** World-axis turn about the moved model centre; translation does not orbit. */
export function interactiveTurn(base:Rigid,center:Vec3,axis:InteractiveAxis,degrees:number):Rigid{
 const pivot=new Float64Array(3);rigidApply(base,...center,pivot)
 const turn=rigidFromAxisAngle(axes[axis],degrees*Math.PI/180)
 const rotated=new Float64Array(3);rigidApply(turn,pivot[0],pivot[1],pivot[2],rotated)
 turn.t.set(pivot.map((v,i)=>v-rotated[i]))
 return rigidCompose(turn,base)
}
export function interactiveMove(base:Rigid,axis:InteractiveAxis,mm:number):Rigid{
 const result={r:base.r.slice(),t:base.t.slice()};result.t['xyz'.indexOf(axis)]+=mm;return result
}
interface State{
 open:boolean;rigid:Rigid;center:Vec3;strength:number;mirror:boolean;mirrorPlane:MirrorPlane;asView:boolean
 setMirror:(on:boolean)=>void;setMirrorPlane:(plane:MirrorPlane)=>void;orientToView:(rotation:Rigid)=>void
 start:(center:Vec3)=>void;close:()=>void;setStrength:(n:number)=>void
 rotate:(axis:InteractiveAxis,degrees:number)=>void;move:(axis:InteractiveAxis,mm:number)=>void
 drag:(side:string,delta:number,phase:'start'|'move'|'end')=>void
}
let start:Rigid|null=null
export const useInteractiveAlign=create<State>((set,get)=>({
 open:false,rigid:identityRigid(),center:[0,0,0],strength:1,mirror:false,mirrorPlane:'OYZ',asView:false,
 setMirror:mirror=>set({mirror}),setMirrorPlane:mirrorPlane=>set({mirrorPlane}),
 orientToView:rotation=>{if(get().open)set(s=>{
  const rigid=rigidCompose(rotation,s.rigid),moved=new Float64Array(3)
  rigidApply(rigid,...s.center,moved)
  for(let i=0;i<3;i++)rigid.t[i]-=moved[i]
  return {rigid,asView:true}
 })},
 start:center=>{start=null;set({open:true,center:[...center],rigid:identityRigid(),asView:false})},
 close:()=>{start=null;set({open:false,rigid:identityRigid(),asView:false})},
 setStrength:n=>{if(Number.isFinite(n))set({strength:Math.min(1,Math.max(0,n))})},
 rotate:(axis,n)=>{if(Number.isFinite(n))set(s=>({rigid:interactiveTurn(s.rigid,s.center,axis,n)}))},
 move:(axis,n)=>{if(Number.isFinite(n))set(s=>({rigid:interactiveMove(s.rigid,axis,n)}))},
 drag:(side,delta,phase)=>{
  if(!get().open||!/^align-[rm][xyz]$/.test(side))return
  if(phase==='start'){start=get().rigid;return}
  if(phase==='end'){start=null;return}
  if(!start||!Number.isFinite(delta))return
  const s=get(),axis=side.at(-1) as InteractiveAxis
  set({rigid:side[6]==='r'?interactiveTurn(start,s.center,axis,delta*s.strength):interactiveMove(start,axis,delta*s.strength)})
 }
}))
