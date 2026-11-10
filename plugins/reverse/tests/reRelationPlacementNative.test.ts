// SPDX-License-Identifier: AGPL-3.0-only
// Relations added to two free lines land where QUICKSURFACE 8.0.128 puts
// them: its own DXF exports of the same two lines before and after each
// relation (analysis/sketch-modify-constraints-2026-11-10/constraints-observed,
// 2026-11-10). Horizontal, Vertical and Equal match to the export's
// precision; Parallel and Perpendicular match the native angles, with the
// lengths kept (native shortens them by about 1 % for Parallel).
import { beforeEach, describe, expect, it } from 'vitest'
import type { EntityInput, SketchLine } from '../core/sketch'
import { placeForRelation } from '../core/relationPlacement'
import { useReverse } from '../state/reStore'
import { XY } from './reKit'

const s = () => useReverse.getState()
const lines = () => s().sketchDraft!.sketch.entities.filter((e): e is SketchLine => e.kind === 'line')
const BASE: EntityInput[] = [
  { kind: 'line', a: [11.96067476273, 6.59965133667], b: [18.31482505798, 5.155526161194] },
  { kind: 'line', a: [11.96067476273, -0.6209737658501], b: [17.1595249176, -2.931573867798] },
]
const deg = (l: SketchLine) => (Math.atan2(l.b[1] - l.a[1], l.b[0] - l.a[0]) * 180) / Math.PI
const len = (l: SketchLine) => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])
const mid = (l: SketchLine) => [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2]
const close = (p: readonly number[], q: readonly number[], tol: number) => p.forEach((x, i) => expect(Math.abs(x - q[i])).toBeLessThan(tol))

function relate(kind: 'horizontal' | 'vertical' | 'parallel' | 'perpendicular' | 'equal', both = true) {
  useReverse.setState({ sketchDraft: { ...s().sketchDraft!, selection: both ? [1, 2] : [1] } })
  s().addRelation(kind)
  expect(s().sketchDraft!.error).toBeNull()
  return lines()
}

beforeEach(() => {
  useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, extrudeDraft: null, revolveDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, BASE)
})

describe('as QUICKSURFACE places the lines', () => {
  it('Horizontal: the second end stays, the first comes onto its height', () => {
    const [l1, l2] = relate('horizontal', false)
    close(l1.a, [11.96067476273, 5.155526161194], 1e-6)
    close(l1.b, [18.31482505798, 5.155526161194], 1e-6)
    close(l2.a, BASE[1].kind === 'line' ? BASE[1].a : [], 1e-9)
  })

  it('Vertical: the second end stays, the first comes across to it', () => {
    const [l1] = relate('vertical', false)
    close(l1.a, [18.31482505798, 6.59965133667], 1e-6)
    close(l1.b, [18.31482505798, 5.155526161194], 1e-6)
  })

  it('Equal: directions and midpoints kept, both lengths the mean', () => {
    const [l1, l2] = relate('equal')
    close(l1.a, [12.1623, 6.5538], 2e-4); close(l1.b, [18.1132, 5.2013], 2e-4)
    close(l2.a, [11.7717, -0.537], 2e-4); close(l2.b, [17.3485, -3.0155], 2e-4)
    expect(deg(l1)).toBeCloseTo(-12.80, 2)
    expect(deg(l2)).toBeCloseTo(-23.96, 2)
  })

  it('Parallel: both turn about their midpoints to native’s common angle', () => {
    const [l1, l2] = relate('parallel')
    expect(deg(l1)).toBeCloseTo(-17.62, 1)
    expect(deg(l2)).toBeCloseTo(-17.62, 1)
    close(mid(l1), [15.1375, 5.8776], 1e-3)
    close(mid(l2), [14.5601, -1.7763], 1e-3)
    // Native's ends, within the 1 % it shortens the lines by.
    close(l1.a, [12.0722, 6.8513], 0.05); close(l2.b, [17.2296, -2.6242], 0.05)
  })

  it('Perpendicular: the turn shared by length², as native (21.43°, −68.57°)', () => {
    const [l1, l2] = relate('perpendicular')
    expect(Math.abs(deg(l1) - 21.43)).toBeLessThan(0.3)
    expect(Math.abs(deg(l2) + 68.57)).toBeLessThan(0.3)
    expect(Math.abs(Math.abs(deg(l1) - deg(l2)) - 90)).toBeLessThan(1e-6)
    expect(len(l1)).toBeCloseTo(6.516, 2)
  })

  it('a line already Horizontal keeps its direction for Parallel; the other turns to it', () => {
    relate('horizontal', false)
    const [l1, l2] = relate('parallel')
    expect(Math.abs(deg(l1))).toBeLessThan(1e-6)
    expect(Math.abs(deg(l2))).toBeLessThan(1e-6)
    close(mid(l2), [14.5601, -1.7763], 1e-3)
    expect(len(l2)).toBeCloseTo(5.689, 3)
  })

  it('Horizontal on a line already parallel to another still keeps its second end; the other turns with it', () => {
    const [p1] = relate('parallel')
    const [l1, l2] = relate('horizontal', false)
    close(l1.b, p1.b, 1e-6)
    expect(l1.a[1]).toBeCloseTo(p1.b[1], 6)
    expect(Math.abs(deg(l2))).toBeLessThan(1e-4)
  })

  it('Undo puts both lines back', () => {
    relate('parallel')
    s().undoSketch()
    close(lines()[0].a, [11.96067476273, 6.59965133667], 1e-12)
  })
})

describe('placeForRelation', () => {
  const l = (id: number, a: [number, number], b: [number, number], fixed = false): SketchLine => ({ id, kind: 'line', a, b, ...(fixed ? { fixed } : {}) })
  it('a fixed line does not move; the free one takes the whole turn', () => {
    const out = placeForRelation('parallel', [l(1, [0, 0], [10, 0], true), l(2, [0, 5], [10, 7])])!
    expect(out.has(1)).toBe(false)
    const m = out.get(2)!
    expect(m.a[1]).toBeCloseTo(m.b[1], 12)
  })
  it('takes the fixed line’s length for Equal', () => {
    const out = placeForRelation('equal', [l(1, [0, 0], [4, 0]), l(2, [0, 5], [10, 5], true)])!
    expect(Math.hypot(out.get(1)!.b[0] - out.get(1)!.a[0], 0)).toBeCloseTo(10, 12)
  })
  it('refuses degenerate or non-finite lines rather than inventing a place', () => {
    expect(placeForRelation('parallel', [l(1, [0, 0], [0, 0]), l(2, [0, 5], [10, 7])])).toBeNull()
    expect(placeForRelation('equal', [l(1, [0, 0], [Number.NaN, 0]), l(2, [0, 5], [10, 7])])).toBeNull()
    expect(placeForRelation('horizontal', [l(1, [0, 0], [0, 5], true)])).toBeNull()
  })
  it('a vertical line made horizontal is left to the solver rather than collapsed', () => {
    expect(placeForRelation('horizontal', [l(1, [3, 0], [3, 5])])!.size).toBe(0)
    expect(placeForRelation('horizontal', [l(1, [3, 5], [3, 5.0000000000001])])).toBeNull()
  })
})
