// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.25: driven (reference) dimensions — read off the pieces after every
// solve, holding nothing, written in brackets — and an arc's length as a
// dimension of its own, driving or driven. The brief's Part 6–7 open items.

import { describe, expect, it } from 'vitest'
import { dimShape } from '../core/dimLayout'
import { addConstraint, addEntity, emptySketch, entityOf, isDriven, type Constraint, type ConstraintInput, type SketchArc, type SketchLine } from '../core/sketch'
import { readDimension, solveSketch } from '../core/solver'
import { useReverse } from '../state/reStore'
import { dimensionText } from '../viewer/sketchDimText'

const dim = (s: { constraints: Constraint[] }, id: number) => s.constraints.find((c) => c.id === id) as Extract<Constraint, { value: number }>
const lengthOf = (l: SketchLine) => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])

describe('driven dimensions in the solver', () => {
  it('a driven dimension holds nothing: it reads the pieces where the driving ones put them', () => {
    const s = emptySketch()
    const l = addEntity(s, { kind: 'line', a: [0, 0], b: [40, 0] })
    addConstraint(s, { kind: 'horizontal', entity: l })
    const ref = addConstraint(s, { kind: 'length', entity: l, value: 40, driven: true })
    const set = addConstraint(s, { kind: 'length', entity: l, value: 55 })
    const r = solveSketch(s)
    expect(r.ok).toBe(true)
    expect(r.unmet).toEqual([])
    expect(lengthOf(entityOf(s, l) as SketchLine)).toBeCloseTo(55, 6)
    expect(dim(s, ref).value).toBeCloseTo(55, 6)
    expect(dim(s, set).value).toBe(55)
    expect(isDriven(dim(s, ref))).toBe(true)
  })

  it('two dimensions that fight overdefine the sketch; made driven, the second reads what the first makes', () => {
    const s = emptySketch()
    const l = addEntity(s, { kind: 'line', a: [0, 0], b: [40, 0] })
    addConstraint(s, { kind: 'length', entity: l, value: 40 })
    const second = addConstraint(s, { kind: 'length', entity: l, value: 50 })
    expect(solveSketch(s).ok).toBe(false)
    s.constraints = s.constraints.map((c) => (c.id === second ? { ...c, driven: true } : c))
    const r = solveSketch(s)
    expect(r.ok).toBe(true)
    expect(dim(s, second).value).toBeCloseTo(40, 6)
  })

  it('a driven dimension adds no equation: the redundancy count is the driving ones\' alone', () => {
    const s = emptySketch()
    const l = addEntity(s, { kind: 'line', a: [0, 0], b: [40, 0] })
    addConstraint(s, { kind: 'length', entity: l, value: 40 })
    addConstraint(s, { kind: 'length', entity: l, value: 40, driven: true })
    const r = solveSketch(s)
    expect(r.ok).toBe(true)
    expect(r.redundant).toBe(0)
  })
})

describe('arc length', () => {
  const quarter = () => {
    const s = emptySketch()
    const a = addEntity(s, { kind: 'arc', c: [0, 0], r: 10, start: 0, sweep: Math.PI / 2 })
    return { s, a }
  }

  it('reads the radius times the sweep', () => {
    const { s, a } = quarter()
    const id = addConstraint(s, { kind: 'arcLength', entity: a, value: 0, driven: true })
    solveSketch(s)
    expect(dim(s, id).value).toBeCloseTo(5 * Math.PI, 9)
  })

  it('driving, with the radius held, opens the sweep to length ÷ radius', () => {
    const { s, a } = quarter()
    addConstraint(s, { kind: 'radius', entity: a, value: 10 })
    addConstraint(s, { kind: 'arcLength', entity: a, value: 20 })
    const r = solveSketch(s)
    expect(r.ok).toBe(true)
    const arc = entityOf(s, a) as SketchArc
    expect(arc.r).toBeCloseTo(10, 6)
    expect(Math.abs(arc.sweep)).toBeCloseTo(2, 6)
    expect(Math.abs(arc.r * arc.sweep)).toBeCloseTo(20, 6)
  })

  it('driven, it follows a radius typed after it', () => {
    const { s, a } = quarter()
    const r = addConstraint(s, { kind: 'radius', entity: a, value: 10 })
    const len = addConstraint(s, { kind: 'arcLength', entity: a, value: 5 * Math.PI, driven: true })
    s.constraints = s.constraints.map((c) => (c.id === r ? { ...c, value: 12 } : c))
    solveSketch(s)
    const arc = entityOf(s, a) as SketchArc
    expect(dim(s, len).value).toBeCloseTo(Math.abs(arc.r * arc.sweep), 9)
    expect(arc.r).toBeCloseTo(12, 6)
  })

  it('is written with ⌒, and in brackets when driven', () => {
    const c = { id: 1, kind: 'arcLength', entity: 2, value: 15.70796 } as const
    expect(dimensionText(c)).toBe('⌒ 15.708')
    expect(dimensionText({ ...c, driven: true })).toBe('(⌒ 15.708)')
    expect(dimensionText({ id: 3, kind: 'radius', entity: 2, value: 5, driven: true })).toBe('(R 5)')
    expect(dimensionText({ id: 4, kind: 'angle', a: 1, b: 2, value: 30, driven: true })).toBe('(30°)')
  })

  it('is drawn as an arc about the arc\'s centre, outside it, from end to end', () => {
    const { s, a } = quarter()
    const shape = dimShape({ id: 9, kind: 'arcLength', entity: a, value: 5 * Math.PI }, s, [], 2)
    if (shape?.kind !== 'angle') throw new Error(`no arc: ${JSON.stringify(shape)}`)
    expect(shape.vertex).toEqual([0, 0])
    expect(shape.a0).toBeCloseTo(0, 12)
    expect(shape.sweep).toBeCloseTo(Math.PI / 2, 12)
    expect(shape.radius).toBeGreaterThan(10)
  })
})

