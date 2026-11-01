import { describe, expect, it } from 'vitest'
import { enlargeVertices, shrinkVertices, wandSelect } from '../src/core/geometry/wand'

// A sheet 4 columns long and 1 wide folded 90° at column 2: the first two
// columns lie flat, the last two stand up.
function folded() {
  const pos: number[] = []
  for (let i = 0; i <= 4; i++) for (const y of [0, 1]) pos.push(Math.min(i, 2), y, Math.max(i - 2, 0))
  const idx: number[] = []
  for (let i = 0; i < 4; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d) }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx) }
}
describe('magic wand', () => {
  it('stops at a crease sharper than the sensitivity', () => {
    const { pos, idx } = folded()
    expect([...wandSelect(idx, pos, 0, 20)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
  })
  it('crosses the crease when the sensitivity allows it', () => {
    const { pos, idx } = folded()
    expect(wandSelect(idx, pos, 99, 90).length).toBe(0)
    expect(wandSelect(idx, pos, 0, 90).length).toBe(10)
  })
  it('refuses a bad seed or angle without throwing', () => {
    const { pos, idx } = folded()
    expect(wandSelect(idx, pos, 99, 20).length).toBe(0)
    expect(wandSelect(idx, pos, 0, NaN).length).toBe(0)
  })
  it("enlarges and shrinks by one ring", () => {
    const { idx } = folded()
    expect([...enlargeVertices(idx, Uint32Array.of(0, 1))].sort((a, b) => a - b)).toEqual([0, 1, 2, 3])
    // Columns 0-1 marked (vertices 0-5): the end vertices 0,1 and the edge ring 4,5 touch unmarked triangles.
    expect([...shrinkVertices(idx, Uint32Array.from([0, 1, 2, 3, 4, 5]))].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5].filter((v) => v < 4))
  })
})
