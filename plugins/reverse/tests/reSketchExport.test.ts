// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { exportSketch, sketchToDxf, flattenExportBezier } from '../core/sketchExport'
import type { SketchEntity } from '../core/sketch'
import { bsplineAt, splineCurve, splineEnd, splineStretch } from '../core/sketchSpline'
const entities: SketchEntity[]=[{id:1,kind:'line',a:[-9.797080994,-5],b:[9.797080994,-5]},{id:2,kind:'circle',c:[2,3],r:4},{id:3,kind:'arc',c:[0,0],r:2,start:0,sweep:-Math.PI/2},{id:4,kind:'spline',pts:[[0,0],[2,3],[5,1],[8,4]]},{id:5,kind:'line',a:[0,0],b:[9,9],construction:true}]
function pairs(text:string){const lines=text.trimEnd().split(/\r?\n/);return Array.from({length:lines.length/2},(_,i)=>[Number(lines[2*i]),lines[2*i+1]] as const)}
function records(text:string){const result:Array<Array<readonly [number,string]>>=[];for(const p of pairs(text)){if(p[0]===0)result.push([]);result.at(-1)?.push(p)}return result}
it('editor IGES uses local XY while retaining millimetres and excludes construction geometry',()=>{
 const out=exportSketch(entities,'iges','Test');expect(out.extension).toBe('igs');expect(out.text).toContain('110,-9.797080994,-5.0,0.0,9.797080994,-5.0,0.0;')
 expect(out.text).toContain('124,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0;')
})
it('writes R14 analytic arcs and exact cubic spline control points, knots and version',()=>{
 const text=sketchToDxf(entities,true);expect(text).toContain('AC1014')
 const rs=records(text);expect(rs.filter(r=>r[0][1]==='LINE')).toHaveLength(1)
 const arc=rs.find(r=>r[0][1]==='ARC')!;expect(arc.find(p=>p[0]===50)?.[1]).toBe('270');expect(arc.find(p=>p[0]===51)?.[1]).toBe('0')
 const r=rs.find(r=>r[0][1]==='SPLINE')!, knots=r.filter(p=>p[0]===40).map(p=>Number(p[1])),xs=r.filter(p=>p[0]===10).map(p=>Number(p[1])),ys=r.filter(p=>p[0]===20).map(p=>Number(p[1]))
 expect(knots.length).toBe(xs.length+4);expect(r.filter(p=>p[0]===30).every(p=>Number(p[1])===0)).toBe(true)
 const distinct=[...new Set(knots)], b={poles:xs.map((x,i)=>[x,ys[i]]),knots:distinct,mults:distinct.map(k=>knots.filter(v=>v===k).length)}
 const curve=splineCurve(entities[3] as Extract<SketchEntity,{kind:'spline'}>),expected=splineStretch(curve,0,splineEnd(curve))!
 for(let i=0;i<=20;i++){const t=knots.at(-1)!*i/20;const a=bsplineAt(b,t),e=bsplineAt(expected,t);expect(Math.hypot(a[0]-e[0],a[1]-e[1])).toBeLessThan(1e-10)}
})
it('writes R12 without spline/subclass records and approximates a bowed cubic within tolerance',()=>{
 const text=sketchToDxf(entities,false);expect(text).toContain('AC1009');expect(records(text).some(r=>r[0][1]==='SPLINE')).toBe(false);expect(pairs(text).some(p=>p[0]===100)).toBe(false)
 const b:[[number,number],[number,number],[number,number],[number,number]]=[[0,0],[0,10],[10,10],[10,0]], poly=flattenExportBezier(b)
 const distance=(x:number,y:number)=>Math.min(...poly.slice(1).map((p,i)=>{const a=poly[i],dx=p[0]-a[0],dy=p[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)}))
 for(let i=0;i<=100;i++){const t=i/100,u=1-t;expect(distance(30*u*t*t+10*t*t*t,30*u*u*t+30*u*t*t)).toBeLessThanOrEqual(.01)}
})

if(process.env.SKETCH_EXPORT_EVIDENCE){
 const directory=process.env.SKETCH_EXPORT_EVIDENCE;mkdirSync(directory,{recursive:true})
 for(const format of ['iges','dxf-r14','dxf-r12'] as const){const out=exportSketch(entities,format,'Verification');writeFileSync(join(directory,`quick-verification-${format}.${out.extension}`),out.text)}
}
