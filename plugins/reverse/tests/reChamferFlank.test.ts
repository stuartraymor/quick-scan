// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, describe, expect, it } from 'vitest'
import { ReKernel, type LoopPiece, type Shape } from '../core/kernel'
import { straightEdgeBlend } from '../core/straightEdgeBlend'
import type { Vec3 } from '../../../src/core/types'

describe('a setback which consumes the narrow flank of an extrusion', () => {
  let k: ReKernel
  beforeAll(async () => { k = await ReKernel.load() }, 60_000)
  function prism(points: [number, number][], height: number) {
    const corners: Vec3[] = points.map(([x, y]) => [x, y, 0])
    const outer: LoopPiece[] = corners.map((a, i) => ({ kind: 'line', a, b: corners[(i + 1) % corners.length] }))
    const face = k.face({ outer, holes: [] })
    try { return k.extrude(face, [0, 0, 1], 0, height) } finally { k.release(face) }
  }
  const upright = (shape: Shape) => k.edges(shape, 0.05).find(e => Math.hypot(e.mid[0], e.mid[1]) < 1e-7)!
  it('clips the bevel to the oblique next flank and preserves the exact setback plane', () => {
    const body = prism([[0, 0], [10, 0], [10, 8], [3, 8], [0, 2]], 5)
    const result = straightEdgeBlend(k, body, upright(body).hash, 3, 'chamfer')
    try {
      expect(result).not.toBeNull()
      const shape = result!.shape
      expect(k.isClosedSolid(shape)).toBe(true)
      expect(k.solidCount(shape)).toBe(1)
      // The 3-by-3 triangular chip excludes the 1/6 mm² outside the stock.
      expect(k.volume(body) - k.volume(shape)).toBeCloseTo((4.5 - 1 / 6) * 5, 6)
      const bevel = k.faces(shape).find(f => f.kind === 'plane' && Math.abs(f.centroid[0] + f.centroid[1] - 3) < 1e-7 && Math.abs(f.dir[0] * f.dir[1] - 0.5) < 1e-7)
      expect(bevel).toBeDefined()
      const face = k.faceCopy(shape, bevel!.hash)
      try {
        for (const p of [[3, 0, 2.5], [1.5, 1.5, 2.5], [1 / 3, 8 / 3, 2.5]] as Vec3[])
          expect(k.distanceToPoint(face, p)).toBeLessThan(1e-6)
      } finally { k.release(face) }
    } finally { if (result) k.release(result.shape); k.release(body) }
  })
  it('keeps the original wall-width limit for a rectangular bar', () => {
    const body = prism([[0, 0], [10, 0], [10, 2], [0, 2]], 5)
    try { expect(straightEdgeBlend(k, body, upright(body).hash, 3, 'chamfer')).toBeNull() }
    finally { k.release(body) }
  })
})
