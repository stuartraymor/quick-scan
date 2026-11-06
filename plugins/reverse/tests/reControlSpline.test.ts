// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { evalSpline, evalSplineDerivative, splineBezierForm, splinePolyline } from '../../../src/core/flat/spline'
import { fitControlSpline } from '../core/controlSpline'
import { bsplineAt, nearestOnSpline, splineAt, splineCurve, splineEnd, splineStretch } from '../core/sketchSpline'
import { moveAnchor, rotateSketch, translateEntity } from '../core/drag'
import { addConstraint, addEntity, emptySketch, type SketchSpline } from '../core/sketch'
import { solveSketch } from '../core/solver'
import { projectSketchEntity } from '../core/project'
import { XY, build, sketchOf as featureSketch, extrudeAll } from './reKit'
import { validateFeatureJson, featureToJson, applyReversePart } from '../app/projectSection'
import { useReverse } from '../state/reStore'
import { Builder } from '../core/build'
import { ReKernel } from '../core/kernel'

const curve: SketchSpline = { id: 1, kind: 'spline', pts: [[0, 0], [1, 4], [4, 6], [8, -2], [12, 3], [16, 7], [20, 2], [24, 0]], controlKnots: [0, 0.08, 0.3, 0.6, 0.85, 1] }
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])
describe('geometric parameter refinement', () => {
  const truth={poles:[[0,0],[0,25],[40,-20],[50,0]] as Vec2[],knots:[0,1],mults:[4,4]}
  it.each([1,1.3])('fits an asymmetric cubic at sampling exponent %s without chord-length bias', (power) => {
    const points=Array.from({length:161},(_,i)=>bsplineAt(truth,(i/160)**power) as Vec2)
    const fit=fitControlSpline(points,4), curve=splineCurve(fit)
    expect(fit.pts[0]).toEqual(points[0]);expect(fit.pts.at(-1)).toEqual(points.at(-1))
    expect(Math.max(...points.map(p=>nearestOnSpline(curve,p,32).dist))).toBeLessThan(.002)
    expect(Math.max(...Array.from({length:301},(_,i)=>nearestOnSpline(curve,bsplineAt(truth,i/300) as Vec2,32).dist))).toBeLessThan(.002)
    expect(fitControlSpline(points,4)).toEqual(fit)
  })
  it('preserves curved fitting accuracy after rotation and a large translation', () => {
    const map=([x,y]:Vec2):Vec2=>[1e6+.6*x-.8*y,-2e6+.8*x+.6*y]
    const points=Array.from({length:161},(_,i)=>map(bsplineAt(truth,(i/160)**1.3) as Vec2))
    const fit=fitControlSpline(points,4),curve=splineCurve(fit)
    expect(Math.max(...points.map(p=>nearestOnSpline(curve,p,32).dist))).toBeLessThan(.002)
    expect(fit.pts[0]).toEqual(points[0]);expect(fit.pts.at(-1)).toEqual(points.at(-1))
  })
  it('retains accuracy when samples are duplicated or densified', () => {
    const sparse=Array.from({length:161},(_,i)=>bsplineAt(truth,(i/160)**1.3) as Vec2)
    const duplicate=sparse.flatMap((p,i)=>i%3?[p]:[p,p,p])
    const dense=Array.from({length:1001},(_,i)=>bsplineAt(truth,(i/1000)**1.3) as Vec2)
    const baseline=fitControlSpline(sparse,4)
    const repeated=fitControlSpline(duplicate,4)
    for(let i=0;i<4;i++)expect(dist(baseline.pts[i],repeated.pts[i])).toBeLessThan(1e-8)
    const curve=splineCurve(fitControlSpline(dense,4))
    expect(Math.max(...sparse.map(p=>nearestOnSpline(curve,p,32).dist))).toBeLessThan(.002)
  })
})
const definition = (e: SketchSpline) => ({ poles: e.pts, knots: e.controlKnots!, mults: e.controlKnots!.map((_, i, k) => i === 0 || i === k.length - 1 ? 4 : 1) })
// Follow application import order, as reSketchEditIds does for the command cycle.
beforeAll(async () => { await import('../plugin') }, 60_000)

