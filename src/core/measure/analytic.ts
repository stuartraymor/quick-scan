// SPDX-License-Identifier: AGPL-3.0-only
// Pure model-coordinate evaluation shared by geometry providers. Supporting
// lines/planes are deliberately distinct from finite edges/trimmed faces.
import type {Vec3} from '../types'
import {addScaled,cross,dot,len,scale,sub} from '../vec'

export type AnalyticGeometry =
 | {kind:'point';at:Vec3}
 | {kind:'segment';a:Vec3;b:Vec3}
 | {kind:'line';at:Vec3;dir:Vec3}
 | {kind:'plane';at:Vec3;normal:Vec3}
 | {kind:'circle';center:Vec3;normal:Vec3;radius:number}
 | {kind:'sphere';center:Vec3;radius:number}
export interface AnalyticValue {
 key:string;label:string;value:number;unit:'length'|'deg';witness?:[Vec3,Vec3]
 domain:'points'|'finite edges'|'supporting geometry'|'complete circles'|'complete spheres'
}
export interface AnalyticResult {status:'ok'|'partial'|'unsupported'|'invalid';values:AnalyticValue[];reason?:string}
const clamp=(x:number,lo=0,hi=1)=>Math.max(lo,Math.min(hi,x))
const validPoint=(p:Vec3)=>p.length===3&&p.every(Number.isFinite)
const angular=(a:Vec3,b:Vec3)=>{const u=unit(a)!,v=unit(b)!;return Math.atan2(len(cross(u,v)),dot(u,v))*180/Math.PI}
const unit=(v:Vec3):Vec3|null=>{const m=Math.max(...v.map(Math.abs));if(!(m>0)||!Number.isFinite(m))return null;const w=scale(v,1/m),n=len(w);return scale(w,1/n)}
const distance=(a:Vec3,b:Vec3)=>len(sub(a,b))
const bad=(reason:string):AnalyticResult=>({status:'invalid',values:[],reason})
const value=(key:string,label:string,v:number,domain:AnalyticValue['domain'],witness?:[Vec3,Vec3],angle=false):AnalyticValue=>({key,label,value:v,unit:angle?'deg':'length',domain,...(witness?{witness}:{})})
function separation(a:Vec3,b:Vec3,domain:AnalyticValue['domain'],label='Minimum distance'):AnalyticValue[]{
 return [value('distance',label,distance(a,b),domain,[a,b]),...(['X','Y','Z'] as const).map((axis,i)=>value('d'+axis,`Witness Δ${axis}`,Math.abs(b[i]-a[i]),domain))]
}
function validate(g:AnalyticGeometry):boolean{
 switch(g.kind){
 case'point':return validPoint(g.at)
 case'segment':return validPoint(g.a)&&validPoint(g.b)&&distance(g.a,g.b)>0
 case'line':return validPoint(g.at)&&validPoint(g.dir)&&len(g.dir)>0
 case'plane':return validPoint(g.at)&&validPoint(g.normal)&&len(g.normal)>0
 case'circle':return validPoint(g.center)&&validPoint(g.normal)&&len(g.normal)>0&&Number.isFinite(g.radius)&&g.radius>0
 case'sphere':return validPoint(g.center)&&Number.isFinite(g.radius)&&g.radius>0
 }
}
const line=(g:Extract<AnalyticGeometry,{kind:'line'|'segment'}>)=>g.kind==='line'?{at:g.at,dir:unit(g.dir)!}:{at:g.a,dir:unit(sub(g.b,g.a))!}
const perpendicular=(n:Vec3):Vec3=>unit(cross(n,Math.abs(n[0])<.8?[1,0,0]:[0,1,0]))!
function nearestPoint(p:Vec3,g:AnalyticGeometry):Vec3|null{
 switch(g.kind){
 case'point':return g.at
 case'segment':{const d=sub(g.b,g.a);return addScaled(g.a,d,clamp(dot(sub(p,g.a),d)/dot(d,d)))}
 case'line':{const d=unit(g.dir)!;return addScaled(g.at,d,dot(sub(p,g.at),d))}
 case'plane':{const n=unit(g.normal)!;return addScaled(p,n,-dot(sub(p,g.at),n))}
 case'sphere':return addScaled(g.center,unit(sub(p,g.center))??[1,0,0],g.radius)
 case'circle':{const n=unit(g.normal)!,d=sub(p,g.center),radial=sub(d,scale(n,dot(d,n)));return addScaled(g.center,unit(radial)??perpendicular(n),g.radius)}
 }
}
/** Closest points of two bounded segments; directions and parameters remain
 * local to their origins, so large world translations do not enter dot products. */
