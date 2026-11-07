// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { classifyCornerGesture, piecesNearPath } from '../core/cornerGesture'
import { addConstraint, addEntity, emptySketch } from '../core/sketch'
import { buildCornerTrim } from '../core/sketchCornerTrim'
import type { Vec2 } from '../../../src/core/flat/types'

function corner(joined: boolean) {
  const s = emptySketch()
  const a = addEntity(s, { kind: 'line', a: [0, 0], b: [9.5, 0] })
  const b = addEntity(s, { kind: 'line', a: [10, 0.5], b: [10, 10] })
  if (joined) addConstraint(s, { kind: 'coincident', p: { entity: a, at: 'b' }, q: { entity: b, at: 'a' } })
  return { s, a, b }
}
const brush: Vec2[] = [[8, -1], [10, 0], [11, 2]]

describe('Ctrl-drag corner gesture', () => {
  it('finds the two pieces under the brush and ignores far ones', () => {
    const { s, a, b } = corner(false)
    addEntity(s, { kind: 'line', a: [0, 50], b: [5, 50] })
    expect(piecesNearPath(s, brush, 1.5).sort()).toEqual([a, b].sort())
    expect(piecesNearPath(s, brush, 0)).toEqual([])
  })
  it('takes a long line when the brush crosses its middle, far from its ends (0.0.145 regression)', () => {
    const s = emptySketch()
    const long = addEntity(s, { kind: 'line', a: [-150, 0], b: [150, 0] })
    // A short stroke straight across the middle, and one passing 1 mm beside it.
    expect(piecesNearPath(s, [[37, -5], [37, 5]], 0.5)).toEqual([long])
    expect(piecesNearPath(s, [[37, 1], [60, 1]], 1.5)).toEqual([long])
    expect(piecesNearPath(s, [[37, 3], [60, 3]], 1.5)).toEqual([])
  })
  it('joins an open corner, fillets a joined one with the scan points, and ignores empty space', () => {
    expect(classifyCornerGesture(corner(false).s, brush, 1.5, []).kind).toBe('join')
    const j = corner(true)
    const r = 3, scan: Vec2[] = []
    for (let i = 0; i <= 12; i++) { const t = (Math.PI / 2) * (i / 12); scan.push([10 - r + r * Math.sin(t), r - r * Math.cos(t) + 0]) }
    const g = classifyCornerGesture(j.s, [[7, -0.5], [10.5, 0.2], [10.5, 3.5]], 3.5, scan)
    expect(g.kind).toBe('fillet')
    expect(classifyCornerGesture(j.s, [[40, 40]], 1, []).kind).toBe('none')
  })
  it('a joined corner takes an auto fillet whose radius is fitted to the brushed scan arc', () => {
    const j = corner(true)
    const la = j.s.entities.find((e) => e.id === j.a) as { b: Vec2 }, lb = j.s.entities.find((e) => e.id === j.b) as { a: Vec2 }
    la.b = [10, 0]; lb.a = [10, 0]
    const r = 2, scan: Vec2[] = []
    for (let i = 0; i <= 12; i++) { const t = -Math.PI / 2 + (Math.PI / 2) * (i / 12); scan.push([8 + r * Math.cos(t), 2 + r * Math.sin(t)]) }
    const out = buildCornerTrim(j.s, [j.a, j.b], { mode: 'autoFillet', radiusMm: 0, addDimension: true }, scan)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.radiusMm).toBeCloseTo(r, 2)
  })
})
