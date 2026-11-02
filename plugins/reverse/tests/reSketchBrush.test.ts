// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest'
import { brushPoints, brushedPoints, fitBrushPrimitive, sketchWithBrushFit } from '../core/sketchBrush'
import { emptySketch } from '../core/sketch'
import { fitBrushClosedShape } from '../core/sketchBrushShapes'
import type { Vec2 } from '../../../src/core/flat/types'
import { useSketchBrush } from '../state/sketchBrushStore'
import { useReverse } from '../state/reStore'
import { XY } from './reKit'

const options = { tolerance: 0.1, axisDegrees: 1, curvePoints: 8 }
const sample = (points: Vec2[]) => brushPoints([points])
const arc = (start = 0, sweep = Math.PI / 2, count = 50): Vec2[] => Array.from({ length: count }, (_, i) => { const a = start + sweep * i / (count - 1); return [3 + 10 * Math.cos(a), -2 + 10 * Math.sin(a)] })
const transform = (p: Vec2): Vec2 => [25 + p[0] * Math.cos(0.37) - p[1] * Math.sin(0.37), -18 + p[0] * Math.sin(0.37) + p[1] * Math.cos(0.37)]
const polygonPoints = (corners: Vec2[]): Vec2[] => corners.flatMap((a, j) => Array.from({ length: 30 }, (_, i): Vec2 => { const b = corners[(j + 1) % corners.length], u = i / 30; return transform([a[0] * (1 - u) + b[0] * u, a[1] * (1 - u) + b[1] * u]) }))

describe('section-point brush geometry', () => {
  it('selects the whole swept circle without skipping fast pointer movement', () => {
    const pts = sample([[0, 0], [5, 0.8], [10, 0], [5, 1.1], [-1.1, 0]])
    expect(brushedPoints(pts, [0, 0], [10, 0], 1).map((p) => p.index)).toEqual([0, 1, 2])
    expect(brushedPoints(pts, [5, 0], [5, 0], 1).map((p) => p.index)).toEqual([1])
    expect(brushedPoints(pts, [0, 0], [10, 0], NaN)).toEqual([])
  })
  it('fits the actual selected line points and records data for the solver', () => {
    const fit = fitBrushPrimitive('line', sample([[0, 2], [5, 2], [10, 2]]), options)
    expect(fit.ok).toBe(true)
    if (!fit.ok || fit.entity.kind !== 'line') throw new Error('Expected line')
    expect(fit.entity.a[1]).toBeCloseTo(2)
    expect(fit.entity.b[1]).toBeCloseTo(2)
    expect(fit.entity.points).toHaveLength(3)
    expect(fit.axis).toBe('horizontal')
    const original = emptySketch()
    const made = sketchWithBrushFit(original, fit)!
    expect(original.entities).toHaveLength(0)
    expect(made.constraints).toMatchObject([{ kind: 'horizontal', entity: 1, inferred: true }])
  })
  it('applies axis inference only within the configured angle', () => {
    const points = sample([[0, 0], [10, 0.1]])
    const on = fitBrushPrimitive('line', points, options)
    const off = fitBrushPrimitive('line', points, { ...options, axisDegrees: 0 })
    expect(on.ok && on.axis).toBe('horizontal')
    expect(off.ok && off.axis).toBeUndefined()
  })
  it('fits circle and partial arc from highlighted samples', () => {
    const circle = fitBrushPrimitive('circle', sample(arc(0, Math.PI * 2)), options)
    const fit = fitBrushPrimitive('arc', sample(arc()), options)
    expect(circle.ok && circle.entity.kind === 'circle' && circle.entity.r).toBeCloseTo(10, 7)
    expect(fit.ok && fit.entity.kind === 'arc' && fit.entity.sweep).toBeCloseTo(Math.PI / 2, 7)
    expect(circle.ok && circle.maxDeviation).toBeLessThan(1e-7)
  })
  it('rejects insufficient, coincident, collinear circle and out-of-tolerance data without mutating', () => {
    const sketch = emptySketch()
    for (const [kind, points] of [
      ['line', [[0, 0], [0, 0]]],
      ['circle', [[0, 0], [1, 0], [2, 0]]],
      ['arc', [[0, 0], [1, 0]]],
      ['line', [[0, 0], [5, 5], [10, 0]]],
    ] as const) {
      const fit = fitBrushPrimitive(kind, sample(points.map((p) => [p[0], p[1]])), options)
      expect(fit.ok).toBe(false)
      expect(sketchWithBrushFit(sketch, fit)).toBeNull()
    }
    expect(sketch.entities).toHaveLength(0)
  })
  it('keeps ordered single-contour curve data and refuses to bridge separate contours', () => {
    const points = Array.from({ length: 30 }, (_, i): Vec2 => [i / 3, 2 + i / 6])
    const fit = fitBrushPrimitive('curve', sample(points), options)
    expect(fit.ok && fit.entity.kind === 'spline' && fit.entity.pts.length).toBe(8)
    expect(fitBrushPrimitive('curve', brushPoints([points.slice(0, 15), points.slice(15)]), options).ok).toBe(false)
  })
  it('fits a complete rotated rectangle and keeps closed-contour relations', () => {
    const points = polygonPoints([[-10, -4], [10, -4], [10, 4], [-10, 4]])
    const fit = fitBrushPrimitive('rectangle', sample(points), options)
    expect(fit.ok, !fit.ok ? fit.error : undefined).toBe(true)
    if (!fit.ok) return
    expect(fit.shapeSketch!.entities).toHaveLength(4)
    expect(fit.maxDeviation).toBeLessThan(0.01)
    const next = sketchWithBrushFit(emptySketch(), fit)!
    expect(next.constraints.filter((c) => c.kind === 'coincident')).toHaveLength(4)
    expect(next.constraints.filter((c) => c.kind === 'perpendicular')).toHaveLength(1)
  })
  it('fits a rotated slot from straight walls and round ends with tangent joins', () => {
    const points: Vec2[] = []
    for (let i = 0; i < 30; i++) { const u = i / 29; points.push(transform([-8 + 16 * u, 3]), transform([-8 + 16 * u, -3])); const a = -Math.PI / 2 + u * Math.PI; points.push(transform([8 + 3 * Math.cos(a), 3 * Math.sin(a)]), transform([-8 - 3 * Math.cos(a), 3 * Math.sin(a)])) }
    const fit = fitBrushPrimitive('slot', sample(points), options)
    expect(fit.ok, !fit.ok ? fit.error : undefined).toBe(true)
    if (!fit.ok) return
    expect(fit.shapeSketch!.entities.filter((e) => e.kind === 'arc')).toHaveLength(2)
    expect(fit.shapeSketch!.constraints.filter((c) => c.kind === 'tangent')).toHaveLength(4)
    expect(fit.maxDeviation).toBeLessThan(0.01)
  })
  it('fits an arbitrary rotated regular hexagon and rejects incomplete contours', () => {
    const corners = Array.from({ length: 6 }, (_, i): Vec2 => [10 * Math.cos(i * Math.PI / 3), 10 * Math.sin(i * Math.PI / 3)])
    const fit = fitBrushPrimitive('hexagon', sample(polygonPoints(corners)), options)
    expect(fit.ok, !fit.ok ? fit.error : undefined).toBe(true)
    if (fit.ok) expect(fit.shapeSketch!.entities.filter((e) => e.kind === 'line')).toHaveLength(6)
    const incomplete = fitBrushClosedShape('rectangle', Array.from({ length: 30 }, (_, i): Vec2 => [i / 3, 2]), 0.1)
    expect(typeof incomplete).toBe('string')
  })
})