function segments(a:Extract<AnalyticGeometry,{kind:'segment'}>,b:Extract<AnalyticGeometry,{kind:'segment'}>):[Vec3,Vec3]{
 const candidates:[Vec3,Vec3][]=[[a.a,nearestPoint(a.a,b)!],[a.b,nearestPoint(a.b,b)!],[nearestPoint(b.a,a)!,b.a],[nearestPoint(b.b,a)!,b.b]]
 const u=unit(sub(a.b,a.a))!,v=unit(sub(b.b,b.a))!,la=distance(a.a,a.b),lb=distance(b.a,b.b)
 const [p,q]=carriers({at:a.a,dir:u},{at:b.a,dir:v}),s=dot(sub(p,a.a),u),t=dot(sub(q,b.a),v)
 if(s>=0&&s<=la&&t>=0&&t<=lb)candidates.push([p,q])
 return candidates.reduce((best,pair)=>distance(...pair)<distance(...best)?pair:best)
}
function carriers(a:{at:Vec3;dir:Vec3},b:{at:Vec3;dir:Vec3}):[Vec3,Vec3]{
 const u=unit(a.dir)!,v=unit(b.dir)!,r=sub(a.at,b.at),n=cross(u,v),d=len(n)
 if(d===0)return [a.at,addScaled(b.at,v,dot(v,r))]
 const normal=scale(n,1/d),s=dot(cross(v,r),normal)/d,t=dot(cross(u,r),normal)/d
 return [addScaled(a.at,u,s),addScaled(b.at,v,t)]
}
/** Evaluate only meanings justified by the selected geometry. A plane here
 * is infinite; adapters must not label it a bounded-face clearance. */
