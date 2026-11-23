// SPDX-License-Identifier: AGPL-3.0-only
// A piece that carries a dimension keeps it while it is dragged: a line's
// length, an arc's radius, a circle's diameter hold at every step of the
// drag, not only once the hand lets go — and the dragged end stays under
// the hand as far as the dimension lets it.
import { beforeEach, expect, it } from 'vitest'
import { useReverse } from '../state/reStore'
import { addConstraint, type SketchArc, type SketchCircle, type SketchLine } from '../core/sketch'
import { XY } from './reKit'

const s = () => useReverse.getState(), d = () => s().sketchDraft!
beforeEach(() => {
  s().sketchDragEnd()
  useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
})
const lengthOf = (l: SketchLine) => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])

it('a line with a length keeps it at every step while an end is dragged', () => {
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [{ kind: 'line', a: [0, 0], b: [10, 0] }])
  addConstraint(d().sketch, { kind: 'length', entity: 1, value: 10 })
  s().solveNow()
  expect(s().sketchDragStart([10, 0], 0.3)).toBe(true)
  const worst = { length: 0, lag: 0 }
  // The hand sweeps the end round and outward, a few pixels a step.
  for (let i = 1; i <= 40; i++) {
    const hand: [number, number] = [10 + i * 0.25, i * 0.3]
    s().sketchDrag(hand, 0.3, { off: true })
    const l = d().sketch.entities[0] as SketchLine
    worst.length = Math.max(worst.length, Math.abs(lengthOf(l) - 10))
    worst.lag = Math.max(worst.lag, Math.hypot(l.b[0] - hand[0], l.b[1] - hand[1]))
  }
  s().sketchDragEnd()
  const l = d().sketch.entities[0] as SketchLine
  expect(Math.abs(lengthOf(l) - 10)).toBeLessThan(1e-6)
  // On screen a length that breathes by a hundredth of a millimetre is a
  // number flickering; the end stays with the hand.
  expect(worst.length).toBeLessThan(1e-3)
  expect(worst.lag).toBeLessThan(0.05)
})

it('with its other end held, the dragged end swings round on the length', () => {
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [{ kind: 'line', a: [0, 0], b: [10, 0] }, { kind: 'point', p: [0, 0], fixed: true }])
  addConstraint(d().sketch, { kind: 'length', entity: 1, value: 10 })
  addConstraint(d().sketch, { kind: 'coincident', p: { entity: 1, at: 'a' }, q: { entity: 2, at: 'center' } })
  d().sketch.entities = d().sketch.entities.map((e) => (e.kind === 'point' ? { ...e, fixed: true } : e))
  s().solveNow()
  expect(s().sketchDragStart([10, 0], 0.3)).toBe(true)
  let worst = 0
  for (let i = 1; i <= 30; i++) {
    const a = (i / 30) * (Math.PI / 2)
    // The hand strays outside the circle the end can reach.
    s().sketchDrag([13 * Math.cos(a), 13 * Math.sin(a)], 0.3, { off: true })
    const l = d().sketch.entities[0] as SketchLine
    worst = Math.max(worst, Math.abs(lengthOf(l) - 10), Math.hypot(l.a[0], l.a[1]))
  }
  s().sketchDragEnd()
  const l = d().sketch.entities[0] as SketchLine
  expect(worst).toBeLessThan(1e-3)
  expect(Math.abs(lengthOf(l) - 10)).toBeLessThan(1e-6)
  // It ends pointing at the hand: straight up.
  expect(Math.abs(l.b[0])).toBeLessThan(0.02)
  expect(Math.abs(l.b[1] - 10)).toBeLessThan(0.02)
})

it('an arc with a radius keeps it while an end is dragged, and a circle its diameter while its rim is', () => {
  const arc: Omit<SketchArc, 'id'> = { kind: 'arc', c: [0, 0], r: 5, start: 0, sweep: Math.PI / 2 }
  const circle: Omit<SketchCircle, 'id'> = { kind: 'circle', c: [30, 0], r: 4 }
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [arc, circle])
  addConstraint(d().sketch, { kind: 'radius', entity: 1, value: 5 })
  addConstraint(d().sketch, { kind: 'diameter', entity: 2, value: 8 })
  s().solveNow()
  expect(s().sketchDragStart([5, 0], 0.3)).toBe(true)
  let worst = 0
  for (let i = 1; i <= 30; i++) {
    s().sketchDrag([5 + i * 0.2, -i * 0.15], 0.3, { off: true })
    worst = Math.max(worst, Math.abs((d().sketch.entities[0] as SketchArc).r - 5))
  }
  s().sketchDragEnd()
  expect(worst).toBeLessThan(1e-3)
  expect(Math.abs((d().sketch.entities[0] as SketchArc).r - 5)).toBeLessThan(1e-6)
  if (s().sketchDragStart([34, 0], 0.3)) {
    worst = 0
    for (let i = 1; i <= 20; i++) {
      s().sketchDrag([34 + i * 0.3, i * 0.2], 0.3, { off: true })
      worst = Math.max(worst, Math.abs((d().sketch.entities[1] as SketchCircle).r - 4))
    }
    s().sketchDragEnd()
    expect(worst).toBeLessThan(1e-3)
  }
  expect(Math.abs((d().sketch.entities[1] as SketchCircle).r - 4)).toBeLessThan(1e-6)
})