beforeEach(() => {
  useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, extrudeDraft: null, revolveDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
  useReverse.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
  useSketchBrush.setState({ open: false, primitive: 'line', brushPx: 52, instant: true, tolerance: 0.1, axisDegrees: 1, curvePoints: 8, selected: [], selectionOverflow: false, preview: null, message: null })
})

describe('brush fit draft commit', () => {
  it('adds one undoable measured primitive and restores it on redo', () => {
    const s = useSketchBrush.getState()
    s.setOpen(true)
    s.setSelected(sample([[0, 2], [5, 2], [10, 2]]))
    expect(s.apply()).toBe(true)
    expect(useReverse.getState().sketchDraft!.sketch.entities).toHaveLength(1)
    expect(useSketchBrush.getState().selected).toHaveLength(0)
    useReverse.getState().undoSketch()
    expect(useReverse.getState().sketchDraft!.sketch.entities).toHaveLength(0)
    useReverse.getState().redoSketch()
    expect(useReverse.getState().sketchDraft!.sketch.entities).toHaveLength(1)
  })
  it('preserves the draft and history for a rejected fit', () => {
    const before = JSON.stringify(useReverse.getState().sketchDraft)
    useSketchBrush.getState().setPrimitive('circle')
    useSketchBrush.getState().setSelected(sample([[0, 0], [1, 0], [2, 0]]))
    expect(useSketchBrush.getState().apply()).toBe(false)
    expect(JSON.stringify(useReverse.getState().sketchDraft)).toBe(before)
    expect(useSketchBrush.getState().message).toBeTruthy()
  })
  it('commits a measured closed rectangle through the actual solver and keeps undo atomic', () => {
    const points = polygonPoints([[-10, -4], [10, -4], [10, 4], [-10, 4]])
    useSketchBrush.getState().setPrimitive('rectangle')
    useSketchBrush.getState().setSelected(sample(points))
    expect(useSketchBrush.getState().apply()).toBe(true)
    const draft = useReverse.getState().sketchDraft!
    expect(draft.sketch.entities).toHaveLength(4)
    expect(draft.report?.ok).toBe(true)
    expect(draft.found).toHaveLength(1)
    useReverse.getState().undoSketch()
    expect(useReverse.getState().sketchDraft!.sketch.entities).toHaveLength(0)
  })
  it('does not commit a truncated selection after the brush point budget is exceeded', () => {
    useSketchBrush.getState().setSelected(sample([[0, 2], [5, 2], [10, 2]]))
    useSketchBrush.setState({ selectionOverflow: true, preview: null })
    const before = JSON.stringify(useReverse.getState().sketchDraft)
    expect(useSketchBrush.getState().apply()).toBe(false)
    expect(JSON.stringify(useReverse.getState().sketchDraft)).toBe(before)
    useSketchBrush.getState().clear()
    expect(useSketchBrush.getState().selectionOverflow).toBe(false)
  })
})
