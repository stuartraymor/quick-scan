// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, expect, it } from 'vitest'
import { applyReversePart, featureToJson, validateFeatureJson, validateReversePart } from '../app/projectSection'
import { DEFAULT_SURFACE_FIT } from '../core/surfaceFit'
import { moveSurfacePole } from '../core/surfaceStep'
import type { SurfaceFeature } from '../core/features'
import { useReverse } from '../state/reStore'

const axis = { degree: 4, count: 5, knots: [-2, 3], mults: [5, 5] }
function feature(): SurfaceFeature {
  const net = { u: structuredClone(axis), v: structuredClone(axis), poles: Array.from({ length: 25 }, (_, i) => [Math.floor(i / 5), i % 5, 0]) }
  return { id: 1, kind: 'surface', name: 'Edited surface', region: Uint32Array.from({ length: 100 }, (_, i) => i), fit: { ...DEFAULT_SURFACE_FIT }, visible: true, controlSurface: moveSurfacePole(net, 1, 1, [3, 2, 1], 50) }
}
beforeEach(() => useReverse.getState().reset())

it('retains explicit smoothing levels without converting legacy weights', () => {
  for (const level of [undefined, 0, 3, 5]) {
    const f = feature()
    f.fit = { ...f.fit, smoothness: 17.25, ...(level === undefined ? {} : { smoothingLevel: level }) }
    const part = validateReversePart(JSON.parse(JSON.stringify({ version: 3, features: [featureToJson(f)], nextFeatureId: 2, nextOfKind: { surface: 1 } })))
    applyReversePart(part)
    const restored = useReverse.getState().features[0] as SurfaceFeature
    expect(restored.fit).toEqual(f.fit)
    useReverse.getState().editFeature(1)
    const draft = useReverse.getState().featureDraft!
    expect(draft.kind === 'surface' && draft.fit.smoothingLevel).toBe(level)
    useReverse.getState().cancelFeature()
    expect((useReverse.getState().features[0] as SurfaceFeature).fit).toEqual(f.fit)
  }
})

it('rejects invalid explicit smoothing levels before restoring a project', () => {
  const f = feature(), json = featureToJson(f)
  for (const level of [null, -1, 6, 1.5, '3', NaN, Infinity]) {
    expect(() => validateFeatureJson({ ...json, fit: { ...f.fit, smoothingLevel: level } })).toThrow(/smoothingLevel/)
  }
})

it('retains edited XYZ poles and nonnormalized knots through project JSON', () => {
  const f = feature()
  const part = validateReversePart(JSON.parse(JSON.stringify({ version: 3, features: [featureToJson(f)], nextFeatureId: 2, nextOfKind: { surface: 1 } })))
  applyReversePart(part)
  const restored = useReverse.getState().features[0] as SurfaceFeature
  expect(restored.controlSurface).toEqual(f.controlSurface)
  expect(restored.region).toEqual(f.region)
})

it('isolates an edit draft and committed net so cancel cannot modify saved poles', () => {
  const f = feature()
  const snapshot = structuredClone(f.controlSurface)
  useReverse.setState({ features: [f], nextFeatureId: 2 })
  useReverse.getState().editFeature(1)
  let d = useReverse.getState().featureDraft!
  if (d.kind !== 'surface') throw Error('Wrong draft')
  expect(d.controlSurface).toEqual(snapshot)
  d.controlSurface!.poles[6][0] += 10
  useReverse.getState().cancelFeature()
  expect(f.controlSurface).toEqual(snapshot)
  useReverse.getState().editFeature(1)
  d = useReverse.getState().featureDraft!
  if (d.kind !== 'surface') throw Error('Wrong draft')
  d.controlSurface = moveSurfacePole(d.controlSurface!, 1, 1, [1, 0, 0])
  useReverse.getState().commitFeature()
  const committed = useReverse.getState().features[0] as SurfaceFeature
  expect(committed.controlSurface).toEqual(d.controlSurface)
  d.controlSurface.poles[6][0] += 100
  expect(committed.controlSurface!.poles[6][0]).toBe(snapshot!.poles[6][0] + 1)
})

it('rejects malformed edited geometry and edited nets on analytic primitives', () => {
  const json = featureToJson(feature())
  for (const bad of [null, {}, { ...feature().controlSurface, poles: [[0, 0, 0]] }, { ...feature().controlSurface, u: { ...axis, mults: [1, 1] } }]) {
    expect(() => validateFeatureJson({ ...json, controlSurface: bad })).toThrow()
  }
  expect(() => validateFeatureJson({ ...json, shape: 'plane' })).toThrow()
  expect(() => validateFeatureJson({ ...json, controlSurface: undefined })).not.toThrow()
})

it('preserves the edited net on harmless draft changes but clears it for a refit or changed region', () => {
  for (const patch of [{ fit: { ...DEFAULT_SURFACE_FIT } }, { shape: 'plane' as const }, { region: new Uint32Array([1, 2, 3]) }]) {
    useReverse.setState({ features: [feature()] })
    useReverse.getState().editFeature(1)
    useReverse.getState().setFeatureDraft({ name: 'Renamed' })
    let d = useReverse.getState().featureDraft!
    expect(d.kind === 'surface' && d.controlSurface).toBeTruthy()
    useReverse.getState().setFeatureDraft(patch)
    d = useReverse.getState().featureDraft!
    expect(d.kind === 'surface' && d.controlSurface).toBeUndefined()
  }
  useReverse.setState({ features: [feature()] })
  useReverse.getState().editFeature(1)
  useReverse.getState().setRegion(new Uint32Array([1, 2, 3]))
  const d = useReverse.getState().featureDraft!
  expect(d.kind === 'surface' && d.controlSurface).toBeUndefined()
})
