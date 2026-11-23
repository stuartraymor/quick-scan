// SPDX-License-Identifier: AGPL-3.0-only
// The snap bar's switches as the sketch reads them: quadrant points of
// circles and arcs as anchors a dimension and a drawn end hold to, a
// circle's centre and a line's middle as points the Dimension tool takes,
// and each kind of snap switched off.
import { beforeEach, describe, expect, it } from 'vitest'
import { useReverse } from '../state/reStore'
import { DEFAULT_SNAP_FLAGS, useSnapFilter } from '../../../src/state/snapFilterStore'
import { XY } from './reKit'
import { addConstraint, addEntity, anchorPoint, emptySketch, quadrantsOf, type Sketch, type SketchArc, type SketchCircle } from '../core/sketch'
import { dimensionFor, dimPickAt, pickAsPoint, PICK_ENDS, type PickAllow } from '../core/draw'
import { SNAP_ALL, snapSketchPoint } from '../core/snap'
import { solveSketch } from '../core/solver'

const all: PickAllow = { endpoint: true, midpoint: true, center: true, quadrant: true, curve: true }
function scene(): Sketch {
  const s = emptySketch()
  addEntity(s, { kind: 'circle', c: [10, 0], r: 3 }) // 1
  addEntity(s, { kind: 'line', a: [0, -3], b: [0, 7] }) // 2: its middle at (0, 2), clear of the sheet's zero
  addEntity(s, { kind: 'arc', c: [30, 0], r: 4, start: -Math.PI / 4, sweep: Math.PI / 2 }) // 3: through 0° only
  return s
}

describe('quadrant points', () => {
  it('a circle has four, an arc those on the arc itself', () => {
    const s = scene()
    expect(quadrantsOf(s.entities[0]).map((q) => q.at)).toEqual(['q0', 'q1', 'q2', 'q3'])
    expect(quadrantsOf(s.entities[0]).map((q) => q.point)).toEqual([[13, 0], [10, 3], [7, 0], [10, -3]])
    expect(quadrantsOf(s.entities[2]).map((q) => q.at)).toEqual(['q0'])
    expect(quadrantsOf(s.entities[1])).toEqual([])
    // An arc run clockwise through 90° and 180°.
    const cw: SketchArc = { id: 9, kind: 'arc', c: [0, 0], r: 2, start: Math.PI * 1.1, sweep: -Math.PI * 0.7 }
    expect(quadrantsOf(cw).map((q) => q.at)).toEqual(['q1', 'q2'])
  })

  it('ride on the rim: they follow the centre and the radius', () => {
    const c: SketchCircle = { id: 1, kind: 'circle', c: [2, 3], r: 5 }
    expect(anchorPoint(c, 'q2')).toEqual([-3, 3])
    expect(anchorPoint({ ...c, c: [0, 0], r: 1 }, 'q3')).toEqual([0, -1])
    expect(anchorPoint(c, 'center')).toEqual([2, 3])
  })

  it('a distance from a quadrant to a line drives the circle by its edge', () => {
    const s = scene()
    const first = dimPickAt(s, [7.05, 0.05], 0.4, [], all)
    // The square clicked: the circle by itself, its 180° point in a pair.
    expect(first).toEqual({ kind: 'piece', id: 1, via: { entity: 1, at: 'q2' } })
    expect(dimensionFor(s, first!, null)).toMatchObject({ kind: 'diameter', entity: 1, value: 6 })
    const made = dimensionFor(s, pickAsPoint(first!), { kind: 'piece', id: 2 })
    expect(made).toMatchObject({ kind: 'distance', p: { entity: 1, at: 'q2' }, q: { line: 2 } })
    expect((made as { value: number }).value).toBeCloseTo(7, 9)
    addConstraint(s, { kind: 'vertical', entity: 2 })
    addConstraint(s, { ...(made as object), value: 4 } as Parameters<typeof addConstraint>[1])
    expect(solveSketch(s).ok).toBe(true)
    const [circle, line] = s.entities as [SketchCircle, { a: [number, number] }]
    expect(circle.c[0] - circle.r - line.a[0]).toBeCloseTo(4, 6)
  })

  it('two quadrants of one circle measure across it', () => {
    const s = scene()
    const made = dimensionFor(s, { kind: 'point', anchor: { entity: 1, at: 'q0' } }, { kind: 'point', anchor: { entity: 1, at: 'q2' } })
    expect(made).toMatchObject({ kind: 'distance', value: 6 })
  })
})

