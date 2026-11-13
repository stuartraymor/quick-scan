// SPDX-License-Identifier: AGPL-3.0-only
// Outline Mesh with Stacked sections: the outline of only the slab of the part
// between the two planes (clipToSlab + projectedMeshOutline).
import { describe, expect, it } from 'vitest'
import { clipToSlab, projectedMeshOutline } from '../src/core/section/shadow'
import type { SectionFrame } from '../src/core/section/frame'

/** A closed stepped block: z −10..0 is 20 × 10, z 0..10 is 12 × 6. */
function stepped() {
  const rings = [{ z: -10, x: 10, y: 5 }, { z: 0, x: 10, y: 5 }, { z: 0, x: 6, y: 3 }, { z: 10, x: 6, y: 3 }]
  const positions = new Float32Array(rings.flatMap(({ z, x, y }) => [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]].flat()))
  const faces: number[] = []
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < 4; i++) { const a = r * 4 + i, b = r * 4 + (i + 1) % 4, c = a + 4, d = b + 4; faces.push(a, b, d, a, d, c) }
  // The bottom and top caps, so the block is closed.
  faces.push(0, 2, 1, 0, 3, 2, 12, 13, 14, 12, 14, 15)
  return { positions, indices: new Uint32Array(faces) }
}
const XY: SectionFrame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
const halfWidth = (cut: { points: Float32Array }) => {
  let x = 0, y = 0
  for (let i = 0; i < cut.points.length; i += 3) { x = Math.max(x, Math.abs(cut.points[i])); y = Math.max(y, Math.abs(cut.points[i + 1])) }
  return [x, y]
}

describe('the outline of the part between two planes', () => {
  it('outlines only the upper step for a slab across it, only the lower for one across that', () => {
    const { positions, indices } = stepped()
    const upper = clipToSlab(positions, indices, XY, 2, 8)
    const [ux, uy] = halfWidth(projectedMeshOutline(upper.positions, upper.indices, XY))
    expect(ux).toBeCloseTo(6, 0); expect(uy).toBeCloseTo(3, 0)
    const lower = clipToSlab(positions, indices, XY, -8, -2)
    const [lx, ly] = halfWidth(projectedMeshOutline(lower.positions, lower.indices, XY))
    expect(lx).toBeCloseTo(10, 0); expect(ly).toBeCloseTo(5, 0)
  })
  it('a slab across both steps outlines the larger, and one off the part outlines nothing', () => {
    const { positions, indices } = stepped()
    const both = clipToSlab(positions, indices, XY, -5, 5)
    const [bx] = halfWidth(projectedMeshOutline(both.positions, both.indices, XY))
    expect(bx).toBeCloseTo(10, 0)
    const none = clipToSlab(positions, indices, XY, 20, 30)
    expect(none.indices.length).toBe(0)
  })
})
