// SPDX-License-Identifier: AGPL-3.0-only
// A distance to an arc or a circle taken on its rim: the gap between two
// rounded edges, clicked with the Dimension tool on the rims, solved by
// moving the pieces and not by resizing them, drawn rim to rim, and switched
// between Centre, Nearest edge and Farthest edge.

import { useSnapFilter } from '../../../src/state/snapFilterStore'
import { describe, expect, it } from 'vitest'
import { dimensionFor } from '../core/draw'
import { dimShape, type Dimension } from '../core/dimLayout'
import { addEntity, emptySketch, entityOf, type SketchArc, type SketchCircle } from '../core/sketch'
import { measureDimension } from '../core/solver'
import { useReverse } from '../state/reStore'

const piece = (id: number) => ({ kind: 'piece' as const, id })
const half = Math.PI

/** Two arcs bulging towards each other: centres 40 apart on x, radii 5 and 8. */
function twoArcs() {
  const sketch = emptySketch()
  const a = addEntity(sketch, { kind: 'arc', c: [0, 0], r: 5, start: -half / 2, sweep: half })
  const b = addEntity(sketch, { kind: 'arc', c: [40, 0], r: 8, start: half / 2, sweep: half })
  return { sketch, a, b }
}

describe('dimensionFor on round pieces', () => {
  it('gives two arcs clicked on their rims the gap between the edges', () => {
    const { sketch, a, b } = twoArcs()
    expect(dimensionFor(sketch, piece(a), piece(b))).toMatchObject({ kind: 'distance', p: { entity: a, at: 'center' }, q: { entity: b, at: 'center' }, edge: 'near', value: 27 })
  })

  it('gives an arc and a circle the gap too', () => {
    const sketch = emptySketch()
    const a = addEntity(sketch, { kind: 'arc', c: [0, 0], r: 5, start: 0, sweep: half })
    const c = addEntity(sketch, { kind: 'circle', c: [0, 30], r: 4 })
    expect(dimensionFor(sketch, piece(c), piece(a))).toMatchObject({ edge: 'near', value: 21 })
  })

  it('pitches two full circles by their centres, as holes are', () => {
    const sketch = emptySketch()
    const p = addEntity(sketch, { kind: 'circle', c: [0, 0], r: 3 })
    const q = addEntity(sketch, { kind: 'circle', c: [25, 0], r: 3 })
    const d = dimensionFor(sketch, piece(p), piece(q))
    expect(d).toMatchObject({ kind: 'distance', value: 25 })
    expect(d && 'edge' in d ? d.edge : undefined).toBeUndefined()
  })

  it('falls back to the centres where the arcs overlap and there is no gap', () => {
    const sketch = emptySketch()
    const a = addEntity(sketch, { kind: 'arc', c: [0, 0], r: 10, start: 0, sweep: half })
    const b = addEntity(sketch, { kind: 'arc', c: [12, 0], r: 10, start: 0, sweep: half })
    const d = dimensionFor(sketch, piece(a), piece(b))
    expect(d).toMatchObject({ kind: 'distance', value: 12 })
    expect(d && 'edge' in d ? d.edge : undefined).toBeUndefined()
  })

  it('measures an arc to a line from the rim when asked, and from the centre by default', () => {
    const sketch = emptySketch()
    const a = addEntity(sketch, { kind: 'arc', c: [0, 10], r: 4, start: 0, sweep: half })
    const l = addEntity(sketch, { kind: 'line', a: [-20, 0], b: [20, 0] })
    expect(dimensionFor(sketch, piece(a), piece(l))).toMatchObject({ value: 10 })
    expect(measureDimension(sketch, 'distance', { entity: a, at: 'center' }, { line: l }, [], 'near')).toBeCloseTo(6)
    expect(measureDimension(sketch, 'distance', { entity: a, at: 'center' }, { line: l }, [], 'far')).toBeCloseTo(14)
  })
})

describe('the gap drawn', () => {
  it('runs the dimension line rim to rim, not centre to centre', () => {
    const { sketch, a, b } = twoArcs()
    const near: Dimension = { id: 99, kind: 'distance', p: { entity: a, at: 'center' }, q: { entity: b, at: 'center' }, value: 27, edge: 'near' }
    const shape = dimShape(near, sketch, [], 2)
    expect(shape?.kind).toBe('linear')
    if (shape?.kind !== 'linear') return
    expect(shape.p[0]).toBeCloseTo(5)
    expect(shape.q[0]).toBeCloseTo(32)
    const far = dimShape({ ...near, edge: 'far', value: 53 }, sketch, [], 2)
    if (far?.kind !== 'linear') throw new Error('no shape')
    expect(far.p[0]).toBeCloseTo(-5)
    expect(far.q[0]).toBeCloseTo(48)
  })
})

