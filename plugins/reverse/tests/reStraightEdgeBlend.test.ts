// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { ReKernel } from '../core/kernel'
import { cylinderEdgeFillet, straightEdgeBlend } from '../core/straightEdgeBlend'
import { prepareBlendDrag } from '../core/blendDrag'
import { polygonLoop } from '../core/loops'
import { len, sub } from '../../../src/core/vec'
import type { Vec3 } from '../../../src/core/types'

const kernel = ReKernel.load()
const modes = ['fillet', 'chamfer'] as const

describe.each(modes)('bounded straight-edge %s', kind => {
  it.each([60, 90, 120])('makes the exact section at a %i degree corner', async degrees => {
    const k = await kernel
    const theta = degrees * Math.PI / 180, radius = 1.6, span = 18
    const face = k.face({ outer: polygonLoop([[0,0,0], [20,0,0], [20*Math.cos(theta),20*Math.sin(theta),0]]), holes: [] })
    const solid = k.extrude(face, [0,0,1], 0, span)
    try {
      const h = k.edges(solid, 0.1).find(e => len(sub(e.mid,[0,0,span/2])) < 1e-6)!.hash
      const result = straightEdgeBlend(k, solid, h, radius, kind)
      expect(result).not.toBeNull()
      try {
        const area = kind === 'fillet'
          ? radius**2 * (1/Math.tan(theta/2) - (Math.PI-theta)/2)
          : radius**2 * Math.sin(theta)/2
        expect(k.volume(solid)-k.volume(result!.shape)).toBeCloseTo(area*span, 5)
        expect(k.isClosedSolid(result!.shape)).toBe(true)
        expect(straightEdgeBlend(k,solid,h,1000,kind)).toBeNull()
      } finally { if (result) k.release(result.shape) }
    } finally { k.release(solid); k.release(face) }
  })

  it('fills a reentrant corner and preserves the rest of the solid', async () => {
    const k = await kernel, span = 12, size = 1.5
    const profile: Vec3[] = [[0,0,0],[10,0,0],[10,4,0],[4,4,0],[4,10,0],[0,10,0]]
    const face = k.face({ outer: polygonLoop(profile), holes: [] })
    const solid = k.extrude(face, [0,0,1], 0, span)
    try {
      const h = k.edges(solid, 0.1).find(e => len(sub(e.mid,[4,4,span/2])) < 1e-6)!.hash
      const result = straightEdgeBlend(k,solid,h,size,kind)
      expect(result).not.toBeNull()
      try {
        expect(k.isClosedSolid(result!.shape)).toBe(true)
        expect(k.volume(result!.shape)-k.volume(solid)).toBeCloseTo(span*size**2*(kind === 'fillet' ? 1-Math.PI/4 : 0.5), 5)
      } finally { if (result) k.release(result.shape) }
    } finally { k.release(solid); k.release(face) }
  })
})

describe('live edge section', () => {
  it.each(modes)('reads a fractional %s on both sides of its moving face', async kind => {
    const k = await kernel
    const face = k.face({ outer: polygonLoop([[0,0,0],[18,0,0],[18,18,0],[0,18,0]]), holes: [] })
    const solid = k.extrude(face,[0,0,1],0,20)
    const edge = k.edges(solid,0.1).find(e => len(sub(e.mid,[0,0,10]))<1e-6)!
    try {
      const blend = straightEdgeBlend(k,solid,edge.hash,1,kind)!
      try {
        const mesh = k.mesh(blend.shape,0.03)
        const drag = prepareBlendDrag(mesh,blend.section!)!
        const r = 2.2367080581211667
        const d = kind==='fillet' ? r*(1-1/Math.SQRT2) : r/2
        // Scan points straddle the middle of the strip. A fourth is past the end.
        const scan = Float32Array.from([d,d,10,d-.1,d-.1,10,d+.1,d+.1,10,d,d,21])
        const original = mesh.positions.slice()
        for (const size of [1.36,4.957,r]) drag.resize(size)
        const field=drag.field(scan,r,.1)
        expect([...field.subset]).toEqual([0,1,2])
        expect(field.values[0]).toBeCloseTo(0,5)
        expect(field.values[1]).toBeCloseTo(Math.SQRT2*.1,5)
        expect(field.values[2]).toBeCloseTo(-Math.SQRT2*.1,5)
        expect(mesh.positions).toEqual(original)
      } finally { k.release(blend.shape) }
    } finally { k.release(solid); k.release(face) }
  })
})