describe('what the Dimension tool takes', () => {
  it('by default ends and whole pieces, as before the bar', () => {
    const s = scene()
    expect(dimPickAt(s, [7, 0], 0.4)).toEqual({ kind: 'piece', id: 1 })
    expect(dimPickAt(s, [0, 0], 0.4)).toEqual({ kind: 'piece', id: 2 })
    expect(dimPickAt(s, [10, 0], 0.4)).toBeNull()
    expect(dimPickAt(s, [0, 7], 0.4)).toEqual({ kind: 'point', anchor: { entity: 2, at: 'b' } })
    expect(PICK_ENDS.quadrant || PICK_ENDS.midpoint || PICK_ENDS.center).toBe(false)
  })

  it('a centre, a midpoint and a quadrant when their switches are on', () => {
    const s = scene()
    expect(dimPickAt(s, [10.1, 0], 0.4, [], { ...PICK_ENDS, center: true })).toEqual({ kind: 'point', anchor: { entity: 1, at: 'center' } })
    expect(dimPickAt(s, [30, 0.1], 0.4, [], { ...PICK_ENDS, center: true })).toEqual({ kind: 'point', anchor: { entity: 3, at: 'center' } })
    expect(dimPickAt(s, [0.05, 2], 0.4, [], { ...PICK_ENDS, midpoint: true })).toEqual({ kind: 'piece', id: 2, via: { entity: 2, at: 'center' } })
    // With whole pieces switched off the square is the point and nothing else.
    expect(dimPickAt(s, [0.05, 2], 0.4, [], { ...PICK_ENDS, midpoint: true, curve: false })).toEqual({ kind: 'point', anchor: { entity: 2, at: 'center' } })
    // Along the line away from its middle it is still the line.
    expect(dimPickAt(s, [0, 5], 0.4, [], all)).toEqual({ kind: 'piece', id: 2 })
    // Away from a quadrant the rim is still the circle.
    expect(dimPickAt(s, [10 + 3 * Math.cos(1), 3 * Math.sin(1)], 0.4, [], all)).toEqual({ kind: 'piece', id: 1 })
  })

  it('with Curve off only points are taken; with End off no ends', () => {
    const s = scene()
    expect(dimPickAt(s, [0, 5], 0.4, [], { ...all, curve: false })).toBeNull()
    expect(dimPickAt(s, [0, 7], 0.4, [], { ...all, endpoint: false })).toEqual({ kind: 'piece', id: 2 })
  })
})

