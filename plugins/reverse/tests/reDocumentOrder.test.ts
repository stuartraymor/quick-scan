// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore } from '../../../src/state/store'
import { useFlat } from '../../../src/state/flatStore'
import { useDeviation } from '../../../src/state/deviationStore'
import { useThickness } from '../../../src/state/thicknessStore'
import { clearHistory, configureHistory, historyAction, installHistory, redo, registerHistory, undo, useHistory } from '../../../src/state/historyStore'
import { documentHistoryStep, documentHistoryToEnd, installDocumentOrder, registerDocumentOrderProvider, setDocumentHistoryBoundary, useDocumentOrder } from '../../../src/state/documentOrderStore'
import { blankManifest, collectProject, emptySources, prepareProjectState } from '../../../src/app/project'
import { registerProjectSection } from '../../../src/app/projectSections'
import { scanLoaded } from '../../../src/app/scanEvents'
import { packProject, unpackProject } from '../../../src/core/project/archive'
import { frameKey, type SectionFrame } from '../../../src/core/section/frame'
import { useReverse } from '../state/reStore'
import { reverseSection } from '../app/projectSection'
import type { SketchFeature } from '../core/features'
import { reverseDocumentOrderProvider } from '../state/reDocumentOrder'
import { registerCommands, runCommand } from '../../../src/commands/registry'
import { elementCommands } from '../../../src/commands/core/element'
import { update as updateFeatureCommand } from '../app/reFeatureCommands'

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

