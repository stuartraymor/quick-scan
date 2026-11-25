// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { ReKernel, type Shape } from '../core/kernel'
import { boreEntranceFillet } from '../core/boreEntranceFillet'

const kernel = ReKernel.load()
const near = (a: number,b: number) => Math.abs(a-b) < 1e-5

describe('a fillet around a blind bore exposed by a cut plane', () => {
  it.each([[-3, 0.17], [-2, 2.16], [0, 1.731], [3, 1.23]])('rounds the three picks at y=%s with radius %s and keeps the pre-existing rounds', async (cutY, radius) => {
    const k = await kernel, owned: Shape[] = [], keep = (s: Shape) => { owned.push(s); return s }
    try {
      const stock = keep(k.box([-20,-20,0],[20,20,30]))
      const profile = keep(k.face({outer:[{kind:'circle',center:[0,0,5],normal:[0,0,1],radius:10}],holes:[]}))
      const hole = keep(k.extrude(profile,[0,0,1],0,35))
      let bored = keep(k.cut(stock,hole))
      for (const [z,r] of [[5,.45],[30,.28]]) {
        const edge = k.edges(bored,.1).find(e=>e.kind==='circle' && near(e.mid[2],z))!
        bored = keep(k.filletTracked(bored,[edge.hash],r).shape)
      }
      const clip = keep(k.box([-21,-21,-1],[21,cutY,31]))
      const body = keep(k.common(bored,clip)), edges = k.edges(body,.05)
      const picks = edges.filter(e=>e.kind==='line' && near(e.mid[1],cutY) && (near(e.mid[2],5) || near(e.length,30-.28-5-.45)))
      expect(picks).toHaveLength(3)
      const extra = edges.filter(e=>e.kind!=='line' && near(e.mid[1],cutY) && Math.abs(e.mid[2]-5)<.5)
      const selection = cutY>0 ? [...extra,...picks].reverse() : picks
      const result = boreEntranceFillet(k,body,selection.map(e=>e.hash),radius)
      expect(result).not.toBeNull()
      const rounded = keep(result!.shape)
      expect(k.isClosedSolid(rounded)).toBe(true)
      expect(k.solidCount(rounded)).toBe(1)
      expect(k.volume(rounded)).toBeLessThan(k.volume(body))
      const faces = k.faces(rounded)
      const fillets = faces.filter(f=>f.kind==='cylinder' && f.radius && near(f.radius,radius))
      expect(fillets).toHaveLength(3)
      // Outside a bore, the centre of the rolling circle lies R+r from the bore axis.
      for (const sign of [-1,1]) {
        const x = sign*Math.sqrt((10+radius)**2-(cutY-radius)**2)
        const side = fillets.find(f=>f.center && near(f.center[0],x))!
        const face = keep(k.faceCopy(rounded,side.hash))
        expect(k.distanceToPoint(face,[x,cutY,18])).toBeLessThan(1e-5)
        expect(k.distanceToPoint(face,[x*10/(10+radius),(cutY-radius)*10/(10+radius),18])).toBeLessThan(1e-5)
      }
      const floor = keep(k.faceCopy(rounded,fillets.find(f=>Math.abs(f.dir[0])>.999)!.hash))
      expect(k.distanceToPoint(floor,[0,cutY,5-radius])).toBeLessThan(1e-5)
      expect(k.distanceToPoint(floor,[0,cutY-radius,5])).toBeLessThan(1e-5)
      const remote = edges.find(e=>e.kind==='line' && near(e.mid[1],-20))!
      expect(boreEntranceFillet(k,body,[...picks.map(e=>e.hash),remote.hash],radius)).toBeNull()
    } finally { owned.reverse().forEach(s=>k.release(s)) }
  })
})
