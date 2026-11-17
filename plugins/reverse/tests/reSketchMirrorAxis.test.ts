// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul 2.2: Mirror about a picked axis at any distance.
import { describe, expect, it } from 'vitest'
import { addEntity, addRectangle, arcPoint, emptySketch, entityOf, type SketchArc, type SketchCircle, type SketchLine, type SketchPoint, type SketchSpline } from '../core/sketch'
import { mirrorAbout } from '../core/sketchEdits'
import { findRegions } from '../core/regions'
import { mirrorAxisChoices, mirrorAxisNear } from '../core/mirrorAxes'
import { datumTraces } from '../core/datums'

const close = (p: readonly number[], q: readonly number[], tol = 1e-9) => expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(tol)

describe('mirror about a picked axis', () => {
  it('reflects (10, 5) about X = 0 to (-10, 5)', () => {
    const s = emptySketch(), p = addEntity(s, { kind: 'point', p: [10, 5] })
    const r = mirrorAbout(s, [p], { a: [0, 0], b: [0, 1] }); expect(r.ok).toBe(true); if (!r.ok) return
    close((entityOf(r.sketch, r.ids[0]) as SketchPoint).p, [-10, 5])
    close((entityOf(r.sketch, p) as SketchPoint).p, [10, 5])
  })
  it('copies a disconnected closed profile far from the axis without touching it', () => {
    const s = emptySketch(), ids = addRectangle(s, [40, 10], [60, 25])
    const before = JSON.stringify(s)
    const r = mirrorAbout(s, ids, { a: [0, -100], b: [0, 100] }); expect(r.ok).toBe(true); if (!r.ok) return
    expect(JSON.stringify(s)).toBe(before)
    expect(r.ids).toHaveLength(4)
    const xs = r.ids.flatMap(id => { const l = entityOf(r.sketch, id) as SketchLine; return [l.a[0], l.b[0]] })
    expect(Math.min(...xs)).toBeCloseTo(-60, 9); expect(Math.max(...xs)).toBeCloseTo(-40, 9)
    for (const id of ids) expect(JSON.stringify(entityOf(r.sketch, id))).toBe(JSON.stringify(entityOf(s, id)))
    expect(findRegions(r.sketch).length).toBe(2)
  })
  it('reflects about an angled axis exactly', () => {
    const s = emptySketch(), l = addEntity(s, { kind: 'line', a: [3, 0], b: [5, 2] })
    // y = x: (x, y) → (y, x)
    const r = mirrorAbout(s, [l], { a: [-7, -7], b: [1, 1] }); expect(r.ok).toBe(true); if (!r.ok) return
    const c = entityOf(r.sketch, r.ids[0]) as SketchLine
    close(c.a, [0, 3]); close(c.b, [2, 5])
  })
  it('reflects circles, arcs and splines with their orientation', () => {
    const s = emptySketch()
    const circle = addEntity(s, { kind: 'circle', c: [8, 2], r: 3 })
    const arc = addEntity(s, { kind: 'arc', c: [6, -4], r: 2, start: 0.3, sweep: 1.2 })
    const spline = addEntity(s, { kind: 'spline', pts: [[4, 0], [6, 2], [9, 1]], startDir: 0.5, endDir: -0.2 })
    const r = mirrorAbout(s, [circle, arc, spline], { a: [1, 0], b: [1, 5] }); expect(r.ok).toBe(true); if (!r.ok) return
    const [c, a, sp] = r.ids.map(id => entityOf(r.sketch, id))
    close((c as SketchCircle).c, [-6, 2]); expect((c as SketchCircle).r).toBe(3)
    const src = entityOf(s, arc) as SketchArc, m = a as SketchArc
    const srcEnds = [arcPoint(src, src.start), arcPoint(src, src.start + src.sweep)].map(p => [2 - p[0], p[1]])
    close(arcPoint(m, m.start + m.sweep), srcEnds[0]); close(arcPoint(m, m.start), srcEnds[1])
    expect(m.sweep).toBeCloseTo(src.sweep, 12)
    const ms = sp as SketchSpline
    expect(ms.pts.map(p => p.map(v => +v.toFixed(9)))).toEqual([[-2, 0], [-4, 2], [-7, 1]])
    expect(Math.cos(ms.startDir ?? 0)).toBeCloseTo(-Math.cos(0.5), 12); expect(Math.sin(ms.startDir ?? 0)).toBeCloseTo(Math.sin(0.5), 12)
  })
  it('refuses a zero-length axis or an empty selection', () => {
    const s = emptySketch(), l = addEntity(s, { kind: 'line', a: [3, 0], b: [5, 2] })
    expect(mirrorAbout(s, [l], { a: [1, 1], b: [1, 1] }).ok).toBe(false)
    expect(mirrorAbout(s, [], { a: [0, 0], b: [0, 1] }).ok).toBe(false)
    expect(mirrorAbout(s, [l], { a: [0, Number.NaN], b: [0, 1] }).ok).toBe(false)
  })
  it('offers sketch lines, the sheet axes and plane traces to pick', () => {
    const s = emptySketch(), piece = addEntity(s, { kind: 'line', a: [3, 0], b: [5, 2] }), axis = addEntity(s, { kind: 'line', a: [10, -5], b: [10, 5], construction: true })
    const traces = datumTraces({ origin: [0, 0, 7], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] } as never)
    const choices = mirrorAxisChoices(s, traces, [piece])
    expect(choices.some(c => c.entity === piece)).toBe(false)
    expect(mirrorAxisNear(choices, [10.3, 4], 0.5)?.entity).toBe(axis)
    expect(mirrorAxisNear(choices, [10.3, 40], 0.5)).toBeNull()
    expect(mirrorAxisNear(choices, [0.2, 400], 0.5)?.label).toBe('Sketch Y axis')
    expect(mirrorAxisNear(choices, [-300, 0.1], 0.5)?.label).toBe('Sketch X axis')
    const yz = choices.find(c => c.label === 'YZ plane'); expect(yz).toBeTruthy()
    const r = mirrorAbout(s, [piece], yz!); expect(r.ok).toBe(true)
  })
})
