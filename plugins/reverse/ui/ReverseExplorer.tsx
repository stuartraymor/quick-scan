// SPDX-License-Identifier: AGPL-3.0-only
// Plugin-owned tree rows use the CAD store's selection and visibility actions.
// Menus, rename, delete confirmation, isolation and the dependency card are
// the document browser's (src/state/explorerStore, src/ui/ExplorerMenu), so
// sketches, features and bodies behave as measured elements do.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { Icon } from '../../../src/ui/icons'
import { useShell } from '../../../src/state/shellStore'
import { useMeasureTool } from '../../../src/state/measureToolStore'
import { commandRunning, pluginBusy, useCommandActivity, watchSession } from '../../../src/commands/activity'
import { sessionBusy } from '../../../src/commands/host'
import { useStore } from '../../../src/state/store'
import { useDeviation } from '../../../src/state/deviationStore'
import { bodyMaker, builtOn, dependentsOf, type Feature } from '../core/features'
import { bodyColor, openFeatureEditor, reEditorOpen, selectionItems, useReverse } from '../state/reStore'
import { FEATURE_ICONS } from './featureReading'
import { KeyIcon } from './reIcons'
import { folderPathText } from './BodyList'
import { ExplorerCheckbox, ExplorerGroup } from '../../../src/ui/ExplorerVisibility'
import { historyAction } from '../../../src/state/historyStore'
import type { ExplorerCoreItem, ExplorerHistoryEntry, PluginRuntime } from '../../../src/plugins/api'
import { canDisableAllNext, endOfModelAfter, useDocumentOrder } from '../../../src/state/documentOrderStore'
import { hideAllBut, useExplorer } from '../../../src/state/explorerStore'
import { ExplorerMenu, ExplorerProperties, explorerMenuAt, pickColor, type ExplorerMenuAt, type ExplorerMenuItem, type PropertyRow } from '../../../src/ui/ExplorerMenu'
import { boundLength } from '../../../src/app/useUnits'
import { usePrefs } from '../../../src/state/prefsStore'

const treeWorking = () => Boolean(sessionBusy()) || commandRunning()
// Imports also own a non-store lifetime token. Read that at action time;
// reactive disabled states use the stores registered by each plugin.
const observedTreeWorking = () => Boolean(pluginBusy()) || commandRunning()
const subscribeTreeWork = (listener: () => void) => watchSession(listener, [useStore, useReverse, useShell, useDeviation, useCommandActivity])
const coreDialogOpen = () => {
  const state = useStore.getState()
  return Boolean(state.draft || state.sectionDraft || state.dimDraft || state.alignDraft || useShell.getState().extractOpen)
}

function useExplorerLocked() {
  const busy = useStore((s) => s.busy)
  const picking = useDeviation((s) => s.picking)
  const state = useReverse()
  const coreEditor = useStore(s => Boolean(s.draft || s.sectionDraft || s.dimDraft || s.alignDraft))
  const extracting = useShell(s => s.extractOpen)
  const sessionWorking = useSyncExternalStore(subscribeTreeWork, observedTreeWorking, () => false)
  const working = sessionWorking || busy || picking || coreEditor || extracting || state.building || state.playback !== null
  const editing = reEditorOpen(state)
  return { state, locked: working || editing, visibilityLocked: working || (editing && !state.sketchDraft) }
}

function objectsLockedNow(): boolean {
  const state = useReverse.getState()
  return treeWorking() || coreDialogOpen() || useStore.getState().busy || useDeviation.getState().picking || state.building || state.playback !== null || reEditorOpen(state)
}
const rolledNow = () => useDocumentOrder.getState().rollbackAt !== null
const featureKey = (id: number) => `reverse:feature:${id}`

function setSketchVisibility(ids: readonly number[], on: boolean): void {
  if (objectsLockedNow() && !canInspectReferences()) return
  historyAction(`${on ? 'show' : 'hide'} sketches`, () => {
    const state = useReverse.getState()
    for (const f of state.features) if (f.kind === 'sketch' && ids.includes(f.id) && f.visible !== on) state.toggleFeatureVisible(f.id)
  })
}

/** Reference display and selection remain available while drawing or measuring. */
function canInspectReferences(): boolean {
  const state = useReverse.getState()
  const inspecting = Boolean(state.sketchDraft) || (useMeasureTool.getState().open && !reEditorOpen(state))
  return inspecting && !treeWorking() && !coreDialogOpen() && !useStore.getState().busy &&
    !useDeviation.getState().picking && !state.building && state.playback === null
}

