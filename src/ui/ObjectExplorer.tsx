// SPDX-License-Identifier: AGPL-3.0-only
// Document browser. Every eye calls the existing visibility action; the
// explorer does not own geometry or introduce a second document model.
// Menus follow QUICKSURFACE's Objects/History (analysis/quick-scan-v1.2.14/
// native/NOTES.md): object-aware commands, F2 rename in place, Delete that
// lists what goes with it, Hide All But This, Disable All Next / Enable To
// Here, and a card naming the parents and dependents of the row in focus.
import { duplicateCoreElement, elementProperties, flipCoreElement, lockCoreElement, objectDeleteKey, recolorCoreObject, renameCoreObject, sectionProperties } from '../app/objectActions'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../state/store'
import { useShell } from '../state/shellStore'
import { useNavigationView } from '../state/navigationViewStore'
import { activeLocalHistory, historyAction, historyBlocked, useHistory } from '../state/historyStore'
import type { ExplorerCoreItem, ExplorerHistoryEntry } from '../plugins/api'
import { ExplorerCheckbox, ExplorerGroup } from './ExplorerVisibility'
import { canDisableAllNext, documentHistoryStep, documentHistoryToEnd, endOfModelAfter, placeEndOfModelAtStart, setDocumentHistoryBoundary, useDocumentOrder } from '../state/documentOrderStore'
import { commandRunning, pluginBusy, useCommandActivity, watchSession } from '../commands/activity'
import { sessionBusy } from '../commands/host'
import { useUnits } from '../app/useUnits'
import { sectionRefElement } from '../core/section/frame'
import { dependencyCard, dependencyCascade, historyTree } from '../core/explorerDependencies'
import { publishExplorerEntries, registerExplorerIsolate, useExplorer } from '../state/explorerStore'
import { ExplorerDeleteConfirm, ExplorerMenu, ExplorerProperties, explorerMenuAt, pickColor, type ExplorerMenuAt, type ExplorerMenuItem, type PropertyRow } from './ExplorerMenu'
import './object-explorer.css'

/** Where the dependency card goes: the view's top-left corner, as in
 *  QUICKSURFACE, past any panel docked in that corner (the CAD tools panel),
 *  so the card never covers a panel's own controls. */
function dependencyCardPlace(explorer: HTMLElement): { left: number; top: number } {
  const box = explorer.getBoundingClientRect()
  let left = box.right + 8
  const top = box.top + 6
  const view = document.querySelector('.viewport')
  const width = view?.getBoundingClientRect().width ?? 0
  for (let tries = 0; view && typeof document.elementsFromPoint === 'function' && tries < 3; tries++) {
    // A panel over the corner: the outermost element under the point that
    // is neither the view nor holds it, and not a layer as wide as the view.
    const under = document.elementsFromPoint(left + 4, top + 4).filter(e => e.tagName !== 'CANVAS' && e !== view && !e.contains(view) && !e.closest('.object-explorer, .explorer-dependency-card'))
    const panel = under.map(e => { let at: Element = e; while (at.parentElement && at.parentElement !== view && !at.parentElement.contains(view)) at = at.parentElement; return at })
      .find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.width < width * 0.6 && r.right > left })
    if (!panel) break
    left = panel.getBoundingClientRect().right + 8
  }
  return { left, top }
}

function TreeMark({ kind = 'object' }: { kind?: 'object' | 'mesh' | 'plane' | 'history' }) {
  return <svg className="explorer-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    {kind === 'plane' ? <path d="M2 13 7 5l11 2-5 8Z M10 2v16" /> : kind === 'history' ? <><path d="M5 5a7 7 0 1 1-2 7 M2 3v5h5" /><path d="M10 6v5l3 2" /></> : kind === 'mesh' ? <><path d="m10 2 7 5v8l-7 3-7-5V5Z M3 5l7 6 7-4 M10 11v7 M10 2v9 M3 13l14 2" /></> : <><path d="m10 2 7 4v9l-7 3-7-4V6Z M3 6l7 4 7-4 M10 10v8" /></>}
  </svg>
}

// Registered plugin stores are observed through the common session boundary;
// this browser must not reach into another workspace to inspect its drafts.
function sessionLocked(): boolean {
  return commandRunning() || pluginBusy() !== null || historyBlocked() || activeLocalHistory() !== null
}
const subscribeSession = (changed: () => void) => watchSession(changed, [useStore, useShell, useHistory, useCommandActivity])

/** What the scan row's menu can do, supplied by the app. */
export interface ExplorerScanActions {
  edit?: () => void
  tinted?: boolean
  color?: (hex: string) => void
  defaultColor?: () => void
  seeThrough?: { on: boolean; set: (on: boolean) => void }
  mesh?: { on: boolean; set: (on: boolean) => void }
  exportMesh?: () => void
  properties?: () => PropertyRow[]
}

/** Core row selection keys ("element:3") and their History keys ("core:element:3"). */
const docKey = (key: string) => key === 'scan' ? 'scan' : `core:${key}`
type CoreKind = 'element' | 'section'
const parseCore = (key: string): { kind: CoreKind; id: number } | null => {
  const match = /^(?:core:)?(element|section):(\d+)$/.exec(key)
  return match ? { kind: match[1] as CoreKind, id: Number(match[2]) } : null
}
const ROLLED = 'The model is rolled back. Place End of Model at the end before deleting.'

type MenuState =
  | { kind: 'core'; at: ExplorerMenuAt; key: string; location: 'object' | 'history' }
  | { kind: 'multi'; at: ExplorerMenuAt; keys: string[] }
  | { kind: 'scan'; at: ExplorerMenuAt; location: 'object' | 'history' }
  | { kind: 'group'; at: ExplorerMenuAt; label: string; group: 'element' | 'section'; ids: number[] }
  | { kind: 'end'; at: ExplorerMenuAt }