describe('single-edge sided chamfer', () => {
  it.each([false,true])('builds two distances and a distance at an angle, flip %s', async flip => {
    const k=await kernel, theta=2*Math.PI/3, span=16, first=1.27391
    const face=k.face({outer:polygonLoop([[0,0,0],[28,0,0],[28*Math.cos(theta),28*Math.sin(theta),0]]),holes:[]})
    const solid=k.extrude(face,[0,0,1],0,span)
    try {
      const edge=k.edges(solid,.1).find(e=>len(sub(e.mid,[0,0,span/2]))<1e-6)!
      const side=k.edgeSides(solid,[edge.hash])[0]!.faces[flip?1:0]
      const ref=k.faces(solid).find(f=>f.hash===side)!
      for(const want of [{mode:'twoDistances',distance:first,distance2:2.3478} as const,{mode:'distanceAngle',distance:first,angleDeg:27.83} as const]){
        const second=want.mode==='twoDistances'?want.distance2:first*Math.sin(want.angleDeg*Math.PI/180)/Math.sin(theta+want.angleDeg*Math.PI/180)
        const cut=straightEdgeBlend(k,solid,edge.hash,first,'chamfer',{want,flip})!
        expect(cut).toBeTruthy()
        try {
          expect(k.volume(solid)-k.volume(cut.shape)).toBeCloseTo(span*first*second*Math.sin(theta)/2,5)
          const along:Vec3=Math.abs(ref.dir[0])<.001?[1,0,0]:[Math.cos(theta),Math.sin(theta),0]
          const edges=k.edges(cut.shape,.1)
          expect(edges.some(e=>len(sub(e.mid,[along[0]*first,along[1]*first,span/2]))<1e-5)).toBe(true)
        } finally { k.release(cut.shape) }
      }
    } finally {k.release(solid);k.release(face)}
  })
})

it('trims the chamfer to both sloping end walls and leaves a nearby arm intact', async () => {
  const k = await kernel
  const outline: Vec3[] = [[0,0,0],[20,0,0],[24,8,0],[34,8,0],[34,0,0],[43,0,0],[43,14,0],[-7,14,0]]
  const face = k.face({ outer: polygonLoop(outline), holes: [] })
  const solid = k.extrude(face, [0,0,1], 0, 12)
  try {
    const edge = k.edges(solid, 0.1).find(e => len(sub(e.mid,[10,0,0])) < 1e-6)!
    const distance = 3.36042
    const result = straightEdgeBlend(k, solid, edge.hash, distance, 'chamfer')
    expect(result).toBeTruthy()
    try {
      // At depth y, the selected arm widens to 20+y. Integrate the
      // removed area (20+y)*(distance-y) to the far rail.
      const removed = 10 * distance**2 + distance**3 / 6
      expect(k.volume(solid) - k.volume(result!.shape)).toBeCloseTo(removed, 5)
      for (const x of [-0.3,20.3]) expect(k.containsPoint(result!.shape,[x,1,0.3])).toBe(false)
      expect(k.containsPoint(result!.shape,[38,1,0.3])).toBe(true)
      expect(k.isClosedSolid(result!.shape)).toBe(true)
    } finally { if (result) k.release(result.shape) }
  } finally { k.release(solid); k.release(face) }
})

describe('axial fillet between a plane and an outer cylinder', () => {
  it.each([-4, 0, 6])('meets both supports of a cylinder clipped at y=%i', async cutY => {
    const k = await kernel, outer = 12, radius = 1.73, length = 27
    const profile = k.face({ outer: [{ kind: 'circle', center: [0,0,0], normal: [0,0,1], radius: outer }], holes: [] })
    const cylinder = k.extrude(profile,[0,0,1],0,length)
    const mask = k.box([-15,-15,-1],[15,cutY,length+1])
    const body = k.common(cylinder,mask)
    try {
      const x = Math.sqrt(outer**2-cutY**2)
      const edge = k.edges(body,.02).find(e=>len(sub(e.mid,[x,cutY,length/2]))<1e-5)!
      const result = cylinderEdgeFillet(k,body,edge.hash,radius)
      expect(result).not.toBeNull()
      try {
        expect(k.isClosedSolid(result!.shape)).toBe(true)
        const face = k.faces(result!.shape).find(f=>f.kind==='cylinder' && Math.abs((f.radius??0)-radius)<1e-6)!
        const cx = Math.sqrt((outer-radius)**2-(cutY-radius)**2)
        expect(face.center![0]).toBeCloseTo(cx,6)
        expect(face.center![1]).toBeCloseTo(cutY-radius,6)
        for (const z of [0, length/2, length]) {
          const surface = k.faceCopy(result!.shape,face.hash)
          try {
            expect(k.distanceToPoint(surface,[cx,cutY,z])).toBeLessThan(1e-6)
            expect(k.distanceToPoint(surface,[cx*outer/(outer-radius),(cutY-radius)*outer/(outer-radius),z])).toBeLessThan(1e-6)
          } finally { k.release(surface) }
        }
        expect(k.containsPoint(result!.shape,[-x+.05,cutY-.05,length/2])).toBe(true)
        expect(cylinderEdgeFillet(k,body,edge.hash,outer)).toBeNull()
      } finally { if(result)k.release(result.shape) }
    } finally { for(const s of [body,mask,cylinder,profile])k.release(s) }
  })
})