function setBodyVisibility(ids: readonly number[], on: boolean): void {
  if (!ids.length || (objectsLockedNow() && !canInspectReferences())) return
  historyAction(`${on ? 'show' : 'hide'} bodies`, () => {
    const state = useReverse.getState()
    if (on) {
      state.setBodiesHidden(false)
      if (state.sketchDraft && !state.sketchModelShown) {
        state.setSketchModelShown(true)
        state.setSketchSliced(false)
      }
    }
    state.setBodiesVisible(ids, on)
  })
}

/** Bodies a feature made that stand in the built model now. */
function outputBodies(feature: Feature): number[] {
  const state = useReverse.getState()
  const resultIds = state.results[feature.id]?.bodies ?? []
  return state.bodies.filter(body => resultIds.includes(body.id) || bodyMaker(body.id) === feature.id).map(body => body.id)
}

/** The sketch an extrude or revolve is drawn from, for "Edit Sketch ...". */
function sketchOf(feature: Feature | undefined): number | null {
  if (!feature) return null
  const id = (feature as { sketchId?: unknown }).sketchId
  return typeof id === 'number' ? id : null
}

/** Public document-browser contribution, with the plugin owning its masks. */
export function useReverseExplorerVisibility(): NonNullable<PluginRuntime['explorerVisibility']> {
  const { state, locked } = useExplorerLocked()
  const sketches = state.features.filter(f => f.kind === 'sketch')
  return {
    values: [...sketches.map(f => f.visible), ...state.bodies.map(body => body.visible && !state.bodiesHidden)],
    disabled: locked,
    setVisible: on => {
      if (objectsLockedNow()) return
      historyAction(`${on ? 'show' : 'hide'} CAD objects`, () => {
        const current = useReverse.getState()
        setSketchVisibility(current.features.filter(f => f.kind === 'sketch').map(f => f.id), on)
        setBodyVisibility(current.bodies.map(body => body.id), on)
      })
    },
  }
}

// Selection belongs to the document browser, not to the editor draft. Both
// tree representations select the same feature without opening it on a click.
const useTreeSelection = create<{ id: number | null }>(() => ({ id: null }))

function editFromTree(id: number) {
  if (treeWorking() || coreDialogOpen() || rolledNow()) return
  useShell.getState().setWorkspace('reverse')
  openFeatureEditor(id)
}

function startFromSketch(kind: 'extrude' | 'revolve', id: number) {
  if (objectsLockedNow() || rolledNow()) return
  useShell.getState().setWorkspace('reverse')
  const state = useReverse.getState()
  if (kind === 'extrude') state.startExtrude(id)
  else state.startRevolve(id)
}

function featureLabel(id: number): string {
  const state = useReverse.getState()
  return [...state.features, ...state.rolledBack].find(f => f.id === id)?.name ?? `Feature ${id}`
}

/** Feature Properties: what it is, what it is built on and what builds on
 *  it, how its build went and what it made. */
function featureProperties(feature: Feature, parents: readonly string[], labelOf: (key: string) => string): PropertyRow[] {
  const state = useReverse.getState()
  const all = [...state.features, ...state.rolledBack]
  const result = state.results[feature.id]
  const rolled = state.rolledBack.some(f => f.id === feature.id)
  const made = outputBodies(feature)
  const rows: (PropertyRow | false)[] = [
    ['Name', feature.name], ['Type', feature.kind.replace(/^./, c => c.toUpperCase())],
    ['Built on', parents.length ? parents.map(labelOf).join(', ') : '—'],
    ['Used by', dependentsOf(feature.id, all).map(f => f.name).join(', ') || '—'],
    ['Status', rolled ? 'Rolled back (below End of Model)' : feature.suppressed ? 'Suppressed' : result?.status === 'failed' ? `Failed: ${result.message ?? 'no reason given'}` : result ? 'Built' : 'Not built yet'],
    made.length > 0 && ['Bodies', made.map(id => state.bodies.find(b => b.id === id)?.name ?? `#${id}`).join(', ')],
    feature.kind === 'sketch' && ['Shown', feature.visible ? 'Yes' : 'No'],
  ]
  return rows.filter(Boolean) as PropertyRow[]
}

