// SPDX-License-Identifier: AGPL-3.0-only
// Corner Trim beyond two lines (2D Sketch overhaul, batch 1): line/arc,
// arc/arc and line/curve joins at exact crossings; a robust mesh-fitted
// fillet over acute, right, obtuse and shallow corners.
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { buildCornerTrim, cornerEndsNearPath } from '../core/sketchCornerTrim'
import { addEntity, anchorPoint, cloneSketch, emptySketch, entityOf, type Sketch, type SketchArc, type SketchLine, type SketchSpline } from '../core/sketch'
import { nearestOnSpline, splineAt, splineCurve } from '../core/sketchSpline'

const trim = { mode: 'trim' as const, radiusMm: 1, addDimension: false }
const near = (p: Vec2, q: Vec2, tol = 1e-9) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol
const ok = (r: ReturnType<typeof buildCornerTrim>) => { if (!r.ok) throw new Error(r.error); return r }
const coincidentPainted = (s: Sketch) => s.constraints.filter((c) => c.kind === 'coincident')

describe('Corner Trim joins arcs and curves', () => {
  it('extends a line and an arc to their nearest true crossing', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [-10, 0], b: [2, 0] })
    addEntity(s, { kind: 'arc', c: [10, 3], r: 5, start: 2, sweep: 1 })
    const before = cloneSketch(s)
    const r = ok(buildCornerTrim(s, [1, 2], trim, [], [{ entity: 1, at: 'b' }, { entity: 2, at: 'b' }]))
    const line = entityOf(r.sketch, 1) as SketchLine, arc = entityOf(r.sketch, 2) as SketchArc
    expect(near(line.b, [6, 0])).toBe(true)
    expect(near(anchorPoint(arc, 'b'), [6, 0])).toBe(true)
    // The far ends and the circle stay exactly where they were.
    expect(line.a).toEqual([-10, 0])
    expect(arc.c[0]).toBeCloseTo(10, 9); expect(arc.c[1]).toBeCloseTo(3, 9); expect(arc.r).toBeCloseTo(5, 9)
    expect(near(anchorPoint(arc, 'a'), anchorPoint(before.entities[1], 'a'))).toBe(true)
    expect(coincidentPainted(r.sketch)).toMatchObject([{ p: { entity: 1, at: 'b' }, q: { entity: 2, at: 'b' } }])
    expect(s).toEqual(before)
  })

  it('trims an arc that overshoots a line, keeping its painted side away from the far end', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [0, 0], b: [20, 0] })
    // Arc centre (10, 3), r 5, from 2 rad round past the line's crossing at (6, 0).
    addEntity(s, { kind: 'arc', c: [10, 3], r: 5, start: 2, sweep: 2.2 })
    const r = ok(buildCornerTrim(s, [1, 2], trim, [], [{ entity: 1, at: 'a' }, { entity: 2, at: 'b' }]))
    const line = entityOf(r.sketch, 1) as SketchLine, arc = entityOf(r.sketch, 2) as SketchArc
    expect(near(line.a, [6, 0])).toBe(true)
    expect(near(anchorPoint(arc, 'b'), [6, 0])).toBe(true)
    expect(arc.start).toBe(2)
    expect(arc.sweep).toBeCloseTo(Math.atan2(-3, -4) + 2 * Math.PI - 2, 12)
  })

  it('joins two arcs at the crossing nearer the painted ends', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'arc', c: [0, 0], r: 5, start: 0, sweep: 0.6 })          // ends near (4.1, 2.8)
    addEntity(s, { kind: 'arc', c: [8, 0], r: 5, start: Math.PI - 0.3, sweep: 0.3 }) // a near (3.2, 1.5)
    const r = ok(buildCornerTrim(s, [1, 2], trim, [], [{ entity: 1, at: 'b' }, { entity: 2, at: 'a' }]))
    const x: Vec2 = [4, 3] // circles |p| = 5 and |p − (8,0)| = 5 cross at (4, ±3)
    expect(near(anchorPoint(entityOf(r.sketch, 1)!, 'b'), x)).toBe(true)
    expect(near(anchorPoint(entityOf(r.sketch, 2)!, 'a'), x)).toBe(true)
    expect(near(anchorPoint(entityOf(r.sketch, 2)!, 'b'), anchorPoint(s.entities[1], 'b'))).toBe(true)
  })

  it('extends an open curve along its own end cubic onto a line, keeping its shape', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'spline', pts: [[0, 10], [3, 6], [5, 3], [6, 1]] })
    addEntity(s, { kind: 'line', a: [12, 0], b: [20, 0] })
    const original = splineCurve(s.entities[0] as SketchSpline)
    const r = ok(buildCornerTrim(s, [1, 2], trim, [], [{ entity: 1, at: 'b' }, { entity: 2, at: 'a' }]))
    const curve = entityOf(r.sketch, 1) as SketchSpline, line = entityOf(r.sketch, 2) as SketchLine
    expect(curve.controlKnots).toBeDefined()
    const end = anchorPoint(curve, 'b')
    expect(Math.abs(end[1])).toBeLessThan(1e-9)
    expect(near(line.a, end)).toBe(true)
    expect(line.b).toEqual([20, 0])
    expect(near(anchorPoint(curve, 'a'), [0, 10])).toBe(true)
    // Every point of the original curve still lies on the new one.
    const fit = splineCurve(curve)
    for (let t = 0; t <= 3; t += 0.125) expect(nearestOnSpline(fit, splineAt(original, t)).dist).toBeLessThan(1e-7)
  })

  it('trims an open curve where it crosses a line', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'spline', pts: [[0, 6], [2, 3], [4, -1], [6, -4]] })
    addEntity(s, { kind: 'line', a: [-10, 0], b: [0, 0] })
    const r = ok(buildCornerTrim(s, [1, 2], trim, [], [{ entity: 1, at: 'b' }, { entity: 2, at: 'b' }]))
    const curve = entityOf(r.sketch, 1) as SketchSpline
    const end = anchorPoint(curve, 'b')
    expect(Math.abs(end[1])).toBeLessThan(1e-9)
    expect(end[0]).toBeGreaterThan(2); expect(end[0]).toBeLessThan(4)
    expect(near((entityOf(r.sketch, 2) as SketchLine).b, end)).toBe(true)
  })

  it('paints arc and curve ends, and fillets a line and an arc, and refuses circles, fillets of curves and pieces that never meet', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'arc', c: [0, 0], r: 5, start: 0, sweep: 1 })
    expect(cornerEndsNearPath(s, [[5, 0]], 0.1)).toEqual([{ entity: 1, at: 'a' }])
    addEntity(s, { kind: 'circle', c: [30, 0], r: 2 })
    expect(buildCornerTrim(s, [1, 2], trim).ok).toBe(false)
    const t = emptySketch()
    addEntity(t, { kind: 'line', a: [-10, 0], b: [2, 0] })
    addEntity(t, { kind: 'arc', c: [10, 3], r: 5, start: 2, sweep: 1 })
    // Since 1.2.6 a line and an arc are filleted; a free-form curve is not.
    expect(buildCornerTrim(t, [1, 2], { ...trim, mode: 'fixedFillet', radiusMm: 1 })).toMatchObject({ ok: true, shape: 'arc', radiusMm: 1 })
    const c = emptySketch()
    addEntity(c, { kind: 'spline', pts: [[0, 10], [3, 6], [5, 3], [6, 1]] })
    addEntity(c, { kind: 'line', a: [12, 0], b: [20, 0] })
    expect(buildCornerTrim(c, [1, 2], { ...trim, mode: 'fixedFillet', radiusMm: 1 }, [], [{ entity: 1, at: 'b' }, { entity: 2, at: 'a' }])).toMatchObject({ ok: false, error: expect.stringMatching(/free-form curve/) })
    const u = emptySketch()
    addEntity(u, { kind: 'line', a: [-10, 20], b: [2, 20] })
    addEntity(u, { kind: 'arc', c: [10, 3], r: 5, start: 2, sweep: 1 })
    const before = cloneSketch(u)
    expect(buildCornerTrim(u, [1, 2], trim).ok).toBe(false)
    expect(u).toEqual(before)
  })
})

