// SPDX-License-Identifier: AGPL-3.0-only
// History rows' "-> Disable All Next" and "<- Enable To Here", End of Model's
// Place at Start, and files saved while only the CAD owner was rolled back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../../src/state/store'
import { useFlat } from '../../../src/state/flatStore'
import { useDeviation } from '../../../src/state/deviationStore'
import { useThickness } from '../../../src/state/thicknessStore'
import { clearHistory, configureHistory, historyAction, installHistory, registerHistory, undo, useHistory } from '../../../src/state/historyStore'
import { canDisableAllNext, documentHistoryToEnd, documentKeyRolled, endOfModelAfter, installDocumentOrder, placeEndOfModelAtStart, registerDocumentOrderProvider, useDocumentOrder } from '../../../src/state/documentOrderStore'
import { collectProject, emptySources, prepareProjectState } from '../../../src/app/project'
import { registerProjectSection } from '../../../src/app/projectSections'
import { scanLoaded } from '../../../src/app/scanEvents'
import { type SectionFrame } from '../../../src/core/section/frame'
import { useReverse } from '../state/reStore'
import { reverseSection } from '../app/projectSection'
import type { SketchFeature } from '../core/features'
import { reverseDocumentOrderProvider } from '../state/reDocumentOrder'

const XY: SectionFrame = { origin: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] }
const order = () => useDocumentOrder.getState()
const source = () => ({ ...emptySources(), scan: { name: 'part.stl', bytes: new Uint8Array([1, 2, 3]) } })
let stops: (() => void)[] = []

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  useFlat.setState(useFlat.getInitialState(), true)
  useDeviation.setState(useDeviation.getInitialState(), true)
  useThickness.setState(useThickness.getInitialState(), true)
  useReverse.setState(useReverse.getInitialState(), true)
  useDocumentOrder.setState(useDocumentOrder.getInitialState(), true)
  useHistory.setState({ restoring: false, importing: false })
  clearHistory()
  stops.push(configureHistory({}), installDocumentOrder(), registerProjectSection(reverseSection))
  stops.push(registerDocumentOrderProvider(reverseDocumentOrderProvider))
  stops.push(registerHistory({ sections: [{
    key: 'testReverse',
    capture: () => ({ features: useReverse.getState().features, rolledBack: useReverse.getState().rolledBack, nextFeatureId: useReverse.getState().nextFeatureId }),
    apply: (value) => useReverse.setState(value as Pick<ReturnType<typeof useReverse.getState>, 'features' | 'rolledBack' | 'nextFeatureId'>),
  }] }), installHistory())
})
afterEach(() => { for (const stop of stops.reverse()) stop(); stops = [] })

function loadScan() {
  useStore.getState().beginLoad('part.stl')
  useStore.getState().finishLoad(3, 1, 10, [0, 0, 0])
  scanLoaded({ positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]), modelSize: 10 })
}

function plane() {
  const s = useStore.getState()
  s.startDraft('plane')
  s.resolveDraft({ kind: 'plane', center: [0, 0, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 10, extentV: 10,
    sigma: 0, usedPoints: 3, regionSize: 3, region: new Uint32Array([0, 1, 2]) })
  const id = useStore.getState().commitDraft()!
  useStore.getState().cancelDraft()
  return id
}

function sketch(): number {
  const id = useReverse.getState().nextFeatureId
  const feature: SketchFeature = {
    id, name: `Sketch ${id}`, kind: 'sketch', visible: true, plane: { kind: 'fitted', frame: XY }, frame: XY,
    sketch: { entities: [{ id: 1, kind: 'line', a: [0, 0], b: [10, 0] }], constraints: [], nextId: 2 },
  }
  historyAction('create sketch fixture', () => useReverse.setState((s) => ({ features: [...s.features, feature], nextFeatureId: id + 1 })))
  return id
}

describe('History row boundary commands', () => {
  it('Disable All Next rolls back what follows and Enable To Here brings it back, each one undo step', async () => {
    loadScan()
    const a = plane(), b = sketch(), c = plane()
    const ka = `core:element:${a}`, kb = `reverse:feature:${b}`, kc = `core:element:${c}`
    expect(canDisableAllNext(ka)).toBe(true)
    expect(canDisableAllNext(kc)).toBe(false)
    expect(endOfModelAfter(ka)).toBe(true)
    expect(order().rollbackAt).toBe(2)
    expect(documentKeyRolled(kb)).toBe(true)
    expect(useReverse.getState().features).toEqual([])
    expect(useReverse.getState().rolledBack.map((f) => f.id)).toEqual([b])
    expect(useStore.getState().elements.map((e) => e.id)).toEqual([a])
    // A rolled-back row offers no Disable All Next; its Enable To Here does.
    expect(canDisableAllNext(kb)).toBe(false)
    expect(endOfModelAfter(kb)).toBe(true)
    expect(order().rollbackAt).toBe(3)
    expect(useReverse.getState().features.map((f) => f.id)).toEqual([b])
    expect(useStore.getState().elements.map((e) => e.id)).toEqual([a])
    expect(endOfModelAfter(kc)).toBe(true)
    expect(order().rollbackAt).toBeNull()
    expect(useStore.getState().elements.map((e) => e.id)).toEqual([a, c])
    await undo()
    expect(order().rollbackAt).toBe(3)
    await undo()
    expect(order().rollbackAt).toBe(2)
  })

  it('Place at Start keeps the scan alone', () => {
    loadScan(); plane(); sketch()
    expect(placeEndOfModelAtStart()).toBe(true)
    expect(order().rollbackAt).toBe(1)
    expect(useStore.getState().elements).toEqual([])
    expect(useReverse.getState().features).toEqual([])
    expect(documentHistoryToEnd()).toBe(true)
    expect(useStore.getState().elements).toHaveLength(1)
    expect(useReverse.getState().features).toHaveLength(1)
  })
})

describe('a file saved with only the CAD owner rolled back', () => {
  it('opens with End of Model where the CAD rollback stood', async () => {
    loadScan()
    plane(); const s1 = sketch(), s2 = sketch()
    const saved = collectProject(source(), null, 'test').manifest
    ;(saved.reverse as { rolledTo?: number }).rolledTo = 1
    useReverse.getState().reset()
    prepareProjectState(saved)()
    await Promise.resolve()
    expect(useReverse.getState().rolledBack.map((f) => f.id)).toEqual([s2])
    expect(order().rollbackAt).toBe(order().keys.indexOf(`reverse:feature:${s2}`))
    expect(documentKeyRolled(`reverse:feature:${s1}`)).toBe(false)
    expect(documentHistoryToEnd()).toBe(true)
    expect(useReverse.getState().features.map((f) => f.id)).toEqual([s1, s2])
  })

  it('leaves the marker at the end when core recipes follow, and End of Model still brings CAD forward', async () => {
    loadScan()
    const s1 = sketch(); plane()
    const saved = collectProject(source(), null, 'test').manifest
    ;(saved.reverse as { rolledTo?: number }).rolledTo = 0
    useReverse.getState().reset()
    prepareProjectState(saved)()
    await Promise.resolve()
    expect(useReverse.getState().rolledBack.map((f) => f.id)).toEqual([s1])
    expect(order().rollbackAt).toBeNull()
    expect(documentHistoryToEnd()).toBe(true)
    expect(useReverse.getState().features.map((f) => f.id)).toEqual([s1])
  })
})