function bodyProperties(id: number): PropertyRow[] {
  const state = useReverse.getState()
  const body = state.bodies.find(b => b.id === id)
  if (!body) return []
  const len = boundLength(usePrefs.getState().units)
  const folder = state.bodyFolders.find(f => f.bodies.includes(id))
  const rows: (PropertyRow | false)[] = [
    ['Name', body.name], ['Type', body.surface ? 'Surface body' : 'Solid body'], ['Made by', featureLabel(bodyMaker(id))],
    folder !== undefined && ['Component', folderPathText(state.bodyFolders, folder.id)],
    ['Color', body.color ?? bodyColor(id)], ['Faces', body.faces.toLocaleString('en-US')], ['Triangles', body.triangles.toLocaleString('en-US')],
    !body.surface && ['Volume', body.closed ? len.vol(body.volume) : 'Open shell — no volume'],
    body.box !== undefined && ['X', len.fmt(body.box.max[0] - body.box.min[0], 3)],
    body.box !== undefined && ['Y', len.fmt(body.box.max[1] - body.box.min[1], 3)],
    body.box !== undefined && ['Z', len.fmt(body.box.max[2] - body.box.min[2], 3)],
    ['Shown', body.visible && !state.bodiesHidden ? 'Yes' : 'No'],
  ]
  return rows.filter(Boolean) as PropertyRow[]
}

/** "-> Disable All Next" / "<- Enable To Here" for a History row. */
function boundaryItems(key: string, locked: boolean): ExplorerMenuItem[] {
  const s = useDocumentOrder.getState()
  const at = s.keys.indexOf(key)
  const rolled = s.rollbackAt !== null && at >= s.rollbackAt
  if (rolled) return [{ label: '<- Enable To Here', testId: 'explorer-enable-to-here', disabled: locked, onSelect: () => { if (!objectsLockedNow()) endOfModelAfter(key) } }]
  return canDisableAllNext(key) ? [{ label: '-> Disable All Next', testId: 'explorer-disable-all-next', disabled: locked, onSelect: () => { if (!objectsLockedNow()) endOfModelAfter(key) } }] : []
}

function InlineRename({ value, label, onDone }: { value: string; label: string; onDone: (text: string | null) => void }) {
  const [text, setText] = useState(value)
  let done = false
  const finish = (commit: boolean) => { if (done) return; done = true; onDone(commit ? text : null) }
  return <input className="explorer-rename-inline" data-test="explorer-rename-input" aria-label={`Rename ${label}`} autoFocus value={text}
    onFocus={event => event.currentTarget.select()}
    onChange={event => setText(event.target.value)}
    onBlur={() => finish(true)}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Enter') { event.preventDefault(); finish(true) }
      if (event.key === 'Escape') { event.preventDefault(); finish(false) }
    }} />
}

function renameFeature(id: number, text: string | null) {
  useExplorer.getState().setRenaming(null)
  if (text === null || objectsLockedNow()) return
  const clean = text.trim()
  if (!clean) return
  if (!useReverse.getState().renameFeature(id, clean)) {
    const taken = [...useReverse.getState().features, ...useReverse.getState().rolledBack].some(f => f.id !== id && f.name === clean)
    useStore.getState().setError(taken ? `Another feature is already called ${clean}.` : `${featureLabel(id)} could not be renamed.`)
  }
}

function renameBody(id: number, text: string | null) {
  useExplorer.getState().setRenaming(null)
  if (text === null || objectsLockedNow()) return
  const clean = text.trim()
  const state = useReverse.getState()
  const body = state.bodies.find(b => b.id === id)
  if (!body || !clean || clean === body.name) return
  // Body names identify bodies to the agent (reverse.body.set refuses a
  // second body of the same name); the tree keeps to the same rule.
  if (state.bodies.some(b => b.id !== id && b.name === clean)) { useStore.getState().setError(`Another body is already called ${clean}.`); return }
  historyAction('Rename body', () => state.setBodyStyle(id, { name: clean }))
}

function recolorBodies(ids: readonly number[]) {
  const state = useReverse.getState()
  const first = state.bodies.find(b => ids.includes(b.id))
  pickColor(first?.color ?? (first ? bodyColor(first.id) : null), hex => {
    if (objectsLockedNow()) return
    historyAction('Change color', () => { for (const id of ids) useReverse.getState().setBodyStyle(id, { color: hex }) })
  })
}

