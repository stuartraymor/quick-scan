// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, describe, expect, it } from 'vitest'
import { addEntity, emptySketch } from '../core/sketch'
import { XY } from './reKit'

let store: typeof import('../state/reStore').useReverse
let actions: typeof import('../state/sketchExtraTools')
beforeAll(async () => {
  await import('../plugin')
  store = (await import('../state/reStore')).useReverse
  actions = await import('../state/sketchExtraTools')
}, 60_000)

describe('sketch edit actions share the draft history', () => {
  it('mirrors as one undoable step and redo restores the copy', () => {
    const s = emptySketch()
    const axis = addEntity(s, { kind: 'line', a: [0, 0], b: [0, 10], construction: true })
    const line = addEntity(s, { kind: 'line', a: [2, 1], b: [4, 1] })
    store.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, s.entities)
    store.setState(state => ({ sketchDraft: { ...state.sketchDraft!, selection: [axis, line] } }))
    expect(actions.mirrorSketchSelection()).toBe(true)
    expect(store.getState().sketchDraft!.sketch.entities).toHaveLength(3)
    expect(store.getState().sketchDraft!.history).toHaveLength(1)
    store.getState().undoSketch()
    expect(store.getState().sketchDraft!.sketch.entities).toHaveLength(2)
    store.getState().redoSketch()
    expect(store.getState().sketchDraft!.sketch.entities).toHaveLength(3)
  })
  it('failed actions expose an error without creating an undo step or changing geometry', () => {
    const s = emptySketch()
    const id = addEntity(s, { kind: 'circle', c: [0, 0], r: 2 })
    store.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY, s.entities)
    store.setState(state => ({ sketchDraft: { ...state.sketchDraft!, selection: [id] } }))
    const before = JSON.stringify(store.getState().sketchDraft!.sketch)
    expect(actions.offsetSketchSelection(3)).toBe(false)
    expect(store.getState().sketchDraft!.error).toContain('radius')
    expect(store.getState().sketchDraft!.history).toHaveLength(0)
    expect(JSON.stringify(store.getState().sketchDraft!.sketch)).toBe(before)
  })
})
