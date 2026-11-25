// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { Builder } from '../core/build'
import { edgeSelectionOptions } from '../core/edgeSelectionOptions'
import { build, extrudeAll, rectangleSketch } from './reKit'
import { faceRound } from '../core/faceRound'
import { ReKernel, type Shape } from '../core/kernel'
import type { LoopPiece } from '../core/kernelTypes'
import { validLaw } from '../core/roundInputs'

describe('Fillet and Chamfer edge finishing', () => {
  let k: ReKernel
  const owned: Shape[] = []
  const keep = (s: Shape) => { owned.push(s); return s }
  beforeAll(async () => { k = await ReKernel.load() })
  afterEach(() => { for (const s of owned.splice(0).reverse()) k.release(s) })

  it('offers the two distinct closed boundaries through a box edge and an alternative single pick', async () => {
    const sketch = rectangleSketch(1, 30, 18)
    const builder = new Builder(k)
    try {
      const { topology } = (await build(builder, [sketch, extrudeAll(2, sketch, 0, 8)])).bodies[0]
      const seed = topology.edges[0]
      const neighbor = topology.edges.find(e => e.hash !== seed.hash && e.ends.some(p => seed.ends.some(q => p.every((v,i) => v === q[i]))))!
      const options = edgeSelectionOptions(topology, seed, [seed, neighbor, neighbor])
      expect(options.map(o => o.kind)).toEqual(['single','loop','loop','nearby'])
      for (const loop of options.filter(o => o.kind === 'loop')) {
        expect(loop.edges).toHaveLength(4)
        expect(loop.edges).toContain(seed)
        expect(seed.faces.some(h => loop.edges.every(e => e.faces.includes(h)))).toBe(true)
      }
      expect(options.at(-1)!.edges).toEqual([neighbor])
    } finally { builder.dispose() }
  })

  it('rounds the full center strip of an 8 mm block and rejects overlapping groups', () => {
    const block = keep(k.box([0, 0, 0], [30, 18, 8]))
    const faces = k.faces(block)
    const h = (i: number, v: number) => faces.find(f => Math.abs(f.centroid[i] - v) < 1e-7)!.hash
    const groups = { left: [h(2, 8)], center: [h(0, 30)], right: [h(2, 0)] }
    expect(() => faceRound(k, block, { ...groups, right: groups.left }, true)).toThrow(/separate/)
    const rounded = keep(faceRound(k, block, groups, true).shape)
    expect(k.isClosedSolid(rounded)).toBe(true)
    expect(k.volume(rounded)).toBeCloseTo(30 * 18 * 8 - 18 * (32 - 8 * Math.PI), 4)
    expect(k.faces(rounded).some(f => f.kind === 'cylinder' && Math.abs(f.radius! - 4) < 1e-5)).toBe(true)
  })

  it('uses the wall thickness for a full round on an annular end', () => {
    const rim = (radius: number): LoopPiece => ({ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius })
    const profile = keep(k.face({ outer: [rim(10)], holes: [[rim(6)]] }))
    const tube = keep(k.extrude(profile, [0, 0, 1], 0, 15))
    const faces = k.faces(tube)
    const h = (r: number) => faces.find(f => f.kind === 'cylinder' && Math.abs(f.radius! - r) < 1e-8)!.hash
    const cap = faces.find(f => f.kind === 'plane' && f.centroid[2] > 14.99)!.hash
    const rounded = keep(faceRound(k, tube, { left: [h(10)], center: [cap], right: [h(6)] }, true).shape)
    expect(k.isClosedSolid(rounded)).toBe(true)
    expect(k.faces(rounded).some(f => f.kind === 'torus')).toBe(true)
    // OCCT's default volume integration on a torus is approximate.
    const expected = k.volume(tube) - 16 * Math.PI * (8 - 2 * Math.PI)
    expect(Math.abs(k.volume(rounded) - expected) / expected).toBeLessThan(1e-6)
  })

  it('consumes the end strip between two sloping prismatic sides', () => {
    const pts: Vec3[] = [[0, 0, 0], [30, 0, 0], [30, 8, 0], [0, 14, 0]]
    const profile = keep(k.face({ outer: pts.map((a, i) => ({ kind: 'line', a, b: pts[(i + 1) % pts.length] })), holes: [] }))
    const wedge = keep(k.extrude(profile, [0, 0, 1], 0, 18))
    const faces = k.faces(wedge)
    const left = faces.find(f => f.dir[1] < -0.99)!.hash
    const right = faces.find(f => f.dir[1] > 0.9)!.hash
    const center = faces.find(f => f.dir[0] > 0.99)!.hash
    const rounded = keep(faceRound(k, wedge, { left: [left], right: [right], center: [center] }, true).shape)
    expect(k.isClosedSolid(rounded)).toBe(true)
    expect(k.faces(rounded).filter(f => f.kind === 'cylinder')).toHaveLength(1)
  })

  it('rounds a changing-width spline strip, retaining both end sizes and the back face', () => {
    const upper: Vec3[] = [[0,0,3], [0,12,3], [0,28,6], [0,40,6]]
    const lower: Vec3[] = upper.map(([x,y,z]): Vec3 => [x,y,-z]).reverse()
    const spline = (poles: Vec3[]): LoopPiece => ({ kind: 'spline', poles, knots: [0,1], mults: [4,4] })
    const profile = keep(k.face({ outer: [spline(upper), {kind:'line', a:upper[3], b:lower[0]}, spline(lower), {kind:'line', a:lower[3], b:upper[0]}], holes: [] }))
    const body = keep(k.extrude(profile, [1,0,0], 0, 30))
    const faces = k.faces(body)
    const groups = { left: [faces.find(f => f.centroid[2] > 3)!.hash], center: [faces.find(f => f.centroid[0] > 29.99)!.hash], right: [faces.find(f => f.centroid[2] < -3)!.hash] }
    const result = keep(faceRound(k, body, groups, true).shape)
    expect(k.isClosedSolid(result)).toBe(true)
    const finished = k.faces(result)
    expect(finished.some(f => f.hash === faces.find(f => f.centroid[0] < 0.01)!.hash || (f.kind === 'plane' && Math.abs(f.centroid[0]) < 1e-8))).toBe(true)
    expect(finished.some(f => f.kind === 'plane' && f.centroid[0] > 29.99)).toBe(false)
    for (const [y,r] of [[0,3],[40,6]]) {
      const arc = k.edges(result, 0.005).find(e => Math.abs(e.mid[1] - y) < 1e-6 && Math.abs(e.mid[0] - 30) < 1e-4)!
      expect(arc.length).toBeCloseTo(Math.PI * r, 4)
      for (let j = 0; j < arc.polyline.length; j += 3)
        expect(Math.hypot(arc.polyline[j] - (30-r), arc.polyline[j+2])).toBeCloseTo(r, 4)
    }
  })

  it('applies multiple interior radii to an originally unsplit edge', async () => {
    const block = keep(k.box([0, 0, 0], [40, 20, 12]))
    const edge = k.edges(block, 0.1).find(e => Math.abs(e.length - 40) < 1e-7)!
    const points = [{ position: 0.25, radius: 3 }, { position: 0.7, radius: 2 }]
    const variable = [{ edge: { ...edge, faces: [], origin: 0 }, radius: [1, 1] as [number, number], points }]
    await k.prepareStations([{ kind: 'fillet', body: 1, name: 'Round', id: 2, radius: 1, edges: [], chain: false, variable }])
    const rounded = keep(k.filletVariable(block, edge.hash, 1, 1, points))
    const small = keep(k.filletVariable(block, edge.hash, 1, 1))
    expect(k.isClosedSolid(rounded)).toBe(true)
    expect(k.volume(rounded)).toBeLessThan(k.volume(small) - 1)
    expect(validLaw([1, 1], [...points].reverse())).toBe(false)
    expect(validLaw([1, 1], [{ position: 1, radius: 2 }])).toBe(false)
  })
})
