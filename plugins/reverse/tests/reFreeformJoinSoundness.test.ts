// SPDX-License-Identifier: AGPL-3.0-only
// Joins that would leave an unsound cage are refused (2026-11-18): a quad
// turned over or crossed on itself, and two quads lying on one another.
import { expect, it } from 'vitest'
import type { Cage } from '../core/freeform/cage'
import { extrapolateEdges } from '../core/freeform/edit'
import { joinFolds, mergeBoundaryPoint, weldExtension } from '../core/freeform/merge'
import { topology } from '../core/freeform/cage'

const cage = (positions: number[], faces: number[][]): Cage => ({ positions: Float64Array.from(positions), faces, creases: [] })
const same = (v: number) => v

it('passes a join that leaves every quad the way it lay', () => {
  const before = cage([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0], [[0, 1, 2, 3]])
  const after = cage([0, 0, 0, 6, 0, 0, 5, 5, 0, 0, 5, 0], [[0, 1, 2, 3]])
  expect(joinFolds(before, after, same)).toBe(false)
})

it('passes a part turned to fit: its faces run the other way and lie as they did', () => {
  const before = cage([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0], [[0, 1, 2, 3]])
  expect(joinFolds(before, { ...before, faces: [[3, 2, 1, 0]] }, same)).toBe(false)
})

it('finds a quad turned over by a point pulled through it', () => {
  const before = cage([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0], [[0, 1, 2, 3]])
  const after = cage([9, 9, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0], [[0, 1, 2, 3]])
  expect(joinFolds(before, after, same)).toBe(true)
})

it('finds a quad crossed on itself', () => {
  const before = cage([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0], [[0, 1, 2, 3]])
  // Corners 2 and 3 changed places, and the far side made longer so that the
  // quad's area keeps its sign: only the crossing gives it away.
  const after = cage([0, 0, 0, 5, 0, 0, -2, 5, 0, 7, 5, 0], [[0, 1, 2, 3]])
  expect(joinFolds(before, after, same)).toBe(true)
})

it('refuses a point join that would lay one quad on its neighbour', () => {
  // Q1 and Q3 share a side; Q1's free corner joined to Q3's far corner would
  // leave them sharing three points.
  const c = cage([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0, 5, 9, 0, 0, 9, 0], [[0, 1, 2, 3], [3, 2, 4, 5]])
  expect(() => mergeBoundaryPoint(c, 1, 4)).toThrow(/cannot be merged/)
})

it('refuses a D pull welded back onto the quad it was pulled from', () => {
  const c = cage([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0], [[0, 1, 2, 3]])
  const top = topology(c), side = top.edges.findIndex(e => (e.a === 1 && e.b === 2) || (e.a === 2 && e.b === 1))
  const pulled = extrapolateEdges(c, [side], [4, 0, 0]).cage
  expect(pulled.positions.length / 3).toBe(6)
  // The new corner beside point 2 welded to point 3: the new quad and the old share 1, 2 and 3.
  const beside2 = [4, 5].find(v => pulled.faces[1].includes(v) && Math.abs(pulled.positions[v * 3 + 1] - 5) < 1e-9)!
  expect(() => weldExtension(c, pulled, [[beside2, 3]])).toThrow(/cannot be merged/)
})
