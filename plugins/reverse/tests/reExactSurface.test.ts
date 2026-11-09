// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import { ReKernel } from '../core/kernel'
import { controlNetOf, DEFAULT_SURFACE_FIT, evalSurface, fitSurface } from '../core/surfaceFit'
import { moveSurfacePole, surfaceAxis, writeSurfaceStep } from '../core/surfaceStep'

it('exports the fitted degree and net and preserves its surface after the temporary shell is released', async () => {
  const k = await ReKernel.load()
  const raw = await OcctKernel.init()
  const points: number[] = []
  for (let x = -30; x <= 30; x += 3) for (let y = -20; y <= 20; y += 2.5) points.push(x,y,0.006*x*x+0.009*y*y+0.003*x*y)
  try {
    for (const degree of [3,4,9]) {
      const askedNet = degree === 9 ? {u:10,v:10} : {u:6,v:5}
      const fit = fitSurface(Float32Array.from(points), {...DEFAULT_SURFACE_FIT, net: askedNet, degree, expandPct:40, orientation:'oxy'})
      const net = controlNetOf(fit)
      const surface = {u:surfaceAxis(fit.knotsU,fit.degree,fit.nu),v:surfaceAxis(fit.knotsV,fit.degree,fit.nv),poles:Array.from({length:fit.nu*fit.nv},(_,i)=>Array.from(net.points.slice(i*3,i*3+3)))}
      const face = k.surfaceFromControlNet(surface)
      try {
        expect(k.surfaceArea(face)).toBeGreaterThan(0)
        const text = k.exportStep([face])
        const entity = text.match(/B_SPLINE_SURFACE_WITH_KNOTS\s*\(\s*'[^']*'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\(([\s\S]*?)\)\s*,\s*\.UNSPECIFIED\./)
        expect(entity).not.toBeNull()
        expect(Number(entity![1])).toBe(degree); expect(Number(entity![2])).toBe(degree)
        expect(entity![3].match(/#\d+/g)?.length).toBe(askedNet.u * askedNet.v)
        const imported=raw.importStep(text),faces=raw.getSubShapes(imported,'face')
        try {
          expect(faces).toHaveLength(1);expect(raw.isValid(imported)).toBe(true)
          for(let i=0;i<=12;i++)for(let j=0;j<=12;j++){
            const u=fit.uRange[0]+i/12*(fit.uRange[1]-fit.uRange[0]),v=fit.vRange[0]+j/12*(fit.vRange[1]-fit.vRange[0])
            const p=evalSurface(fit,u,v),q=raw.pointOnSurface(faces[0],u,v)
            expect(Math.hypot(p[0]-q.x,p[1]-q.y,p[2]-q.z)).toBeLessThan(1e-8)
          }
        } finally {faces.forEach(f=>raw.release(f));raw.release(imported)}
      } finally {k.release(face)}
    }
  } finally {raw[Symbol.dispose]()}
}, 60_000)

it('rejects malformed or unsupported exact nets instead of silently refitting', () => {
  const axis={degree:1,count:2,knots:[-2,3],mults:[2,2]}
  const s={u:axis,v:axis,poles:[[0,0,0],[0,1,0],[1,0,0],[1,1,0]]}
  expect(()=>writeSurfaceStep({...s,poles:[[NaN,0,0],...s.poles.slice(1)]})).toThrow()
  expect(()=>writeSurfaceStep({...s,u:{...axis,mults:[1,2]}})).toThrow()
  expect(()=>writeSurfaceStep({...s,v:{...axis,knots:[3,-2]}})).toThrow()
  expect(()=>writeSurfaceStep({...s,weights:[1,1,1,1]} as never)).toThrow()
})

it('moves one XYZ pole at half strength, preserving the source and exact spline influence', async () => {
  const axis={degree:4,count:5,knots:[0,1],mults:[5,5]}
  const source={u:structuredClone(axis),v:structuredClone(axis),poles:Array.from({length:25},(_,i)=>{const u=Math.floor(i/5),v=i%5;return [u*10,v*10,0.2*u*v]})}
  const snapshot=structuredClone(source)
  const delta=[15.594033185,15.594033867,0]
  const moved=moveSurfacePole(source,1,1,delta,50)
  expect(source).toEqual(snapshot)
  expect(moved.u).toEqual(source.u);expect(moved.v).toEqual(source.v)
  for(let i=0;i<25;i++)if(i!==6)expect(moved.poles[i]).toEqual(source.poles[i])
  expect(moved.poles[6]).toEqual(source.poles[6].map((x,i)=>x+delta[i]/2))
  const restored=moveSurfacePole(moved,1,1,delta.map(x=>-x),50)
  restored.poles.forEach((p,i)=>p.forEach((x,j)=>expect(x).toBeCloseTo(source.poles[i][j],12)))
  // Independent CAD evaluation: the (1,1) quartic pole's basis is 1/16
  // at the center and zero at every corner; tangential motion is retained.
  const raw=await OcctKernel.init()
  const shapes=[raw.importStep(writeSurfaceStep(source)),raw.importStep(writeSurfaceStep(moved))]
  const faces=shapes.map(s=>raw.getSubShapes(s,'face'))
  try {
    for(const [u,v,weight] of [[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0.5,0.5,1/16]]){
      const a=raw.pointOnSurface(faces[0][0],u,v),b=raw.pointOnSurface(faces[1][0],u,v)
      expect(Math.hypot(b.x-a.x-delta[0]*weight/2,b.y-a.y-delta[1]*weight/2,b.z-a.z)).toBeLessThan(1e-10)
    }
    expect(()=>moveSurfacePole(source,5,0,delta)).toThrow()
    expect(()=>moveSurfacePole(source,0,0,[Infinity,0,0])).toThrow()
    expect(()=>moveSurfacePole(source,0,0,delta,101)).toThrow()
  } finally {faces.flat().forEach(f=>raw.release(f));shapes.forEach(s=>raw.release(s));raw[Symbol.dispose]()}
})