describe('readDimension reads every kind as it stands', () => {
  it('length, radius, diameter, arc length, angle and distance', () => {
    const s = emptySketch()
    const l = addEntity(s, { kind: 'line', a: [0, 0], b: [30, 40] })
    const m = addEntity(s, { kind: 'line', a: [0, 0], b: [10, 0] })
    const a = addEntity(s, { kind: 'arc', c: [0, 0], r: 4, start: 0, sweep: Math.PI })
    const read = (c: ConstraintInput) => readDimension(s, { id: 99, ...c } as Extract<Constraint, { value: number }>)
    expect(read({ kind: 'length', entity: l, value: 0 })).toBeCloseTo(50, 12)
    expect(read({ kind: 'radius', entity: a, value: 0 })).toBe(4)
    expect(read({ kind: 'diameter', entity: a, value: 0 })).toBe(8)
    expect(read({ kind: 'arcLength', entity: a, value: 0 })).toBeCloseTo(4 * Math.PI, 12)
    expect(read({ kind: 'angle', a: m, b: l, value: 0 })).toBeCloseTo((Math.atan2(4, 3) * 180) / Math.PI, 9)
    expect(read({ kind: 'distance', p: { entity: l, at: 'b' }, q: { entity: m, at: 'b' }, value: 0 })).toBeCloseTo(Math.hypot(20, 40), 12)
    expect(read({ kind: 'length', entity: 12345, value: 0 })).toBeNull()
  })
})

describe('in the store', () => {
  const frame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] } as never
  const open = () => {
    useReverse.getState().reset()
    useReverse.getState().startSketch({ kind: 'coordinate', plane: 'xy' } as never, frame, [
      { kind: 'arc', c: [0, 0], r: 10, start: 0, sweep: Math.PI / 2 },
      { kind: 'circle', c: [40, 0], r: 5 },
    ])
  }
  const draft = () => useReverse.getState().sketchDraft!
  const pieces = () => draft().sketch.entities
  const dimensionOn = (kind: 'radius' | 'length', entity: number) => {
    useReverse.setState((s) => ({ sketchDraft: { ...s.sketchDraft!, selection: [entity] } }))
    useReverse.getState().addDimension(kind)
    return draft().sketch.constraints.filter((c) => 'value' in c).at(-1)!.id
  }

  it('an arc\'s radius given as its length instead, and back: the arc stays as it is', () => {
    open()
    const arc = pieces().find((e) => e.kind === 'arc')!
    const id = dimensionOn('radius', arc.id)
    useReverse.getState().setDimensionForm(id, 'arcLength')
    let c = dim(draft().sketch, id)
    expect(c.kind).toBe('arcLength')
    expect(c.value).toBeCloseTo(5 * Math.PI, 9)
    const after = pieces().find((e) => e.id === arc.id) as SketchArc
    expect(after.r).toBeCloseTo(10, 9)
    expect(after.sweep).toBeCloseTo(Math.PI / 2, 9)
    useReverse.getState().setDimensionValue(id, 20)
    const opened = pieces().find((e) => e.id === arc.id) as SketchArc
    expect(Math.abs(opened.r * opened.sweep)).toBeCloseTo(20, 5)
    useReverse.getState().setDimensionForm(id, 'radius')
    c = dim(draft().sketch, id)
    expect(c.kind).toBe('radius')
    expect(c.value).toBeCloseTo(opened.r, 9)
  })

  it('a circle is not given by an arc length', () => {
    open()
    const circle = pieces().find((e) => e.kind === 'circle')!
    const id = dimensionOn('radius', circle.id)
    useReverse.getState().setDimensionForm(id, 'arcLength')
    expect(dim(draft().sketch, id).kind).toBe('radius')
    expect(draft().error).toMatch(/Only an arc/)
  })

  it('made driven: in brackets, read only, its expression let go; undone, driving again', () => {
    open()
    const circle = pieces().find((e) => e.kind === 'circle')!
    const id = dimensionOn('radius', circle.id)
    useReverse.getState().setDimensionValue(id, 6, '3 * 2')
    expect(dim(draft().sketch, id).expr).toBe('3 * 2')
    useReverse.getState().setDimensionDriven(id, true)
    const c = dim(draft().sketch, id)
    expect(c.driven).toBe(true)
    expect(c.expr).toBeUndefined()
    expect(c.value).toBeCloseTo(6, 9)
    useReverse.getState().setDimensionValue(id, 9)
    expect(draft().error).toMatch(/driven dimension only reads/)
    expect((pieces().find((e) => e.id === circle.id) as { r: number }).r).toBeCloseTo(6, 9)
    useReverse.getState().undoSketch()
    expect(dim(draft().sketch, id).driven).toBeUndefined()
  })

  it('made driving again, it holds the pieces at what they read', () => {
    open()
    const circle = pieces().find((e) => e.kind === 'circle')!
    const id = dimensionOn('radius', circle.id)
    useReverse.getState().setDimensionDriven(id, true)
    useReverse.getState().setDimensionDriven(id, false)
    const c = dim(draft().sketch, id)
    expect(c.driven).toBeUndefined()
    expect(c.value).toBeCloseTo(5, 9)
    expect(draft().report?.ok).toBe(true)
  })
})
