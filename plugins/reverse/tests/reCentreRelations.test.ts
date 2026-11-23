// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.22: two circles held about one centre, the three ways CAD offers it
// (the user's report: "two circles cannot easily be constrained to the same
// centrepoint"). Before this release Concentric and Coincident moved both
// circles halfway, two circles selected with Coincident put one centre on
// the other's rim and grew its radius, a centre clicked onto the origin
// was held on one axis only, and two fixed circles made Concentric were
// left unmet without a word. Spec cases C01–C15 of the brief.

import { beforeEach, describe, expect, it } from 'vitest'
import { useReverse } from '../state/reStore'
import { cloneSketch, type EntityInput, type SketchArc, type SketchCircle, type SketchEntity, type SketchLine } from '../core/sketch'
import { solveSketch } from '../core/solver'
import { sharesCentre } from '../core/centreRelations'
import { useSnapFilter } from '../../../src/state/snapFilterStore'
import { XY } from './reKit'

const s = () => useReverse.getState()
const d = () => s().sketchDraft!
const ent = (id: number) => d().sketch.entities.find((e) => e.id === id)! as SketchEntity
const centre = (id: number) => (ent(id) as SketchCircle | SketchArc).c
const radius = (id: number) => (ent(id) as SketchCircle | SketchArc).r
const kinds = () => d().sketch.constraints.map((c) => c.kind)
const near = (p: readonly number[], q: readonly number[], tol = 1e-6) => expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeLessThan(tol)
const select = (...ids: number[]) => useReverse.setState({ sketchDraft: { ...d(), selection: ids } })

/** Circle A (1): centre (20, 30), r 10. Circle B (2): centre (80, 70), r 5 — the brief's 3.7 example. */
function twoCircles(extra: EntityInput[] = []) {
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [
    { kind: 'circle', c: [20, 30], r: 10 },
    { kind: 'circle', c: [80, 70], r: 5 },
    ...extra,
  ])
}

beforeEach(() => {
  s().sketchDragEnd()
  useSnapFilter.getState().reset('pick')
  useSnapFilter.getState().reset('draw')
  useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
})

