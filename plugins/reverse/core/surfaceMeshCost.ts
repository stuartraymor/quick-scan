// SPDX-License-Identifier: AGPL-3.0-only
import { basisFunctions, findSpan } from './surfaceFit'
import { validate, type PolynomialSurface, type SurfaceAxis } from './surfaceStep'
import { meshDeflection } from './buildTypes'

/** Rendering-cost heuristic for an arbitrary XYZ net. Like the scalar-fit
 * estimator, this is sampled normal curvature, not a certified mesh bound.
 * Every distinct knot span is sampled, including narrow nonuniform spans. */
export function surfaceMeshCost(surface: PolynomialSurface, requestedChord?: number) {
  validate(surface)
  const prepare = (axis: SurfaceAxis) => {
    const knots=Float64Array.from(axis.knots.flatMap((k,i)=>Array(axis.mults[i]).fill(k)))
    const samples:number[]=[]
    const width=axis.knots.at(-1)!-axis.knots[0]
    for(let i=0;i<axis.knots.length-1;i++) {
      const a=axis.knots[i],b=axis.knots[i+1]
      const count=Math.max(4,Math.ceil(4*(axis.count-1)*(b-a)/width))
      for(let j=0;j<2*count;j++) samples.push(a+(b-a)*j/(2*count))
    }
    samples.push(axis.knots.at(-1)!)
    return samples.map(t=>{
      const span=findSpan(knots,axis.count,axis.degree,t),values=new Float64Array(axis.degree+1)
      basisFunctions(knots,span,axis.degree,t,values)
      return {t,first:span-axis.degree,values}
    })
  }
  const us=prepare(surface.u),vs=prepare(surface.v),points=new Float64Array(us.length*vs.length*3)
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity]
  for(let i=0;i<us.length;i++) for(let j=0;j<vs.length;j++) {
    const u=us[i],v=vs[j],offset=(i*vs.length+j)*3
    for(let a=0;a<u.values.length;a++) for(let b=0;b<v.values.length;b++) {
      const p=surface.poles[(u.first+a)*surface.v.count+v.first+b],weight=u.values[a]*v.values[b]
      for(let k=0;k<3;k++) points[offset+k]+=weight*p[k]
    }
    for(let k=0;k<3;k++){min[k]=Math.min(min[k],points[offset+k]);max[k]=Math.max(max[k],points[offset+k])}
  }
  const diagonal=Math.hypot(...min.map((x,k)=>max[k]-x)),chord=requestedChord??meshDeflection(diagonal)
  if(!(chord>0) || !Number.isFinite(chord)) throw Error('Invalid surface mesh chord')
  if(!Number.isFinite(diagonal)) return {chord,triangles:Infinity}
  let total=0
  for(let i=1;i<us.length-1;i+=2) for(let j=1;j<vs.length-1;j+=2) {
    const du=us[i+1].t-us[i-1].t,dv=vs[j+1].t-vs[j-1].t
    const c=(i*vs.length+j)*3,l=c-vs.length*3,r=c+vs.length*3,b=c-3,t=c+3
    const u=[0,0,0],v=[0,0,0],uu=[0,0,0],vv=[0,0,0]
    for(let k=0;k<3;k++) {
      u[k]=(points[r+k]-points[l+k])/du;v[k]=(points[t+k]-points[b+k])/dv
      uu[k]=(points[r+k]-2*points[c+k]+points[l+k])/(du*du/4)
      vv[k]=(points[t+k]-2*points[c+k]+points[b+k])/(dv*dv/4)
    }
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],area=Math.hypot(...n)
    if(area===0) continue
    const dot=(a:number[],b:number[])=>a.reduce((s,x,k)=>s+x*b[k],0)
    const curvature=Math.max(Math.abs(dot(uu,n))/(area*dot(u,u)),Math.abs(dot(vv,n))/(area*dot(v,v)))
    const edge=Math.min(diagonal,curvature>1e-12?Math.min(Math.sqrt(8*chord/curvature),.15/curvature):Infinity)
    total+=2*du*dv*area/(edge*edge)
  }
  return {chord,triangles:Number.isFinite(total)?Math.round(3*total):Infinity}
}
