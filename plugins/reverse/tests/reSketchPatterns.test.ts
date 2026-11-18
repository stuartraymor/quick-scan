// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul 5: Duplicate / Pattern in four modes, and the exact
// curve evaluation behind Along Curve spacing.
import { describe, expect, it } from 'vitest'
import { addEntity, addRectangle, emptySketch, entityOf, type SketchArc, type SketchCircle, type SketchLine, type SketchPoint } from '../core/sketch'
import { applyPattern, defaultPattern, planPattern, type PatternSpec } from '../core/sketchPatterns'
import { curveOf, curvatureOf } from '../core/curveEval'

const close = (p: readonly number[], q: readonly number[], tol = 1e-9) => expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(tol)
const pt = (s: ReturnType<typeof emptySketch>, id: number) => (entityOf(s, id) as SketchPoint).p

describe('exact curve evaluation', () => {
  it('measures lines, arcs and circles exactly and inverts arc length', () => {
    const s = emptySketch()
    const l = curveOf(entityOf(s, addEntity(s, { kind: 'line', a: [0, 0], b: [3, 4] }))!)!
    expect(l.length).toBeCloseTo(5, 12); expect(l.paramAt(2.5)).toBeCloseTo(0.5, 12)
    const c = curveOf(entityOf(s, addEntity(s, { kind: 'circle', c: [5, 5], r: 10 }))!)!
    expect(c.length).toBeCloseTo(20 * Math.PI, 10)
    close(c.at(c.paramAt(5 * Math.PI)), [5, 15], 1e-9)
    const a = curveOf(entityOf(s, addEntity(s, { kind: 'arc', c: [0, 0], r: 4, start: 0, sweep: Math.PI / 2 }))!)!
    expect(a.length).toBeCloseTo(2 * Math.PI, 10)
  })
  it('gives curvature 0 on a line, 1/R on an arc and a constant on a circle', () => {
    const s = emptySketch()
    const l = curveOf(entityOf(s, addEntity(s, { kind: 'line', a: [0, 0], b: [7, 1] }))!)!
    for (const t of [0, 0.3, 1]) expect(curvatureOf(l, t)).toBe(0)
    const a = curveOf(entityOf(s, addEntity(s, { kind: 'arc', c: [1, 2], r: 10, start: 0.2, sweep: 1.5 }))!)!
    for (const t of [0, 0.5, 1]) expect(curvatureOf(a, t)).toBeCloseTo(0.1, 12)
    const cw = curveOf(entityOf(s, addEntity(s, { kind: 'arc', c: [1, 2], r: 10, start: 1.7, sweep: -1.5 }))!)!
    expect(curvatureOf(cw, 0.5)).toBeCloseTo(-0.1, 12)
    const c = curveOf(entityOf(s, addEntity(s, { kind: 'circle', c: [0, 0], r: 2.5 }))!)!
    for (let i = 0; i <= 8; i++) expect(curvatureOf(c, i / 8)).toBeCloseTo(0.4, 12)
  })
  it('inverts a spline\'s arc length to 1e-9', () => {
    const s = emptySketch()
    const sp = curveOf(entityOf(s, addEntity(s, { kind: 'spline', pts: [[0, 0], [10, 8], [25, -3], [40, 6]] }))!)!
    for (const f of [0.1, 0.37, 0.5, 0.93]) expect(sp.lengthTo(sp.paramAt(f * sp.length))).toBeCloseTo(f * sp.length, 9)
    // The length agrees with a fine polyline.
    let poly = 0, prev = sp.at(0)
    for (let i = 1; i <= 20000; i++) { const p = sp.at((sp.end * i) / 20000); poly += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p }
    expect(Math.abs(poly - sp.length)).toBeLessThan(1e-6)
  })
})