describe('editable cubic control curves', () => {
  it('renders the exact B-spline and exports it without changing the curve', () => {
    const fit = splineCurve(curve), saved = splineStretch(fit, 0, splineEnd(fit))!
    expect(fit.points.length).toBe(6)
    expect(saved.poles.length).toBe(8)
    let error = 0, derivativeError = 0
    for (let k = 0; k < 5; k++) for (let i = 0; i <= 40; i++) {
      const u = i / 40, t = curve.controlKnots![k] + u * (curve.controlKnots![k + 1] - curve.controlKnots![k])
      const expected = bsplineAt(definition(curve), t)
      error = Math.max(error, dist(evalSpline(fit, k, u), expected), dist(bsplineAt(saved, t), expected))
      if (i > 0 && i < 40) {
        const a = evalSpline(fit, k, u - 1e-6), b = evalSpline(fit, k, u + 1e-6)
        derivativeError = Math.max(derivativeError, dist(evalSplineDerivative(fit, k, u), [(b[0] - a[0]) / 2e-6, (b[1] - a[1]) / 2e-6]))
      }
    }
    expect(error).toBeLessThan(1e-10)
    expect(derivativeError).toBeLessThan(1e-7)
    expect(splinePolyline(fit)[0]).toEqual(curve.pts[0])
    expect(splineBezierForm(fit).poles.at(-1)).toEqual(curve.pts.at(-1))
    expect(nearestOnSpline(fit, splineAt(fit, 2.32)).dist).toBeLessThan(1e-6)
  })

  it('a moved interior pole has local influence and preserves both endpoints', () => {
    const moved = moveAnchor(curve, 'p3', [8, 11]) as SketchSpline
    const a = splineCurve(curve), b = splineCurve(moved)
    expect(moved.pts.filter((_, i) => i !== 3)).toEqual(curve.pts.filter((_, i) => i !== 3))
    expect(moved.controlKnots).toEqual(curve.controlKnots)
    expect(splineAt(b, 0)).toEqual(splineAt(a, 0))
    expect(splineAt(b, 5)).toEqual(splineAt(a, 5))
    expect(dist(splineAt(b, 4.5), splineAt(a, 4.5))).toBeLessThan(1e-12)
    // A pole is not an interpolated point, and a positive basis cannot overshoot.
    const deltas = Array.from({ length: 301 }, (_, i) => splineAt(b, i / 60)[1] - splineAt(a, i / 60)[1])
    expect(Math.min(...deltas)).toBeGreaterThan(-1e-12)
    expect(Math.max(...deltas)).toBeLessThan(13)
    expect(Math.max(...deltas)).toBeGreaterThan(3)
  })

  it('retains exact geometry across JSON, translation, rotation and parallel projection', () => {
    const copy = JSON.parse(JSON.stringify(curve)) as SketchSpline
    expect(splineCurve(copy)).toEqual(splineCurve(curve))
    const moved = translateEntity(copy, [1000, -400]) as SketchSpline
    const projected = projectSketchEntity(moved, XY, { ...XY, origin: [0, 0, 7] }) as SketchSpline
    const sketch = emptySketch(); addEntity(sketch, curve)
    rotateSketch(sketch, Math.PI / 3)
    const rotated = sketch.entities[0] as SketchSpline
    for (let i = 0; i <= 50; i++) {
      const p = splineAt(splineCurve(curve), i / 10), q = splineAt(splineCurve(projected), i / 10), r = splineAt(splineCurve(rotated), i / 10)
      expect(dist(q, [p[0] + 1000, p[1] - 400])).toBeLessThan(1e-10)
      expect(dist(r, [p[0] * 0.5 - p[1] * Math.sqrt(3) / 2, p[0] * Math.sqrt(3) / 2 + p[1] * 0.5])).toBeLessThan(1e-10)
    }
  })

  it('enforces endpoint tangency by moving poles rather than an unused angle', () => {
    const sketch = emptySketch()
    const line = addEntity(sketch, { kind: 'line', a: [-10, 0], b: [0, 0], fixed: true })
    const { id: _id, ...input } = curve
    const id = addEntity(sketch, input)
    addConstraint(sketch, { kind: 'coincident', p: { entity: line, at: 'b' }, q: { entity: id, at: 'a' } })
    addConstraint(sketch, { kind: 'tangent', a: line, b: id })
    expect(solveSketch(sketch).ok).toBe(true)
    const result = sketch.entities[1] as SketchSpline
    expect(result.startDir).toBeUndefined()
    const tangent = evalSplineDerivative(splineCurve(result), 0, 0)
    expect(Math.abs(tangent[1] / Math.hypot(...tangent))).toBeLessThan(1e-7)
  })

  it('does not reinterpret old interpolation curves or silently accept invalid knots', () => {
    const old = { pts: curve.pts }
    for (let i = 0; i < old.pts.length; i++) expect(dist(splineAt(splineCurve(old), i), old.pts[i])).toBeLessThan(1e-12)
    expect(() => splineCurve({ ...curve, controlKnots: [0, 1] })).toThrow(/knots/)
    expect(() => splineCurve({ ...curve, closed: true })).toThrow(/knots/)
  })

  it('preserves control knots in the real project section and rejects malformed saved curves', () => {
    const feature = { kind: 'sketch' as const, id: 1, name: 'Curve', visible: true, plane: { kind: 'world' as const, axis: 'z' as const, offset: 0 }, frame: XY, sketch: { entities: [structuredClone(curve)], constraints: [], nextId: 2 } }
    const json = JSON.parse(JSON.stringify(featureToJson(feature)))
    validateFeatureJson(json)
    applyReversePart({ features: [json], nextFeatureId: 2, nextOfKind: { sketch: 1 }, elementsShown: true })
    expect(useReverse.getState().features[0]).toEqual(feature)
    json.sketch.entities[0].controlKnots[2] = 0
    expect(() => validateFeatureJson(json)).toThrow()
    applyReversePart(undefined)
  })

  it('keeps the same control definition through AI creation and named pole edits', async () => {
    const { sketchOf, setPieces } = await import('../app/reSketchInput')
    const { sketch } = sketchOf({ entities: [structuredClone(curve)], constraints: [], infer: false }, XY)
    expect((sketch.entities[0] as SketchSpline).controlKnots).toEqual(curve.controlKnots)
    setPieces(sketch, { '1': { p3: [8, 11] } }, 'Curve')
    expect((sketch.entities[0] as SketchSpline).pts[3]).toEqual([8, 11])
    expect(() => setPieces(sketch, { '1': { pts: [[0, 0], [1, 1], [2, 0]] } }, 'Curve')).toThrow(/control-pole count/)
  })

  it('builds and exports the exact control curve as a solid with known analytic volume', async () => {
    const feature = featureSketch(1, (sketch) => {
      addEntity(sketch, { kind: 'spline', pts: [[0, 0], [10 / 3, 10], [20 / 3, 10], [10, 0]], controlKnots: [0, 1] })
      addEntity(sketch, { kind: 'line', a: [10, 0], b: [0, 0] })
    })
    const builder = new Builder(await ReKernel.load())
    const result = await build(builder, [feature, extrudeAll(2, feature, 0, 3)])
    expect(result.bodies).toHaveLength(1)
    expect(result.bodies[0].closed).toBe(true)
    // x=10u, y=30u(1-u): area 50 mm², thickness 3 mm.
    expect(result.bodies[0].volume).toBeCloseTo(150, 6)
    expect(builder.exportStep([result.bodies[0].id])).toMatch(/B_SPLINE_CURVE_WITH_KNOTS/)
  }, 60_000)
})