function FeatureTreeRow({ feature, locked, rolled = false, location, outputs = [], outputValues = [], parents = [], labelOf }: { feature: Feature; locked: boolean; rolled?: boolean; location: 'object' | 'history'; outputs?: readonly number[]; outputValues?: readonly boolean[]; parents?: readonly string[]; labelOf: (key: string) => string }) {
  const measuring=useMeasureTool(s=>s.open)
  const drafting = useReverse(s => Boolean(s.sketchDraft))
  const presentationLocked = locked && !((measuring || drafting) && canInspectReferences() && (feature.kind === 'sketch' || outputs.length > 0))
  const selected = useTreeSelection(s => s.id === feature.id)
  const rolledDocument = useDocumentOrder(s => s.rollbackAt !== null)
  const renameKey = `${featureKey(feature.id)}@${location}`
  const renaming = useExplorer(s => s.renaming === renameKey)
  const failed = useReverse(s => s.results[feature.id]?.status === 'failed' ? s.results[feature.id]?.message ?? 'The feature failed to build.' : null)
  const [menu, setMenu] = useState<ExplorerMenuAt | null>(null)
  const [properties, setProperties] = useState<PropertyRow[] | null>(null)
  const key = featureKey(feature.id)
  const sketch = feature.kind === 'sketch'
  const shown = sketch ? feature.visible && !rolled : outputValues.length > 0 && outputValues.every(Boolean)
  const editSketch = sketchOf(feature)
  const select = () => {
    if (!rolled && canInspectReferences()) {
      if (sketch && !feature.visible) setSketchVisibility([feature.id], true)
      if (!sketch && outputValues.some(value => !value)) setBodyVisibility(outputs, true)
    }
    useTreeSelection.setState({ id: feature.id })
    useExplorer.getState().setFocus(key)
  }
  const edit = () => {
    setMenu(null)
    if (!locked && !rolled && !feature.suppressed) editFromTree(feature.id)
  }
  const requestDelete = () => {
    setMenu(null)
    if (locked || treeWorking() || coreDialogOpen()) return
    select()
    useExplorer.getState().requestDelete([key])
  }
  const startRename = () => { if (!locked) { select(); useExplorer.getState().setRenaming(renameKey) } }
  const setShown = (on: boolean) => sketch ? setSketchVisibility([feature.id], on) : setBodyVisibility(outputs, on)
  const items: (ExplorerMenuItem | false)[] = [
    { label: 'Edit ...', testId: 'explorer-feature-edit', disabled: rolled || feature.suppressed || rolledDocument, onSelect: edit },
    editSketch !== null && { label: 'Edit Sketch ...', testId: 'explorer-feature-edit-sketch', disabled: rolledDocument, onSelect: () => editFromTree(editSketch) },
    { label: 'Hide All But This', testId: 'explorer-hide-all-but', disabled: rolled || (!sketch && outputs.length === 0), onSelect: () => hideAllBut(() => setShown(true)) },
    { label: shown ? 'Hide' : 'Show', testId: 'explorer-feature-visibility', disabled: rolled || (!sketch && outputs.length === 0), onSelect: () => setShown(!shown) },
    sketch && 'separator',
    sketch && { label: 'Extrude ...', testId: 'explorer-sketch-extrude', disabled: rolled || rolledDocument, onSelect: () => startFromSketch('extrude', feature.id) },
    sketch && { label: 'Revolve ...', testId: 'explorer-sketch-revolve', disabled: rolled || rolledDocument, onSelect: () => startFromSketch('revolve', feature.id) },
    'separator',
    { label: 'Rename ...', shortcut: 'F2', testId: 'explorer-feature-rename', onSelect: startRename },
    sketch && { label: 'Duplicate', testId: 'explorer-sketch-duplicate', disabled: rolled || rolledDocument, onSelect: () => {
      setMenu(null)
      if (locked || objectsLockedNow() || rolledNow()) return
      let made: number | null = null
      historyAction('Duplicate sketch', () => { made = useReverse.getState().duplicateSketch(feature.id) })
      if (made !== null) { useTreeSelection.setState({ id: made }); useExplorer.getState().setFocus(featureKey(made)) }
    } },
    ...(location === 'history' ? boundaryItems(key, locked) : []),
    'separator',
    { label: 'Delete ...', danger: true, testId: 'explorer-delete', disabled: rolledDocument, onSelect: requestDelete },
    { label: 'Properties ...', testId: 'explorer-feature-properties', onSelect: () => setProperties(featureProperties(feature, parents, labelOf)) },
  ]
  return <div className={`explorer-row${selected ? ' selected' : ''}${rolled ? ' is-rolled' : ''}${failed ? ' is-failed' : ''}`} data-test={`explorer-${location}-row-${feature.id}`}
    onKeyDown={event => {
      if (renaming) return
      if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); startRename(); return }
      if (event.key !== 'Delete' || locked) return
      event.preventDefault()
      event.stopPropagation()
      requestDelete()
    }}
    onContextMenu={event => {
      event.preventDefault()
      if (locked) return
      select()
      setMenu(explorerMenuAt(event, 13))
    }}>
    {sketch && <ExplorerCheckbox values={[feature.visible && !rolled]} label={`${feature.name} visibility`} disabled={presentationLocked || rolled} onSet={on => setSketchVisibility([feature.id], on)} />}
    {!sketch && location === 'history' && <ExplorerCheckbox values={outputValues} label={`${feature.name} output visibility`} disabled={presentationLocked || rolled} onSet={on => setBodyVisibility(outputs, on)} />}
    {renaming ? <InlineRename value={feature.name} label={feature.name} onDone={text => renameFeature(feature.id, text)} /> : <button type="button" className="explorer-item" disabled={presentationLocked} data-test={`explorer-${location}-feature-${feature.id}`}
      aria-pressed={selected} onClick={select} onDoubleClick={edit}
      title={rolled ? 'Below End of Model. Right-click → Enable To Here to bring it back.' : failed ? `${feature.name} failed: ${failed}` : `${feature.name} · right-click for actions, double-click to edit, F2 to rename`}>
      <span className="explorer-icon"><KeyIcon name={FEATURE_ICONS[feature.kind]} size={16} /></span>
      <span>{feature.name}</span>{failed && <span className="explorer-failed" aria-label="Failed" data-test="explorer-feature-failed">⚠</span>}<small>{rolled ? 'rolled back' : feature.suppressed ? 'suppressed' : feature.kind}</small>
    </button>}
    {menu && !locked && <ExplorerMenu at={menu} head={feature.name} items={items} onClose={() => setMenu(null)} testId="explorer-feature-menu" />}
    {properties && <ExplorerProperties title={feature.name} rows={properties} onClose={() => setProperties(null)} />}
  </div>
}

