// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { refineDeviation, type MeasuredTriangles } from '../core/freeform/deviationRefinement'

const measure = (p: Float32Array) => Float32Array.from({length:p.length/3},(_,i)=>Math.hypot(p[i*3],p[i*3+2])-2)
const input = (): MeasuredTriangles => {
  const positions=Float32Array.from([-2,-1,2,2,-1,2,2,1,2,-2,1,2])
  return {positions,triangles:Uint32Array.from([0,1,2,0,2,3]),values:measure(positions)}
}
it('resolves curved-reference deviation inside flat CAD triangles without moving the surface',()=>{
 const original=input(),before=structuredClone(original),out=refineDeviation(original,measure,.01)
 expect(out.positions.length).toBeGreaterThan(original.positions.length)
 const uses=new Map<string,number>();let error=0,area=0
 for(let i=0;i<out.triangles.length;i+=3){
  const ids=Array.from(out.triangles.subarray(i,i+3)),p=ids.map(v=>Array.from(out.positions.subarray(v*3,v*3+3))),centre=Float32Array.from([0,1,2].map(k=>p.reduce((s,q)=>s+q[k],0)/3)),actual=measure(centre)[0],interpolated=ids.reduce((s,v)=>s+out.values[v],0)/3
  if(Math.min(actual,interpolated)<.05)error=Math.max(error,Math.abs(actual-interpolated))
  const cross=(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]);expect(cross).toBeGreaterThan(0);area+=cross/2
  for(let k=0;k<3;k++){const a=ids[k],b=ids[(k+1)%3],key=[a,b].sort((a,b)=>a-b).join(':');uses.set(key,(uses.get(key)??0)+1)}
 }
 expect(error).toBeLessThan(.0002);expect(area).toBeCloseTo(8,6)
 for(const [key,count] of uses)if(count===1){const [a,b]=key.split(':').map(Number),p=Array.from(out.positions.subarray(a*3,a*3+3)),q=Array.from(out.positions.subarray(b*3,b*3+3));expect((p[0]===q[0]&&Math.abs(p[0])===2)||(p[1]===q[1]&&Math.abs(p[1])===1)).toBe(true)}else expect(count).toBe(2)
 expect(Array.from(out.positions).filter((_,i)=>i%3===2).every(z=>z===2)).toBe(true);expect(original).toEqual(before)
})
it('retains linear measurements without unnecessary refinement',()=>{
 const c=input(),linear=(p:Float32Array)=>Float32Array.from({length:p.length/3},(_,i)=>p[i*3]*.01);c.values=linear(c.positions)
 expect(refineDeviation(c,linear,.01)).toBe(c)
})
it('rejects a missing measurement without mutating the input',()=>{
 const c=input(),before=structuredClone(c);expect(()=>refineDeviation(c,p=>new Float32Array(p.length/3).fill(NaN),.01)).toThrow('Incomplete');expect(c).toEqual(before)
})
it('respects the sampling budget and rejects an invalid tolerance',()=>{
 const c=input();expect(refineDeviation(c,measure,.01,4)).toBe(c);expect(()=>refineDeviation(c,measure,0)).toThrow('Invalid')
})
