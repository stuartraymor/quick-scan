// SPDX-License-Identifier: AGPL-3.0-only
// Plugin-owned tree rows use the CAD store's selection and visibility actions.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { create } from 'zustand'
import { Icon } from '../../../src/ui/icons'
import { useShell } from '../../../src/state/shellStore'
import { useDismiss } from '../../../src/ui/useDismiss'
import { commandRunning, pluginBusy, useCommandActivity, watchSession } from '../../../src/commands/activity'
import { sessionBusy } from '../../../src/commands/host'
import { useStore } from '../../../src/state/store'
import { useDeviation } from '../../../src/state/deviationStore'
import { bodyMaker, builtOn, dependentsOf, type Feature } from '../core/features'
import { bodyColor, openFeatureEditor, reEditorOpen, useReverse } from '../state/reStore'
import { FEATURE_ICONS } from './featureReading'
import { KeyIcon } from './reIcons'
import { folderPathText } from './BodyList'
import { ExplorerCheckbox, ExplorerGroup } from '../../../src/ui/ExplorerVisibility'
import { historyAction } from '../../../src/state/historyStore'
import type { PluginRuntime } from '../../../src/plugins/api'
import { useDocumentOrder } from '../../../src/state/documentOrderStore'

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
  return { state, locked: sessionWorking || busy || picking || coreEditor || extracting || state.building || state.playback !== null || reEditorOpen(state) }
}

function objectsLockedNow(): boolean {
  const state = useReverse.getState()
  return treeWorking() || coreDialogOpen() || useDeviation.getState().picking || state.building || state.playback !== null || reEditorOpen(state)
}

function setSketchVisibility(ids: readonly number[], on: boolean): void {
  if (objectsLockedNow()) return
  historyAction(`${on ? 'show' : 'hide'} sketches`, () => {
    const state = useReverse.getState()
    for (const f of state.features) if (f.kind === 'sketch' && ids.includes(f.id) && f.visible !== on) state.toggleFeatureVisible(f.id)
  })
}

function setBodyVisibility(ids: readonly number[], on: boolean): void {
  if (objectsLockedNow()) return
  const state = useReverse.getState()
  if (on) state.setBodiesHidden(false)
  state.setBodiesVisible(ids, on)
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
  if (treeWorking() || coreDialogOpen() || useDocumentOrder.getState().rollbackAt !== null) return
  useShell.getState().setWorkspace('reverse')
  openFeatureEditor(id)
}

function FeatureTreeRow({ feature, locked, rolled = false, location, outputBodies = [], outputValues = [] }: { feature: Feature; locked: boolean; rolled?: boolean; location: 'object' | 'history'; outputBodies?: readonly number[]; outputValues?: readonly boolean[] }) {
  const selected = useTreeSelection(s => s.id === feature.id)
  const rolledDocument = useDocumentOrder(s => s.rollbackAt !== null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Feature | null>(null)
  const deleting = deleteTarget !== null
  useDismiss(menu !== null, () => setMenu(null), { outside: '.explorer-feature-menu' })
  useDismiss(deleting, () => setDeleteTarget(null))
  const edit = () => {
    setMenu(null)
    if (!locked && !rolled && !feature.suppressed) editFromTree(feature.id)
  }
  const select = () => useTreeSelection.setState({ id: feature.id })
  const requestDelete = () => {
    setMenu(null)
    if (locked || treeWorking() || coreDialogOpen() || useDocumentOrder.getState().rollbackAt !== null) return
    select()
    setDeleteTarget(feature)
  }
  const remove = () => {
    const target = deleteTarget
    setDeleteTarget(null)
    const state = useReverse.getState()
    if (!target || ![...state.features, ...state.rolledBack].includes(target)) return
    if (locked || treeWorking() || coreDialogOpen() || useDocumentOrder.getState().rollbackAt !== null || reEditorOpen(state) || state.building || state.playback !== null) return
    if (dependentsOf(feature.id, [...state.features, ...state.rolledBack]).length) {
      useStore.getState().setError(`${feature.name} is built on by a later feature — delete that first.`)
      return
    }
    state.removeFeature(feature.id)
  }
  return <div className={`explorer-row${selected ? ' selected' : ''}${rolled ? ' is-rolled' : ''}`} data-test={`explorer-${location}-row-${feature.id}`}
    onKeyDown={event => {
      if (event.key !== 'Delete' || locked || deleting) return
      event.preventDefault()
      event.stopPropagation()
      requestDelete()
    }}
    onContextMenu={event => {
      event.preventDefault()
      if (locked) return
      select()
      setMenu({ x: Math.max(4, Math.min(event.clientX, window.innerWidth - 210)), y: Math.max(4, Math.min(event.clientY, window.innerHeight - 90)) })
    }}>
    {feature.kind === 'sketch' && <ExplorerCheckbox values={[feature.visible && !rolled]} label={`${feature.name} visibility`} disabled={locked || rolled} onSet={on => setSketchVisibility([feature.id], on)} />}
    {feature.kind !== 'sketch' && location === 'history' && <ExplorerCheckbox values={outputValues} label={`${feature.name} output visibility`} disabled={locked || rolled} onSet={on => setBodyVisibility(outputBodies, on)} />}
    <button type="button" className="explorer-item" disabled={locked} data-test={`explorer-${location}-feature-${feature.id}`}
      aria-pressed={selected} onClick={select} onDoubleClick={edit}
      title={rolled ? 'Below the rollback bar. Restore it before editing.' : `${feature.name} · right-click for actions, double-click to edit`}>
      <span className="explorer-icon"><KeyIcon name={FEATURE_ICONS[feature.kind]} size={16} /></span>
      <span>{feature.name}</span><small>{rolled ? 'rolled back' : feature.suppressed ? 'suppressed' : feature.kind}</small>
    </button>
    {menu && !locked && createPortal(<div role="menu" className="re-menu explorer-feature-menu" style={{ left: menu.x, top: menu.y, zIndex: 1000 }}>
      <div className="re-menu-head">{feature.name}</div>
      <button type="button" role="menuitem" disabled={rolled || feature.suppressed || rolledDocument} onClick={edit}>Edit ...</button>
      <button type="button" role="menuitem" disabled={rolledDocument} data-test="explorer-delete" onClick={requestDelete}>Delete ...</button>
    </div>, document.body)}
    {deleting && createPortal(<div className="modalback" data-test="explorer-delete-confirm">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Delete" onKeyDown={event => {
        event.stopPropagation()
        if (event.key === 'Tab') {
          event.preventDefault()
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
          const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
        }
      }}>
        <h2>Delete</h2>
        <p>The following group of entities is about to be deleted:</p>
        <p>{deleteTarget?.name};</p>
        <p>Are you sure you want to delete all of the above entities?</p>
        <div className="toolrow">
          <button type="button" data-test="explorer-delete-yes" autoFocus onClick={remove}>Yes</button>
          <button type="button" data-test="explorer-delete-no" onClick={() => setDeleteTarget(null)}>No</button>
        </div>
      </div>
    </div>, document.body)}
  </div>
}

