// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { buildCornerTrim, pointsInCornerArea, type CornerTrimOptions } from '../core/sketchCornerTrim'
import { addConstraint, addEntity, cloneSketch, emptySketch, entityOf, type Sketch, type SketchArc, type SketchLine } from '../core/sketch'
import { useReverse } from '../state/reStore'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'
import { XY } from './reKit'

const options: CornerTrimOptions = { mode: 'trim', radiusMm: 2, addDimension: true }
const make = (): Sketch => {
  const sketch = emptySketch()
  addEntity(sketch, { kind: 'line', a: [2, 0], b: [20, 0] })
  addEntity(sketch, { kind: 'line', a: [0, 2], b: [0, 20] })
  return sketch
}
const rounded = (radius = 3): Vec2[] => Array.from({ length: 23 }, (_, i) => {
  const t = Math.PI + (i + 1) / 24 * Math.PI / 2
  return [radius + radius * Math.cos(t), radius + radius * Math.sin(t)]
})

describe('Corner Trim geometry', () => {
  it('extends two separated lines to their real intersection and preserves far ends', () => {
    const source = make(), before = cloneSketch(source)
    const result = buildCornerTrim(source, [1, 2], options)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.sketch.entities).toMatchObject([{ a: [0, 0], b: [20, 0] }, { a: [0, 0], b: [0, 20] }])
    expect(result.sketch.constraints).toMatchObject([{ kind: 'coincident', p: { entity: 1, at: 'a' }, q: { entity: 2, at: 'a' } }])
    expect(source).toEqual(before)
  })

  it('trims crossing carriers without changing their far ends', () => {
    const source = make()
    ;(source.entities[0] as SketchLine).a = [-2, 0]
    ;(source.entities[1] as SketchLine).a = [0, -2]
    const result = buildCornerTrim(source, [1, 2], options)
    expect(result.ok && result.sketch.entities).toMatchObject([{ a: [0, 0], b: [20, 0] }, { a: [0, 0], b: [0, 20] }])
  })

  it('builds a fixed-radius fillet with true tangency, coincidence and optional dimension', () => {
    for (const addDimension of [false, true]) {
      const result = buildCornerTrim(make(), [1, 2], { mode: 'fixedFillet', radiusMm: 4, addDimension })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      const arc = result.sketch.entities.find((e) => e.kind === 'arc') as SketchArc
      expect(arc.r).toBeCloseTo(4, 6)
      expect(arc.c[0]).toBeCloseTo(4, 6); expect(arc.c[1]).toBeCloseTo(4, 6)
      expect(result.sketch.constraints.filter((c) => c.kind === 'tangent')).toHaveLength(2)
      expect(result.sketch.constraints.filter((c) => c.kind === 'coincident')).toHaveLength(2)
      expect(result.sketch.constraints.filter((c) => c.kind === 'radius')).toHaveLength(addDimension ? 1 : 0)
      expect((entityOf(result.sketch, 1) as SketchLine).b[0]).toBeCloseTo(20, 8)
      expect((entityOf(result.sketch, 1) as SketchLine).b[1]).toBeCloseTo(0, 8)
    }
  })

  it('fits a nondefault radius from actual rounded reference samples', () => {
    const result = buildCornerTrim(make(), [1, 2], { ...options, mode: 'autoFillet', radiusMm: 99 }, rounded(3.7))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.radiusMm).toBeCloseTo(3.7, 5)
    expect(result.rms).toBeLessThan(1e-6)
    expect(result.usedPoints).toBeGreaterThanOrEqual(15)
    const arc = result.sketch.entities.find((e) => e.kind === 'arc') as SketchArc
    expect(arc.r).toBeCloseTo(3.7, 5)
    expect(arc.points?.length).toBe(result.usedPoints)
  })

  it('refuses Auto Fillet without adequate curved data instead of choosing a default', () => {
    const source = make(), before = cloneSketch(source)
    for (const points of [[], [[1, 0], [2, 0], [3, 0], [0, 1], [0, 2], [0, 3]] as Vec2[], rounded().slice(0, 3)]) {
      expect(buildCornerTrim(source, [1, 2], { ...options, mode: 'autoFillet' }, points).ok).toBe(false)
      expect(source).toEqual(before)
    }
  })

  it('rejects straight noisy data and insufficient angular coverage', () => {
    const flat = Array.from({ length: 20 }, (_, i): Vec2 => [2 + i * 0.1, 0.1])
    expect(buildCornerTrim(make(), [1, 2], { ...options, mode: 'autoFillet' }, flat).ok).toBe(false)
    const tiny = Array.from({ length: 10 }, (_, i): Vec2 => [3 + 3 * Math.cos(Math.PI * 1.2 + i * 0.001), 3 + 3 * Math.sin(Math.PI * 1.2 + i * 0.001)])
    expect(buildCornerTrim(make(), [1, 2], { ...options, mode: 'autoFillet' }, tiny).ok).toBe(false)
  })

  it('rejects unsupported, fixed, parallel, oversized and constrained choices without mutation', () => {
    const fixtures = [make(), make(), make(), make(), make()]
    fixtures[0].entities[0].fixed = true
    addConstraint(fixtures[1], { kind: 'length', entity: 1, value: 18 })
    ;(fixtures[2].entities[1] as SketchLine).a = [0, 5]
    ;(fixtures[2].entities[1] as SketchLine).b = [20, 5]
    addEntity(fixtures[3], { kind: 'circle', c: [10, 10], r: 2 })
    const cases: [Sketch, number[], CornerTrimOptions][] = [
      [fixtures[0], [1, 2], options], [fixtures[1], [1, 2], options], [fixtures[2], [1, 2], options],
      [fixtures[3], [1, 2, 3], options], [fixtures[3], [1, 3], options], [fixtures[4], [1, 2], { ...options, mode: 'fixedFillet', radiusMm: 40 }],
    ]
    for (const [source, ids, opt] of cases) {
      const before = cloneSketch(source)
      expect(buildCornerTrim(source, ids, opt).ok).toBe(false)
      expect(source).toEqual(before)
    }
  })

  it('filters actual samples by a rotated area including its boundary', () => {
    expect(pointsInCornerArea([[0, 0], [1, 0], [2, 2]], [[0, 1], [1, 0], [0, -1], [-1, 0]])).toEqual([[0, 0], [1, 0]])
    expect(pointsInCornerArea([[0, 0]], [[0, 0], [1, 0], [2, 0]])).toEqual([])
  })

  it('protects projected geometry and construction membership', () => {
    const source = make(), before = cloneSketch(source)
    source.entities[0].projected = true
    expect(buildCornerTrim(source, [1, 2], options)).toMatchObject({ ok: false, error: expect.stringMatching(/projected/) })
    delete source.entities[0].projected
    source.entities[0].construction = true
    expect(buildCornerTrim(source, [1, 2], options).ok).toBe(false)
    source.entities[1].construction = true
    const result = buildCornerTrim(source, [1, 2], { ...options, mode: 'fixedFillet' })
    expect(result.ok && result.sketch.entities.find((e) => e.kind === 'arc')?.construction).toBe(true)
    expect(before.entities).not.toMatchObject([{ construction: true }])
  })

  it('preserves a far-end join and rejects a near-end connection to a third entity', () => {
    const source = make()
    const point = addEntity(source, { kind: 'point', p: [20, 0], fixed: true })
    addConstraint(source, { kind: 'coincident', p: { entity: 1, at: 'b' }, q: { entity: point, at: 'center' } })
    const result = buildCornerTrim(source, [1, 2], { ...options, mode: 'fixedFillet' })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.sketch.constraints.some((c) => c.kind === 'coincident' && c.q.entity === point)).toBe(true)
    const before = cloneSketch(source)
    addConstraint(source, { kind: 'coincident', p: { entity: 1, at: 'a' }, q: { entity: point, at: 'center' } })
    expect(buildCornerTrim(source, [1, 2], options).ok).toBe(false)
    expect(before.entities).toEqual(source.entities)
  })
})