describe('linear pattern', () => {
  it('lays a two-direction grid exactly, far from the origin, the original counted', () => {
    const s = emptySketch(), p = addEntity(s, { kind: 'point', p: [1000.25, -2000.5] })
    const spec: PatternSpec = { mode: 'linear', d1: { on: true, ref: { kind: 'x' }, count: 3, spacing: 12.5, flip: false }, d2: { on: true, ref: { kind: 'y' }, count: 2, spacing: 7, flip: true } }
    const r = applyPattern(s, [p], spec); expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.ids).toHaveLength(5)
    const got = r.ids.map((id) => pt(r.sketch, id))
    const want = [[1012.75, -2000.5], [1025.25, -2000.5], [1000.25, -2007.5], [1012.75, -2007.5], [1025.25, -2007.5]]
    want.forEach((w, i) => close(got[i], w, 1e-9))
    expect(pt(r.sketch, p)).toEqual([1000.25, -2000.5])
  })
  it('follows a picked line, and copies a rectangle with its relations', () => {
    const s = emptySketch(), line = addEntity(s, { kind: 'line', a: [0, 0], b: [3, 4], construction: true })
    const rect = addRectangle(s, [0, 0], [2, 1])
    const spec: PatternSpec = { mode: 'linear', d1: { on: true, ref: { kind: 'line', id: line }, count: 2, spacing: 10, flip: false }, d2: { on: false, ref: { kind: 'y' }, count: 2, spacing: 5, flip: false } }
    const r = applyPattern(s, rect, spec); expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.ids).toHaveLength(4)
    const first = entityOf(r.sketch, r.ids[0]) as SketchLine, orig = entityOf(s, rect[0]) as SketchLine
    close(first.a, [orig.a[0] + 6, orig.a[1] + 8]); close(first.b, [orig.b[0] + 6, orig.b[1] + 8])
    expect(r.sketch.constraints.length).toBeGreaterThan(s.constraints.length)
  })
  it('refuses parallel directions, zero spacing and a bad count', () => {
    const s = emptySketch(), p = addEntity(s, { kind: 'point', p: [0, 0] })
    const base = defaultPattern('linear', 10) as Extract<PatternSpec, { mode: 'linear' }>
    expect(planPattern(s, [p], { ...base, d2: { ...base.d2, on: true, ref: { kind: 'x' } } }).ok).toBe(false)
    expect(planPattern(s, [p], { ...base, d1: { ...base.d1, spacing: 0 } }).ok).toBe(false)
    expect(planPattern(s, [p], { ...base, d1: { ...base.d1, count: 2.5 } }).ok).toBe(false)
    expect(planPattern(s, [p], { ...base, d1: { ...base.d1, count: 100000 } }).ok).toBe(false)
    expect(planPattern(s, [], base).ok).toBe(false)
  })
})

describe('circular and angular patterns', () => {
  it('spreads 6 over 360° without a copy on the original', () => {
    const s = emptySketch(), p = addEntity(s, { kind: 'point', p: [10, 0] })
    const r = applyPattern(s, [p], { mode: 'circular', centre: [0, 0], centreRef: { kind: 'origin' }, count: 6, totalDeg: 360, ccw: true, keepOrientation: false })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.ids).toHaveLength(5)
    r.ids.forEach((id, i) => close(pt(r.sketch, id), [10 * Math.cos(((i + 1) * Math.PI) / 3), 10 * Math.sin(((i + 1) * Math.PI) / 3)], 1e-12))
  })
  it('ends a partial span on its last angle, clockwise too, about a picked circle centre', () => {
    const s = emptySketch(), hub = addEntity(s, { kind: 'circle', c: [50, 50], r: 3 }), p = addEntity(s, { kind: 'point', p: [60, 50] })
    const r = applyPattern(s, [p], { mode: 'circular', centre: [0, 0], centreRef: { kind: 'circle', id: hub }, count: 4, totalDeg: 90, ccw: false, keepOrientation: false })
    expect(r.ok).toBe(true); if (!r.ok) return
    close(pt(r.sketch, r.ids[2]), [50, 40], 1e-12)
    close(pt(r.sketch, r.ids[0]), [50 + 10 * Math.cos(-Math.PI / 6), 50 + 10 * Math.sin(-Math.PI / 6)], 1e-12)
  })
  it('keeps the original orientation when asked', () => {
    const s = emptySketch(), l = addEntity(s, { kind: 'line', a: [9, 0], b: [11, 0] })
    const r = applyPattern(s, [l], { mode: 'circular', centre: [0, 0], centreRef: { kind: 'origin' }, count: 2, totalDeg: 180, ccw: true, keepOrientation: true })
    expect(r.ok).toBe(true); if (!r.ok) return
    const c = entityOf(r.sketch, r.ids[0]) as SketchLine
    close(c.a, [-11, 0], 1e-12); close(c.b, [-9, 0], 1e-12)
  })
  it('turns arcs with their sweep', () => {
    const s = emptySketch(), a = addEntity(s, { kind: 'arc', c: [10, 0], r: 2, start: 0, sweep: 1 })
    const r = applyPattern(s, [a], { mode: 'circular', centre: [0, 0], centreRef: { kind: 'origin' }, count: 2, totalDeg: 90, ccw: true, keepOrientation: false })
    expect(r.ok).toBe(true); if (!r.ok) return
    const c = entityOf(r.sketch, r.ids[0]) as SketchArc
    close(c.c, [0, 10], 1e-12); expect(c.start).toBeCloseTo(Math.PI / 2, 12); expect(c.sweep).toBe(1)
  })
  it('angular turns in place about the selection centre by a fixed step', () => {
    const s = emptySketch(), l = addEntity(s, { kind: 'line', a: [100, 50], b: [110, 50] })
    const r = applyPattern(s, [l], { mode: 'angular', pivot: null, pivotRef: { kind: 'selection' }, count: 3, stepDeg: 45, flip: false, keepOrientation: false })
    expect(r.ok).toBe(true); if (!r.ok) return
    const second = entityOf(r.sketch, r.ids[1]) as SketchLine
    close(second.a, [105, 45], 1e-12); close(second.b, [105, 55], 1e-12)
    const flipped = applyPattern(s, [l], { mode: 'angular', pivot: null, pivotRef: { kind: 'selection' }, count: 2, stepDeg: 90, flip: true, keepOrientation: false })
    expect(flipped.ok).toBe(true); if (!flipped.ok) return
    const f = entityOf(flipped.sketch, flipped.ids[0]) as SketchLine
    close(f.a, [105, 55], 1e-12)
  })
  it('refuses a total angle over 360° or of zero', () => {
    const s = emptySketch(), p = addEntity(s, { kind: 'point', p: [1, 0] })
    expect(planPattern(s, [p], { mode: 'circular', centre: [0, 0], centreRef: { kind: 'origin' }, count: 3, totalDeg: 400, ccw: true, keepOrientation: false }).ok).toBe(false)
    expect(planPattern(s, [p], { mode: 'circular', centre: [0, 0], centreRef: { kind: 'origin' }, count: 3, totalDeg: 0, ccw: true, keepOrientation: false }).ok).toBe(false)
  })
})