describe('the Dimension tool on two arcs, in the store', () => {
  const frame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] } as never
  const open = () => {
    useReverse.getState().reset()
    useReverse.getState().startSketch({ kind: 'coordinate', plane: 'xy' } as never, frame, [
      { kind: 'arc', c: [0, 0], r: 5, start: -half / 2, sweep: half },
      { kind: 'arc', c: [40, 0], r: 8, start: half / 2, sweep: half },
    ])
  }
  const arcs = () => {
    const s = useReverse.getState().sketchDraft!.sketch
    return s.entities.filter((e): e is SketchArc => e.kind === 'arc')
  }
  const gapOf = () => {
    const [p, q] = arcs()
    return Math.hypot(q.c[0] - p.c[0], q.c[1] - p.c[1]) - p.r - q.r
  }

  it('clicks the two rims, puts the gap down, types a new gap and keeps both radii', () => {
    open()
    const re = useReverse.getState()
    // The rims are clicked where they face each other, which is on their
    // quadrant squares: with Quad on that is the two points (reQuadrantPicks),
    // so it is switched off here for the rims themselves.
    useSnapFilter.getState().set('draw', 'quadrant', false)
    re.setSketchTool('dimension')
    re.sketchClick([5, 0], 0.5, false)
    re.sketchClick([32, 0], 0.5, false)
    re.sketchClick([18, 10], 0.5, false)
    const d = useReverse.getState().sketchDraft!
    const dims = d.sketch.constraints.filter((c) => 'value' in c)
    expect(dims).toHaveLength(1)
    const gap = dims[0] as Dimension
    expect(gap).toMatchObject({ kind: 'distance', edge: 'near' })
    expect(gap.value).toBeCloseTo(27)
    re.setDimensionValue(gap.id, 12)
    expect(useReverse.getState().sketchDraft!.error ?? null).toBeNull()
    expect(gapOf()).toBeCloseTo(12, 6)
    const [p, q] = arcs()
    expect(p.r).toBeCloseTo(5, 3.5)
    expect(q.r).toBeCloseTo(8, 3.5)
  })

  it('switches the same dimension to the centres and to the far edges, the pieces staying put', () => {
    open()
    const re = useReverse.getState()
    // The rims are clicked where they face each other, which is on their
    // quadrant squares: with Quad on that is the two points (reQuadrantPicks),
    // so it is switched off here for the rims themselves.
    useSnapFilter.getState().set('draw', 'quadrant', false)
    re.setSketchTool('dimension')
    re.sketchClick([5, 0], 0.5, false)
    re.sketchClick([32, 0], 0.5, false)
    re.sketchClick([18, 10], 0.5, false)
    const id = useReverse.getState().sketchDraft!.sketch.constraints.find((c) => 'value' in c)!.id
    const at = () => useReverse.getState().sketchDraft!.sketch.constraints.find((c) => c.id === id) as Dimension
    re.setDimensionForm(id, 'centre')
    expect(at()).toMatchObject({ value: 40 })
    expect('edge' in at() ? (at() as { edge?: string }).edge : undefined).toBeUndefined()
    re.setDimensionForm(id, 'far')
    expect(at()).toMatchObject({ value: 53, edge: 'far' })
    expect(gapOf()).toBeCloseTo(27, 6)
    re.undoSketch()
    expect(at()).toMatchObject({ value: 40 })
  })

  it('refuses a gap where the edges overlap, and says what to use instead', () => {
    useReverse.getState().reset()
    useReverse.getState().startSketch({ kind: 'coordinate', plane: 'xy' } as never, frame, [
      { kind: 'circle', c: [0, 0], r: 10 },
      { kind: 'circle', c: [12, 0], r: 10 },
    ])
    const re = useReverse.getState()
    const [p, q] = useReverse.getState().sketchDraft!.sketch.entities as SketchCircle[]
    re.addDimension('distance')
    // Nothing is selected: nothing is made.
    expect(useReverse.getState().sketchDraft!.sketch.constraints.filter((c) => 'value' in c)).toHaveLength(0)
    useReverse.setState((s) => ({ sketchDraft: { ...s.sketchDraft!, selection: [p.id, q.id] } }))
    re.addDimension('distance')
    const id = useReverse.getState().sketchDraft!.sketch.constraints.find((c) => 'value' in c)!.id
    re.setDimensionForm(id, 'near')
    expect(useReverse.getState().sketchDraft!.error).toMatch(/no gap/)
    expect(entityOf(useReverse.getState().sketchDraft!.sketch, p.id)).toMatchObject({ c: [0, 0], r: 10 })
  })
})