function section() {
  const id = useStore.getState().nextId
  historyAction('create section fixture', () => useStore.setState((s) => ({
    sections: [...s.sections, { id, name: 'Section 1', color: '#ff8800', visible: true, frame: XY, ref: null, offset: 0, cutKey: frameKey(XY) }],
    nextId: id + 1,
  })))
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

describe('common model recipe order', () => {
  it('records core and CAD creation synchronously without namespace collisions', () => {
    loadScan()
    const a = plane(), b = sketch(), c = section(), d = plane()
    expect(order().keys).toEqual(['scan', `core:element:${a}`, `reverse:feature:${b}`, `core:section:${c}`, `core:element:${d}`])
    expect(order().migrated).toBe(false)
    expect(a).toBe(b)
    const before = order().keys
    useStore.getState().toggleElementVisible(a)
    useReverse.getState().toggleFeatureVisible(b)
    expect(order().keys).toBe(before)
  })

  it('restores cross-workspace positions on deletion, Undo and Redo', async () => {
    loadScan()
    const a = plane(), b = sketch()
    section()
    const before = [...order().keys]
    useStore.getState().removeElement(a)
    expect(order().keys).not.toContain(`core:element:${a}`)
    await undo()
    expect(order().keys).toEqual(before)
    await redo()
    expect(order().keys).toEqual(before.filter((key) => key !== `core:element:${a}`))
    historyAction('delete sketch', () => useReverse.getState().removeFeature(b))
    await undo()
    expect(order().keys).toContain(`reverse:feature:${b}`)
  })

  it('saves and reopens exact interleaving through the actual project ZIP format', async () => {
    loadScan(); plane(); sketch(); section(); plane()
    const expected = [...order().keys]
    const saved = collectProject(source(), null, 'test')
    const back = unpackProject(packProject(saved.manifest, saved.members))
    loadScan(); useReverse.getState().reset()
    prepareProjectState(back.manifest, back.members)()
    await Promise.resolve()
    expect(order().keys).toEqual(expected)
    expect(order().migrated).toBe(false)
    expect(useStore.getState().elements).toHaveLength(2)
    expect(useStore.getState().sections).toHaveLength(1)
    expect(useReverse.getState().features).toHaveLength(1)
  })

  it('marks deterministic legacy migration rather than inventing mixed chronology', async () => {
    loadScan(); plane(); sketch(); section()
    const saved = collectProject(source(), null, 'test').manifest
    delete saved.documentOrder
    prepareProjectState(saved)()
    await Promise.resolve()
    expect(order().keys).toEqual(['scan', 'core:element:1', 'core:section:2', 'reverse:feature:1'])
    expect(order().migrated).toBe(true)
    expect((collectProject(source(), null, 'test').manifest.documentOrder as { migrated: boolean }).migrated).toBe(true)
  })

  it('validates metadata before replacing live data and retains missing-plugin keys', async () => {
    loadScan(); plane()
    const saved = collectProject(source(), null, 'test').manifest
    saved.documentOrder = { version: 1, keys: ['scan', 'future:feature:9', 'core:element:1'] }
    prepareProjectState(saved)()
    await Promise.resolve()
    expect(order().keys).toEqual(['scan', 'future:feature:9', 'core:element:1'])
    const before = order().keys
    saved.documentOrder = { version: 1, keys: ['scan', 'scan'] }
    expect(() => prepareProjectState(saved)).toThrow('Malformed project: documentOrder')
    expect(order().keys).toBe(before)
    expect(useStore.getState().elements).toHaveLength(1)
  })

  it('keeps scanless CAD when its first scan is added and resets on replacement, even under the same filename', async () => {
    sketch()
    loadScan()
    expect(order().keys).toEqual(['scan', 'reverse:feature:1'])
    loadScan()
    // Mirrors the reverse workspace's loaded listener for a replaced scan.
    useReverse.getState().reset()
    expect(order().keys).toEqual(['scan'])
    sketch()
    useStore.setState({ fileName: null, elements: [], sections: [] })
    scanLoaded(null)
    useReverse.getState().reset()
    prepareProjectState(blankManifest('test'))()
    await Promise.resolve()
    expect(order().keys).toEqual([])
    expect(order().rollbackAt).toBeNull()
  })

  it('retains recipes across CAD rollback and preserves owner reorder among core slots', () => {
    loadScan(); plane(); sketch(); section(); sketch()
    const before = [...order().keys]
    useReverse.getState().rollTo(1)
    expect(order().keys).toEqual(before)
    useReverse.getState().rollTo(null)
    const all = useReverse.getState().features
    useReverse.setState({ features: [all[1], all[0]] })
    expect(order().keys).toEqual(['scan', 'core:element:1', 'reverse:feature:2', 'core:section:2', 'reverse:feature:1'])
  })
})

describe('real global model rollback', () => {
  it('refuses core and CAD modeling entrypoints before drafts or recipes can change', () => {
    loadScan(); plane(); sketch(); plane()
    expect(documentHistoryStep(-1)).toBe(true)
    const state = order(), active = useStore.getState().elements, features = useReverse.getState().features
    useStore.getState().startDraft('point')
    useStore.getState().editElement(1)
    useStore.getState().removeElement(1)
    expect(useStore.getState().commitDraft()).toBeNull()
    expect(useStore.getState().pickDraftPoint([1, 2, 3])).toBeNull()
    useStore.getState().startSection()
    expect(useReverse.getState().startSketchOn({ kind: 'world', axis: 'z', offset: 0 })).toBe(false)
    useReverse.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    useReverse.getState().editSketch(1)
    useReverse.getState().removeFeature(1)
    useReverse.getState().startFeature('surface')
    expect(useReverse.getState().commitSketch()).toBeNull()
    expect(useStore.getState().draft).toBeNull()
    expect(useStore.getState().sectionDraft).toBeNull()
    expect(useReverse.getState().sketchDraft).toBeNull()
    expect(useReverse.getState().featureDraft).toBeNull()
    expect(useStore.getState().elements).toBe(active)
    expect(useReverse.getState().features).toBe(features)
    expect(order().coreArchive).toBe(state.coreArchive)
    expect(order().keys).toBe(state.keys)
    expect(useStore.getState().errorText).toContain('Move End of Model')
    expect(documentHistoryToEnd()).toBe(true)
    useStore.getState().startDraft('point')
    expect(useStore.getState().draft?.kind).toBe('point')
    useStore.getState().cancelDraft()
  })

  it('rejects changing commands before their job runs, while read-only commands remain usable', async () => {
    loadScan(); plane(); plane(); documentHistoryStep(-1)
    let mutations = 0
    stops.push(registerCommands('rollback_safety', [
      { name: 'edit', title: 'Edit', description: 'test', input: { type: 'object', properties: {} }, run: async () => { mutations++; useStore.setState({ elements: [] }) } },
      { name: 'picture', title: 'Read', description: 'test', input: { type: 'object', properties: {} }, readOnly: true, run: async () => ({ count: useStore.getState().elements.length }) },
    ]))
    stops.push(registerCommands('element', elementCommands), registerCommands('reverse', [{ ...updateFeatureCommand, name: 'feature.update' }]))
    const archived = order().coreArchive
    await expect(runCommand('rollback_safety.edit')).rejects.toMatchObject({ code: 'invalid_state' })
    expect(mutations).toBe(0)
    expect(order().coreArchive).toBe(archived)
    expect(useStore.getState().elements).toHaveLength(1)
    await expect(runCommand('element.rename', { element: 1, name: 'Blocked rename' })).rejects.toMatchObject({ code: 'invalid_state' })
    await expect(runCommand('element.remove', { element: 1 })).rejects.toMatchObject({ code: 'invalid_state' })
    await expect(runCommand('reverse.feature.update', { feature: 1, set: { name: 'Blocked sketch' } })).rejects.toMatchObject({ code: 'invalid_state' })
    await expect(runCommand('rollback_safety.picture')).resolves.toEqual({ count: 1 })
    expect(documentHistoryToEnd()).toBe(true)
  })

  it('allows a command admitted at End to temporarily roll and restore its own insertion context', async () => {
    loadScan(); plane(); sketch(); plane()
    stops.push(registerCommands('rollback_safety', [{
      name: 'insert_context', title: 'Insertion context', description: 'test', input: { type: 'object', properties: {} },
      run: async () => {
        useReverse.getState().rollTo(0)
        expect(order().rollbackAt).toBe(2)
        useStore.getState().startDraft('point')
        expect(useStore.getState().draft?.kind).toBe('point')
        useStore.getState().cancelDraft()
        useReverse.getState().rollTo(null)
        return true
      },
    }]))
    await expect(runCommand('rollback_safety.insert_context')).resolves.toBe(true)
    expect(order().rollbackAt).toBeNull()
    expect(useStore.getState().elements).toHaveLength(2)
    expect(useReverse.getState().features).toHaveLength(1)
  })

  it('routes legacy CAD rollback through the common model boundary and permits view switches', () => {
    loadScan(); plane(); sketch(); plane()
    useReverse.getState().rollTo(0)
    expect(order().rollbackAt).toBe(2)
    expect(useStore.getState().elements).toHaveLength(1)
    expect(useReverse.getState().rolledBack).toHaveLength(1)
    useStore.getState().toggleElementVisible(1)
    useStore.getState().setNavScheme('quick-surface')
    useReverse.getState().setBodiesHidden(true)
    expect(useStore.getState().elements[0].visible).toBe(false)
    expect(useReverse.getState().bodiesHidden).toBe(true)
    useReverse.getState().rollTo(null)
    expect(order().rollbackAt).toBeNull()
    expect(useStore.getState().elements).toHaveLength(2)
    expect(useStore.getState().elements[0].visible).toBe(false)
    expect(useReverse.getState().features).toHaveLength(1)
  })

  it('removes future core recipes from the active store and restores them with Next', async () => {
    loadScan(); plane(); sketch(); const id = plane()
    useStore.setState({ dimensions: [{ id: 1, type: 'form-flatness', name: 'Flatness', refs: [id] }] })
    clearHistory()
    expect(documentHistoryStep(-1)).toBe(true)
    expect(order().rollbackAt).toBe(3)
    expect(useStore.getState().elements.map((e) => e.id)).toEqual([1])
    expect(useStore.getState().dimensions).toEqual([])
    expect(order().coreArchive!.elements).toHaveLength(2)
    expect(order().keys).toHaveLength(4)
    await undo()
    expect(order().rollbackAt).toBeNull()
    expect(useStore.getState().elements).toHaveLength(2)
    await redo()
    expect(order().rollbackAt).toBe(3)
    expect(useStore.getState().elements).toHaveLength(1)
    expect(documentHistoryStep(1)).toBe(true)
    expect(order().rollbackAt).toBeNull()
    expect(order().coreArchive).toBeNull()
    expect(useStore.getState().elements.map((e) => e.id)).toEqual([1, id])
    expect(useStore.getState().dimensions[0].refs).toEqual([id])
  })

  it('rolls CAD through its actual feature arrays and crosses core sections safely', () => {
    loadScan(); plane(); sketch(); section(); sketch()
    expect(setDocumentHistoryBoundary(2)).toBe(true)
    expect(useReverse.getState().features).toHaveLength(0)
    expect(useReverse.getState().rolledBack).toHaveLength(2)
    expect(useStore.getState().sections).toHaveLength(0)
    expect(documentHistoryStep(1)).toBe(true)
    expect(useReverse.getState().features).toHaveLength(1)
    expect(useStore.getState().sections).toHaveLength(0)
    expect(documentHistoryStep(1)).toBe(true)
    expect(useStore.getState().sections).toHaveLength(1)
    expect(documentHistoryToEnd()).toBe(true)
    expect(useReverse.getState().features).toHaveLength(2)
    expect(useReverse.getState().rolledBack).toHaveLength(0)
    expect(order().keys).toHaveLength(5)
  })

  it('keeps the marker and parked recipes through save, reopen and subsequent Next', async () => {
    loadScan(); plane(); sketch(); section(); plane()
    expect(setDocumentHistoryBoundary(2)).toBe(true)
    const expected = [...order().keys]
    const saved = collectProject(source(), null, 'test')
    const back = unpackProject(packProject(saved.manifest, saved.members))
    documentHistoryToEnd(); loadScan(); useReverse.getState().reset()
    prepareProjectState(back.manifest, back.members)()
    await Promise.resolve()
    expect(order().keys).toEqual(expected)
    expect(order().rollbackAt).toBe(2)
    expect(useStore.getState().elements).toHaveLength(1)
    expect(useStore.getState().sections).toHaveLength(0)
    expect(useReverse.getState().features).toHaveLength(0)
    expect(useReverse.getState().rolledBack).toHaveLength(1)
    expect(documentHistoryToEnd()).toBe(true)
    expect(useStore.getState().elements).toHaveLength(2)
    expect(useStore.getState().sections).toHaveLength(1)
    expect(useReverse.getState().features).toHaveLength(1)
  })

  it('supports scanless CAD rollback and refuses to remove the source scan', async () => {
    sketch(); sketch()
    expect(setDocumentHistoryBoundary(0)).toBe(true)
    const saved = collectProject(emptySources(), null, 'test')
    const back = unpackProject(packProject(saved.manifest, saved.members))
    prepareProjectState(back.manifest, back.members)()
    await Promise.resolve()
    expect(order().rollbackAt).toBe(0)
    expect(documentHistoryToEnd()).toBe(true)
    expect(useReverse.getState().features).toHaveLength(2)
    useReverse.getState().reset()
    loadScan()
    expect(documentHistoryStep(-1)).toBe(false)
    expect(order().rollbackAt).toBeNull()
  })

  it('blocks navigation during live editors and import, then allows Next/End again', () => {
    loadScan(); plane(); plane()
    useStore.getState().startSection()
    expect(documentHistoryStep(-1)).toBe(false)
    useStore.getState().cancelSection()
    useHistory.setState({ importing: true })
    expect(documentHistoryStep(-1)).toBe(false)
    useHistory.setState({ importing: false })
    expect(documentHistoryStep(-1)).toBe(true)
    expect(documentHistoryToEnd()).toBe(true)
  })
})