describe('where a drawn end snaps', () => {
  it('to a quadrant only when it is switched on, held by the rim’s own point', () => {
    const s = scene()
    const off = snapSketchPoint(s, [7.1, 0.1], 0.5)
    expect(off.kind).toBe('entity')
    const on = snapSketchPoint(s, [7.1, 0.1], 0.5, { allow: { ...SNAP_ALL, quadrant: true } })
    expect(on).toMatchObject({ kind: 'quadrant', point: [7, 0], anchor: { entity: 1, at: 'q2' } })
  })

  it('each switch takes its kind away and leaves the rest', () => {
    const s = scene()
    expect(snapSketchPoint(s, [0.1, 6.9], 0.5).kind).toBe('anchor')
    expect(snapSketchPoint(s, [0.1, 6.9], 0.5, { allow: { ...SNAP_ALL, endpoint: false } }).kind).toBe('entity')
    expect(snapSketchPoint(s, [0.1, 2.1], 0.5).kind).toBe('midpoint')
    expect(snapSketchPoint(s, [0.1, 2.1], 0.5, { allow: { ...SNAP_ALL, midpoint: false } }).kind).toBe('entity')
    expect(snapSketchPoint(s, [10.1, 0.1], 0.5).anchor).toEqual({ entity: 1, at: 'center' })
    expect(snapSketchPoint(s, [10.1, 0.1], 0.5, { allow: { ...SNAP_ALL, center: false } }).kind).toBeNull()
    expect(snapSketchPoint(s, [0.1, 5], 0.5, { allow: { ...SNAP_ALL, curve: false } }).kind).toBeNull()
    const chains = [[[20, 20], [21, 20]] as [number, number][]]
    expect(snapSketchPoint(s, [20.1, 20], 0.5, { chains }).kind).toBe('edge')
    expect(snapSketchPoint(s, [20.1, 20], 0.5, { chains, allow: { ...SNAP_ALL, scan: false } }).kind).toBeNull()
  })

  it('an arc’s centre is a place to land', () => {
    const s = scene()
    expect(snapSketchPoint(s, [30.1, 0.1], 0.5)).toMatchObject({ kind: 'anchor', point: [30, 0], anchor: { entity: 3, at: 'center' } })
  })
})

describe('All: the smart snap', () => {
  const smart = { ...SNAP_ALL, quadrant: true, nearest: true }
  it('takes whichever point is closest: a quadrant over the rim, a middle at an end’s reach', () => {
    const s = scene()
    expect(snapSketchPoint(s, [7.3, 0.2], 0.5, { allow: smart })).toMatchObject({ kind: 'quadrant', point: [7, 0] })
    // By rank a line's middle reaches half as far: 0.4 away it is the body.
    expect(snapSketchPoint(s, [0.4, 2], 0.5).kind).toBe('entity')
    expect(snapSketchPoint(s, [0.4, 2], 0.5, { allow: smart })).toMatchObject({ kind: 'midpoint', point: [0, 2] })
  })

  it('between two points in reach the nearer wins, whatever their kinds', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'circle', c: [0, 0], r: 2 }) // its 0° point at (2, 0)
    addEntity(s, { kind: 'line', a: [2.3, 0], b: [8, 0] }) // an end 0.3 from it
    expect(snapSketchPoint(s, [2.1, 0], 0.5, { allow: smart })).toMatchObject({ kind: 'quadrant', anchor: { entity: 1, at: 'q0' } })
    expect(snapSketchPoint(s, [2.22, 0], 0.5, { allow: smart })).toMatchObject({ kind: 'anchor', anchor: { entity: 2, at: 'a' } })
    // By rank the end is taken first even when the quadrant is nearer.
    expect(snapSketchPoint(s, [2.1, 0], 0.5, { allow: { ...SNAP_ALL, quadrant: true } })).toMatchObject({ kind: 'anchor', anchor: { entity: 2, at: 'a' } })
  })

  it('falls back to the curve, the scan and nothing, in that order', () => {
    const s = scene()
    expect(snapSketchPoint(s, [10 + 3 * Math.cos(1), 3 * Math.sin(1) + 0.1], 0.5, { allow: smart }).kind).toBe('entity')
    expect(snapSketchPoint(s, [50, 50], 0.5, { allow: smart }).kind).toBeNull()
    expect(snapSketchPoint(s, [50, 50], 0.5, { allow: smart, off: true }).kind).toBeNull()
  })

  it('leaves the piece being dragged out, and takes the sheet’s zero', () => {
    const s = scene()
    expect(snapSketchPoint(s, [7.1, 0], 0.5, { allow: smart }, new Set([1])).kind).not.toBe('quadrant')
    expect(snapSketchPoint(s, [0.2, 0.1], 0.5, { allow: smart })).toMatchObject({ kind: 'origin', point: [0, 0] })
  })

  it('in the Dimension tool a middle and a quadrant reach as far as an end', () => {
    const s = scene()
    const pick = { endpoint: true, midpoint: true, center: true, quadrant: true, curve: true }
    // 0.27 from the middle: beyond the 0.8 share of the point reach, within the whole of it.
    expect(dimPickAt(s, [0.27, 2], 0.4, [], pick)).toEqual({ kind: 'piece', id: 2 })
    expect(dimPickAt(s, [0.27, 2], 0.4, [], { ...pick, nearest: true })).toEqual({ kind: 'piece', id: 2, via: { entity: 2, at: 'center' } })
  })
})

