// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.19: QUICKSURFACE's "Set sketch on: Top plane / Bottom plane" in the
// Extruded dialog (read live 2026-11-22: Depth 1 11.4 / Depth 2 0 became
// 0 / 11.4 on Top plane, the body where it was), and a Cut that opens into
// the solid.

import { beforeEach, describe, expect, it } from 'vitest'
import type { ExtrudeFeature, SketchFeature } from '../core/features'
import { useReverse } from '../state/reStore'
import { XY } from './reKit'

const s = () => useReverse.getState()

function finishSquare(size = 10, offset = 0): number {
  s().startSketch({ kind: 'world', axis: 'z', offset }, { ...XY, origin: [0, 0, offset] })
  s().setSketchTool('rectangle')
  s().sketchClick([0, 0], 0.5, false, { off: true })
  s().sketchClick([size, size], 0.5, false, { off: true })
  const id = s().commitSketch()
  if (id === null) throw new Error('the square did not finish')
  return id
}
const sketchOf = (id: number) => s().features.find((f): f is SketchFeature => f.kind === 'sketch' && f.id === id)!

beforeEach(() => {
  useReverse.setState({ features: [], rolledBack: [], featureDraft: null, nextFeatureId: 1, nextOfKind: {}, results: {}, bodies: [], sketchDraft: null, extrudeDraft: null, revolveDraft: null, past: [], future: [], selection: null, gripField: null, buildVersion: 0 })
})

describe('Set sketch on', () => {
  it('Top plane moves the sketch up to the top end and re-reads the depths, the body where it was', () => {
    const id = finishSquare()
    s().startExtrude(id)
    s().setExtrude({ extent: { kind: 'distance', from: -2, to: 11.4 } })
    expect(s().setExtrudeSketchOn('top')).toBeNull()
    expect(s().extrudeDraft!.extent).toEqual({ kind: 'distance', from: -13.4, to: 0 })
    expect(sketchOf(id).plane).toMatchObject({ kind: 'world', axis: 'z', offset: 11.4 })
    expect(sketchOf(id).frame.origin[2]).toBeCloseTo(11.4, 12)
    // Again is nothing to do.
    const features = s().features
    expect(s().setExtrudeSketchOn('top')).toBeNull()
    expect(s().features).toBe(features)
  })

  it('Bottom plane moves it to the lower end; one Undo puts the sketch back', () => {
    const id = finishSquare()
    s().startExtrude(id)
    s().setExtrude({ extent: { kind: 'distance', from: -2, to: 8 } })
    expect(s().setExtrudeSketchOn('bottom')).toBeNull()
    expect(s().extrudeDraft!.extent).toEqual({ kind: 'distance', from: 0, to: 10 })
    expect(sketchOf(id).frame.origin[2]).toBeCloseTo(-2, 12)
    s().cancelExtrude()
    s().undoFeatures()
    expect(sketchOf(id).frame.origin[2]).toBe(0)
  })

  it('an extrude being edited is rewritten with the sketch, so both agree whatever the box does next', () => {
    const id = finishSquare()
    s().startExtrude(id)
    s().setExtrude({ extent: { kind: 'distance', from: 0, to: 6 } })
    const made = s().commitExtrude()!
    s().editExtrude(made)
    expect(s().setExtrudeSketchOn('top')).toBeNull()
    const stored = s().features.find((f): f is ExtrudeFeature => f.id === made && f.kind === 'extrude')!
    expect(stored.extent).toEqual({ kind: 'distance', from: -6, to: 0 })
    expect(sketchOf(id).frame.origin[2]).toBeCloseTo(6, 12)
  })

  it('refuses where another feature uses the sketch, and says which', () => {
    const id = finishSquare()
    s().startExtrude(id)
    s().setExtrude({ extent: { kind: 'distance', from: 0, to: 6 } })
    s().commitExtrude()
    s().startExtrude(id)
    s().setExtrude({ extent: { kind: 'distance', from: 0, to: 3 } })
    const why = s().setExtrudeSketchOn('top')
    expect(why).toMatch(/also used by Extrude 1/)
    expect(sketchOf(id).frame.origin[2]).toBe(0)
  })
})

describe('Cut opens into the solid', () => {
  const solid = (min: [number, number, number], max: [number, number, number]) => ({ id: 2, name: 'Solid 1', visible: true, volume: 1, faces: 6, closed: true, triangles: 12, box: { min, max } })

  it('a sketch on the plane a block stands on: Cut keeps pointing up into it', () => {
    const id = finishSquare()
    useReverse.setState({ bodies: [solid([0, 0, 0], [10, 10, 6])] })
    s().startExtrude(id)
    const opened = s().extrudeDraft!.extent
    s().setExtrudeOp('cut')
    expect(s().extrudeDraft!.extent).toEqual(opened)
    // Back to Join: away from the block.
    s().setExtrudeOp('join')
    const e = s().extrudeDraft!.extent
    expect(e.kind === 'distance' && e.to < 0).toBe(true)
  })

  it('a sketch on a block’s top face: Cut turns down into it, as before', () => {
    const id = finishSquare(10, 6)
    useReverse.setState({ bodies: [solid([0, 0, 0], [10, 10, 6])] })
    s().startExtrude(id)
    s().setExtrudeOp('cut')
    const e = s().extrudeDraft!.extent
    expect(e.kind === 'distance' && e.to < 0 && e.from === 0).toBe(true)
  })

  it('solids on both sides: the direction turns over, as it always has', () => {
    const id = finishSquare(10, 3)
    useReverse.setState({ bodies: [solid([0, 0, 0], [10, 10, 6])] })
    s().startExtrude(id)
    const opened = s().extrudeDraft!.extent
    s().setExtrudeOp('cut')
    const e = s().extrudeDraft!.extent
    expect(opened.kind === 'distance' && e.kind === 'distance' && e.to === -opened.to).toBe(true)
  })
})
