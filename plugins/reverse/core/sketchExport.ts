// SPDX-License-Identifier: AGPL-3.0-only
import type { SketchEntity } from './sketch'
import type { Vec2 } from '../../../src/core/flat/types'
import { sketchToIges } from './igesExport'
import { splineCurve, splineEnd, splineStretch, splineStretchBeziers, type Bezier } from './sketchSpline'

export type SketchExportFormat = 'iges' | 'dxf-r14' | 'dxf-r12'
export const SKETCH_EXPORT_FORMATS: Record<SketchExportFormat, string> = {
  iges: 'Export in IGES', 'dxf-r14': 'Export in DXF R14 (with spline support)', 'dxf-r12': 'Export in DXF R12 (old, 2D only)',
}
// Native Edit Sketch exports use the sketch's XY frame, including on offset OYZ planes.
export function exportSketch(entities: readonly SketchEntity[], format: SketchExportFormat, name: string): { text: string; extension: string; mime: string } {
  if (format === 'iges') return { text: sketchToIges(entities, { origin: [0,0,0], basisU: [1,0,0], basisV: [0,1,0], normal: [0,0,1] }, name), extension: 'igs', mime: 'model/iges' }
  return { text: sketchToDxf(entities, format === 'dxf-r14'), extension: 'dxf', mime: 'application/dxf' }
}
const number = (n: number) => { if (!Number.isFinite(n)) throw new Error('Cannot export non-finite sketch coordinates.'); return String(Number(n.toPrecision(15))) }
const group = (code: number, value: string | number) => `${code}
${typeof value === 'number' ? number(value) : value}
`
const point = (p: readonly number[], code = 10) => group(code,p[0])+group(code+10,p[1])+group(code+20,0)
const degrees = (r: number) => ((r*180/Math.PI)%360+360)%360
const middle = (a: Vec2,b: Vec2): Vec2 => [(a[0]+b[0])/2,(a[1]+b[1])/2]
/** R12 has no SPLINE: subdivide the exact cubic until its control hull is within .01mm of the chord. */
export function flattenExportBezier(b: Bezier, tolerance = .01, depth = 0): Vec2[] {
  const [a,p,q,z]=b, dx=z[0]-a[0],dy=z[1]-a[1],length=Math.hypot(dx,dy)
  const distance=(p:Vec2)=>{
    const t=length ? Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(length*length))) : 0
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)
  }
  if(Math.max(distance(p),distance(q))<=tolerance) return [a,z]
  if(depth>=20) throw new Error('The curve is too complex for the R12 export tolerance.')
  const ap=middle(a,p),pq=middle(p,q),qz=middle(q,z),l=middle(ap,pq),r=middle(pq,qz),c=middle(l,r)
  return [...flattenExportBezier([a,ap,l,c],tolerance,depth+1).slice(0,-1),...flattenExportBezier([c,r,qz,z],tolerance,depth+1)]
}
export function sketchToDxf(entities: readonly SketchEntity[], r14: boolean): string {
  let handle=256
  const entity=(kind:string,sub:string)=>group(0,kind)+group(5,(handle++).toString(16).toUpperCase())+(r14?group(100,'AcDbEntity'):'')+group(8,'Sketch')+(r14?group(100,sub):'')
  let out=group(0,'SECTION')+group(2,'HEADER')+group(9,'$ACADVER')+group(1,r14?'AC1014':'AC1009')+group(9,'$MEASUREMENT')+group(70,1)+group(0,'ENDSEC')
  out+=group(0,'SECTION')+group(2,'TABLES')+group(0,'TABLE')+group(2,'LAYER')+(r14?group(5,'2')+group(100,'AcDbSymbolTable'):'')+group(70,1)
  out+=group(0,'LAYER')+(r14?group(5,'10')+group(100,'AcDbSymbolTableRecord')+group(100,'AcDbLayerTableRecord'):'')+group(2,'Sketch')+group(70,0)+group(62,7)+group(6,'CONTINUOUS')+group(0,'ENDTAB')+group(0,'ENDSEC')
  out+=group(0,'SECTION')+group(2,'ENTITIES')
  for(const e of entities){
    if(e.construction||e.kind==='point')continue
    if(e.kind==='line') out+=entity('LINE','AcDbLine')+point(e.a)+point(e.b,11)
    else if(e.kind==='circle'||e.kind==='arc'){
      out+=entity(e.kind==='circle'?'CIRCLE':'ARC','AcDbCircle')+point(e.c)+group(40,e.r)
      if(e.kind==='arc'){
        const start=e.sweep>=0?e.start:e.start+e.sweep
        out+=(r14?group(100,'AcDbArc'):'')+group(50,degrees(start))+group(51,degrees(start+Math.abs(e.sweep)))
      }
    }else{
      const curve=splineCurve(e),end=splineEnd(curve)
      if(r14){
        const b=splineStretch(curve,0,end);if(!b)continue
        const knots=b.knots.flatMap((k,i)=>Array<number>(b.mults[i]).fill(k))
        out+=entity('SPLINE','AcDbSpline')+group(210,0)+group(220,0)+group(230,1)+group(70,8+(e.closed?1:0))+group(71,3)+group(72,knots.length)+group(73,b.poles.length)+group(74,0)
        for(const k of knots)out+=group(40,k)
        for(const p of b.poles)out+=point(p)
      }else{
        const pieces=splineStretchBeziers(curve,0,end).pieces
        const points=pieces.flatMap((p,i)=>flattenExportBezier(p).slice(i?1:0))
        if(!points.length)continue
        out+=entity('POLYLINE','')+group(66,1)+point([0,0])+group(70,e.closed?1:0)
        for(const p of points)out+=entity('VERTEX','')+point(p)+group(70,0)
        out+=entity('SEQEND','')
      }
    }
  }
  return out+group(0,'ENDSEC')+group(0,'EOF')
}