describe('a square clicked with the Dimension tool, through the store', () => {
  const st = () => useReverse.getState(), dr = () => st().sketchDraft!
  const dims = () => dr().sketch.constraints.filter((c) => 'value' in c)
  beforeEach(() => {
    useSnapFilter.setState({ flags: structuredClone(DEFAULT_SNAP_FLAGS), all: { draw: false, pick: false, measure: false } })
    useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
    st().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, [
      { kind: 'circle', c: [10, 0], r: 3 },
      { kind: 'line', a: [0, -3], b: [0, 7] },
      { kind: 'line', a: [-6, -3], b: [-2, 9] },
    ])
    st().setSketchTool('dimension')
  })

  it('a circle clicked on its top square is still its diameter', () => {
    st().sketchClick([10, 3], 0.5, false)
    expect(dims().map((c) => c.kind)).toEqual(['diameter'])
  })

  it('a line clicked on its middle’s square is still its length', () => {
    st().sketchClick([0, 2], 0.5, false)
    expect(dims()).toMatchObject([{ kind: 'length', entity: 2, value: 10 }])
  })

  it('the circle’s left square then the line: from the rim’s point, not the centre', () => {
    st().sketchClick([7, 0], 0.5, false)
    st().sketchClick([0, 5], 0.5, false)
    expect(dims()).toMatchObject([{ kind: 'distance', p: { entity: 1, at: 'q2' }, q: { line: 2 } }])
    expect((dims()[0] as { value: number }).value).toBeCloseTo(7, 9)
  })

  it('the circle clicked away from its squares then the line: from the centre, as before', () => {
    st().sketchClick([10 + 3 * Math.cos(1), 3 * Math.sin(1)], 0.5, false)
    st().sketchClick([0, 5], 0.5, false)
    expect(dims()).toMatchObject([{ kind: 'distance', p: { entity: 1, at: 'center' }, q: { line: 2 } }])
  })

  it('two squares of one circle measure across it', () => {
    st().sketchClick([7, 0], 0.5, false)
    st().sketchClick([13, 0], 0.5, false)
    expect(dims()).toMatchObject([{ kind: 'distance', p: { entity: 1, at: 'q2' }, q: { entity: 1, at: 'q0' }, value: 6 }])
  })

  it('two lines are an angle even when the second is clicked on its middle’s square', () => {
    st().sketchClick([0, 5], 0.5, false)
    st().sketchClick([-4, 3], 0.5, false)
    expect(dims().map((c) => c.kind)).toEqual(['angle'])
  })

  it('two lines both clicked on their middles’ squares are still an angle', () => {
    st().sketchClick([0, 2], 0.5, false)
    st().sketchClick([-4, 3], 0.5, false)
    expect(dims().map((c) => c.kind)).toEqual(['angle'])
  })

  it('a line’s middle square then the circle’s centre: from the middle', () => {
    st().sketchClick([0, 2], 0.5, false)
    st().sketchClick([10, 0], 0.5, false)
    expect(dims()).toMatchObject([{ kind: 'distance', p: { entity: 2, at: 'center' }, q: { entity: 1, at: 'center' } }])
  })
})
