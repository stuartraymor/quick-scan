// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.17: a distance between two points taken horizontally or vertically
// (QUICKSURFACE's Dimension tool decides by where the number is put down);
// the constraints that overdefine a sketch; and an extrude as a surface.

import { describe, expect, it } from 'vitest'
import { dimPlaceAt, dimShape, distanceAxisAt, withDistanceAxis, type Dimension } from '../core/dimLayout'
import { dimStrokes } from '../../../src/core/flat/dimStrokes'
import { overdefiningConstraints } from '../core/overdefined'
import { addConstraint, addEntity, cloneSketch, emptySketch, entityOf, type Sketch, type SketchLine } from '../core/sketch'
import { measureDimension, solveSketch } from '../core/solver'
import { extrudeDraftReady } from '../state/reDrafts'

/** A line from (−4, −2) to (4, 2) with a plain distance between its ends. */
function sloped() {
  const sketch = emptySketch()
  const line = addEntity(sketch, { kind: 'line', a: [-4, -2], b: [4, 2] })
  const id = addConstraint(sketch, { kind: 'distance', p: { entity: line, at: 'a' }, q: { entity: line, at: 'b' }, value: Math.hypot(8, 4) })
  const dim = () => sketch.constraints.find((c) => c.id === id) as Dimension
  return { sketch, line, id, dim }
}
const lineOf = (sketch: Sketch, id: number) => entityOf(sketch, id) as SketchLine

describe('a distance between two points, by where it is put down', () => {
  it('is horizontal above or below the pair, vertical beside it, straight elsewhere', () => {
    const { sketch, dim } = sloped()
    expect(distanceAxisAt(dim(), sketch, [0, -6])).toEqual({ axis: 'x', value: 8 })
    expect(distanceAxisAt(dim(), sketch, [1, 9])).toEqual({ axis: 'x', value: 8 })
    expect(distanceAxisAt(dim(), sketch, [7, 0])).toEqual({ axis: 'y', value: 4 })
    expect(distanceAxisAt(dim(), sketch, [-9, 1])).toEqual({ axis: 'y', value: 4 })
    expect(distanceAxisAt(dim(), sketch, [0, 0.5])?.axis).toBeUndefined()
    expect(distanceAxisAt(dim(), sketch, [9, 9])?.axis).toBeUndefined()
    expect(distanceAxisAt(dim(), sketch, [9, 9])?.value).toBeCloseTo(Math.hypot(8, 4), 12)
  })

  it('does not arise for level or plumb points, a line or a rim', () => {
    const sketch = emptySketch()
    const level = addEntity(sketch, { kind: 'line', a: [-3, 1], b: [5, 1] })
    const other = addEntity(sketch, { kind: 'line', a: [0, 4], b: [6, 9] })
    const flat = addConstraint(sketch, { kind: 'distance', p: { entity: level, at: 'a' }, q: { entity: level, at: 'b' }, value: 8 })
    const toLine = addConstraint(sketch, { kind: 'distance', p: { entity: level, at: 'a' }, q: { line: other }, value: 1 })
    const find = (id: number) => sketch.constraints.find((c) => c.id === id) as Dimension
    expect(distanceAxisAt(find(flat), sketch, [0, 5])).toBeNull()
    expect(distanceAxisAt(find(toLine), sketch, [0, 5])).toBeNull()
  })

  it('measures and solves along its axis only', () => {
    const { sketch, line, id, dim } = sloped()
    sketch.constraints = sketch.constraints.map((c) => (c.id === id ? withDistanceAxis(dim(), { axis: 'x', value: 10 }) : c))
    expect(dim()).toMatchObject({ axis: 'x', value: 10 })
    const report = solveSketch(sketch)
    expect(report.ok).toBe(true)
    const l = lineOf(sketch, line)
    expect(Math.abs(l.b[0] - l.a[0])).toBeCloseTo(10, 9)
    // The height is left as it was: only X is driven.
    expect(Math.abs(l.b[1] - l.a[1])).toBeCloseTo(4, 6)
    expect(measureDimension(sketch, 'distance', { entity: line, at: 'a' }, { entity: line, at: 'b' }, undefined, undefined, 'x')).toBeCloseTo(10, 9)
    expect(measureDimension(sketch, 'distance', { entity: line, at: 'a' }, { entity: line, at: 'b' }, undefined, undefined, 'y')).toBeCloseTo(4, 6)

    sketch.constraints = sketch.constraints.map((c) => (c.id === id ? withDistanceAxis(dim(), { axis: 'y', value: 7 }) : c))
    expect(solveSketch(sketch).ok).toBe(true)
    expect(Math.abs(lineOf(sketch, line).b[1] - lineOf(sketch, line).a[1])).toBeCloseTo(7, 9)
  })

  it('goes back to the straight distance, the axis taken off', () => {
    const { dim } = sloped()
    const x = withDistanceAxis(dim(), { axis: 'x', value: 8 })
    const straight = withDistanceAxis(x, { axis: undefined, value: 9 })
    expect('axis' in straight).toBe(false)
    expect(straight.value).toBe(9)
  })

  it('is drawn level, an extension line dropped from each point to it', () => {
    const { sketch, dim } = sloped()
    const held = withDistanceAxis(dim(), { axis: 'x', value: 8 })
    const place = dimPlaceAt(held, sketch, [1, -6], [])!
    const shape = dimShape({ ...held, place }, sketch, [], 1)!
    expect(shape).toMatchObject({ kind: 'linear', d: [1, 0] })
    const strokes = dimStrokes(shape, 0.01, 20)
    // The number is where the cursor was.
    expect(strokes.text[0]).toBeCloseTo(1, 9)
    expect(strokes.text[1]).toBeCloseTo(-6, 9)
    // Both arrow tips are on the level y = −6, under the two points.
    expect(strokes.arrows.map((a) => a.tip[1])).toEqual([expect.closeTo(-6, 9), expect.closeTo(-6, 9)])
    expect(strokes.arrows.map((a) => a.tip[0]).sort((a, b) => a - b)).toEqual([expect.closeTo(-4, 9), expect.closeTo(4, 9)])
    // Two extension lines, one from near each point, both plumb, of
    // different lengths: 4 and 8 less the gap, plus the overshoot.
    const ext = strokes.lines.filter((l) => l.length === 2 && Math.abs(l[0][0] - l[1][0]) < 1e-9)
    expect(ext).toHaveLength(2)
    const lengths = ext.map((l) => Math.abs(l[1][1] - l[0][1])).sort((a, b) => a - b)
    expect(lengths[1] - lengths[0]).toBeCloseTo(4, 9)
  })

  it('leaves a straight dimension drawn exactly as before', () => {
    const { sketch, dim } = sloped()
    const place = dimPlaceAt(dim(), sketch, [-2, 3], [])!
    const shape = dimShape({ ...dim(), place }, sketch, [], 1)!
    const strokes = dimStrokes(shape, 0.01, 20)
    expect(strokes.text[0]).toBeCloseTo(-2, 9)
    expect(strokes.text[1]).toBeCloseTo(3, 9)
    const L = Math.hypot(strokes.arrows[1].tip[0] - strokes.arrows[0].tip[0], strokes.arrows[1].tip[1] - strokes.arrows[0].tip[1])
    expect(L).toBeCloseTo(Math.hypot(8, 4), 9)
  })
})

