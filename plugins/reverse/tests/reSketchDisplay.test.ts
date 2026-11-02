// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest'
import { axisIntentMark, sketchPointVisible, snapMark } from '../app/useSketchSceneSync'
import { axisRelationOf, emptySketch, addEntity } from '../core/sketch'
import { lineIntent, snapSketchPoint } from '../core/snap'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('sketch display preferences', () => {
  const prefs = async (stored: Record<string, string> = {}) => {
    const data = new Map(Object.entries(stored))
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) })
    vi.resetModules()
    return { store: (await import('../state/rePrefs')).useRePrefs, data }
  }

  it('shows constraints and dimensions by default and hides inactive control points', async () => {
    const { store } = await prefs()
    expect(store.getState()).toMatchObject({ sketchRelations: true, sketchDimensions: true, sketchControlPoints: false })
  })

  it('preserves independent stored choices and persists toggles', async () => {
    const { store, data } = await prefs({ 'scanruler.sketchrelations': '0', 'scanruler.sketchdimensions': '0', 'scanruler.sketchcontrolpoints': '1' })
    expect(store.getState()).toMatchObject({ sketchRelations: false, sketchDimensions: false, sketchControlPoints: true })
    store.getState().setSketchRelations(true)
    store.getState().setSketchDimensions(true)
    store.getState().setSketchControlPoints(false)
    expect(Object.fromEntries(data)).toMatchObject({ 'scanruler.sketchrelations': '1', 'scanruler.sketchdimensions': '1', 'scanruler.sketchcontrolpoints': '0' })
  })

  it('works for the session when preference storage is blocked', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } })
    vi.resetModules()
    const { useRePrefs } = await import('../state/rePrefs')
    useRePrefs.getState().setSketchDimensions(false)
    useRePrefs.getState().setSketchControlPoints(true)
    expect(useRePrefs.getState()).toMatchObject({ sketchDimensions: false, sketchControlPoints: true })
  })

  it('keeps selected and hovered handles available with control points off', () => {
    expect(sketchPointVisible(false, false, false)).toBe(false)
    expect(sketchPointVisible(false, true, false)).toBe(true)
    expect(sketchPointVisible(false, false, true)).toBe(true)
    expect(sketchPointVisible(true, false, false)).toBe(true)
  })
})

describe('feedback matching actual sketch intent', () => {
  it('uses the same axis inference rule as line creation, including its boundary', () => {
    for (const to of [[10, 0.4], [0.4, 10], [10, 1], [0, 0]] as [number, number][]) {
      expect(lineIntent([0, 0], to)).toBe(axisRelationOf([0, 0], to))
    }
    expect(axisIntentMark([0, 0], [10, 0.4], 1)).toHaveLength(3)
    expect(axisIntentMark([0, 0], [0.4, 10], 1)).toHaveLength(2)
    expect(axisIntentMark([0, 0], [10, 1], 1)).toHaveLength(0)
    expect(axisIntentMark([0, 0], [0, 0], 1)).toHaveLength(0)
  })

  it('draws distinct endpoint and on-curve feedback at the real snap position', () => {
    const sketch = emptySketch()
    addEntity(sketch, { kind: 'line', a: [0, 0], b: [10, 0] })
    const end = snapSketchPoint(sketch, [10.2, 0.2], 0.5)
    expect(end.anchor).toEqual({ entity: 1, at: 'b' })
    expect(snapMark(end.kind!, end.point, 0.3)).toHaveLength(4)
    const curve = snapSketchPoint(sketch, [7, 0.2], 0.5)
    expect(curve.piece).toBe(1)
    expect(snapMark(curve.kind!, curve.point, 0.3)).toEqual([{ kind: 'circle', center: [7, 0], radius: 0.3, sigma: 0, usedPoints: 0 }])
    expect(snapSketchPoint(sketch, [10.2, 0.2], 0.5, { off: true }).kind).toBeNull()
  })
})
