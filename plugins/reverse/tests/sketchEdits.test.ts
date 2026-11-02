// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { addConstraint, addEntity, addRectangle, arcPoint, emptySketch, entityOf, type SketchArc, type SketchLine } from '../core/sketch'
import { duplicateSelected, middleLineSelected, mirrorSelected, offsetSelected, slotSketch, tangentArcSketch, trimAt } from '../core/sketchEdits'
import { findRegions } from '../core/regions'
import { solveSketch } from '../core/solver'

describe('independent sketch edits', () => {
  it('mirrors copies about a construction line without linking them to originals', () => {
    const s = emptySketch(), axis = addEntity(s, { kind: 'line', a: [0, 0], b: [0, 10], construction: true })
    const line = addEntity(s, { kind: 'line', a: [2, 1], b: [4, 1] })
    addConstraint(s, { kind: 'length', entity: line, value: 2 })
    const before = JSON.stringify(s), r = mirrorSelected(s, [axis, line])
    expect(JSON.stringify(s)).toBe(before)
    expect(r.ok).toBe(true); if (!r.ok) return
    const copy = entityOf(r.sketch, r.ids[0]) as SketchLine
    expect(copy.a[0]).toBeCloseTo(-2); expect(copy.b[0]).toBeCloseTo(-4)
    expect(r.sketch.constraints).toHaveLength(2)
    expect(r.sketch.constraints.some(c => c.kind === 'symmetric')).toBe(false)
    expect(solveSketch(r.sketch).ok).toBe(true)
  })
  it('rebinds mirrored arc endpoints so copied coincidence survives solving', () => {
    const s = emptySketch(), axis = addEntity(s, { kind: 'line', a: [0, 0], b: [0, 10], construction: true })
    const arc = addEntity(s, { kind: 'arc', c: [3, 0], r: 1, start: 0, sweep: Math.PI / 2 })
    const line = addEntity(s, { kind: 'line', a: [4, 0], b: [5, 0] })
    addConstraint(s, { kind: 'coincident', p: { entity: arc, at: 'a' }, q: { entity: line, at: 'a' } })
    const r = mirrorSelected(s, [axis, arc, line]); expect(r.ok).toBe(true); if (!r.ok) return
    const a = entityOf(r.sketch, r.ids[0]) as SketchArc
    const l = entityOf(r.sketch, r.ids[1]) as SketchLine
    expect(arcPoint(a, a.start + a.sweep)[0]).toBeCloseTo(l.a[0])
    expect(solveSketch(r.sketch).ok).toBe(true)
    expect((entityOf(r.sketch, r.ids[0]) as SketchArc).c[0]).toBeCloseTo(-3, 5)
  })
  it('drops global horizontal/vertical equations on oblique mirrored copies', () => {
    const s = emptySketch(), axis = addEntity(s, { kind: 'line', a: [0, 0], b: [10, 3], construction: true })
    const line = addEntity(s, { kind: 'line', a: [2, 0], b: [4, 0] })
    addConstraint(s, { kind: 'horizontal', entity: line })
    const r = mirrorSelected(s, [axis, line]); expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.sketch.constraints).toHaveLength(1)
    expect(solveSketch(r.sketch).ok).toBe(true)
  })
  it('rejects ambiguous mirror axes atomically', () => {
    const s = emptySketch(), a = addEntity(s, { kind: 'line', a: [0, 0], b: [0, 1], construction: true }), b = addEntity(s, { kind: 'line', a: [2, 0], b: [2, 1], construction: true })
    const before = JSON.stringify(s)
    expect(mirrorSelected(s, [a, b]).ok).toBe(false); expect(JSON.stringify(s)).toBe(before)
  })
  it('duplicates internal dimensions with new ids and deeply independent geometry', () => {
    const s = emptySketch(), ids = addRectangle(s, [0, 0], [10, 8])
    addConstraint(s, { kind: 'length', entity: ids[0], value: 10 })
    const r = duplicateSelected(s, ids, [20, 0]); expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.ids).toHaveLength(4)
    expect(r.sketch.constraints).toHaveLength(s.constraints.length * 2)
    expect(findRegions(r.sketch)).toHaveLength(2)
    ;(entityOf(r.sketch, r.ids[0]) as SketchLine).a[0] = 999
    expect((entityOf(s, ids[0]) as SketchLine).a[0]).toBe(0)
  })
  it('offsets a rectangle to joined inner corners without copying its old dimensions', () => {
    const s = emptySketch(), ids = addRectangle(s, [0, 0], [10, 8])
    const r = offsetSelected(s, ids, 1); expect(r.ok).toBe(true); if (!r.ok) return
    const lines = r.ids.map(id => entityOf(r.sketch, id) as SketchLine)
    expect(lines[0].a).toEqual([1, 1]); expect(lines[0].b).toEqual([9, 1])
    expect(lines[1].b).toEqual([9, 7])
    expect(r.sketch.constraints).toHaveLength(s.constraints.length + 4)
    expect(solveSketch(r.sketch).ok).toBe(true)
    expect(findRegions(r.sketch)).toHaveLength(2)
  })
  it('rejects collapsed radii and joined arc offsets without mutation', () => {
    const s = emptySketch(), circle = addEntity(s, { kind: 'circle', c: [0, 0], r: 2 })
    const before = JSON.stringify(s)
    expect(offsetSelected(s, [circle], 2).ok).toBe(false)
    expect(JSON.stringify(s)).toBe(before)
  })
  it('rejects an offset that collapses or reverses a polygon edge', () => {
    const s = emptySketch(), ids = addRectangle(s, [0, 0], [10, 8])
    expect(offsetSelected(s, ids, 4).ok).toBe(false)
    expect(offsetSelected(s, ids, 5).ok).toBe(false)
  })
  it('pairs reversed line endpoints when making a middle line', () => {
    const s = emptySketch(), a = addEntity(s, { kind: 'line', a: [0, 0], b: [10, 0] }), b = addEntity(s, { kind: 'line', a: [10, 4], b: [0, 4] })
    const r = middleLineSelected(s, [a, b]); expect(r.ok).toBe(true); if (!r.ok) return
    expect(entityOf(r.sketch, r.ids[0])).toMatchObject({ a: [0, 2], b: [10, 2] })
  })
  it('trims only an internal line span at bounded intersections and removes stale constraints', () => {
    const s = emptySketch(), line = addEntity(s, { kind: 'line', a: [0, 0], b: [10, 0] })
    addConstraint(s, { kind: 'length', entity: line, value: 10 })
    for (const x of [3, 7]) addEntity(s, { kind: 'line', a: [x, -1], b: [x, 1] })
    const before = JSON.stringify(s), r = trimAt(s, line, [5, 0]); expect(r.ok).toBe(true); if (!r.ok) return
    expect(JSON.stringify(s)).toBe(before)
    expect(r.ids.map(id => entityOf(r.sketch, id))).toMatchObject([{ a: [0, 0], b: [3, 0] }, { a: [7, 0], b: [10, 0] }])
    expect(r.sketch.constraints).toHaveLength(0)
  })
  it('does not trim against extended lines outside their actual segment', () => {
    const s = emptySketch(), line = addEntity(s, { kind: 'line', a: [0, 0], b: [10, 0] })
    addEntity(s, { kind: 'line', a: [3, 2], b: [3, 4] })
    expect(trimAt(s, line, [5, 0]).ok).toBe(false)
  })
  it('trims a circle through wraparound into the complementary arc', () => {
    const s = emptySketch(), circle = addEntity(s, { kind: 'circle', c: [0, 0], r: 5 })
    addEntity(s, { kind: 'line', a: [0, -6], b: [0, 6] })
    const r = trimAt(s, circle, [5, 0]); expect(r.ok).toBe(true); if (!r.ok) return
    const arc = entityOf(r.sketch, r.ids[0]) as SketchArc
    expect(arc.start).toBeCloseTo(Math.PI / 2); expect(arc.sweep).toBeCloseTo(Math.PI)
  })
  it('builds a closed constrained slot at any angle and rejects zero centres/width', () => {
    const s = emptySketch(), r = slotSketch(s, [1, 2], [7, 10], 4)
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.ids).toHaveLength(4); expect(solveSketch(r.sketch).ok).toBe(true)
    expect(findRegions(r.sketch)).toHaveLength(1)
    expect(slotSketch(s, [0, 0], [0, 0], 2).ok).toBe(false)
    expect(slotSketch(s, [0, 0], [2, 0], 0).ok).toBe(false)
  })
  it('creates a tangent arc with real endpoint coincidence and a tangent solver equation', () => {
    const s = emptySketch(), line = addEntity(s, { kind: 'line', a: [0, 0], b: [5, 0] })
    const endpoint = addEntity(s, { kind: 'line', a: [10, 5], b: [10, 10] })
    const r = tangentArcSketch(s, line, 'b', [10, 5], { entity: endpoint, at: 'a' })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.sketch.constraints.filter(c => c.kind === 'coincident')).toHaveLength(2)
    expect(r.sketch.constraints.filter(c => c.kind === 'tangent')).toHaveLength(1)
    expect(solveSketch(r.sketch).ok).toBe(true)
    expect((entityOf(r.sketch, r.ids[0]) as SketchArc).r).toBeCloseTo(5, 5)
    expect(tangentArcSketch(s, line, 'b', [10, 0]).ok).toBe(false)
  })})
