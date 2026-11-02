// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, describe, expect, it } from 'vitest'
import { addEntity } from '../core/sketch'
import { sketchOf, XY } from './reKit'
let re: typeof import('../state/reStore').useReverse
let project: typeof import('../state/sketchProjectStore').useSketchProject
beforeAll(async () => {
  await import('../plugin')
  re = (await import('../state/reStore')).useReverse
  project = (await import('../state/sketchProjectStore')).useSketchProject
}, 60_000)
const source = () => sketchOf(11, s => addEntity(s, { kind: 'line', a: [1, 2], b: [6, 2] }))
function fresh() {
  re.setState({ features: [source()] })
  re.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
  project.getState().setOpen(true)
}
describe('batch sketch projection confirmation', () => {
  it('previews without mutation, Cancel leaves no geometry/history change', () => {
    fresh()
    expect(project.getState().preview?.entities).toHaveLength(1)
    expect(re.getState().sketchDraft!.sketch.entities).toHaveLength(0)
    project.getState().cancel()
    expect(re.getState().sketchDraft!.history).toHaveLength(0)
    expect(re.getState().sketchDraft!.sketch.entities).toHaveLength(0)
  })
  it('Create commits all linked projections as one undoable edit', () => {
    fresh(); expect(project.getState().apply()).toBe(true)
    expect(re.getState().sketchDraft!.history).toHaveLength(1)
    expect(re.getState().sketchDraft!.sketch.entities[0].source).toEqual({ sketch: 11, entity: 1 })
    re.getState().undoSketch(); expect(re.getState().sketchDraft!.sketch.entities).toHaveLength(0)
    re.getState().redoSketch(); expect(re.getState().sketchDraft!.sketch.entities).toHaveLength(1)
    project.getState().setOpen(true); expect(project.getState().apply()).toBe(false)
    expect(re.getState().sketchDraft!.history).toHaveLength(1)
  })
  it('requires reviewing refreshed source geometry before Create', () => {
    fresh(); const changed = source(); changed.frame = { ...XY, origin: [20, 0, 0] }
    re.setState({ features: [changed] })
    expect(project.getState().apply()).toBe(false)
    expect(project.getState().message).toContain('changed')
    expect(re.getState().sketchDraft!.history).toHaveLength(0)
    expect(project.getState().apply()).toBe(true)
    expect(re.getState().sketchDraft!.sketch.entities[0]).toMatchObject({ a: [21, 2] })
  })
})