describe('Corner Trim preview/apply/cancel/undo', () => {
  beforeEach(() => {
    useReverse.getState().reset()
    useReverse.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, make().entities)
    useReverse.setState({ sketchDraft: { ...useReverse.getState().sketchDraft!, selection: [1, 2] } })
    useSketchCornerTrim.setState({ mode: 'trim', radiusMm: 2, addDimension: true })
    useSketchCornerTrim.getState().setOpen(true)
  })

  it('keeps preview provisional and cancels without document changes', () => {
    const before = cloneSketch(useReverse.getState().sketchDraft!.sketch)
    useSketchCornerTrim.getState().previewSelected()
    expect(useSketchCornerTrim.getState().preview?.ok).toBe(true)
    expect(useReverse.getState().sketchDraft!.sketch).toEqual(before)
    useSketchCornerTrim.getState().cancel()
    expect(useReverse.getState().sketchDraft!.sketch).toEqual(before)
    expect(useReverse.getState().sketchDraft!.history).toHaveLength(0)
  })

  it('commits the preview as one edit and Undo restores the original geometry', () => {
    const before = cloneSketch(useReverse.getState().sketchDraft!.sketch)
    useSketchCornerTrim.getState().previewSelected()
    expect(useSketchCornerTrim.getState().apply()).toBe(true)
    expect(useReverse.getState().sketchDraft!.history).toHaveLength(1)
    useSketchCornerTrim.getState().undo()
    expect(useReverse.getState().sketchDraft!.sketch).toEqual(before)
  })

  it('updates a fixed-size preview dynamically and refuses stale apply', () => {
    const state = useSketchCornerTrim.getState()
    state.setMode('fixedFillet'); state.previewSelected(); state.setRadiusMm(5)
    const preview = useSketchCornerTrim.getState().preview
    expect(preview?.ok && preview.radiusMm).toBe(5)
    useReverse.getState().toggleConstructionSelected()
    const before = cloneSketch(useReverse.getState().sketchDraft!.sketch)
    expect(useSketchCornerTrim.getState().apply()).toBe(false)
    expect(useReverse.getState().sketchDraft!.sketch).toEqual(before)
    expect(useSketchCornerTrim.getState().message).toMatch(/changed/)
  })

  it('selects exactly two crossed lines and section points from a corner area', () => {
    const state = useSketchCornerTrim.getState()
    state.setMode('autoFillet')
    state.selectArea([[-1, -1], [6, -1], [6, 6], [-1, 6]], [...rounded(), [40, 40]])
    expect(useSketchCornerTrim.getState().ids).toEqual([1, 2])
    expect(useSketchCornerTrim.getState().points).not.toContainEqual([40, 40])
    expect(useSketchCornerTrim.getState().preview?.ok).toBe(true)
  })
})
