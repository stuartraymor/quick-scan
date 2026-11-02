// SPDX-License-Identifier: AGPL-3.0-only
// Independent group-selection behavior; QuickSurface bulk semantics remain unverified.
import { beforeEach, describe, expect, it } from 'vitest'
import { cloneSketch, type ConstraintKind, type EntityInput, type SketchLine } from '../core/sketch'
import { useReverse } from '../state/reStore'
import { XY } from './reKit'

const s = () => useReverse.getState()
const d = () => s().sketchDraft!
const lines: EntityInput[] = [
  { kind: 'line', a: [0, 0], b: [10, 0] },
  { kind: 'line', a: [0, 10], b: [10, 10] },
  { kind: 'line', a: [0, 20], b: [10, 20] },
]
const open = (seed = lines) => s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, seed)
const selectAll = () => {
  for (const y of [0, 10, 20]) s().sketchClick([5, y], 0.1, false)
}

beforeEach(() => {
  useReverse.setState({ features: [], nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, extrudeDraft: null, revolveDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
  open()
})

describe('graphical multi-selection', () => {
  it('accumulates three ordinary clicks and toggles only the clicked piece', () => {
    const history = d().history.length
    selectAll()
    expect(d().selection).toEqual([1, 2, 3])
    s().sketchClick([5, 10], 0.1, false)
    expect(d().selection).toEqual([1, 3])
    expect(d().history).toHaveLength(history)
    s().sketchClick([80, 80], 0.1, true)
    expect(d().selection).toEqual([1, 3])
    s().sketchClick([80, 80], 0.1, false)
    expect(d().selection).toEqual([])
  })

  it.each(['horizontal', 'vertical'] as const)('applies %s to all lines as one undo step', (kind) => {
    selectAll()
    const before = cloneSketch(d().sketch)
    s().addRelation(kind)
    expect(d().sketch.constraints.filter((c) => c.kind === kind)).toHaveLength(3)
    expect(d().report?.ok).toBe(true)
    const solved = cloneSketch(d().sketch)
    for (const e of solved.entities as SketchLine[]) {
      expect(Math.abs(e.a[kind === 'horizontal' ? 1 : 0] - e.b[kind === 'horizontal' ? 1 : 0])).toBeLessThan(1e-5)
    }
    expect(d().history).toHaveLength(1)
    s().undoSketch()
    expect(d().sketch).toEqual(before)
    s().redoSketch()
    // Redo solves again, so geometry agrees within solver tolerance rather
    // than requiring bit-identical floating-point coordinates.
    expect(d().sketch.constraints).toEqual(solved.constraints)
    for (const [i, e] of (d().sketch.entities as SketchLine[]).entries()) {
      const before = solved.entities[i] as SketchLine
      for (const axis of [0, 1]) {
        expect(e.a[axis]).toBeCloseTo(before.a[axis], 7)
        expect(e.b[axis]).toBeCloseTo(before.b[axis], 7)
      }
    }
  })

  it.each(['parallel', 'perpendicular', 'equal'] as const)('applies %s between the first line and every other selected line', (kind) => {
    // Avoid a zero-gradient perpendicular starting point.
    open([
      lines[0],
      { kind: 'line', a: [0, 10], b: [1, 20] },
      { kind: 'line', a: [0, 30], b: [2, 40] },
    ])
    useReverse.setState({ sketchDraft: { ...d(), selection: [1, 2, 3] } })
    s().addRelation(kind)
    expect(d().sketch.constraints.filter((c) => c.kind === kind)).toMatchObject([{ a: 1, b: 2 }, { a: 1, b: 3 }])
    expect(d().report?.ok).toBe(true)
    expect(d().history).toHaveLength(1)
    s().undoSketch()
    expect(d().sketch.constraints).toHaveLength(0)
  })

  it('rejects a mixed group without applying the valid first pair', () => {
    open([...lines.slice(0, 2), { kind: 'circle', c: [0, 30], r: 2 }])
    useReverse.setState({ sketchDraft: { ...d(), selection: [1, 2, 3] } })
    const before = cloneSketch(d().sketch)
    for (const kind of ['horizontal', 'parallel', 'equal', 'perpendicular'] as ConstraintKind[]) {
      s().addRelation(kind)
      expect(d().error).toMatch(/does not apply/)
      expect(d().sketch).toEqual(before)
      expect(d().history).toHaveLength(0)
      expect(d().selection).toEqual([1, 2, 3])
    }
  })

  it('rejects a stale selection without constraining only its surviving pieces', () => {
    useReverse.setState({ sketchDraft: { ...d(), selection: [1, 2, 99] } })
    const before = cloneSketch(d().sketch)
    s().addRelation('horizontal')
    expect(d().error).toMatch(/no longer/)
    expect(d().sketch).toEqual(before)
    expect(d().history).toHaveLength(0)
  })

  it('keeps a group intact when a dimension needs one piece or a pair', () => {
    selectAll()
    const before = cloneSketch(d().sketch)
    s().dimensionSelection()
    expect(d().error).toMatch(/one piece, or two/)
    expect(d().sketch).toEqual(before)
    expect(d().selection).toEqual([1, 2, 3])
    // Put one piece down and dimension the remaining pair normally.
    s().sketchClick([5, 20], 0.1, false)
    s().dimensionSelection()
    expect(d().tool).toBe('dimension')
    expect(d().dimMade).not.toBeNull()
    expect(d().sketch.constraints.at(-1)).toMatchObject({ kind: 'distance', value: 10 })
  })
})
