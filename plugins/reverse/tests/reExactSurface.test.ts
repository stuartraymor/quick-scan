// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import { ReKernel } from '../core/kernel'
import { controlNetOf, DEFAULT_SURFACE_FIT, evalSurface, fitSurface } from '../core/surfaceFit'
import { surfaceAxis, writeSurfaceStep } from '../core/surfaceStep'

it('exports the fitted degree and net and preserves its surface after the temporary shell is released', async () => {
  const k = await ReKernel.load()
  const raw = await OcctKernel.init()
  const points: number[] = []
  for (let x = -30; x <= 30; x += 3) for (let y = -20; y <= 20; y += 2.5) points.push(x,y,0.006*x*x+0.009*y*y+0.003*x*y)
  try {
    for (const degree of [3,4]) {
      const fit = fitSurface(Float32Array.from(points), {...DEFAULT_SURFACE_FIT, net: {u:6,v:5}, degree, expandPct:40, orientation:'oxy'})
      const net = controlNetOf(fit)
      const surface = {u:surfaceAxis(fit.knotsU,fit.degree,fit.nu),v:surfaceAxis(fit.knotsV,fit.degree,fit.nv),poles:Array.from({length:fit.nu*fit.nv},(_,i)=>Array.from(net.points.slice(i*3,i*3+3)))}
      const face = k.surfaceFromControlNet(surface)
      try {
        expect(k.surfaceArea(face)).toBeGreaterThan(0)
        const text = k.exportStep([face])
        const entity = text.match(/B_SPLINE_SURFACE_WITH_KNOTS\s*\(\s*'[^']*'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\(([\s\S]*?)\)\s*,\s*\.UNSPECIFIED\./)
        expect(entity).not.toBeNull()
        expect(Number(entity![1])).toBe(degree); expect(Number(entity![2])).toBe(degree)
        expect(entity![3].match(/#\d+/g)?.length).toBe(30)
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