function evaluateAnalytic(a:AnalyticGeometry,b:AnalyticGeometry):AnalyticResult{
 if(!validate(a)||!validate(b))return bad('The geometry is degenerate or contains non-finite coordinates.')
 if(a.kind==='point'){
  const q=nearestPoint(a.at,b)!
  const domain=b.kind==='point'?'points':b.kind==='segment'?'finite edges':b.kind==='circle'?'complete circles':b.kind==='sphere'?'complete spheres':'supporting geometry'
  return {status:'ok',values:separation(a.at,q,domain,b.kind==='point'?'Point-to-point distance':'Minimum distance')}
 }
 if(b.kind==='point'){
  const r=measureAnalytic(b,a)
  return {...r,values:r.values.map(v=>v.witness?{...v,witness:[v.witness[1],v.witness[0]]}:v)}
 }
 if(a.kind==='segment'&&b.kind==='segment'){
  const [p,q]=segments(a,b),angle=angular(sub(a.b,a.a),sub(b.b,b.a))
  return{status:'ok',values:[...separation(p,q,'finite edges'),value('angle','Angle between directions',angle,'finite edges',undefined,true)]}
 }
 if(a.kind==='line'&&b.kind==='line'){
  const [p,q]=carriers(a,b)
  return{status:'ok',values:[...separation(p,q,'supporting geometry','Supporting-line distance'),value('angle','Angle between directions',angular(a.dir,b.dir),'supporting geometry',undefined,true)]}
 }
 if((a.kind==='line'||a.kind==='segment')&&b.kind==='plane'){
  const l=line(a),n=unit(b.normal)!,offset=dot(sub(l.at,b.at),n),slope=dot(l.dir,n)
  let p:Vec3
  if(a.kind==='segment'){
   const da=dot(sub(a.a,b.at),n),db=dot(sub(a.b,b.at),n)
   p=da*db<=0&&da!==db?addScaled(a.a,sub(a.b,a.a),da/(da-db)):Math.abs(da)<=Math.abs(db)?a.a:a.b
  }else p=slope!==0?addScaled(l.at,l.dir,-offset/slope):l.at
  const q=nearestPoint(p,b)!,angle=Math.asin(clamp(Math.abs(slope),0,1))*180/Math.PI
  return{status:'ok',values:[...separation(p,q,'supporting geometry',a.kind==='segment'?'Finite-edge to supporting-plane distance':'Supporting-line to supporting-plane distance'),value('angle','Line-to-plane angle',angle,'supporting geometry',undefined,true)]}
 }
 if(a.kind==='plane'&&(b.kind==='segment'||b.kind==='line')){const r=measureAnalytic(b,a);return {...r,values:r.values.map(v=>v.witness?{...v,witness:[v.witness[1],v.witness[0]]}:v)}}
 if(a.kind==='plane'&&b.kind==='plane'){
  const n1=unit(a.normal)!,n2=unit(b.normal)!,d=cross(n1,n2),dd=len(d)
  const p=dd>0?addScaled(a.at,cross(scale(d,1/dd),n1),dot(n2,sub(b.at,a.at))/dd):a.at
  const q=dd>0?p:nearestPoint(p,b)!
  return{status:'ok',values:[...separation(p,q,'supporting geometry','Supporting-plane separation'),value('angle','Angle between plane normals',angular(n1,n2),'supporting geometry',undefined,true)]}
 }
 if((a.kind==='circle'&&b.kind==='circle')||(a.kind==='sphere'&&b.kind==='sphere')){
  const domain=a.kind==='circle'?'complete circles':'complete spheres',d=distance(a.center,b.center)
  const values=[value('centerDistance','Centre-to-centre distance',d,'points',[a.center,b.center])]
  if(a.kind==='circle'&&b.kind==='circle'){
   const na=unit(a.normal)!,nb=unit(b.normal)!
   if(len(cross(na,nb))>1e-10||Math.abs(dot(sub(b.center,a.center),na))>1e-9)
    return{status:'partial',values,reason:'Centre distance is available; minimum/maximum distance between these non-coplanar circles needs a bounded curve evaluator.'}
  }
  const minimum=Math.max(0,d-a.radius-b.radius,Math.abs(a.radius-b.radius)-d)
  const u=unit(sub(b.center,a.center))??(a.kind==='circle'?perpendicular(unit(a.normal)!):[1,0,0])
  let p:Vec3,q:Vec3
  if(d>=a.radius+b.radius){p=addScaled(a.center,u,a.radius);q=addScaled(b.center,u,-b.radius)}
  else if(a.radius>=d+b.radius){p=addScaled(a.center,u,a.radius);q=addScaled(b.center,u,b.radius)}
  else if(b.radius>=d+a.radius){p=addScaled(a.center,u,-a.radius);q=addScaled(b.center,u,-b.radius)}
  else if(d===0){p=addScaled(a.center,u,a.radius);q=p}
  else{const along=(a.radius*a.radius-b.radius*b.radius+d*d)/(2*d),height=Math.sqrt(Math.max(0,a.radius*a.radius-along*along));const v=a.kind==='circle'?unit(cross(a.normal,u))!:perpendicular(u);p=addScaled(addScaled(a.center,u,along),v,height);q=p}
  values.push(value('minDistance','Minimum surface distance',minimum,domain,[p,q]),value('maxDistance','Maximum surface distance',d+a.radius+b.radius,domain,[addScaled(a.center,u,-a.radius),addScaled(b.center,u,b.radius)]))
  return{status:'ok',values}
 }
 return{status:'unsupported',values:[],reason:'This geometry pairing requires another registered evaluator; no distance has been inferred from picked positions.'}
}

export function measureAnalytic(a:AnalyticGeometry,b:AnalyticGeometry):AnalyticResult{
 const result=evaluateAnalytic(a,b)
 if(result.values.some(v=>!Number.isFinite(v.value)||v.witness?.some(p=>!validPoint(p))))return bad('The geometry exceeds the stable numeric range for this calculation.')
 return result
}

/** Ordered three-point angle A–vertex–B, including obtuse angles. */
export function measureThreePointAngle(a:Vec3,vertex:Vec3,b:Vec3):AnalyticResult{
 if(![a,vertex,b].every(validPoint))return bad('The angle points contain non-finite coordinates.')
 const u=sub(a,vertex),v=sub(b,vertex)
 if(!(len(u)>0&&len(v)>0))return bad('The vertex must differ from both angle endpoints.')
 return{status:'ok',values:[value('angle','Three-point angle',angular(u,v),'points',undefined,true)]}
}