/** Two lines meeting at `angle` at the origin, with scan samples on the true
 *  tangent fillet of `radius` plus straight flank samples. */
function corner(angleDeg: number, radius: number) {
  const s = emptySketch(), half = (angleDeg * Math.PI) / 360
  const u: Vec2 = [1, 0], v: Vec2 = [Math.cos(2 * half), Math.sin(2 * half)]
  addEntity(s, { kind: 'line', a: [u[0] * 2, u[1] * 2], b: [u[0] * 60, u[1] * 60] })
  addEntity(s, { kind: 'line', a: [v[0] * 2, v[1] * 2], b: [v[0] * 60, v[1] * 60] })
  const bis: Vec2 = [Math.cos(half), Math.sin(half)], d = radius / Math.sin(half)
  const c: Vec2 = [bis[0] * d, bis[1] * d], t = radius / Math.tan(half)
  const ta: Vec2 = [u[0] * t, u[1] * t], tb: Vec2 = [v[0] * t, v[1] * t]
  const a0 = Math.atan2(ta[1] - c[1], ta[0] - c[0]), a1 = Math.atan2(tb[1] - c[1], tb[0] - c[0])
  let sweep = a1 - a0
  while (sweep > Math.PI) sweep -= 2 * Math.PI
  while (sweep < -Math.PI) sweep += 2 * Math.PI
  const scan: Vec2[] = []
  for (let i = 1; i < 40; i++) { const a = a0 + (sweep * i) / 40; scan.push([c[0] + radius * Math.cos(a), c[1] + radius * Math.sin(a)]) }
  return { s, c, scan }
}

