// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.18: Trim keeps what still describes the kept pieces. Before, every
// relation on a trimmed piece was dropped: a rectangle's side lost its
// corner and its horizontal, and the outline came apart at the next drag.

import { describe, expect, it } from 'vitest'
import { addConstraint, addEntity, addRectangle, cloneSketch, emptySketch, entityOf, type Sketch, type SketchArc, type SketchLine } from '../core/sketch'
import { trimAt } from '../core/sketchEdits'
import { solveSketch } from '../core/solver'

const kinds = (s: Sketch) => s.constraints.map((c) => c.kind).sort()
const pieces = (s: Sketch) => JSON.stringify(s.entities.map((e) => ({ ...e })))

describe('Trim keeps the relations that still hold', () => {
  it('a rectangle side cut by a line keeps its corner, its level and its new end on the cutter', () => {
    const s = emptySketch()
    const sides = addRectangle(s, [0, 0], [10, 6])
    const top = sides.find((id) => { const l = entityOf(s, id) as SketchLine; return l.a[1] === 6 && l.b[1] === 6 })!
    const cutter = addEntity(s, { kind: 'line', a: [4, 3], b: [4, 9] })
    expect(solveSketch(s).ok).toBe(true)
    const topLine = entityOf(s, top) as SketchLine
    const r = trimAt(s, top, [7, 6])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.ids).toHaveLength(1)
    const kept = entityOf(r.sketch, r.ids[0]) as SketchLine
    const xs = [kept.a[0], kept.b[0]].sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(0, 9)
    expect(xs[1]).toBeCloseTo(4, 9)
    const mine = r.sketch.constraints.filter((c) => JSON.stringify(c).includes(`"entity":${kept.id}`) || ('entity' in c && c.entity === kept.id) || ('a' in c && (c.a === kept.id || c.b === kept.id)))
    // Still level (or parallel to its opposite side, as the rectangle holds it).
    expect(mine.some((c) => c.kind === 'horizontal' || c.kind === 'parallel' || c.kind === 'perpendicular')).toBe(true)
    // Still joined to the corner it kept: the end that was at x = 0.
    const keptEnd = Math.abs(topLine.a[0]) < 1e-9 ? 'a' : 'b'
    expect(mine.some((c) => c.kind === 'coincident' && ((c.p.entity === kept.id && c.p.at === keptEnd) || (c.q.entity === kept.id && c.q.at === keptEnd)))).toBe(true)
    // The cut end rests on the cutter.
    expect(mine.some((c) => c.kind === 'pointOn' && c.p.entity === kept.id && 'line' in c.on && c.on.line === cutter)).toBe(true)
    // Nothing moves at the next solve, and every relation is met.
    const before = pieces(r.sketch)
    const solved = cloneSketch(r.sketch)
    expect(solveSketch(solved).ok).toBe(true)
    for (const e of solved.entities) {
      const was = (JSON.parse(before) as SketchLine[]).find((x) => x.id === e.id)!
      if (e.kind === 'line') for (const k of ['a', 'b'] as const) for (const i of [0, 1]) expect(e[k][i]).toBeCloseTo((was as SketchLine)[k][i], 6)
    }
  })

  it('moving the cutter carries the trimmed end with it', () => {
    const s = emptySketch()
    const line = addEntity(s, { kind: 'line', a: [0, 0], b: [10, 0] })
    addConstraint(s, { kind: 'horizontal', entity: line })
    const cutter = addEntity(s, { kind: 'line', a: [6, -3], b: [6, 3], fixed: true })
    const r = trimAt(s, line, [8, 0])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const kept = r.ids[0]
    // The cutter shifted to x = 5, the left end pinned.
    r.sketch.entities = r.sketch.entities.map((e) => (e.id === cutter && e.kind === 'line' ? { ...e, a: [5, -3], b: [5, 3] } : e))
    addConstraint(r.sketch, { kind: 'distance', p: { entity: kept, at: 'a' }, q: { datum: 'yz' }, value: 0 })
    solveSketch(r.sketch)
    const l = entityOf(r.sketch, kept) as SketchLine
    expect(l.b[0]).toBeCloseTo(5, 6)
    expect(l.b[1]).toBeCloseTo(l.a[1], 6)
  })

  it('a circle trimmed to an arc keeps its diameter and concentric, both ends on the cutter', () => {
    const s = emptySketch()
    const circle = addEntity(s, { kind: 'circle', c: [0, 0], r: 5 })
    const inner = addEntity(s, { kind: 'circle', c: [0, 0], r: 2 })
    addConstraint(s, { kind: 'concentric', a: circle, b: inner })
    addConstraint(s, { kind: 'diameter', entity: circle, value: 10 })
    const cutter = addEntity(s, { kind: 'line', a: [0, -6], b: [0, 6] })
    const r = trimAt(s, circle, [5, 0])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const arc = entityOf(r.sketch, r.ids[0]) as SketchArc
    expect(arc.kind).toBe('arc')
    expect(kinds(r.sketch)).toEqual(['concentric', 'diameter', 'pointOn', 'pointOn'])
    expect(r.sketch.constraints.filter((c) => c.kind === 'pointOn').every((c) => c.kind === 'pointOn' && 'line' in c.on && c.on.line === cutter && c.p.entity === arc.id)).toBe(true)
    expect(solveSketch(r.sketch).ok).toBe(true)
    expect((entityOf(r.sketch, arc.id) as SketchArc).r).toBeCloseTo(5, 9)
  })

  it('drops a length, keeps Fix, and joins a cut made at the cutter’s own end', () => {
    const s = emptySketch()
    const line = addEntity(s, { kind: 'line', a: [0, 0], b: [10, 0], fixed: true })
    addConstraint(s, { kind: 'length', entity: line, value: 10 })
    // A cutter that ends exactly on the line (a T), and one that crosses it.
    const tee = addEntity(s, { kind: 'line', a: [3, 0], b: [3, 4] })
    addEntity(s, { kind: 'line', a: [7, -1], b: [7, 1] })
    const r = trimAt(s, line, [5, 0])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.sketch.constraints.some((c) => c.kind === 'length')).toBe(false)
    expect(r.ids.every((id) => entityOf(r.sketch, id)?.fixed === true)).toBe(true)
    expect(r.sketch.constraints.some((c) => c.kind === 'coincident' && c.q.entity === tee && c.q.at === 'a')).toBe(true)
    expect(r.sketch.constraints.filter((c) => c.kind === 'pointOn')).toHaveLength(1)
  })
})