describe('pattern along a curve', () => {
  it('spaces equally by arc length on a spline and follows its tangent', () => {
    const s = emptySketch(), guide = addEntity(s, { kind: 'spline', pts: [[0, 0], [10, 8], [25, -3], [40, 6]] })
    const p = addEntity(s, { kind: 'point', p: [0, 0] })
    const r = applyPattern(s, [p], { mode: 'alongCurve', curve: guide, count: 5, equal: true, spacing: 1, reverse: false, tangent: true, startOffset: 0, endOffset: 0 })
    expect(r.ok).toBe(true); if (!r.ok) return
    const c = curveOf(entityOf(s, guide)!)!
    r.ids.forEach((id, i) => close(pt(r.sketch, id), c.at(c.paramAt(((i + 1) * c.length) / 4)), 1e-9))
    close(pt(r.sketch, r.ids[3]), [40, 6], 1e-9)
  })
  it('never doubles the seam of a closed curve', () => {
    const s = emptySketch(), guide = addEntity(s, { kind: 'circle', c: [0, 0], r: 10 }), p = addEntity(s, { kind: 'point', p: [10, 0] })
    const r = applyPattern(s, [p], { mode: 'alongCurve', curve: guide, count: 4, equal: true, spacing: 1, reverse: false, tangent: true, startOffset: 0, endOffset: 0 })
    expect(r.ok).toBe(true); if (!r.ok) return
    expect(r.ids).toHaveLength(3)
    close(pt(r.sketch, r.ids[0]), [0, 10], 1e-9); close(pt(r.sketch, r.ids[1]), [-10, 0], 1e-9); close(pt(r.sketch, r.ids[2]), [0, -10], 1e-9)
  })
  it('steps a fixed spacing with offsets, reversed, keeping orientation, and says when fewer fit', () => {
    const s = emptySketch(), guide = addEntity(s, { kind: 'line', a: [0, 0], b: [100, 0] })
    const l = addEntity(s, { kind: 'line', a: [90, 5], b: [90, 8] })
    const r = applyPattern(s, [l], { mode: 'alongCurve', curve: guide, count: 10, equal: false, spacing: 20, reverse: true, tangent: false, startOffset: 10, endOffset: 15 })
    expect(r.ok).toBe(true); if (!r.ok) return
    // From x = 90 back to x = 15: 90, 70, 50, 30 fit; 10 would pass the end offset.
    expect(r.ids).toHaveLength(3)
    expect(r.note).toMatch(/Only 4 instances/)
    const last = entityOf(r.sketch, r.ids[2]) as SketchLine
    close(last.a, [30, 5], 1e-9); close(last.b, [30, 8], 1e-9)
  })
  it('refuses a missing or selected guide and offsets longer than the curve', () => {
    const s = emptySketch(), guide = addEntity(s, { kind: 'line', a: [0, 0], b: [10, 0] }), p = addEntity(s, { kind: 'point', p: [0, 0] })
    const spec = { ...(defaultPattern('alongCurve', 1) as Extract<PatternSpec, { mode: 'alongCurve' }>) }
    expect(planPattern(s, [p], spec).ok).toBe(false)
    expect(planPattern(s, [p, guide], { ...spec, curve: guide }).ok).toBe(false)
    expect(planPattern(s, [p], { ...spec, curve: guide, startOffset: 6, endOffset: 6 }).ok).toBe(false)
    expect(planPattern(s, [p], { ...spec, curve: p }).ok).toBe(false)
  })
  it('keeps circles exact', () => {
    const s = emptySketch(), guide = addEntity(s, { kind: 'line', a: [0, 0], b: [0, 30] }), c = addEntity(s, { kind: 'circle', c: [3, 0], r: 1.5 })
    const r = applyPattern(s, [c], { mode: 'alongCurve', curve: guide, count: 4, equal: true, spacing: 1, reverse: false, tangent: true, startOffset: 0, endOffset: 0 })
    expect(r.ok).toBe(true); if (!r.ok) return
    const last = entityOf(r.sketch, r.ids[2]) as SketchCircle
    close(last.c, [3, 30], 1e-9); expect(last.r).toBe(1.5)
  })
})
