// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul 7: editing a finished spline — add a point on the
// curve, remove one, rebuild through N points by arc length, set or free an
// end's tangent — with relations on its points following them.
import { describe, expect, it } from 'vitest'
import { addConstraint, addEntity, emptySketch, entityOf, type SketchSpline } from '../core/sketch'
import { insertSplinePoint, rebuildSpline, removeSplinePoint, setSplineEndDirection, splinePointNear } from '../core/splineEdits'
import { curveOf } from '../core/curveEval'
import { solveSketch } from '../core/solver'
import { nearestOnSpline, splineCurve, splineDirAt } from '../core/sketchSpline'

const sp = (s: ReturnType<typeof emptySketch>, id: number) => entityOf(s, id) as SketchSpline
const seed = () => { const s = emptySketch(); const id = addEntity(s, { kind: 'spline', pts: [[0, 0], [10, 8], [25, -3], [40, 6]] }); return { s, id } }

describe('spline edits', () => {
  it('adds a point on the curve where clicked, keeping the shape nearly unchanged', () => {
    const { s, id } = seed()
    const c0 = curveOf(sp(s, id))!, mid = c0.at(1.5)
    const r = insertSplinePoint(s, id, [mid[0] + 0.2, mid[1] - 0.1]); expect(r.ok).toBe(true); if (!r.ok) return
    const e = sp(r.sketch, id)
    expect(e.pts).toHaveLength(5)
    // The new point lies on the curve as it was, near the click.
    expect(nearestOnSpline(splineCurve(sp(s, id)), e.pts[2]).dist).toBeLessThan(1e-6)
    expect(Math.hypot(e.pts[2][0] - mid[0], e.pts[2][1] - mid[1])).toBeLessThan(0.5)
    expect(Math.abs(curveOf(e)!.length - c0.length)).toBeLessThan(0.05 * c0.length)
    expect(sp(s, id).pts).toHaveLength(4)
  })
  it('refuses to add on top of an existing point', () => {
    const { s, id } = seed()
    expect(insertSplinePoint(s, id, [10, 8]).ok).toBe(false)
  })
  it('removes a point, renumbering relations and dropping those on it', () => {
    const { s, id } = seed()
    const a = addEntity(s, { kind: 'point', p: [25, -3] }), b = addEntity(s, { kind: 'point', p: [40, 6] })
    addConstraint(s, { kind: 'coincident', p: { entity: id, at: 'p2' }, q: { entity: a, at: 'center' } } as never)
    addConstraint(s, { kind: 'coincident', p: { entity: id, at: 'p3' }, q: { entity: b, at: 'center' } } as never)
    const r = removeSplinePoint(s, id, 2); expect(r.ok).toBe(true); if (!r.ok) return
    expect(sp(r.sketch, id).pts).toEqual([[0, 0], [10, 8], [40, 6]])
    expect(r.sketch.constraints).toHaveLength(1)
    expect(JSON.stringify(r.sketch.constraints[0])).toContain('"at":"p2"')
    expect(r.note).toMatch(/1 relation on it removed/)
  })
  it('keeps two points open and three closed', () => {
    const s = emptySketch(), open = addEntity(s, { kind: 'spline', pts: [[0, 0], [5, 5]] }), closed = addEntity(s, { kind: 'spline', pts: [[0, 0], [5, 5], [9, 0]], closed: true })
    expect(removeSplinePoint(s, open, 0).ok).toBe(false)
    expect(removeSplinePoint(s, closed, 1).ok).toBe(false)
    expect(removeSplinePoint(s, open, 7).ok).toBe(false)
  })
  it('rebuilds through N points evenly by arc length, ends fixed, change reported', () => {
    const { s, id } = seed()
    const r = rebuildSpline(s, id, 9); expect(r.ok).toBe(true); if (!r.ok) return
    const e = sp(r.sketch, id), c = curveOf(sp(s, id))!
    expect(e.pts).toHaveLength(9)
    expect(e.pts[0]).toEqual([0, 0]); expect(e.pts[8]).toEqual([40, 6])
    // Each new point lies on the old curve at its share of the length.
    for (let i = 1; i < 8; i++) { const want = c.at(c.paramAt((c.length * i) / 8)); expect(Math.hypot(e.pts[i][0] - want[0], e.pts[i][1] - want[1])).toBeLessThan(1e-9) }
    expect(r.deviation).toBeLessThan(0.3)
    expect(r.note).toMatch(/Rebuilt through 9 points/)
    expect(rebuildSpline(s, id, 1).ok).toBe(false)
    expect(rebuildSpline(s, id, 5000).ok).toBe(false)
  })
  it('sets an end direction and frees it, refusing while a tangent relation holds it', () => {
    const { s, id } = seed()
    const r = setSplineEndDirection(s, id, 'a', Math.PI / 2); expect(r.ok).toBe(true); if (!r.ok) return
    const d = splineDirAt(splineCurve(sp(r.sketch, id)), 0)
    expect(d[0]).toBeCloseTo(0, 9); expect(d[1]).toBeCloseTo(1, 9)
    const freed = setSplineEndDirection(r.sketch, id, 'a', null); expect(freed.ok).toBe(true); if (!freed.ok) return
    expect('startDir' in sp(freed.sketch, id)).toBe(false)
    const line = addEntity(s, { kind: 'line', a: [-10, 0], b: [0, 0] })
    addConstraint(s, { kind: 'tangent', a: line, b: id } as never)
    expect(setSplineEndDirection(s, id, 'b', 0).ok).toBe(false)
  })
  it('keeps a hand-set end direction through a solve', () => {
    const { s, id } = seed()
    const r = setSplineEndDirection(s, id, 'b', -Math.PI / 4); expect(r.ok).toBe(true); if (!r.ok) return
    solveSketch(r.sketch)
    expect(sp(r.sketch, id).endDir).toBeCloseTo(-Math.PI / 4, 9)
    expect(sp(r.sketch, id).endSet).toBe(true)
    const d = splineDirAt(splineCurve(sp(r.sketch, id)), 3)
    expect(Math.atan2(d[1], d[0])).toBeCloseTo(-Math.PI / 4, 9)
  })
  it('finds the fit point near a spot', () => {
    const { s, id } = seed()
    expect(splinePointNear(sp(s, id), [10.3, 7.8], 1)).toBe(1)
    expect(splinePointNear(sp(s, id), [17, 0], 1)).toBeNull()
  })
})