describe('Mesh-fitted fillet', () => {
  for (const angle of [12, 35, 90, 125, 160, 172]) {
    it(`fits the scan radius tangent to both lines at a ${angle}° corner`, () => {
      const { s, c, scan } = corner(angle, 4)
      const r = ok(buildCornerTrim(s, [1, 2], { mode: 'autoFillet', radiusMm: 1, addDimension: true }, scan))
      expect(r.radiusMm).toBeCloseTo(4, 5)
      const arc = r.sketch.entities.find((e) => e.kind === 'arc') as SketchArc
      expect(Math.hypot(arc.c[0] - c[0], arc.c[1] - c[1])).toBeLessThan(1e-4)
      // G0: each line end lies on an arc end; G1: the centre is r from each line.
      const l1 = entityOf(r.sketch, 1) as SketchLine, l2 = entityOf(r.sketch, 2) as SketchLine
      const ends = [anchorPoint(arc, 'a'), anchorPoint(arc, 'b')]
      for (const l of [l1, l2]) {
        expect(ends.some((e) => near(e, l.a, 1e-6))).toBe(true)
        const dx = l.b[0] - l.a[0], dy = l.b[1] - l.a[1]
        expect(Math.abs(((arc.c[0] - l.a[0]) * dy - (arc.c[1] - l.a[1]) * dx) / Math.hypot(dx, dy))).toBeCloseTo(arc.r, 6)
      }
      // The radius stays editable: Auto Fillet adds a radius dimension when asked.
      expect(r.sketch.constraints.some((k) => k.kind === 'radius')).toBe(true)
    })
  }

  it('ignores a few stray scan points instead of bending the radius', () => {
    const { s, scan } = corner(90, 4)
    const noisy = scan.concat([[1.2, 1.9], [1.7, 1.1], [2.4, 1.4]])
    const r = ok(buildCornerTrim(s, [1, 2], { mode: 'autoFillet', radiusMm: 1, addDimension: false }, noisy))
    expect(r.radiusMm).toBeCloseTo(4, 3)
    expect(r.usedPoints).toBe(scan.length)
  })

  it('reports a non-circular blend instead of inserting an inaccurate arc', () => {
    const { s } = corner(90, 4)
    // A blend with a 1.4 mm bump: not a tangent circle.
    const bumpy: Vec2[] = Array.from({ length: 39 }, (_, i) => {
      const a = Math.PI + ((i + 1) / 40) * (Math.PI / 2), r = 4 + 1.4 * Math.sin(2 * (a - Math.PI)) ** 2
      return [4 + r * Math.cos(a), 4 + r * Math.sin(a)]
    })
    const r = buildCornerTrim(s, [1, 2], { mode: 'autoFillet', radiusMm: 1, addDimension: false }, bumpy)
    expect(r.ok).toBe(false)
  })
})