type BodyMenu = { at: ExplorerMenuAt; kind: 'body' } | { at: ExplorerMenuAt; kind: 'group'; label: 'Surfaces' | 'Solids'; ids: number[] } | { at: ExplorerMenuAt; kind: 'sketches' }

export function ReverseObjects() {
  const { state, locked, visibilityLocked } = useExplorerLocked()
  const fileName = useStore(s => s.fileName)
  const rolledDocument = useDocumentOrder(s => s.rollbackAt !== null)
  const renaming = useExplorer(s => s.renaming)
  const [menu, setMenu] = useState<BodyMenu | null>(null)
  const [properties, setProperties] = useState<{ title: string; rows: PropertyRow[] } | null>(null)
  useEffect(() => { setMenu(null) }, [fileName, locked])
  useEffect(() => { useTreeSelection.setState({ id: null }) }, [fileName])
  useEffect(() => {
    const id = useTreeSelection.getState().id
    if (id !== null && ![...state.features, ...state.rolledBack].some(f => f.id === id)) useTreeSelection.setState({ id: null })
  }, [state.features, state.rolledBack])
  const picked = state.listSelection.bodies
  // A face, edge or corner clicked on a body in the view picks that body's
  // row, its feature's History row and the dependency card, as a click on
  // the part does in QUICKSURFACE. The list's own pick is left alone: the
  // view's click has already let it go.
  const viewBodies = [...new Set(selectionItems(state.selection).map(item => item.bodyId))]
  const viewKey = viewBodies.join(',')
  useEffect(() => {
    if (viewBodies.length === 0) return
    const maker = bodyMaker(viewBodies[0])
    useTreeSelection.setState({ id: maker })
    useExplorer.getState().setFocus(featureKey(maker))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey])
  const rowPicked = (id: number) => picked.includes(id) || viewBodies.includes(id)
  const mergeIds = [...new Set(picked.map(bodyMaker))]
  const canMerge = mergeIds.length >= 2 && mergeIds.length === picked.length && picked.every(id => state.bodies.some(body => body.id === id))
    && mergeIds.every(id => state.features.some(feature => feature.id === id && feature.kind === 'freeform' && !feature.suppressed))
  const merge = () => {
    if (objectsLockedNow() || rolledNow()) return
    const current = useReverse.getState()
    try { current.mergeFreeforms(current.listSelection.bodies.map(bodyMaker)) }
    catch (error) { useStore.getState().setError(error instanceof Error ? error.message : String(error)) }
  }
  const labelOf = (key: string) => { const m = /^reverse:feature:(\d+)$/.exec(key); return m ? featureLabel(Number(m[1])) : key }
  const deleteBodies = (ids: readonly number[]) => {
    if (locked || treeWorking() || coreDialogOpen()) return
    useExplorer.getState().requestDelete([...new Set(ids.map(id => featureKey(bodyMaker(id))))])
  }
  const bodyItems = (): (ExplorerMenuItem | false | undefined)[] => {
    const one = picked.length === 1 ? state.bodies.find(b => b.id === picked[0]) : undefined
    const maker = one ? [...state.features, ...state.rolledBack].find(f => f.id === bodyMaker(one.id)) : undefined
    const editSketch = sketchOf(maker)
    const shown = picked.every(id => state.bodies.find(b => b.id === id)?.visible) && !state.bodiesHidden
    return [
      one && { label: 'Edit ...', testId: 'explorer-body-edit', disabled: rolledDocument || !maker || maker.suppressed, onSelect: () => editFromTree(bodyMaker(one.id)) },
      one && editSketch !== null && { label: 'Edit Sketch ...', testId: 'explorer-body-edit-sketch', disabled: rolledDocument, onSelect: () => editFromTree(editSketch) },
      { label: 'Hide All But This', testId: 'explorer-hide-all-but', onSelect: () => hideAllBut(() => setBodyVisibility(picked, true), picked.length > 1 ? 'Hide all but these' : 'Hide all but this') },
      { label: shown ? 'Hide' : 'Show', testId: 'explorer-body-visibility', onSelect: () => setBodyVisibility(picked, !shown) },
      'separator',
      { label: 'Color ...', testId: 'explorer-body-color', onSelect: () => recolorBodies(picked) },
      { label: 'Set Default Color', testId: 'explorer-body-default-color', disabled: !picked.some(id => state.bodyStyles[id]?.color), onSelect: () => { if (!objectsLockedNow()) historyAction('Set default color', () => { for (const id of picked) useReverse.getState().setBodyStyle(id, { color: null }) }) } },
      { label: 'Transparent', testId: 'explorer-body-transparent', checked: picked.length > 0 && picked.every(id => state.bodyStyles[id]?.transparent), title: picked.length > 1 ? 'See through these bodies' : 'See through this body', onSelect: () => {
        if (objectsLockedNow()) return
        const on = !picked.every(id => useReverse.getState().bodyStyles[id]?.transparent)
        historyAction(on ? 'Transparent' : 'Opaque', () => { for (const id of picked) useReverse.getState().setBodyStyle(id, { transparent: on || null }) })
      } },
      'separator',
      one && { label: 'Rename ...', shortcut: 'F2', testId: 'explorer-body-rename', onSelect: () => useExplorer.getState().setRenaming(`reverse:body:${one.id}`) },
      picked.length > 1 && { label: 'Merge', testId: 'explorer-merge-freeform', disabled: !canMerge || rolledDocument, title: 'Combine selected Freeform objects into one editable control mesh', onSelect: merge },
      'separator',
      { label: 'Delete ...', danger: true, testId: 'explorer-body-delete', disabled: rolledDocument, onSelect: () => deleteBodies(picked) },
      one && { label: 'Properties ...', testId: 'explorer-body-properties', onSelect: () => setProperties({ title: one.name, rows: bodyProperties(one.id) }) },
    ]
  }
  const groupItems = (label: string, ids: number[]): ExplorerMenuItem[] => [
    { label: 'Show All', testId: 'explorer-group-show', onSelect: () => setBodyVisibility(ids, true) },
    { label: 'Hide All', testId: 'explorer-group-hide', onSelect: () => setBodyVisibility(ids, false) },
    'separator',
    { label: 'Color ...', testId: 'explorer-group-color', onSelect: () => recolorBodies(ids) },
    { label: 'Set Default Color', testId: 'explorer-group-default-color', disabled: !ids.some(id => state.bodyStyles[id]?.color), onSelect: () => { if (!objectsLockedNow()) historyAction('Set default color', () => { for (const id of ids) useReverse.getState().setBodyStyle(id, { color: null }) }) } },
    { label: 'Transparent', testId: 'explorer-group-transparent', checked: state.bodiesSeeThrough, title: 'See through every CAD body', onSelect: () => useReverse.getState().setBodiesSeeThrough(!useReverse.getState().bodiesSeeThrough) },
    'separator',
    { label: 'Delete ...', danger: true, testId: 'explorer-group-delete', disabled: rolledDocument || ids.length === 0, title: `Delete every body in ${label} (the features that make them)`, onSelect: () => deleteBodies(ids) },
  ]
  const sketches = state.features.filter(f => f.kind === 'sketch')
  const partShown = !state.bodiesHidden && (!state.sketchDraft || state.sketchModelShown)
  const pickBody = (id: number, index: number, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (canInspectReferences() && (!state.bodies[index].visible || !partShown)) setBodyVisibility([id], true)
    let next = [id]
    const now = useReverse.getState().listSelection.bodies
    if (event.ctrlKey || event.metaKey) next = now.includes(id) ? now.filter((b) => b !== id) : [...now, id]
    else if (event.shiftKey && now.length > 0) {
      const anchor = state.bodies.findIndex((b) => b.id === now[now.length - 1])
      if (anchor >= 0) next = state.bodies.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((b) => b.id)
    }
    state.setListSelection({ bodies: next, folders: [] })
    useExplorer.getState().setFocus(featureKey(bodyMaker(id)))
  }
  return <>
  {(['Surfaces', 'Solids'] as const).map(label => { const bodies = state.bodies.filter(body => Boolean(body.surface) === (label === 'Surfaces')); return <ExplorerGroup key={label} label={label} values={bodies.map(body => body.visible && partShown)} disabled={visibilityLocked} onSet={on => setBodyVisibility(bodies.map(body => body.id), on)} testId={`explorer-${label.toLowerCase()}`}
    onContextMenu={event => { if (!locked) setMenu({ kind: 'group', at: explorerMenuAt(event, 7), label, ids: bodies.map(b => b.id) }) }}>
      {bodies.map(body => {
        const index = state.bodies.findIndex(item => item.id === body.id)
        const folder = state.bodyFolders.find((f) => f.bodies.includes(body.id))
        const location = folder ? folderPathText(state.bodyFolders, folder.id) : ''
        return <div key={body.id} className={`explorer-row${rowPicked(body.id) ? ' selected' : ''}`} data-test={`explorer-body-row-${body.id}`}
          onContextMenu={event => {
            event.preventDefault()
            if (locked) return
            // Opening actions for one of the selected objects retains the group.
            if (!picked.includes(body.id)) state.setListSelection({ bodies: [body.id], folders: [] })
            useExplorer.getState().setFocus(featureKey(bodyMaker(body.id)))
            setMenu({ kind: 'body', at: explorerMenuAt(event, 13) })
          }}
          onKeyDown={event => {
            if (renaming) return
            const now = useReverse.getState().listSelection.bodies
            if (event.key === 'F2' && !locked && now.length === 1) { event.preventDefault(); event.stopPropagation(); useExplorer.getState().setRenaming(`reverse:body:${now[0]}`) }
            if (event.key === 'Delete' && !locked && now.length > 0) { event.preventDefault(); event.stopPropagation(); deleteBodies(now) }
          }}
          onMouseEnter={() => state.setBodyHover({ ids: [body.id], from: 'list' })}
          onMouseLeave={() => { if (useReverse.getState().bodyHover?.from === 'list') useReverse.getState().setBodyHover(null) }}>
          <ExplorerCheckbox values={[body.visible && partShown]} label={`${body.name} visibility`} disabled={visibilityLocked} onSet={on => setBodyVisibility([body.id], on)} />
          {renaming === `reverse:body:${body.id}` ? <InlineRename value={body.name} label={body.name} onDone={text => renameBody(body.id, text)} /> : <button type="button" className="explorer-item" disabled={visibilityLocked} data-test={`explorer-body-${body.id}`} aria-pressed={rowPicked(body.id)}
            title={`${location ? `${location} / ` : ''}${body.name} · ${body.surface ? 'surface' : 'solid'} · click to select, right-click for actions, double-click to edit its feature, F2 to rename`}
            onClick={(event) => pickBody(body.id, index, event)}
            onDoubleClick={() => { if (!locked) editFromTree(bodyMaker(body.id)) }}>
            <span className="explorer-icon" style={{ color: body.color ?? bodyColor(body.id) }}><Icon name={body.surface ? 'sheet' : 'model'} size={16} /></span>
            <span>{body.name}</span><small>{body.surface ? 'surface' : 'solid'}</small>
          </button>}
        </div>
      })}
  </ExplorerGroup> })}
  <ExplorerGroup label="Sketches" values={sketches.map(f => f.visible)} disabled={visibilityLocked} onSet={on => setSketchVisibility(sketches.map(f => f.id), on)} testId="explorer-sketches"
    onContextMenu={event => { if (!locked) setMenu({ kind: 'sketches', at: explorerMenuAt(event, 2) }) }}>
      {sketches.map(feature => <FeatureTreeRow key={feature.id} feature={feature} locked={locked} location="object" parents={[...builtOn(feature).map(featureKey)]} labelOf={labelOf} />)}
  </ExplorerGroup>
  {menu && !locked && menu.kind === 'body' && picked.length > 0 && <ExplorerMenu at={menu.at} head={picked.length === 1 ? state.bodies.find(b => b.id === picked[0])?.name : `${picked.length} objects`} items={bodyItems()} onClose={() => setMenu(null)} testId="explorer-body-menu" />}
  {menu && !locked && menu.kind === 'group' && <ExplorerMenu at={menu.at} head={menu.label} items={groupItems(menu.label, menu.ids)} onClose={() => setMenu(null)} testId="explorer-group-menu" />}
  {menu && !locked && menu.kind === 'sketches' && <ExplorerMenu at={menu.at} head="Sketches" onClose={() => setMenu(null)} testId="explorer-group-menu" items={[
    { label: 'Show All', testId: 'explorer-group-show', onSelect: () => setSketchVisibility(sketches.map(f => f.id), true) },
    { label: 'Hide All', testId: 'explorer-group-hide', onSelect: () => setSketchVisibility(sketches.map(f => f.id), false) },
  ]} />}
  {properties && <ExplorerProperties title={properties.title} rows={properties.rows} onClose={() => setProperties(null)} />}
  </>
}