describe('Concentric and Coincident centres', () => {
  it('C01: two circles selected, Concentric — B comes to A, A and both radii stay', () => {
    twoCircles()
    select(1, 2)
    s().addRelation('concentric')
    expect(d().error).toBeNull()
    expect(kinds()).toEqual(['concentric'])
    near(centre(1), [20, 30], 1e-7)
    near(centre(2), [20, 30], 1e-7)
    expect(radius(1)).toBeCloseTo(10, 9)
    expect(radius(2)).toBeCloseTo(5, 9)
  })

  it('C01 tool first: Concentric in hand, the circles clicked on their rims or at their centres', () => {
    twoCircles()
    s().armRelation('concentric')
    s().sketchClick([30, 30], 1, false, {})
    // B taken by a click on its centre, where there is no rim.
    s().sketchClick([80, 70], 1, false, {})
    expect(kinds()).toEqual(['concentric'])
    near(centre(2), [20, 30], 1e-7)
    near(centre(1), [20, 30], 1e-7)
    // Still in hand for the next pair.
    expect(d().armedRelation).toBe('concentric')
  })

  it('C02: Coincident in hand, the two centres clicked — the first stays', () => {
    twoCircles()
    s().armRelation('coincident')
    s().sketchClick([80, 70], 1, false, {})
    // The first centre is lit while the tool waits (relPicks holds it).
    expect(d().relPicks?.[0]).toEqual({ kind: 'point', anchor: { entity: 2, at: 'center' } })
    s().sketchClick([20, 30], 1, false, {})
    expect(kinds()).toEqual(['coincident'])
    near(centre(2), [80, 70], 1e-7)
    near(centre(1), [80, 70], 1e-7)
    expect(radius(1)).toBeCloseTo(10, 9)
    expect(radius(2)).toBeCloseTo(5, 9)
  })

  it('two circles selected with Coincident: their centres meet; no rim, no radius change', () => {
    twoCircles()
    select(1, 2)
    s().addRelation('coincident')
    expect(d().error).toBeNull()
    const c = d().sketch.constraints[0]
    expect(c).toMatchObject({ kind: 'coincident', p: { entity: 1, at: 'center' }, q: { entity: 2, at: 'center' } })
    near(centre(2), [20, 30], 1e-7)
    expect(radius(2)).toBeCloseTo(5, 9)
  })

  it('C03 / C04: B dragged by its centre onto A centre — held when dropped on it, a place only with snapping off', () => {
    twoCircles()
    expect(s().sketchDragStart([80, 70], 1)).toBe(true)
    s().sketchDrag([50, 50], 1, {})
    s().sketchDrag([20.3, 30.2], 1, {})
    s().sketchDragEnd()
    expect(kinds()).toEqual(['coincident'])
    near(centre(2), [20, 30], 1e-9)
    expect(radius(2)).toBe(5)
    // With Ctrl (snapping off) it lands where let go, and nothing is held.
    twoCircles()
    expect(s().sketchDragStart([80, 70], 1)).toBe(true)
    s().sketchDrag([20, 30], 1, { off: true })
    s().sketchDragEnd()
    expect(kinds()).toEqual([])
    near(centre(2), [20, 30], 1e-9)
  })

  it('C05: a centre made coincident with the origin is held at both coordinates', () => {
    twoCircles()
    s().armRelation('coincident')
    s().sketchClick([80, 70], 1, false, {})
    s().sketchClick([0.2, -0.1], 1, false, {})
    expect(d().error).toBeNull()
    expect(kinds()).toEqual(['pointOn', 'pointOn'])
    near(centre(2), [0, 0], 1e-6)
    // Moving it away by hand: the solve brings it back.
    d().sketch.entities = d().sketch.entities.map((e) => (e.id === 2 && e.kind === 'circle' ? { ...e, c: [5, 5] } : e))
    s().solveNow()
    near(centre(2), [0, 0], 1e-6)
  })

  it('C06 / C07: a centre on a point piece, and on a line midpoint that it then follows', () => {
    twoCircles([{ kind: 'point', p: [40, 10] }, { kind: 'line', a: [0, -20], b: [30, -20] }])
    // The point first, so it is the reference and the circle comes to it.
    s().armRelation('coincident')
    s().sketchClick([40, 10], 1, false, {})
    s().sketchClick([80, 70], 1, false, {})
    near(centre(2), [40, 10], 1e-6)
    near((ent(3) as { p: number[] }).p, [40, 10], 1e-12)
    s().sketchClick([15, -20], 1, false, {}) // the line's middle square
    s().sketchClick([20, 30], 1, false, {})
    expect(d().error).toBeNull()
    near(centre(1), [15, -20], 1e-6)
    // The line lengthened: the centre follows its middle.
    const line = d().sketch.entities.find((e) => e.kind === 'line') as SketchLine
    d().sketch.entities = d().sketch.entities.map((e) => (e.id === line.id && e.kind === 'line' ? { ...e, b: [50, -20] } : e))
    s().solveNow()
    const l = d().sketch.entities.find((e) => e.kind === 'line') as SketchLine
    near(centre(1), [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2], 1e-6)
  })

  it('C08 / C09: a circle and an arc, and two arcs, made concentric keep their radii and sweeps', () => {
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [
      { kind: 'circle', c: [0, 0], r: 10 },
      { kind: 'arc', c: [30, 5], r: 4, start: 0, sweep: Math.PI / 2 },
      { kind: 'arc', c: [-30, 5], r: 7, start: 1, sweep: 1.5 },
    ])
    select(1, 2)
    s().addRelation('concentric')
    near(centre(2), [0, 0], 1e-7)
    select(2, 3)
    s().addRelation('concentric')
    expect(d().error).toBeNull()
    near(centre(3), [0, 0], 1e-6)
    const a = ent(2) as SketchArc
    const b = ent(3) as SketchArc
    expect(a.r).toBeCloseTo(4, 9)
    expect(a.sweep).toBeCloseTo(Math.PI / 2, 9)
    expect(b.r).toBeCloseTo(7, 9)
    expect(b.sweep).toBeCloseTo(1.5, 9)
  })

  it('C10 / C11: a diameter changed after, and the common centre moved — both follow', () => {
    twoCircles()
    select(1, 2)
    s().addRelation('concentric')
    select(2)
    s().addDimension('diameter', 14)
    expect(radius(2)).toBeCloseTo(7, 7)
    near(centre(2), centre(1), 1e-7)
    expect(s().sketchDragStart([20, 30], 1)).toBe(true)
    s().sketchDrag([-10, 5], 1, { off: true })
    s().sketchDragEnd()
    near(centre(1), [-10, 5], 1e-5)
    near(centre(2), [-10, 5], 1e-5)
    expect(radius(1)).toBeCloseTo(10, 6)
    expect(radius(2)).toBeCloseTo(7, 6)
  })

  it('C12: two fixed circles are refused Concentric, and nothing changes', () => {
    twoCircles()
    d().sketch.entities.forEach((e) => (e.fixed = true))
    const before = JSON.stringify(d().sketch)
    const history = d().history.length
    select(1, 2)
    s().addRelation('concentric')
    expect(d().error).toMatch(/cannot be met.*both fixed/)
    expect(JSON.stringify(d().sketch)).toBe(before)
    expect(d().history.length).toBe(history)
  })

  it('the first pick is the reference unless the second is held: a fixed B brings A to it', () => {
    twoCircles()
    d().sketch.entities = d().sketch.entities.map((e) => (e.id === 2 ? { ...e, fixed: true } : e))
    select(1, 2)
    s().addRelation('concentric')
    expect(d().error).toBeNull()
    near(centre(1), [80, 70], 1e-7)
    expect(centre(2)).toEqual([80, 70])
  })

  it('C13: Concentric removed — the centres move apart again', () => {
    twoCircles()
    select(1, 2)
    s().addRelation('concentric')
    s().selectConstraint(d().sketch.constraints[0].id)
    s().removeSelectedConstraint()
    expect(kinds()).toEqual([])
    // Whichever circle the shared centre's grip takes goes; the other stays.
    expect(s().sketchDragStart([20, 30], 1)).toBe(true)
    s().sketchDrag([0, 0], 1, { off: true })
    s().sketchDragEnd()
    const moved = [1, 2].filter((id) => Math.hypot(centre(id)[0], centre(id)[1]) < 1e-5)
    expect(moved).toHaveLength(1)
    near(centre(moved[0] === 1 ? 2 : 1), [20, 30], 1e-5)
  })

  it('C14: Equal and Concentric on different pairs hold both, independently', () => {
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [
      { kind: 'circle', c: [0, 0], r: 10 },
      { kind: 'circle', c: [40, 0], r: 6 },
      { kind: 'circle', c: [40, 30], r: 3 },
    ])
    select(1, 2)
    s().addRelation('equal')
    select(2, 3)
    s().addRelation('concentric')
    expect(d().error).toBeNull()
    expect(radius(1)).toBeCloseTo(radius(2), 7)
    near(centre(3), centre(2), 1e-6)
    expect(radius(3)).toBeCloseTo(3, 6)
  })

  it('no redundant relation: Coincident on centres already Concentric, or Concentric twice, adds nothing', () => {
    twoCircles()
    select(1, 2)
    s().addRelation('concentric')
    const n = d().sketch.constraints.length
    select(1, 2)
    s().addRelation('coincident')
    expect(d().error).toMatch(/already share a centre/)
    s().armRelation('coincident')
    s().sketchClick([20, 30], 1, false, {})
    s().sketchClick([20, 30.1], 1, false, {})
    expect(d().sketch.constraints.length).toBe(n)
    select(2, 1)
    s().addRelation('concentric')
    expect(d().error).toMatch(/already share a centre/)
    expect(sharesCentre(d().sketch, 1, 2)).toBe(true)
  })

  it('C15 / G25: undo and redo restore the relation with the geometry; kept through a save round trip', () => {
    twoCircles()
    select(1, 2)
    s().addRelation('concentric')
    const after = JSON.stringify(d().sketch)
    s().undoSketch()
    expect(kinds()).toEqual([])
    near(centre(2), [80, 70], 1e-12)
    s().redoSketch()
    expect(JSON.stringify(d().sketch)).toBe(after)
    const reopened = cloneSketch(JSON.parse(JSON.stringify(d().sketch)))
    expect(solveSketch(reopened).ok).toBe(true)
    expect(reopened.constraints.map((c) => c.kind)).toEqual(['concentric'])
    near((reopened.entities[1] as SketchCircle).c, [20, 30], 1e-6)
  })
})
