// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { ReKernel, type Shape } from '../core/kernel'
import { straightEdgeBlend } from '../core/straightEdgeBlend'

const kernel = ReKernel.load()
const near = (a: number, b: number) => Math.abs(a - b) < 1e-5

it.each([-3, 2])('keeps a single floor fillet inside the bore at y=%s', async y => {
  const k = await kernel, owned: Shape[] = [], keep = (s: Shape) => { owned.push(s); return s }
  try {
    const wall = 10, foot = .45, r = 2.3, z = 6
    const stock = keep(k.box([-20, -20, 0], [20, 20, 30]))
    const disk = keep(k.face({ outer: [{ kind: 'circle', center: [0, 0, z], normal: [0, 0, 1], radius: wall }], holes: [] }))
    const bored = keep(k.cut(stock, keep(k.extrude(disk, [0, 0, 1], 0, 25))))
    const floorRim = k.edges(bored, .1).find(e => e.kind === 'circle' && near(e.mid[2], z))!
    const rounded = keep(k.filletTracked(bored, [floorRim.hash], foot).shape)
    const body = keep(k.common(rounded, keep(k.box([-21, -21, -1], [21, y, 31]))))
    const pick = k.edges(body, .1).find(e => e.kind === 'line' && near(e.mid[1], y) && near(e.mid[2], z))!
    const made = straightEdgeBlend(k, body, pick.hash, r, 'fillet')
    expect(made).not.toBeNull()
    const result = keep(made!.shape)
    k.mesh(result, .04)
    expect(k.isClosedSolid(result)).toBe(true)
    const cyl = k.faces(result).find(f => f.kind === 'cylinder' && near(f.radius ?? 0, r))!
    const rails = k.edges(result, .1).filter(e => e.faceHashes.includes(cyl.hash))
    const floor = rails.find(e => e.kind === 'line' && near(e.mid[2], z))!
    expect(floor.length).toBeCloseTo(2 * Math.sqrt((wall - foot) ** 2 - (y - r) ** 2), 5)
    const ends = rails.filter(e => e.kind !== 'line')
    // A periodic seam can divide an end at positive section offsets.
    expect(new Set(ends.map(e => Math.sign(e.mid[0])))).toEqual(new Set([-1, 1]))
    for (const end of ends) {
      expect(end.faceHashes).toHaveLength(2)
      expect(end.faceHashes.some(h => k.faces(result).some(f => f.hash === h && f.kind === 'other'))).toBe(true)
    }
    for (const x of [-15, 15]) expect(k.containsPoint(result, [x, y - r / 8, z - r / 8])).toBe(true)
    expect(k.containsPoint(result, [0, y - r / 8, z - r / 8])).toBe(false)
  } finally { owned.reverse().forEach(s => k.release(s)) }
})

it('carries a chamfer into the existing floor round across a periodic seam', async () => {
  const k = await kernel, owned: Shape[] = [], keep = (s: Shape) => { owned.push(s); return s }
  try {
    const wall = 11.31, foot = .392, z = 5.12, y = .53157, d = .258
    const stock = keep(k.box([-22.62, -22.62, 0], [22.62, 22.62, 30.24]))
    const disk = keep(k.face({ outer: [{ kind: 'circle', center: [0, 0, z], normal: [0, 0, 1], radius: wall }], holes: [] }))
    let pocket = keep(k.cut(stock, keep(k.extrude(disk, [0, 0, 1], 0, 31))))
    for (const [height, size] of [[z, foot], [30.24, d]]) {
      const rail = k.edges(pocket, .1).find(e => e.kind === 'circle' && near(e.mid[2], height))!
      pocket = keep(k.filletTracked(pocket, [rail.hash], size).shape)
    }
    const part = keep(k.common(pocket, keep(k.box([-34, -34, -1], [34, y, 31]))))
    const body = keep(k.importStep(k.exportStep([part])))
    const edge = k.edges(body, .1).find(e => e.kind === 'line' && near(e.mid[2], z) && near(e.mid[1], y))!
    const result = straightEdgeBlend(k, body, edge.hash, d, 'chamfer')
    expect(result).not.toBeNull()
    const shape = keep(result!.shape)
    const saved = keep(k.importStep(k.exportStep([shape])))
    expect(k.isClosedSolid(saved)).toBe(true)
    expect(k.solidCount(saved)).toBe(1)
    expect(k.distanceToPoint(saved, edge.mid)).toBeCloseTo(d / Math.SQRT2, 6)
    for (const x of [-17, 17]) expect(k.containsPoint(saved, [x, y - d / 8, z - d / 8])).toBe(true)
    const bevel = k.faces(saved).find(f => f.kind === 'plane' && near(Math.abs(f.dir[1]), Math.SQRT1_2))!
    const face = keep(k.faceCopy(saved, bevel.hash))
    expect(k.distanceToPoint(face, [0, y - d, z])).toBeLessThan(1e-5)
    expect(k.distanceToPoint(face, [0, y, z - d])).toBeLessThan(1e-5)
  } finally { owned.reverse().forEach(s => k.release(s)) }
})