/** Core references a feature is built on (planes, axes, sections, extracted elements). */
function coreParents(feature: Feature): string[] {
  const parents = new Set<string>()
  // Core references use a distinct namespace; numeric CAD body IDs must
  // never be mistaken for measured element IDs.
  const coreRefs = (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(coreRefs); return }
    const ref = value as Record<string, unknown>
    if (typeof ref.id === 'number') {
      if (ref.kind === 'plane' || ref.kind === 'element') parents.add(`core:element:${ref.id}`)
      if (ref.kind === 'section') parents.add(`core:section:${ref.id}`)
    }
    Object.values(ref).forEach(coreRefs)
  }
  coreRefs(feature)
  if (feature.kind === 'extract') {
    if (feature.element !== undefined) parents.add(`core:element:${feature.element}`)
    if (feature.section !== undefined) parents.add(`core:section:${feature.section}`)
  }
  return [...parents]
}

export function useReverseExplorerHistoryEntries(): NonNullable<PluginRuntime['explorerHistoryEntries']> {
  const { state, locked } = useExplorerLocked()
  const all = [...state.features, ...state.rolledBack]
  const labels = new Map(all.map(f => [featureKey(f.id), f.name]))
  const labelOf = (key: string) => labels.get(key) ?? useStore.getState().elements.find(e => `core:element:${e.id}` === key)?.name ?? useStore.getState().sections.find(s => `core:section:${s.id}` === key)?.name ?? 'Unavailable reference'
  return all.map((feature, index): ExplorerHistoryEntry => {
    // Only bodies still present in the built document are displayable. A
    // consumed/failed/rolled-back output must never toggle suppression.
    const resultIds = state.results[feature.id]?.bodies ?? []
    const bodies = state.bodies.filter(body => resultIds.includes(body.id) || bodyMaker(body.id) === feature.id)
    const parents = [...new Set([...builtOn(feature).map(featureKey), ...coreParents(feature)])]
    const sketch = feature.kind === 'sketch'
    return {
      key: featureKey(feature.id), label: feature.name, parents,
      node: <FeatureTreeRow feature={feature} locked={locked} rolled={index >= state.features.length} location="history" outputs={bodies.map(body => body.id)} outputValues={bodies.map(body => body.visible && !state.bodiesHidden && (!state.sketchDraft || state.sketchModelShown))} parents={parents} labelOf={labelOf} />,
      // Dependents go first (the browser removes in reverse order), so the
      // store's own "built on by a later feature" refusal never fires here.
      remove: () => { if ([...useReverse.getState().features, ...useReverse.getState().rolledBack].some(f => f.id === feature.id)) useReverse.getState().removeFeature(feature.id) },
      setVisible: on => sketch ? setSketchVisibility([feature.id], on) : setBodyVisibility(outputBodies(feature), on),
    }
  })
}

/** What the CAD workspace adds to a core row's menu: "2D Sketch" on a datum
 *  plane (QUICKSURFACE's plane menu), which opens a sketch on it. */
export function reverseCoreItems(key: string): ExplorerCoreItem[] {
  const m = /^core:element:(\d+)$/.exec(key)
  if (!m) return []
  const id = Number(m[1])
  const el = useStore.getState().elements.find(e => e.id === id)
  if (!el || el.kind !== 'plane' || !el.fit) return []
  return [{
    label: '2D Sketch', testId: 'explorer-core-sketch', title: `Start a CAD sketch on ${el.name}`,
    onSelect: () => {
      if (objectsLockedNow() || rolledNow()) return
      useShell.getState().setWorkspace('reverse')
      if (!useReverse.getState().startSketchOn({ kind: 'plane', id })) useStore.getState().setError(`${el.name} cannot be sketched on.`)
    },
  }]
}
