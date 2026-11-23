// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.15, from QUICKSURFACE 8.0.128 side by side: the CAD workspace's scan
// and all-bodies eyes saved with the project, Duplicate on a sketch
// ("Sketch(1) - Copy" at the end of the History), and Transparent on one
// body at a time — each one undo step, the last two saved too.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearHistory, configureHistory, historyAction, installHistory, redo, undo } from '../../../src/state/historyStore'
import type { Feature } from '../core/features'
import { collectReversePart, reverseSection, validateReversePart } from '../app/projectSection'
import { useReverse } from '../state/reStore'
import reversePlugin from '../plugin'
import { rectangleSketch } from './reKit'
import { resetReverse } from './reReset'

type Built = Parameters<ReturnType<typeof useReverse.getState>['finishBuild']>[1][number]
const body = (id: number) => ({ id, name: `Body ${id}`, volume: 0, area: 1, closed: false, valid: true, surface: true }) as unknown as Built
const s = () => useReverse.getState()
const sheet: Feature = { id: 2, kind: 'sheet', name: 'Sheet 1', sketchId: 1, from: 0, to: 10, visible: true }
let stops: (() => void)[] = []

beforeAll(() => reversePlugin.install?.())
beforeEach(() => {
  resetReverse()
  clearHistory()
  stops = [configureHistory({}), installHistory()]
  useReverse.setState({ features: [rectangleSketch(1, 10, 10), sheet], nextFeatureId: 3 })
  s().finishBuild([], [body(2)])
})
afterEach(() => { for (const stop of stops.reverse()) stop(); resetReverse() })

describe('the scan eye and the all-bodies eye', () => {
  it('are saved only when shut, mark the project changed, and open as saved', () => {
    expect(collectReversePart()).not.toHaveProperty('scanHidden')
    const changed = vi.fn()
    const stop = reverseSection.watch!(changed, () => {})
    s().setScanHidden(true)
    s().setBodiesHidden(true)
    stop()
    expect(changed).toHaveBeenCalledTimes(2)
    const part = JSON.parse(JSON.stringify(collectReversePart()))
    expect(part.scanHidden).toBe(true)
    expect(part.bodiesHidden).toBe(true)
    resetReverse()
    expect(s().scanHidden).toBe(false)
    reverseSection.prepare!(validateReversePart(part), undefined as never)()
    expect(s().scanHidden).toBe(true)
    expect(s().bodiesHidden).toBe(true)
  })

  it('refuses a malformed value', () => {
    const part = JSON.parse(JSON.stringify(collectReversePart()))
    expect(() => validateReversePart({ ...part, scanHidden: 'yes' })).toThrow('reverse.scanHidden')
  })
})

describe('Duplicate on a sketch', () => {
  it('adds "<name> - Copy" at the end, shown, as one undo step', async () => {
    let id: number | null = null
    historyAction('Duplicate sketch', () => { id = s().duplicateSketch(1) })
    expect(id).toBe(3)
    const copy = s().features.at(-1)!
    expect(copy).toMatchObject({ id: 3, kind: 'sketch', name: `${s().features[0].name} - Copy`, visible: true })
    // Its own geometry: editing the copy leaves the original alone.
    expect((copy as Extract<Feature, { kind: 'sketch' }>).sketch).not.toBe((s().features[0] as Extract<Feature, { kind: 'sketch' }>).sketch)
    expect(s().nextFeatureId).toBe(4)
    historyAction('Duplicate sketch', () => { s().duplicateSketch(1) })
    expect(s().features.at(-1)!.name).toBe(`${s().features[0].name} - Copy (2)`)
    await undo()
    await undo()
    expect(s().features.map((f) => f.id)).toEqual([1, 2])
    await redo()
    expect(s().features.map((f) => f.id)).toEqual([1, 2, 3])
  })

  it('is for sketches only', () => {
    expect(s().duplicateSketch(2)).toBeNull()
    expect(s().duplicateSketch(99)).toBeNull()
  })
})

describe('Transparent on one body', () => {
  it('is kept in the body style, one undo step, and saved', async () => {
    historyAction('Transparent', () => s().setBodyStyle(2, { transparent: true }))
    expect(s().bodyStyles[2]).toEqual({ transparent: true })
    expect(s().bodiesSeeThrough).toBe(false)
    expect(collectReversePart()!.bodyStyles).toEqual({ 2: { transparent: true } })
    expect(() => validateReversePart(JSON.parse(JSON.stringify(collectReversePart())))).not.toThrow()
    await undo()
    expect(s().bodyStyles[2]).toBeUndefined()
    await redo()
    s().setBodyStyle(2, { transparent: null })
    expect(s().bodyStyles[2]).toBeUndefined()
  })
})
