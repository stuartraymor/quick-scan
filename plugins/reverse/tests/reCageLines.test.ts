// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { cageLines } from '../core/freeform/cageLines'
describe('preview cage edges', () => {
  const p = [0,0,0, 1,0,0, 1,1,0, 0,1,0, 2,0,0, 2,1,0]
  it('draws a quad boundary without tessellation diagonals', () => {
    const lines = cageLines(p, [[0,1,2,3]])
    expect(lines.length).toBe(24)
    expect(Array.from(lines.slice(-6))).toEqual([0,1,0, 0,0,0])
  })
  it('draws the shared edge of adjacent quads once regardless of winding', () => {
    expect(cageLines(p, [[0,1,2,3], [1,4,5,2]]).length).toBe(7 * 6)
    expect(cageLines(p, [[0,1,2,3], [2,5,4,1]]).length).toBe(7 * 6)
  })
  it('rejects broken references and non-finite coordinates', () => {
    expect(() => cageLines(p, [[0,1,99,3]])).toThrow('invalid vertex')
    expect(() => cageLines([NaN,0,0, 1,0,0], [[0,1]])).toThrow('non-finite')
  })
})
