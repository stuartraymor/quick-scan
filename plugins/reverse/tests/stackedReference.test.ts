// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest'
import { collectExtrudedReference, referenceCut, referenceEdges, ReferenceCancelled, stackDistances, stackExtentOf } from '../core/stackedReference'
import { projectCut, sliceMesh } from '../../../src/core/section/slice'
import type { Vec2 } from '../../../src/core/flat/types'
import type { Vec3 } from '../../../src/core/types'
import { cloneSketch, emptySketch } from '../core/sketch'
import { useReverse } from '../state/reStore'
import { applyReversePart, featureToJson, validateFeatureJson } from '../app/projectSection'
import { XY } from './reKit'

/** A real stepped wall mesh: lower20x10 profile, upper12x6 profile. */
function steppedMesh() {
  const rings = [{ z: -10, x: 10, y: 5 }, { z: 0, x: 10, y: 5 }, { z: 0, x: 6, y: 3 }, { z: 10, x: 6, y: 3 }]
  const positions = new Float32Array(rings.flatMap(({ z, x, y }) => [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]].flat()))
  const faces: number[] = []
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < 4; i++) { const a = r * 4 + i, b = r * 4 + (i + 1) % 4, c = a + 4, d = b + 4; faces.push(a, b, d, a, d, c) }
  return { positions, indices: new Uint32Array(faces) }
}

describe('one-sketch stacked reference collection', () => {
  it('cuts from the lower to the upper plane, ends included, and projects every cut onto one frame', async () => {
    const mesh = steppedMesh(), calls: Vec3[] = []
    const frame = { ...XY, origin: [0, 0, 2] as Vec3 }
    const source = { bounds: async () => ({ min: [-10, -5, -10] as Vec3, max: [10, 5, 10] as Vec3 }), section: async (origin: Vec3, normal: Vec3) => { calls.push(origin); return sliceMesh(mesh.positions, mesh.indices, origin, normal) } }
    const result = await collectExtrudedReference(source, frame, 4, { extent: { min: -11, max: 7 } })
    expect(calls.map((p) => p[2])).toEqual([-9, -3, 3, 9])
    expect(result.extent).toEqual({ min: -11, max: 7 })
    expect(result.chains).toHaveLength(4)
    expect(result.chains.slice(0, 2).flat().some(([x]) => Math.abs(x) === 10)).toBe(true)
    expect(result.chains.slice(2).flat().some(([x]) => Math.abs(x) === 6)).toBe(true)
    const preview = referenceCut(result.chains, frame)
    expect(Array.from(preview.points).filter((_, i) => i % 3 === 2).every((z) => z === 2)).toBe(true)
    expect(projectCut(preview, frame)).toEqual(referenceEdges(result.chains))
  })
  it('computes normal extent for an oblique plane and honors explicit narrower ranges', async () => {
    const n = Math.SQRT1_2, frame = { ...XY, normal: [n, 0, n] as Vec3 }
    const extent = stackExtentOf({ min: [-2, -3, -4], max: [2, 3, 4] }, frame)
    expect(extent.min).toBeCloseTo(-6 * n, 12); expect(extent.max).toBeCloseTo(6 * n, 12)
    expect(stackDistances({ min: -3, max: 3 }, 4)).toEqual([-3, -1, 1, 3])
    const cuts: Vec3[] = []
    const result = await collectExtrudedReference({ bounds: async () => { throw new Error('explicit range must not request bounds') }, section: async (p) => { cuts.push(p); return { points: new Float32Array(0), offsets: new Uint32Array([0]) } } }, XY, 2, { extent: { min: 2, max: 6 } })
    expect(cuts.map((p) => p[2])).toEqual([2, 6])
    expect(result.points).toBe(0)
  })
  it('stops on cancellation after the in-flight cut, returning no partial cloud', async () => {
    let current = true, calls = 0
    const source = { bounds: async () => ({ min: [0, 0, 0] as Vec3, max: [1, 1, 1] as Vec3 }), section: async () => { calls++; current = false; return { points: new Float32Array([0, 0, 0]), offsets: new Uint32Array([0, 1]) } } }
    await expect(collectExtrudedReference(source, XY, 20, { isCurrent: () => current })).rejects.toBeInstanceOf(ReferenceCancelled)
    expect(calls).toBe(1)
  })
  it('rejects invalid section count, bounds and extent without invoking section work', async () => {
    for (const count of [NaN, 1, 201, 2.5]) expect(() => stackDistances({ min: 0, max: 1 }, count)).toThrow()
    expect(() => stackDistances({ min: 3, max: 2 }, 20)).toThrow()
    expect(() => stackExtentOf({ min: [NaN, 0, 0], max: [1, 1, 1] }, XY)).toThrow()
    await expect(collectExtrudedReference({ bounds: async () => ({ min: [0, 0, 0], max: [1, 1, 1] }), section: async () => { throw new Error('unexpected section') } }, { ...XY, normal: [0, 0, 0] }, 20)).rejects.toThrow('frame')
  })
})