describe('curve fitting rather than sample interpolation', () => {
  it('averages noisy section data and reports a genuinely smooth fitted curve', () => {
    const samples: Vec2[] = Array.from({ length: 201 }, (_, i) => [i / 10, i === 0 || i === 200 ? 0 : 0.02 * Math.sin(i * 1.7)])
    const fitted = fitControlSpline(samples, 8), fit = splineCurve(fitted)
    expect(fitted.pts).toHaveLength(8)
    expect(fitted.pts[0]).toEqual(samples[0]); expect(fitted.pts.at(-1)).toEqual(samples.at(-1))
    const deviations = Array.from({ length: 201 }, (_, i) => Math.abs(splineAt(fit, i / 40)[1]))
    expect(Math.max(...deviations)).toBeLessThan(0.002)
    expect(fit.length).toBeCloseTo(20, 4)
  })

  it('fits rotated straight data at unequal density without losing numerical scale', () => {
    const transform = ([x, y]: Vec2): Vec2 => [1e6 + x * 0.6 - y * 0.8, -2e6 + x * 0.8 + y * 0.6]
    const samples: Vec2[] = Array.from({ length: 201 }, (_, i) => transform([20 * (i / 200) ** 2, 0]))
    const fitted = fitControlSpline(samples, 8), fit = splineCurve(fitted)
    for (let i = 0; i <= 200; i++) expect(nearestOnSpline(fit, transform([i / 10, 0])).dist).toBeLessThan(1e-7)
  })

  it('handles four points and rejects zero-length or invalid input', () => {
    expect(fitControlSpline([[0, 0], [1, 0], [2, 0], [3, 0]], 8).pts).toHaveLength(4)
    expect(() => fitControlSpline([[0, 0], [0, 0], [0, 0], [0, 0]], 8)).toThrow()
    expect(() => fitControlSpline([[0, 0], [1, 0], [2, 0], [3, NaN]], 8)).toThrow()
  })
})
