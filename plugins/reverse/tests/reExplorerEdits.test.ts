// SPDX-License-Identifier: AGPL-3.0-only
// Rename (F2) and a body's eye from the Objects and History panels: each is
// one undo step, and the eye is saved with the project, as in QUICKSURFACE.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearHistory, configureHistory, historyAction, installHistory, undo, redo } from '../../../src/state/historyStore'
import type { Feature } from '../core/features'
import { collectReversePart, reverseSection } from '../app/projectSection'
import { useReverse } from '../state/reStore'
import reversePlugin from '../plugin'
import { rectangleSketch } from './reKit'
import { resetReverse } from './reReset'

type Built = Parameters<ReturnType<typeof useReverse.getState>['finishBuild']>[1][number]
const body = (id: number, surface = false) => ({ id, name: `Body ${id}`, volume: surface ? 0 : 1, area: 1, closed: !surface, valid: true, ...(surface ? { surface: true } : {}) }) as unknown as Built
const s = () => useReverse.getState()
const sheet: Feature = { id: 2, kind: 'sheet', name: 'Sheet 1', sketchId: 1, from: 0, to: 10, visible: true }
let stops: (() => void)[] = []

beforeAll(() => reversePlugin.install?.())
beforeEach(() => {
  resetReverse()
  clearHistory()
  stops = [configureHistory({}), installHistory()]
  useReverse.setState({ features: [rectangleSketch(1, 10, 10), sheet], nextFeatureId: 3 })
  s().finishBuild([], [body(2, true)])
})
afterEach(() => { for (const stop of stops.reverse()) stop(); resetReverse() })

describe('renaming a feature', () => {
  it('renames once, refuses a taken or empty name, and is one undo step', async () => {
    expect(s().renameFeature(1, '  Profile ')).toBe(true)
    expect(s().features[0].name).toBe('Profile')
    expect(s().renameFeature(2, 'Profile')).toBe(false)
    expect(s().renameFeature(2, '   ')).toBe(false)
    expect(s().renameFeature(2, 'x'.repeat(121))).toBe(false)
    expect(s().renameFeature(1, 'Profile')).toBe(true)
    expect(s().features[1].name).toBe('Sheet 1')
    await undo()
    expect(s().features[0].name).not.toBe('Profile')
    await redo()
    expect(s().features[0].name).toBe('Profile')
  })

  it('renames a rolled-back feature too', () => {
    s().rollTo(1)
    expect(s().rolledBack.map((f) => f.id)).toEqual([2])
    expect(s().renameFeature(2, 'Wall')).toBe(true)
    expect(s().rolledBack[0].name).toBe('Wall')
  })
})

describe('a body eye from the panels', () => {
  it('is undone and redone', async () => {
    historyAction('hide bodies', () => s().setBodiesVisible([2], false))
    expect(s().hiddenBodies).toEqual([2])
    expect(s().bodies[0].visible).toBe(false)
    await undo()
    expect(s().hiddenBodies).toEqual([])
    expect(s().bodies[0].visible).toBe(true)
    await redo()
    expect(s().bodies[0].visible).toBe(false)
  })

  it('marks the project changed and is saved', () => {
    const changed = vi.fn()
    const stop = reverseSection.watch!(changed, () => {})
    s().setBodiesVisible([2], false)
    stop()
    expect(changed).toHaveBeenCalled()
    expect(collectReversePart()!.hiddenBodies).toEqual([2])
  })

  it('colors a body as one undo step', async () => {
    const before = s().bodies[0].color
    historyAction('Change color', () => s().setBodyStyle(2, { color: '#ff0000' }))
    expect(s().bodies[0].color).toBe('#ff0000')
    await undo()
    expect(s().bodies[0].color).toBe(before)
    expect(s().bodyStyles[2]?.color).toBeUndefined()
  })
})
