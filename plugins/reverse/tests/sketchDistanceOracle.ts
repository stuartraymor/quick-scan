// SPDX-License-Identifier: AGPL-3.0-only
// Independent geometry for the audit. Do not call the product's measurement
// helpers: their result is what this oracle is meant to check.
import type {Anchor,Constraint,Sketch,SketchEntity} from '../core/sketch'
type Point=[number,number]
export function auditDistance(sketch:Sketch,c:Extract<Constraint,{kind:'distance'}>):number|null {
 const entities=new Map(sketch.entities.map(e=>[e.id,e]))
 const point=(a:Anchor):Point|null=>{
  const e=entities.get(a.entity);if(!e)return null
  if(e.kind==='point')return e.p
  if(e.kind==='line')return a.at==='a'?e.a:a.at==='b'?e.b:a.at==='center'?[(e.a[0]+e.b[0])/2,(e.a[1]+e.b[1])/2]:null
  if(e.kind==='circle'||e.kind==='arc'){
   if(a.at==='center')return e.c
   let angle:number|null=null
   if(/^q[0-3]$/.test(a.at))angle=Number(a.at[1])*Math.PI/2
   else if(e.kind==='arc')angle=a.at==='a'?e.start:a.at==='b'?e.start+e.sweep:a.at==='p0'?e.start+e.sweep*(e.gripT??.5):null
   return angle===null?null:[e.c[0]+e.r*Math.cos(angle),e.c[1]+e.r*Math.sin(angle)]
  }
  return null
 }
 const rim=(a:Anchor)=>{const e=entities.get(a.entity);return c.edge&&a.at==='center'&&(e?.kind==='circle'||e?.kind==='arc')?e.r:0}
 const sign=c.edge==='far'?1:-1,p=point(c.p);if(!p)return null
 if('datum' in c.q)return c.q.datum==='yz'?Math.abs(p[0])+sign*rim(c.p):c.q.datum==='zx'?Math.abs(p[1])+sign*rim(c.p):null
 if('line' in c.q){const e:SketchEntity|undefined=entities.get(c.q.line);if(e?.kind!=='line')return null;const dx=e.b[0]-e.a[0],dy=e.b[1]-e.a[1],length=Math.hypot(dx,dy);return length>0?Math.abs(dx*(p[1]-e.a[1])-dy*(p[0]-e.a[0]))/length+sign*rim(c.p):null}
 const q=point(c.q);if(!q)return null
 if(c.axis)return Math.abs(q[c.axis==='x'?0:1]-p[c.axis==='x'?0:1])
 return Math.hypot(q[0]-p[0],q[1]-p[1])+sign*(rim(c.p)+rim(c.q))
}