export function ReverseObjects() {
  const { state, locked } = useExplorerLocked()
  const fileName = useStore(s => s.fileName)
  useEffect(() => { useTreeSelection.setState({ id: null }) }, [fileName])
  useEffect(() => {
    const id = useTreeSelection.getState().id
    if (id !== null && ![...state.features, ...state.rolledBack].some(f => f.id === id)) useTreeSelection.setState({ id: null })
  }, [state.features, state.rolledBack])
  const picked = state.listSelection.bodies
  const sketches = state.features.filter(f => f.kind === 'sketch')
  return <>
  {(['Surfaces', 'Solids'] as const).map(label => { const bodies = state.bodies.filter(body => Boolean(body.surface) === (label === 'Surfaces')); return <ExplorerGroup key={label} label={label} values={bodies.map(body => body.visible && !state.bodiesHidden)} disabled={locked} onSet={on => setBodyVisibility(bodies.map(body => body.id), on)} testId={`explorer-${label.toLowerCase()}`}>
      {bodies.map(body => {
        const index = state.bodies.findIndex(item => item.id === body.id)
        const folder = state.bodyFolders.find((f) => f.bodies.includes(body.id))
        const location = folder ? folderPathText(state.bodyFolders, folder.id) : ''
        return <div key={body.id} className={`explorer-row${picked.includes(body.id) ? ' selected' : ''}`}
          onMouseEnter={() => state.setBodyHover({ ids: [body.id], from: 'list' })}
          onMouseLeave={() => { if (useReverse.getState().bodyHover?.from === 'list') useReverse.getState().setBodyHover(null) }}>
          <ExplorerCheckbox values={[body.visible && !state.bodiesHidden]} label={`${body.name} visibility`} disabled={locked} onSet={on => setBodyVisibility([body.id], on)} />
          <button type="button" className="explorer-item" disabled={locked} data-test={`explorer-body-${body.id}`}
            title={`${location ? `${location} / ` : ''}${body.name} · ${body.surface ? 'surface' : 'solid'} · click to select, double-click to edit its feature`}
            onClick={(event) => {
              let next = [body.id]
              if (event.ctrlKey || event.metaKey) next = picked.includes(body.id) ? picked.filter((id) => id !== body.id) : [...picked, body.id]
              else if (event.shiftKey && picked.length > 0) {
                const anchor = state.bodies.findIndex((b) => b.id === picked[picked.length - 1])
                if (anchor >= 0) next = state.bodies.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((b) => b.id)
              }
              state.setListSelection({ bodies: next, folders: [] })
            }}
            onDoubleClick={() => { if (!locked) editFromTree(bodyMaker(body.id)) }}>
            <span className="explorer-icon" style={{ color: body.color ?? bodyColor(body.id) }}><Icon name={body.surface ? 'sheet' : 'model'} size={16} /></span>
            <span>{body.name}</span><small>{body.surface ? 'surface' : 'solid'}</small>
          </button>
        </div>
      })}
  </ExplorerGroup> })}
  <ExplorerGroup label="Sketches" values={sketches.map(f => f.visible)} disabled={locked} onSet={on => setSketchVisibility(sketches.map(f => f.id), on)} testId="explorer-sketches">
      {sketches.map(feature => <FeatureTreeRow key={feature.id} feature={feature} locked={locked} location="object" />)}
  </ExplorerGroup>
  </>
}

export function useReverseExplorerHistoryEntries(): NonNullable<PluginRuntime['explorerHistoryEntries']> {
  const { state, locked } = useExplorerLocked()
  const all = [...state.features, ...state.rolledBack]
  return all.map((feature, index) => {
    // Only bodies still present in the built document are displayable. A
    // consumed/failed/rolled-back output must never toggle suppression.
    const resultIds = state.results[feature.id]?.bodies ?? []
    const bodies = state.bodies.filter(body => resultIds.includes(body.id) || bodyMaker(body.id) === feature.id)
    const parents = new Set(builtOn(feature).map(id => `reverse:feature:${id}`))
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
    return { key: `reverse:feature:${feature.id}`, label: feature.name, parents: [...parents], node: <FeatureTreeRow feature={feature} locked={locked} rolled={index >= state.features.length} location="history" outputBodies={bodies.map(body => body.id)} outputValues={bodies.map(body => body.visible && !state.bodiesHidden)} /> }
  })
}