describe('the constraints that overdefine a sketch', () => {
  it('names the newest of a contradiction, not every equation left off', () => {
    const sketch = emptySketch()
    const line = addEntity(sketch, { kind: 'line', a: [-4, -3], b: [4, 3] })
    const p = { entity: line, at: 'a' as const }
    const q = { entity: line, at: 'b' as const }
    const length = addConstraint(sketch, { kind: 'length', entity: line, value: 10 })
    const dx = addConstraint(sketch, { kind: 'distance', p, q, value: 8, axis: 'x' })
    expect(overdefiningConstraints(sketch)).toEqual([])
    const dy = addConstraint(sketch, { kind: 'distance', p, q, value: 9, axis: 'y' })
    const before = cloneSketch(sketch)
    const report = solveSketch(cloneSketch(sketch))
    expect(report.ok).toBe(false)
    expect(report.unmet.length).toBeGreaterThan(1)
    expect(overdefiningConstraints(sketch)).toEqual([dy])
    // The sketch handed in is not touched.
    expect(sketch).toEqual(before)
    expect([length, dx]).not.toContain(dy)
  })

  it('finds each of two separate contradictions', () => {
    const sketch = emptySketch()
    const a = addEntity(sketch, { kind: 'line', a: [0, 0], b: [10, 0] })
    const b = addEntity(sketch, { kind: 'line', a: [0, 20], b: [0, 30] })
    addConstraint(sketch, { kind: 'length', entity: a, value: 10 })
    addConstraint(sketch, { kind: 'length', entity: b, value: 10 })
    const a2 = addConstraint(sketch, { kind: 'distance', p: { entity: a, at: 'a' }, q: { entity: a, at: 'b' }, value: 14 })
    const b2 = addConstraint(sketch, { kind: 'distance', p: { entity: b, at: 'a' }, q: { entity: b, at: 'b' }, value: 3 })
    expect(overdefiningConstraints(sketch).sort((x, y) => x - y)).toEqual([a2, b2])
  })
})

describe('an extrude as a surface', () => {
  const base = { sketchId: 3, regions: [] as string[], draftDeg: 0, op: 'join' as const }
  it('is ready with a sketch and a length, no region picked', () => {
    expect(extrudeDraftReady({ ...base, surface: true, extent: { kind: 'distance', from: 0, to: 12 } })).toBe(true)
    expect(extrudeDraftReady({ ...base, surface: true, extent: { kind: 'symmetric', total: 6 } })).toBe(true)
  })
  it('is not ready with no length, no sketch, or as a solid without a region', () => {
    expect(extrudeDraftReady({ ...base, surface: true, extent: { kind: 'distance', from: 5, to: 5 } })).toBe(false)
    expect(extrudeDraftReady({ ...base, sketchId: null, surface: true, extent: { kind: 'distance', from: 0, to: 12 } })).toBe(false)
    expect(extrudeDraftReady({ ...base, extent: { kind: 'distance', from: 0, to: 12 } })).toBe(false)
  })
})