export function ObjectExplorer({ pluginObjects, pluginHistoryEntries = [], pluginCoreItems, pluginVisibility = [], coreVisibility, onEditElement, onEditSection, onDeleteElement, onDeleteSection, interactionBlocked = false, scanVisibility, scanActions }: { pluginObjects?: ReactNode; pluginHistoryEntries?: readonly ExplorerHistoryEntry[]; pluginCoreItems?: (key: string) => readonly ExplorerCoreItem[]; pluginVisibility?: { values: readonly boolean[]; disabled: boolean; setVisible(on: boolean): void }[]; coreVisibility?: { on: boolean; set(on: boolean): void }; onDeleteElement?: (id: number) => void; onDeleteSection?: (id: number) => void; onEditElement?: (id: number) => void; onEditSection?: (id: number) => void; interactionBlocked?: boolean; scanVisibility?: { shown: boolean; toggle: () => void; disabled?: boolean }; scanActions?: ExplorerScanActions } = {}) {
  const explorer = useRef<HTMLElement>(null)
  const coordinates = useNavigationView(s => s.coordinates)
  const [historyMode, setHistoryMode] = useState<'history' | 'parents'>('history')
  // Parent/Child view rows opened by hand; as in QUICKSURFACE, every
  // feature starts closed over the inputs it was built from.
  const [openParents, setOpenParents] = useState<ReadonlySet<string>>(new Set())
  const renaming = useExplorer(s => s.renaming)
  const [renameText, setRenameText] = useState('')
  const focus = useExplorer(s => s.focus)
  const deleting = useExplorer(s => s.deleting)
  const [properties, setProperties] = useState<{ title: string; rows: PropertyRow[] } | null>(null)
  // Shared with the box drawn on the stage: every selected key is acted on.
  const selection = useShell(s => s.selection)
  const isSelected = (key: string) => selection.includes(key)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const fileName = useStore(s => s.fileName)
  const triangles = useStore(s => s.triangleCount)
  const elements = useStore(s => s.elements)
  const sections = useStore(s => s.sections)
  const busy = useStore(s => s.busy)
  const scanHidden = useStore(s => s.scanHidden)
  const elementsHidden = useStore(s => s.elementsHidden)
  const coreEditor = useStore(s => Boolean(s.draft || s.sectionDraft || s.dimDraft || s.alignDraft))
  const extracting = useShell(s => s.extractOpen)
  const working = useSyncExternalStore(subscribeSession, sessionLocked, sessionLocked)
  const order = useDocumentOrder(s => s.keys)
  const migrated = useDocumentOrder(s => s.migrated)
  const rollbackAt = useDocumentOrder(s => s.rollbackAt)
  const archive = useDocumentOrder(s => s.coreArchive)
  const locked = busy || coreEditor || extracting || working || interactionBlocked
  const units = useUnits()
  const rolledNow = () => useDocumentOrder.getState().rollbackAt !== null
  const pick = (key: string, add = false) => {
    const now = useShell.getState().selection
    useShell.getState().setSelection(add ? (now.includes(key) ? now.filter(k => k !== key) : [...now, key]) : [key])
    useExplorer.getState().setFocus(docKey(key))
    const state=useStore.getState()
    if (state.alignDraft && key.startsWith('element:')) state.selectAlignmentElement(Number(key.slice(8)))
  }
  const aligning = useStore(s => s.alignDraft !== null)
  const visibilityLocked = aligning ? busy || commandRunning() || pluginBusy() !== null || interactionBlocked : locked
  const visibilityBlockedNow = () => visibilityLocked || commandRunning() || pluginBusy() !== null
  const blockedNow = () => locked || sessionLocked() || sessionBusy() !== null || useShell.getState().extractOpen
  const editElement = (id: number) => {
    setMenu(null)
    if (blockedNow() || rolledNow() || !onEditElement || !useStore.getState().elements.some(el => el.id === id)) return
    const lockedEl = useStore.getState().elements.find(el => el.id === id && el.locked)
    if (lockedEl) { useStore.getState().setStatus(`${lockedEl.name} is locked. Right-click it and choose Unlock to edit it.`); return }
    useShell.getState().setWorkspace('elements')
    onEditElement(id)
  }
  const editSection = (id: number) => {
    setMenu(null)
    if (blockedNow() || rolledNow() || !onEditSection || !useStore.getState().sections.some(sec => sec.id === id)) return
    useShell.getState().setWorkspace('elements')
    onEditSection(id)
  }
  const coreMask = !elementsHidden && coreVisibility?.on !== false
  const setCoreVisible = (kind: CoreKind, ids: readonly number[], shown: boolean) => {
    if (visibilityBlockedNow()) return
    historyAction(`${shown ? 'show' : 'hide'} ${kind}s`, () => {
      const store = useStore.getState()
      if (shown) { store.setElementsHidden(false); coreVisibility?.set(true) }
      for (const item of kind === 'element' ? store.elements : store.sections) {
        if (ids.includes(item.id) && item.visible !== shown) (kind === 'element' ? store.toggleElementVisible : store.toggleSectionVisible)(item.id)
      }
    })
  }
  const coreShown = (kind: CoreKind, id: number) => {
    const item = (kind === 'element' ? elements : sections).find(item => item.id === id)
    return Boolean(item?.visible && coreMask)
  }
  const toggleVisible = (kind: CoreKind, id: number) => {
    setMenu(null)
    if (visibilityBlockedNow()) return
    setCoreVisible(kind, [id], !coreShown(kind, id))
  }
  const scanShown = scanVisibility?.shown ?? !scanHidden
  const scanDisabled = Boolean(locked || scanVisibility?.disabled)
  const setScanVisible = (shown: boolean) => {
    if (blockedNow() || scanVisibility?.disabled) return
    if (scanVisibility) { if (scanVisibility.shown !== shown) scanVisibility.toggle() }
    else useStore.getState().setScanHidden(!shown)
  }
  const allValues = [...(fileName ? [scanShown] : []), ...elements.map(el => el.visible && coreMask), ...sections.map(sec => sec.visible && coreMask), ...pluginVisibility.flatMap(plugin => [...plugin.values])]
  const allDisabled = locked || (Boolean(fileName) && scanDisabled) || pluginVisibility.some(plugin => plugin.disabled && plugin.values.length > 0)
  const setAllVisible = (shown: boolean) => {
    if (allDisabled || blockedNow()) return
    historyAction(`${shown ? 'show' : 'hide'} all objects`, () => {
      if (fileName) setScanVisible(shown)
      setCoreVisible('element', elements.map(el => el.id), shown)
      setCoreVisible('section', sections.map(sec => sec.id), shown)
      for (const plugin of pluginVisibility) plugin.setVisible(shown)
    })
  }
  // "Hide All But This", for core and plugin rows alike: everything off,
  // then the kept object(s) on, as one undo step.
  const isolateRef = useRef<(show: () => void, label: string) => boolean>(() => false)
  isolateRef.current = (show, label) => {
    if (visibilityBlockedNow() || sessionBusy() !== null) return false
    historyAction(label, () => {
      if (fileName && !scanVisibility?.disabled) setScanVisible(false)
      const store = useStore.getState()
      for (const el of store.elements) if (el.visible) store.toggleElementVisible(el.id)
      for (const sec of store.sections) if (sec.visible) store.toggleSectionVisible(sec.id)
      for (const plugin of pluginVisibility) plugin.setVisible(false)
      show()
    })
    return true
  }
  useEffect(() => registerExplorerIsolate((show, label) => isolateRef.current(show, label)), [])
  const showCore = (keys: readonly string[]) => {
    const store = useStore.getState()
    if (keys.some(k => parseCore(k))) { store.setElementsHidden(false); coreVisibility?.set(true) }
    for (const key of keys) {
      if (key === 'scan' || key === 'core:scan') { setScanVisible(true); continue }
      const core = parseCore(key)
      if (!core) continue
      const item = (core.kind === 'element' ? useStore.getState().elements : useStore.getState().sections).find(item => item.id === core.id)
      if (item && !item.visible) (core.kind === 'element' ? store.toggleElementVisible : store.toggleSectionVisible)(core.id)
    }
  }
  const elementGroups = [ ['plane', 'Planes'], ['cylinder', 'Cylinders'], ['cone', 'Cones'], ['sphere', 'Spheres'], ['line', 'Ref. geometry'], ['point', 'Points'], ['circle', 'Circles'], ['torus', 'Tori'] ] as const
  const historyElements = archive?.elements ?? elements
  const historySections = archive?.sections ?? sections
  const coreKey = (id: number) => historyElements.some(el => el.id === id) ? `core:element:${id}` : `core:section:${id}`
  const elementParents = (el: (typeof elements)[number]) => [...new Set([
    ...(el.source.type === 'constructed' ? el.source.refs.map(coreKey) : []),
    ...(el.orient ? [coreKey(el.orient.ref)] : []),
  ])]

  // ---- In-place rename (F2) -------------------------------------------------
  const startRename = (key: string) => {
    setMenu(null)
    const core = parseCore(key)
    const item = core && (core.kind === 'element' ? elements : sections).find(item => item.id === core.id)
    if (!core || !item || blockedNow() || rolledNow()) return
    setRenameText(item.name)
    useExplorer.getState().setRenaming(`${core.kind}:${core.id}`)
  }
  const finishRename = (commit: boolean) => {
    const key = useExplorer.getState().renaming
    useExplorer.getState().setRenaming(null)
    const core = key && parseCore(key)
    if (commit && core && !blockedNow()) renameCoreObject(core.kind, core.id, renameText)
    explorer.current?.querySelector<HTMLButtonElement>(`[data-test="explorer-${core ? `${core.kind}-${core.id}` : ''}"]`)?.focus()
  }
  const renameInput = (key: string, label: string) => <input className="explorer-rename-inline" data-test="explorer-rename-input" aria-label={`Rename ${label}`} autoFocus value={renameText}
    onFocus={event => event.currentTarget.select()}
    onChange={event => setRenameText(event.target.value)}
    onBlur={() => { if (useExplorer.getState().renaming === key) finishRename(true) }}
    onKeyDown={event => {
      event.stopPropagation()
      if (event.key === 'Enter') { event.preventDefault(); finishRename(true) }
      if (event.key === 'Escape') { event.preventDefault(); finishRename(false) }
    }} />

  const elementRow = (el: (typeof elements)[number], location: 'object' | 'history') => {
    const rolled = !elements.some(active => active.id === el.id)
    const key = `element:${el.id}`
    return <div key={el.id} data-test={`explorer-${location === 'history' ? 'history-' : ''}element-row-${el.id}`} className={`explorer-row${isSelected(key) ? ' selected' : ''}${rolled ? ' is-rolled' : ''}`} onContextMenu={event => openCoreMenu(event, key, location)}>
      <ExplorerCheckbox values={[!rolled && el.visible && coreMask]} label={`${el.name} visibility`} disabled={visibilityLocked || rolled} onSet={() => toggleVisible('element', el.id)} />
      {renaming === key && location === 'object' ? renameInput(key, el.name) : <button type="button" className="explorer-item" data-test={`explorer-${location === 'history' ? 'history-' : ''}element-${el.id}`} disabled={locked && !aligning} aria-pressed={isSelected(key)} onClick={(ev) => pick(key, ev.ctrlKey || ev.metaKey)} onDoubleClick={() => editElement(el.id)} title={rollbackAt !== null ? 'Restore End of Model before editing.' : `${el.kind} · Right-click for actions, double-click to edit, F2 to rename`}><span className="explorer-color" style={{ background: el.color }} /><span>{el.name}</span>{el.locked && <small className="explorer-locked" data-test={`explorer-locked-${el.id}`}>Locked</small>}</button>}
    </div>
  }
  const sectionRow = (sec: (typeof sections)[number], location: 'object' | 'history') => {
    const rolled = !sections.some(active => active.id === sec.id)
    const key = `section:${sec.id}`
    return <div key={sec.id} data-test={`explorer-${location === 'history' ? 'history-' : ''}section-row-${sec.id}`} className={`explorer-row${isSelected(key) ? ' selected' : ''}${rolled ? ' is-rolled' : ''}`} onContextMenu={event => openCoreMenu(event, key, location)}>
      <ExplorerCheckbox values={[!rolled && sec.visible && coreMask]} label={`${sec.name} visibility`} disabled={visibilityLocked || rolled} onSet={() => toggleVisible('section', sec.id)} />
      {renaming === key && location === 'object' ? renameInput(key, sec.name) : <button type="button" className="explorer-item" data-test={`explorer-${location === 'history' ? 'history-' : ''}section-${sec.id}`} disabled={locked && !aligning} aria-pressed={isSelected(key)} onClick={(ev) => pick(key, ev.ctrlKey || ev.metaKey)} onDoubleClick={() => editSection(sec.id)} title={rollbackAt !== null ? 'Restore End of Model before editing.' : 'Right-click for actions, double-click to edit section, F2 to rename'}><TreeMark kind="plane" /><span>{sec.name}</span></button>}
    </div>
  }
  const scanRow = (location: 'object' | 'history') => <div className={`explorer-row${isSelected('scan') ? ' selected' : ''}`} data-test={`explorer-${location}-scan-row`} onContextMenu={event => { event.preventDefault(); if (locked) return; pick('scan'); setMenu({ kind: 'scan', at: explorerMenuAt(event, 11), location }) }}>
    <ExplorerCheckbox values={[scanShown]} label={`${fileName} visibility`} disabled={scanDisabled} onSet={setScanVisible} />
    <button type="button" className="explorer-item" data-test={`explorer-${location}-scan`} aria-pressed={isSelected('scan')} onClick={(ev) => pick('scan', ev.ctrlKey || ev.metaKey)} onDoubleClick={() => { if (!blockedNow()) scanActions?.edit?.() }} title={`${fileName} · ${triangles.toLocaleString()} triangles · right-click for actions`}><TreeMark kind="mesh" /><span>{fileName?.replace(/\.[^.]+$/, '')}{location === 'object' && ` (T: ${triangles.toLocaleString()})`}</span></button>
  </div>
  const coreEntries: ExplorerHistoryEntry[] = [
    ...(fileName ? [{ key: 'scan', label: fileName.replace(/\.[^.]+$/, ''), node: scanRow('history'), setVisible: (on: boolean) => setScanVisible(on) }] : []),
    ...historyElements.map(el => ({ key: `core:element:${el.id}`, label: el.name, parents: elementParents(el), node: elementRow(el, 'history'),
      remove: onDeleteElement ? () => { if (useStore.getState().elements.some(item => item.id === el.id)) onDeleteElement(el.id) } : undefined,
      setVisible: (on: boolean) => { if (on) showCore([`core:element:${el.id}`]) } })),
    ...historySections.map(sec => ({ key: `core:section:${sec.id}`, label: sec.name, parents: sectionRefElement(sec.ref) === null ? [] : [`core:element:${sectionRefElement(sec.ref)}`], node: sectionRow(sec, 'history'),
      remove: onDeleteSection ? () => { if (useStore.getState().sections.some(item => item.id === sec.id)) onDeleteSection(sec.id) } : undefined,
      setVisible: (on: boolean) => { if (on) showCore([`core:section:${sec.id}`]) } })),
  ]
  const historyEntries: ExplorerHistoryEntry[] = [...coreEntries, ...pluginHistoryEntries]
  const orderAt = new Map(order.map((key, index) => [key, index]))
  historyEntries.sort((a, b) => (orderAt.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (orderAt.get(b.key) ?? Number.MAX_SAFE_INTEGER))
  const entriesRef = useRef(historyEntries)
  entriesRef.current = historyEntries
  publishExplorerEntries(historyEntries)
  useEffect(() => () => publishExplorerEntries([]), [])
  const labelOf = (key: string) => historyEntries.find(entry => entry.key === key)?.label ?? key

  // ---- Delete: the asked objects and everything built on them ---------------
  const requestDelete = (keys: readonly string[]) => {
    setMenu(null)
    if (keys.length === 0 || locked) return
    useExplorer.getState().requestDelete(keys)
  }
  const cascade = deleting ? dependencyCascade(deleting, historyEntries) : []
  const unremovable = cascade.find(key => !historyEntries.find(entry => entry.key === key)?.remove)
  const deleteBlocked = !deleting ? null
    : rollbackAt !== null ? ROLLED
    : blockedNow() ? 'Finish or cancel the open command first.'
    : unremovable ? `${labelOf(unremovable)} cannot be deleted here.`
    : null
  const confirmDelete = () => {
    const keys = useExplorer.getState().deleting
    useExplorer.getState().cancelDelete()
    if (!keys || rolledNow() || blockedNow()) return
    const entries = entriesRef.current
    const all = dependencyCascade(keys, entries)
    if (all.some(key => !entries.find(entry => entry.key === key)?.remove)) return
    historyAction(all.length === 1 ? `Delete ${labelOf(all[0])}` : `Delete ${all.length} objects`, () => {
      for (const key of [...all].reverse()) entries.find(entry => entry.key === key)?.remove?.()
    })
    useShell.getState().setSelection([])
    if (useExplorer.getState().focus && all.includes(useExplorer.getState().focus!)) useExplorer.getState().setFocus(null)
  }

  // ---- Menus ---------------------------------------------------------------
  const historyItems = (key: string, location: 'object' | 'history'): ExplorerMenuItem[] => {
    if (location !== 'history') return []
    const rolled = rollbackAt !== null && (orderAt.get(key) ?? -1) >= rollbackAt
    return rolled
      ? [{ label: '<- Enable To Here', testId: 'explorer-enable-to-here', disabled: locked, onSelect: () => { if (!blockedNow()) endOfModelAfter(key) } }]
      : canDisableAllNext(key) ? [{ label: '-> Disable All Next', testId: 'explorer-disable-all-next', disabled: locked, onSelect: () => { if (!blockedNow()) endOfModelAfter(key) } }] : []
  }
  const openCoreMenu = (event: React.MouseEvent, key: string, location: 'object' | 'history') => {
    event.preventDefault()
    if (locked) return
    const now = useShell.getState().selection
    if (now.length > 1 && now.includes(key) && location === 'object') { setMenu({ kind: 'multi', at: explorerMenuAt(event, 7), keys: [...now] }); return }
    pick(key)
    setMenu({ kind: 'core', at: explorerMenuAt(event, 12), key, location })
  }
  const recolor = (kind: CoreKind, ids: readonly number[]) => {
    const first = (kind === 'element' ? elements : sections).find(item => ids.includes(item.id))
    pickColor(first?.color, hex => { if (!blockedNow()) historyAction('Change color', () => { for (const id of ids) recolorCoreObject(kind, id, hex) }) })
  }
  const coreMenuItems = (key: string, location: 'object' | 'history'): (ExplorerMenuItem | false)[] => {
    const core = parseCore(key)!
    const item = (core.kind === 'element' ? historyElements : historySections).find(item => item.id === core.id)
    if (!item) return []
    const rolled = !(core.kind === 'element' ? elements : sections).some(active => active.id === core.id)
    const editable = rollbackAt === null && !rolled
    const shown = coreShown(core.kind, core.id)
    const element = core.kind === 'element' ? elements.find(el => el.id === core.id) : undefined
    const plane = element?.kind === 'plane'
    const extra = (pluginCoreItems?.(docKey(key)) ?? []).map(entry => ({ ...entry, disabled: entry.disabled || !editable }))
    return [
      { label: 'Edit ...', testId: 'explorer-core-edit', disabled: !editable || Boolean(element?.locked) || (core.kind === 'element' ? !onEditElement : !onEditSection), title: element?.locked ? `${item.name} is locked: Unlock it to edit.` : undefined, onSelect: () => core.kind === 'element' ? editElement(core.id) : editSection(core.id) },
      { label: 'Hide All But This', testId: 'explorer-hide-all-but', disabled: rolled, onSelect: () => isolateRef.current(() => showCore([key]), 'Hide all but this') },
      { label: shown ? 'Hide' : 'Show', testId: 'explorer-core-visibility', disabled: rolled, onSelect: () => toggleVisible(core.kind, core.id) },
      ...(extra.length > 0 ? ['separator' as const, ...extra] : []),
      'separator',
      { label: 'Color ...', testId: 'explorer-core-color', disabled: !editable, onSelect: () => recolor(core.kind, [core.id]) },
      'separator',
      { label: 'Rename ...', shortcut: 'F2', testId: 'explorer-core-rename', disabled: !editable, onSelect: () => location === 'object' ? startRename(key) : startRenameFromHistory(key) },
      core.kind === 'element' && { label: 'Duplicate', testId: 'explorer-core-duplicate', disabled: !editable || !elements.find(el => el.id === core.id)?.fit, onSelect: () => { if (!blockedNow()) { const id = duplicateCoreElement(core.id); if (id !== null) pick(`element:${id}`) } } },
      plane && { label: 'Flip', testId: 'explorer-core-flip', disabled: !editable || !element?.fit, title: 'Turn the plane over: its normal, and what is built on it, the other way', onSelect: () => { setMenu(null); if (!blockedNow()) flipCoreElement(core.id) } },
      element !== undefined && { label: element.locked ? 'Unlock' : 'Lock', testId: 'explorer-core-lock', disabled: !editable, title: element.locked ? 'Let it be moved (edited) again' : 'Keep it from being moved: Edit is refused until it is unlocked', onSelect: () => { setMenu(null); if (!blockedNow()) lockCoreElement(core.id, !element.locked) } },
      ...historyItems(docKey(key), location),
      'separator',
      { label: 'Delete ...', danger: true, testId: 'explorer-core-delete', disabled: !editable, onSelect: () => requestDelete([docKey(key)]) },
      { label: 'Properties ...', testId: 'explorer-core-properties', onSelect: () => setProperties({ title: item.name, rows: core.kind === 'element' ? elementProperties(core.id) : sectionProperties(core.id) }) },
    ]
  }
  // A History row renames through the same box, shown on its Objects row.
  const startRenameFromHistory = (key: string) => {
    explorer.current?.querySelectorAll<HTMLDetailsElement>('.explorer-objects details').forEach(group => { group.open = true })
    startRename(key)
  }
  const multiItems = (keys: string[]): ExplorerMenuItem[] => {
    const cores = keys.map(parseCore).filter((core): core is { kind: CoreKind; id: number } => core !== null)
    const editable = rollbackAt === null
    return [
      { label: 'Hide All But This', testId: 'explorer-hide-all-but', onSelect: () => isolateRef.current(() => showCore(keys.map(docKey)), 'Hide all but these') },
      { label: 'Hide', testId: 'explorer-multi-hide', onSelect: () => historyAction('hide objects', () => { for (const kind of ['element', 'section'] as const) setCoreVisible(kind, cores.filter(c => c.kind === kind).map(c => c.id), false); if (keys.includes('scan')) setScanVisible(false) }) },
      { label: 'Show', testId: 'explorer-multi-show', onSelect: () => historyAction('show objects', () => { for (const kind of ['element', 'section'] as const) setCoreVisible(kind, cores.filter(c => c.kind === kind).map(c => c.id), true); if (keys.includes('scan')) setScanVisible(true) }) },
      'separator',
      { label: 'Color ...', testId: 'explorer-multi-color', disabled: !editable || cores.length === 0, onSelect: () => {
        const first = cores[0]
        const item = first && (first.kind === 'element' ? elements : sections).find(item => item.id === first.id)
        pickColor(item?.color, hex => { if (!blockedNow()) historyAction('Change color', () => { for (const c of cores) recolorCoreObject(c.kind, c.id, hex) }) })
      } },
      'separator',
      { label: 'Delete ...', danger: true, testId: 'explorer-multi-delete', disabled: !editable || cores.length === 0, onSelect: () => requestDelete(cores.map(c => `core:${c.kind}:${c.id}`)) },
    ]
  }
  const scanItems = (location: 'object' | 'history'): (ExplorerMenuItem | false | undefined)[] => [
    scanActions?.edit && { label: 'Edit ...', testId: 'explorer-scan-edit', disabled: rollbackAt !== null, onSelect: () => { if (!blockedNow()) scanActions.edit!() } },
    { label: 'Hide All But This', testId: 'explorer-hide-all-but', onSelect: () => isolateRef.current(() => setScanVisible(true), 'Hide all but this') },
    { label: scanShown ? 'Hide' : 'Show', testId: 'explorer-scan-visibility', disabled: scanDisabled, onSelect: () => setScanVisible(!scanShown) },
    'separator',
    scanActions?.color && { label: 'Color ...', testId: 'explorer-scan-color', onSelect: () => pickColor('#5cc862', hex => scanActions.color!(hex)) },
    scanActions?.defaultColor && { label: 'Set Default Color', testId: 'explorer-scan-default-color', disabled: !scanActions.tinted, onSelect: () => scanActions.defaultColor!() },
    scanActions?.mesh && { label: 'Wireframe', testId: 'explorer-scan-wireframe', checked: scanActions.mesh.on, onSelect: () => scanActions.mesh!.set(!scanActions.mesh!.on) },
    scanActions?.seeThrough && { label: 'Transparent', testId: 'explorer-scan-transparent', checked: scanActions.seeThrough.on, onSelect: () => scanActions.seeThrough!.set(!scanActions.seeThrough!.on) },
    'separator',
    ...historyItems('scan', location),
    scanActions?.exportMesh && { label: 'Export ...', testId: 'explorer-scan-export', onSelect: () => { if (!blockedNow()) scanActions.exportMesh!() } },
    scanActions?.properties && { label: 'Properties ...', testId: 'explorer-scan-properties', onSelect: () => setProperties({ title: fileName ?? 'Scan', rows: scanActions.properties!() }) },
  ]
  const groupItems = (label: string, group: 'element' | 'section', ids: number[]): ExplorerMenuItem[] => {
    const editable = rollbackAt === null
    const items: ExplorerMenuItem[] = [
      { label: 'Show All', testId: 'explorer-group-show', onSelect: () => setCoreVisible(group, ids, true) },
      { label: 'Hide All', testId: 'explorer-group-hide', onSelect: () => setCoreVisible(group, ids, false) },
      'separator',
      { label: 'Color ...', testId: 'explorer-group-color', disabled: !editable, onSelect: () => recolor(group, ids) },
      'separator',
      { label: 'Delete ...', danger: true, testId: 'explorer-group-delete', disabled: !editable || ids.length === 0, onSelect: () => requestDelete(ids.map(id => `core:${group}:${id}`)) },
    ]
    return items.map(item => item === 'separator' ? item : { ...item, title: `${item.label.replace(' ...', '')}: every object in ${label}` })
  }
  const groupMenu = (label: string, group: 'element' | 'section', ids: number[]) => (event: React.MouseEvent) => {
    if (locked) return
    setMenu({ kind: 'group', at: explorerMenuAt(event, 6), label, group, ids })
  }

  // ---- History rows and the End of Model marker -----------------------------
  const dropBoundary = (event: React.DragEvent, at: number | null) => {
    if (!event.dataTransfer.types.includes('application/x-quickscan-history-boundary')) return
    event.preventDefault()
    if (!blockedNow()) setDocumentHistoryBoundary(at)
  }
  const dragOver = (event: React.DragEvent) => { if (!locked && event.dataTransfer.types.includes('application/x-quickscan-history-boundary')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }
  const endMarker = <div className="explorer-end-model" data-test="explorer-end-model" draggable={!locked} tabIndex={0} aria-label="End of Model boundary" title="Drag before a History row to move the model boundary. Right-click: Place at Start / Place at End. End restores the full model; Home returns to the first step."
    onContextMenu={event => { event.preventDefault(); if (!locked) setMenu({ kind: 'end', at: explorerMenuAt(event, 2) }) }}
    onDragStart={event => { if (blockedNow()) { event.preventDefault(); return }; event.dataTransfer.setData('application/x-quickscan-history-boundary', 'model'); event.dataTransfer.effectAllowed = 'move' }} onKeyDown={event => { if (blockedNow()) return; if (event.key === 'End') { event.preventDefault(); documentHistoryToEnd() }; if (event.key === 'Home') { event.preventDefault(); placeEndOfModelAtStart() } }}><span aria-hidden="true">↥</span> &lt; End of Model &gt;</div>
  const historyRows: ReactNode[] = []
  let markerInserted = false
  for (const entry of historyEntries) {
    if (!markerInserted && rollbackAt !== null && (orderAt.get(entry.key) ?? Infinity) >= rollbackAt) { historyRows.push(<div key="model-end">{endMarker}</div>); markerInserted = true }
    // The marker goes before the row it is dropped on, or after it when let
    // go on the row's lower half — as the CAD panel's bar lands in the gap
    // nearest the cursor. After the last row is the end: the whole model.
    const before = orderAt.get(entry.key) ?? null
    historyRows.push(<div key={entry.key} data-order-key={entry.key} onDragOver={dragOver} onDrop={event => {
      const box = event.currentTarget.getBoundingClientRect()
      const after = before !== null && event.clientY > box.top + box.height / 2
      dropBoundary(event, after ? (before + 1 >= order.length ? null : before + 1) : before)
    }}>{entry.node}</div>)
  }
  if (!markerInserted) historyRows.push(<div key="model-end">{endMarker}</div>)
  // QUICKSURFACE's Parent/Child view: each feature at the top with what it
  // was built from inside it (Extruded(1) ▸ Sketch(1)); what nothing uses
  // stands at the top level. An input used by several features sits under
  // the first of them that came after it, and the tooltip names the rest.
  const { children, roots, consumersOf } = historyTree(historyEntries)
  const dependencyRows = (entries: typeof historyEntries): ReactNode => entries.map(entry => {
    const nested = children.get(entry.key) ?? []
    const open = openParents.has(entry.key)
    const users = consumersOf.get(entry.key) ?? []
    return <div key={entry.key} data-order-key={entry.key} className="explorer-dependency-entry" data-test={`explorer-tree-${entry.key}`} title={users.length > 1 ? `Used by: ${users.map(labelOf).join(', ')}` : undefined}>
      <div className="explorer-dependency-row">{nested.length > 0 ? <button type="button" className="explorer-dependency-toggle" data-test={`explorer-tree-toggle-${entry.key}`} aria-label={`${open ? 'Collapse' : 'Expand'} ${entry.label}`} aria-expanded={open} onClick={() => setOpenParents(current => { const next = new Set(current); if (open) next.delete(entry.key); else next.add(entry.key); return next })}>{open ? '▾' : '▸'}</button> : <span className="explorer-dependency-spacer" />}{entry.node}</div>
      {nested.length > 0 && open && <div className="explorer-dependency-children">{dependencyRows(nested)}</div>}
    </div>
  })
  const expandHistory = (expanded: boolean) => {
    const tree = explorer.current?.querySelector<HTMLDetailsElement>('.explorer-history-root')
    if (tree) tree.open = true
    setOpenParents(expanded ? new Set(children.keys()) : new Set())
  }
  const boundary = rollbackAt ?? order.length

  // The focus goes when its object does; a stale card would name nothing.
  useEffect(() => {
    if (focus && !historyEntries.some(entry => entry.key === focus)) useExplorer.getState().setFocus(null)
  })
  // Escape drops the card (and passes on: the workspace's own Escape still runs).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !useExplorer.getState().renaming) useExplorer.getState().setFocus(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const card = focus ? dependencyCard(focus, historyEntries) : null
  const cardBox = explorer.current ? dependencyCardPlace(explorer.current) : null

  const menuNode = menu && !locked ? (() => {
    const close = () => setMenu(null)
    if (menu.kind === 'core') {
      const core = parseCore(menu.key)!
      const item = (core.kind === 'element' ? historyElements : historySections).find(item => item.id === core.id)
      return item ? <ExplorerMenu at={menu.at} head={item.name} items={coreMenuItems(menu.key, menu.location)} onClose={close} testId="explorer-core-menu" /> : null
    }
    if (menu.kind === 'multi') return <ExplorerMenu at={menu.at} head={`${menu.keys.length} objects`} items={multiItems(menu.keys)} onClose={close} testId="explorer-multi-menu" />
    if (menu.kind === 'scan') return fileName ? <ExplorerMenu at={menu.at} head={fileName.replace(/\.[^.]+$/, '')} items={scanItems(menu.location)} onClose={close} testId="explorer-scan-menu" /> : null
    if (menu.kind === 'group') return <ExplorerMenu at={menu.at} head={menu.label} items={groupItems(menu.label, menu.group, menu.ids)} onClose={close} testId="explorer-group-menu" />
    return <ExplorerMenu at={menu.at} head="End of Model" onClose={close} testId="explorer-end-menu" items={[
      { label: 'Place at Start', testId: 'explorer-end-start', onSelect: () => { if (!blockedNow()) placeEndOfModelAtStart() } },
      { label: 'Place at End', testId: 'explorer-end-end', disabled: rollbackAt === null, onSelect: () => { if (!blockedNow()) documentHistoryToEnd() } },
    ]} />
  })() : null

  return <aside ref={explorer} className="object-explorer" aria-label="Object explorer" data-test="object-explorer" onKeyDown={event=>{
      const editable=(event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]') !== null
      if(editable) return
      const keys=useShell.getState().selection.filter(key=>parseCore(key))
      if(event.key==='F2' && !event.ctrlKey && !event.altKey && keys.length===1) {
        event.preventDefault();event.stopPropagation();startRename(keys[0]);return
      }
      if(!objectDeleteKey(event.key,editable,event.ctrlKey||event.altKey||event.metaKey||event.shiftKey,event.repeat) || keys.length===0) return
      if(blockedNow()) return
      event.preventDefault();event.stopPropagation();requestDelete(keys.map(docKey))
    }}>
    <div className="explorer-heading" id="explorer-objects-heading"><span>OBJECTS</span></div>
    <div className="explorer-object-toolbar"><button type="button" aria-label="Expand all object groups" onClick={() => explorer.current?.querySelectorAll<HTMLDetailsElement>('.explorer-objects details').forEach(group => { group.open = true })}>▸</button><button type="button" aria-label="Collapse all object groups" onClick={() => explorer.current?.querySelectorAll<HTMLDetailsElement>('.explorer-objects details').forEach(group => { group.open = false })}>▾</button></div>
    <section className="explorer-content explorer-objects" id="explorer-objects" aria-labelledby="explorer-objects-heading">
      <div className="explorer-row explorer-all"><ExplorerCheckbox values={allValues} label="ALL visibility" testId="explorer-all-visible" disabled={allDisabled} onSet={setAllVisible} /><TreeMark /><span>ALL</span></div>
      <div className="explorer-root-children">
      <div className="explorer-row explorer-coordinate"><ExplorerCheckbox values={[coordinates]} label="Coordinate System visibility" disabled={visibilityLocked} onSet={shown => { if (!visibilityBlockedNow()) useNavigationView.getState().setCoordinates(shown) }} /><TreeMark kind="plane" /><span>Coordinate System</span></div>
      <ExplorerGroup label="Meshes" values={fileName ? [scanShown] : []} disabled={scanDisabled} onSet={setScanVisible} testId="explorer-meshes">
        {fileName && scanRow('object')}
      </ExplorerGroup>
      {pluginObjects}
      {elementGroups.map(([kind, label]) => { const items = elements.filter(el => el.kind === kind); return <ExplorerGroup key={kind} label={label} values={items.map(el => el.visible && coreMask)} disabled={visibilityLocked} onSet={shown => setCoreVisible('element', items.map(el => el.id), shown)} testId={`explorer-${kind}-group`} onContextMenu={groupMenu(label, 'element', items.map(el => el.id))}>
        {items.map(el => elementRow(el, 'object'))}
      </ExplorerGroup> })}
      <ExplorerGroup label="Sections" values={sections.map(sec => sec.visible && coreMask)} disabled={visibilityLocked} onSet={shown => setCoreVisible('section', sections.map(sec => sec.id), shown)} testId="explorer-sections" onContextMenu={groupMenu('Sections', 'section', sections.map(sec => sec.id))}>
        {sections.map(sec => sectionRow(sec, 'object'))}
      </ExplorerGroup>
      </div>
    </section>
    <section className="explorer-history-panel" aria-labelledby="explorer-history-heading">
      <div className="explorer-object-toolbar" id="explorer-history-heading">
        <button type="button" aria-label="History View" aria-pressed={historyMode === 'history'} onClick={() => setHistoryMode('history')}>▤</button>
        <button type="button" aria-label="Parent/Child View" aria-pressed={historyMode === 'parents'} onClick={() => setHistoryMode('parents')}>↳</button>
        <button type="button" aria-label="Expand History" disabled={historyMode !== 'parents'} onClick={() => expandHistory(true)}>▸</button>
        <button type="button" aria-label="Collapse History" disabled={historyMode !== 'parents'} onClick={() => expandHistory(false)}>▾</button>
        {historyMode === 'history' && <>
          <button type="button" aria-label="Previous model step" disabled={locked || boundary <= (fileName ? 1 : 0)} onClick={() => { if (!blockedNow()) documentHistoryStep(-1) }}>◀</button>
          <button type="button" aria-label="Next model step" disabled={locked || rollbackAt === null} onClick={() => { if (!blockedNow()) documentHistoryStep(1) }}>▶</button>
        </>}
      </div>
      <div className="explorer-content" id="explorer-history" title={migrated ? 'This older document did not record a common creation order; the recovered order is approximate.' : 'Document model history'}>
      <details className="explorer-group explorer-history-root" open>
        <summary><ExplorerCheckbox values={allValues} label="History visibility" testId="explorer-history-visible" disabled={allDisabled} onSet={setAllVisible} /><TreeMark kind="history" /><span>History</span></summary>
        <div className="explorer-history-entries">{historyMode === 'history' ? <>{historyRows}<div className="explorer-history-end-drop" data-test="explorer-history-end-drop" onDragOver={dragOver} onDrop={event => dropBoundary(event, null)} /></> : dependencyRows(roots)}</div>
      </details>
      </div>
    </section>
    <div className="explorer-footer">{triangles ? `${triangles.toLocaleString()} triangles` : 'No scan loaded'}<span>{units}</span></div>
    {menuNode}
    {deleting && <ExplorerDeleteConfirm asked={deleting.map(labelOf)} also={cascade.filter(key => !deleting.includes(key)).map(labelOf)} blocked={deleteBlocked} onYes={confirmDelete} onNo={() => useExplorer.getState().cancelDelete()} />}
    {properties && <ExplorerProperties title={properties.title} rows={properties.rows} onClose={() => setProperties(null)} />}
    {card && (card.parents.length > 0 || card.children.length > 0) && cardBox && createPortal(<div className="explorer-dependency-card" data-test="explorer-dependency-card" style={{ left: cardBox.left, top: cardBox.top }}>
      <div className="dep-title">{card.label}</div>
      {card.parents.map((label, i) => <div key={`p${i}`}>&lt;-- {label}</div>)}
      {card.children.length > 0 && <div className="dep-dim">{card.children.length === 1 ? 'Dependent:' : 'Dependents:'}</div>}
      {card.children.map((label, i) => <div key={`c${i}`}>--&gt; {label}</div>)}
    </div>, document.body)}
  </aside>
}