beforeEach(() => { useReverse.getState().reset(); useReverse.setState({ nextFeatureId: 1, nextOfKind: {} }) })
const cloud: Vec2[][] = [[[0, 0], [10, 0], [10, 5]], [[1, 1], [8, 1], [8, 4]]]
const open = () => useReverse.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)

describe('reference sketch persistence and history', () => {
  it('commits exactly one feature with no generated geometry and reopens the same cloud', () => {
    open()
    const sketch = emptySketch(); sketch.referenceChains = cloud
    useReverse.getState().setSketch(sketch)
    expect(useReverse.getState().features).toHaveLength(0)
    expect(useReverse.getState().sketchDraft!.sketch.entities).toHaveLength(0)
    const id = useReverse.getState().commitSketch()!
    expect(id).toBe(1)
    expect(useReverse.getState().features).toHaveLength(1)
    useReverse.getState().editSketch(id)
    expect(useReverse.getState().sketchDraft!.sketch.referenceChains).toEqual(cloud)
    useReverse.getState().discardSketch()
    useReverse.getState().undoFeatures()
    expect(useReverse.getState().features).toHaveLength(0)
    useReverse.getState().redoFeatures()
    expect(useReverse.getState().features).toHaveLength(1)
  })
  it('preserves finite reference data through JSON project restore and explicit Clear', () => {
    open(); const sketch = emptySketch(); sketch.referenceChains = cloud
    useReverse.getState().setSketch(sketch); useReverse.getState().commitSketch()
    const feature = JSON.parse(JSON.stringify(featureToJson(useReverse.getState().features[0])))
    expect(() => validateFeatureJson(feature)).not.toThrow()
    applyReversePart({ features: [feature], nextFeatureId: 2, nextOfKind: { sketch: 1 }, elementsShown: true })
    useReverse.getState().editSketch(1)
    expect(useReverse.getState().sketchDraft!.sketch.referenceChains).toEqual(cloud)
    const cleared = cloneSketch(useReverse.getState().sketchDraft!.sketch); cleared.referenceChains = []
    useReverse.getState().setSketch(cleared); useReverse.getState().commitSketch()
    const held = useReverse.getState().features[0]
    expect(held.kind === 'sketch' && held.sketch.referenceChains).toEqual([])
  })
  it('validates all optional reference coordinates without changing legacy sketches', () => {
    const base = { id: 1, kind: 'sketch', name: 'Reference', frame: XY, plane: { kind: 'world', axis: 'z', offset: 0 }, sketch: emptySketch(), visible: true }
    expect(() => validateFeatureJson(base)).not.toThrow()
    for (const referenceChains of [[[[1, NaN]]], [[[1, 2, 3]]], 'invalid', [[{ x: 1, y: 2 }]]]) expect(() => validateFeatureJson({ ...base, sketch: { ...base.sketch, referenceChains } })).toThrow()
  })
})
