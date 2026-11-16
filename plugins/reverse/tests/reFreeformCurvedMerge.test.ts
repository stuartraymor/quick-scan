// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import fixture from './fixtures/freeform-curved-merge.json'
import { type Cage, vertexAt } from '../core/freeform/cage'
import { movePoints } from '../core/freeform/edit'
import { fitMergedContact, mergeBoundaryPoint } from '../core/freeform/merge'

// The observed scan is an extruded 20-segment cylinder, not an analytic one.
const section = Array.from({ length: 21 }, (_, i) => [i - 10, Math.fround(20 - Math.sqrt(400 - (i - 10) ** 2))])
const closest = (p: [number, number, number]): [number, number, number] => {
  let best = Infinity, q = p
  for (let i = 0; i + 1 < section.length; i++) {
    const [a, z] = section[i], [b, w] = section[i + 1], dx = b - a, dz = w - z
    const t = Math.max(0, Math.min(1, ((p[0] - a) * dx + (p[2] - z) * dz) / (dx * dx + dz * dz)))
    const x = a + t * dx, h = z + t * dz, d = (x - p[0]) ** 2 + (h - p[2]) ** 2
    if (d < best) { best = d; q = [x, p[1], h] }
  }
  return q
}
const rayHeight = (x: number) => { const i = Math.floor(x) + 10, a = section[i], b = section[i + 1]; return a[1] + (x - a[0]) * (b[1] - a[1]) }
const base = (): Cage => ({ ...fixture.before, positions: Float64Array.from(fixture.before.positions), creases: [] })

describe('native curved Closest Point contacts', () => {
  for (const controlNet of [true, false]) for (const point of [true, false]) it(`${point ? 'point' : 'chain'} Control Net ${controlNet}`, () => {
    const input = base(), before = structuredClone(input), from = point ? 8 : 3, to = point ? 10 : 4
    const moved = movePoints(input, (point ? [8] : [2, 3, 8]).map(vertex => ({ vertex, by: [point ? input.positions[30] - input.positions[24] : 3.774358868598938, 0, 0] })))
    const result = mergeBoundaryPoint(moved, from, to, point ? 'point' : 'chain'), p = vertexAt(input, to)
    const out = fitMergedContact(result.cage, point ? [result.vertex] : [2, 3, 7], controlNet, closest,
      point ? { vertex: result.vertex, position: [p[0], p[1], rayHeight(p[0])] } : undefined)
    const expected = fixture.after[`curved-${point ? 'point' : 'chain'}-${controlNet ? 'on' : 'off'}` as keyof typeof fixture.after]
    expect(Math.max(...out.positions.map((p, i) => Math.abs(p - expected.positions[i])))).toBeLessThan(5e-7)
    expect(out.faces).toEqual(expected.faces)
    expect(input).toEqual(before)
  })
  it('keeps the complete cage unchanged if a mesh correspondence disappears', () => {
    const input = base(), before = structuredClone(input)
    expect(() => fitMergedContact(input, [2, 3, 8], true, () => null)).toThrow()
    expect(input).toEqual(before)
  })
  it('refuses a fitted collapse atomically', () => {
    const input = base(), before = structuredClone(input)
    expect(() => fitMergedContact(input, Array.from({ length: 12 }, (_, i) => i), true, () => [0, 0, 0])).toThrow()
    expect(input).toEqual(before)
  })
})
