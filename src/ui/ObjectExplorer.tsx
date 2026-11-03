// SPDX-License-Identifier: AGPL-3.0-only
// Document browser. Every eye calls the existing visibility action; the
// explorer does not own geometry or introduce a second document model.
import { duplicateCoreElement, objectDeleteKey, renameCoreObject } from '../app/objectActions'
import { useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../state/store'
import { useShell } from '../state/shellStore'
import { useNavigationView } from '../state/navigationViewStore'
import { activeLocalHistory, historyAction, historyBlocked, useHistory } from '../state/historyStore'
import type { PluginRuntime } from '../plugins/api'
import { ExplorerCheckbox, ExplorerGroup } from './ExplorerVisibility'
import { documentHistoryStep, documentHistoryToEnd, setDocumentHistoryBoundary, useDocumentOrder } from '../state/documentOrderStore'
import { commandRunning, pluginBusy, useCommandActivity, watchSession } from '../commands/activity'
import { sessionBusy } from '../commands/host'
import { useDismiss } from './useDismiss'
import { useUnits } from '../app/useUnits'
import { sectionRefElement } from '../core/section/frame'
import './object-explorer.css'

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

export function ObjectExplorer({ pluginObjects, pluginHistoryEntries = [], pluginVisibility = [], coreVisibility, onEditElement, onEditSection, onDeleteElement, onDeleteSection, interactionBlocked = false, scanVisibility }: { pluginObjects?: ReactNode; pluginHistoryEntries?: NonNullable<PluginRuntime['explorerHistoryEntries']>; pluginVisibility?: NonNullable<PluginRuntime['explorerVisibility']>[]; coreVisibility?: PluginRuntime['explorerCoreVisibility']; onDeleteElement?: (id: number) => void; onDeleteSection?: (id: number) => void; onEditElement?: (id: number) => void; onEditSection?: (id: number) => void; interactionBlocked?: boolean; scanVisibility?: { shown: boolean; toggle: () => void; disabled?: boolean } } = {}) {
  const explorer = useRef<HTMLElement>(null)
  const coordinates = useNavigationView(s => s.coordinates)
  const [historyMode, setHistoryMode] = useState<'history' | 'parents'>('history')
  const [collapsedParents, setCollapsedParents] = useState<ReadonlySet<string>>(new Set())
  const [renaming, setRenaming] = useState<{kind:'element'|'section';id:number;name:string}|null>(null)
  // Shared with the box drawn on the stage: the first key is the one the
  // row actions (delete, rename) work on.
  const selection = useShell(s => s.selection)
  const selected = selection[0] ?? null
  const isSelected = (key: string) => selection.includes(key)
  const [menu, setMenu] = useState<{ kind: 'element' | 'section'; id: number; x: number; y: number } | null>(null)
  useDismiss(menu !== null, () => setMenu(null), { outside: '.explorer-core-menu' })
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
  const pick = (key: string, add = false) => {
    const now = useShell.getState().selection
    useShell.getState().setSelection(add ? (now.includes(key) ? now.filter(k => k !== key) : [...now, key]) : [key])
    const state=useStore.getState()
    if (state.alignDraft && key.startsWith('element:')) state.selectAlignmentElement(Number(key.slice(8)))
  }
  const aligning = useStore(s => s.alignDraft !== null)
  const visibilityLocked = aligning ? busy || commandRunning() || pluginBusy() !== null || interactionBlocked : locked
  const visibilityBlockedNow = () => visibilityLocked || commandRunning() || pluginBusy() !== null
  const blockedNow = () => locked || sessionLocked() || sessionBusy() !== null || useShell.getState().extractOpen
  const deleteObject = (kind:'element'|'section',id:number) => {
    if(blockedNow() || useDocumentOrder.getState().rollbackAt !== null) return
    const action=kind==='element'?onDeleteElement:onDeleteSection
    if(!action) return
    historyAction('Delete object',()=>action(id))
    setMenu(null); useShell.getState().setSelection([])
  }
  const editElement = (id: number) => {
    setMenu(null)
    if (blockedNow() || useDocumentOrder.getState().rollbackAt !== null || !onEditElement || !useStore.getState().elements.some(el => el.id === id)) return
    useShell.getState().setWorkspace('elements')
    onEditElement(id)
  }
  const editSection = (id: number) => {
    setMenu(null)
    if (blockedNow() || useDocumentOrder.getState().rollbackAt !== null || !onEditSection || !useStore.getState().sections.some(sec => sec.id === id)) return
    useShell.getState().setWorkspace('elements')
    onEditSection(id)
  }
  const openMenu = (event: React.MouseEvent, kind: 'element' | 'section', id: number) => {
    event.preventDefault()
    if (blockedNow() || useDocumentOrder.getState().rollbackAt !== null) return
    pick(`${kind}:${id}`)
    setMenu({ kind, id, x: Math.max(4, Math.min(event.clientX, window.innerWidth - 210)), y: Math.max(4, Math.min(event.clientY, window.innerHeight - 240)) })
  }
  const toggleVisible = (kind: 'element' | 'section', id: number) => {
    setMenu(null)
    if (visibilityBlockedNow()) return
    const store = useStore.getState()
    const item = (kind === 'element' ? store.elements : store.sections).find(item => item.id === id)
    if (!item) return
    const show = !item.visible || elementsHidden || coreVisibility?.on === false
    setCoreVisible(kind, [id], show)
  }
  const coreMask = !elementsHidden && coreVisibility?.on !== false
  const setCoreVisible = (kind: 'element' | 'section', ids: readonly number[], shown: boolean) => {
    if (visibilityBlockedNow()) return
    historyAction(`${shown ? 'show' : 'hide'} ${kind}s`, () => {
      const store = useStore.getState()
      if (shown) { store.setElementsHidden(false); coreVisibility?.set(true) }
      for (const item of kind === 'element' ? store.elements : store.sections) {
        if (ids.includes(item.id) && item.visible !== shown) (kind === 'element' ? store.toggleElementVisible : store.toggleSectionVisible)(item.id)
      }
    })
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
  const elementGroups = [ ['plane', 'Planes'], ['cylinder', 'Cylinders'], ['cone', 'Cones'], ['sphere', 'Spheres'], ['line', 'Lines'], ['point', 'Points'], ['circle', 'Circles'], ['torus', 'Tori'] ] as const
  const historyElements = archive?.elements ?? elements
  const historySections = archive?.sections ?? sections
  const elementRow = (el: (typeof elements)[number], location: 'object' | 'history') => { const rolled = !elements.some(active => active.id === el.id); return <div key={el.id} data-test={`explorer-${location === 'history' ? 'history-' : ''}element-row-${el.id}`} className={`explorer-row${isSelected(`element:${el.id}`) ? ' selected' : ''}${rolled ? ' is-rolled' : ''}`} onContextMenu={event => openMenu(event, 'element', el.id)}>
    <ExplorerCheckbox values={[!rolled && el.visible && coreMask]} label={`${el.name} visibility`} disabled={visibilityLocked || rolled} onSet={() => toggleVisible('element', el.id)} />
    <button type="button" className="explorer-item" data-test={`explorer-${location === 'history' ? 'history-' : ''}element-${el.id}`} disabled={(locked && !aligning) || rollbackAt !== null} aria-pressed={isSelected(`element:${el.id}`)} onClick={(ev) => pick(`element:${el.id}`, ev.ctrlKey || ev.metaKey)} onDoubleClick={() => editElement(el.id)} title={rollbackAt !== null ? 'Restore End of Model before editing.' : `${el.kind} · Right-click for actions, double-click to edit`}><span className="explorer-color" style={{ background: el.color }} /><span>{el.name}</span></button>
  </div> }
  const sectionRow = (sec: (typeof sections)[number], location: 'object' | 'history') => { const rolled = !sections.some(active => active.id === sec.id); return <div key={sec.id} data-test={`explorer-${location === 'history' ? 'history-' : ''}section-row-${sec.id}`} className={`explorer-row${isSelected(`section:${sec.id}`) ? ' selected' : ''}${rolled ? ' is-rolled' : ''}`} onContextMenu={event => openMenu(event, 'section', sec.id)}>
    <ExplorerCheckbox values={[!rolled && sec.visible && coreMask]} label={`${sec.name} visibility`} disabled={visibilityLocked || rolled} onSet={() => toggleVisible('section', sec.id)} />
    <button type="button" className="explorer-item" data-test={`explorer-${location === 'history' ? 'history-' : ''}section-${sec.id}`} disabled={(locked && !aligning) || rollbackAt !== null} aria-pressed={isSelected(`section:${sec.id}`)} onClick={(ev) => pick(`section:${sec.id}`, ev.ctrlKey || ev.metaKey)} onDoubleClick={() => editSection(sec.id)} title={rollbackAt !== null ? 'Restore End of Model before editing.' : 'Right-click for actions, double-click to edit section'}><TreeMark kind="plane" /><span>{sec.name}</span></button>
  </div> }
  const scanRow = (location: 'object' | 'history') => <div className={`explorer-row${isSelected('scan') ? ' selected' : ''}`}>
    <ExplorerCheckbox values={[scanShown]} label={`${fileName} visibility`} disabled={scanDisabled} onSet={setScanVisible} />
    <button type="button" className="explorer-item" data-test={`explorer-${location}-scan`} aria-pressed={isSelected('scan')} onClick={(ev) => pick('scan', ev.ctrlKey || ev.metaKey)} title={`${fileName} · ${triangles.toLocaleString()} triangles`}><TreeMark kind="mesh" /><span>{fileName?.replace(/\.[^.]+$/, '')}{location === 'object' && ` (T: ${triangles.toLocaleString()})`}</span></button>
  </div>
  const coreKey = (id: number) => historyElements.some(el => el.id === id) ? `core:element:${id}` : `core:section:${id}`
  const historyEntries: { key: string; node: ReactNode; label?: string; parents?: readonly string[] }[] = [
    ...(fileName ? [{ key: 'scan', label: fileName, node: scanRow('history') }] : []),
    ...historyElements.map(el => ({ key: `core:element:${el.id}`, label: el.name, parents: el.source.type === 'constructed' ? el.source.refs.map(coreKey) : [], node: elementRow(el, 'history') })),
    ...historySections.map(sec => ({ key: `core:section:${sec.id}`, label: sec.name, parents: sectionRefElement(sec.ref) === null ? [] : [`core:element:${sectionRefElement(sec.ref)}`], node: sectionRow(sec, 'history') })),
    ...pluginHistoryEntries,
  ]
  const orderAt = new Map(order.map((key, index) => [key, index]))
  historyEntries.sort((a, b) => (orderAt.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (orderAt.get(b.key) ?? Number.MAX_SAFE_INTEGER))
  const dropBoundary = (event: React.DragEvent, at: number | null) => {
    if (!event.dataTransfer.types.includes('application/x-quickscan-history-boundary')) return
    event.preventDefault()
    if (!blockedNow()) setDocumentHistoryBoundary(at)
  }
  const dragOver = (event: React.DragEvent) => { if (!locked && event.dataTransfer.types.includes('application/x-quickscan-history-boundary')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }
  const endMarker = <div className="explorer-end-model" data-test="explorer-end-model" draggable={!locked} tabIndex={0} aria-label="End of Model boundary" title="Drag before a History row to move the model boundary. End restores the full model; Home returns to the first step." onDragStart={event => { if (blockedNow()) { event.preventDefault(); return }; event.dataTransfer.setData('application/x-quickscan-history-boundary', 'model'); event.dataTransfer.effectAllowed = 'move' }} onKeyDown={event => { if (blockedNow()) return; if (event.key === 'End') { event.preventDefault(); documentHistoryToEnd() }; if (event.key === 'Home') { event.preventDefault(); setDocumentHistoryBoundary(fileName ? 1 : 0) } }}><span aria-hidden="true">↥</span> &lt; End of Model &gt;</div>
  const historyRows: ReactNode[] = []
  let markerInserted = false
  for (const entry of historyEntries) {
    if (!markerInserted && rollbackAt !== null && (orderAt.get(entry.key) ?? Infinity) >= rollbackAt) { historyRows.push(<div key="model-end">{endMarker}</div>); markerInserted = true }
    historyRows.push(<div key={entry.key} data-order-key={entry.key} onDragOver={dragOver} onDrop={event => dropBoundary(event, orderAt.get(entry.key) ?? null)}>{entry.node}</div>)
  }
  if (!markerInserted) historyRows.push(<div key="model-end">{endMarker}</div>)
  // Display a dependency DAG once, under the earliest existing parent.
  // Preserve other dependencies in the tooltip and reject cyclic edges.
  const entryAt = new Map(historyEntries.map((entry, index) => [entry.key, index]))
  const children = new Map<string, typeof historyEntries>()
  const roots: typeof historyEntries = []
  for (const entry of historyEntries) {
    const parents = (entry.parents ?? []).filter(key => (entryAt.get(key) ?? Infinity) < entryAt.get(entry.key)!)
    parents.sort((a, b) => entryAt.get(a)! - entryAt.get(b)!)
    const parent = parents[0]
    if (parent) children.set(parent, [...(children.get(parent) ?? []), entry])
    else roots.push(entry)
  }
  const dependencyRows = (entries: typeof historyEntries): ReactNode => entries.map(entry => {
    const nested = children.get(entry.key) ?? []
    const collapsed = collapsedParents.has(entry.key)
    return <div key={entry.key} data-order-key={entry.key} className="explorer-dependency-entry" title={(entry.parents ?? []).length > 1 ? `Dependencies: ${entry.parents!.map(key => historyEntries.find(item => item.key === key)?.label ?? 'Unavailable reference').join(', ')}` : undefined}>
      <div className="explorer-dependency-row">{nested.length > 0 ? <button type="button" className="explorer-dependency-toggle" aria-label={`${collapsed ? 'Expand' : 'Collapse'} dependencies ${entry.key}`} aria-expanded={!collapsed} onClick={() => setCollapsedParents(current => { const next = new Set(current); if (collapsed) next.delete(entry.key); else next.add(entry.key); return next })}>{collapsed ? '▸' : '▾'}</button> : <span className="explorer-dependency-spacer" />}{entry.node}</div>
      {nested.length > 0 && !collapsed && <div className="explorer-dependency-children">{dependencyRows(nested)}</div>}
    </div>
  })
  const expandHistory = (expanded: boolean) => {
    const tree = explorer.current?.querySelector<HTMLDetailsElement>('.explorer-history-root')
    if (tree) tree.open = true
    setCollapsedParents(expanded ? new Set() : new Set(children.keys()))
  }
  const boundary = rollbackAt ?? order.length
  const menuItem = menu && (menu.kind === 'element' ? elements : sections).find(item => item.id === menu.id)

  return <aside ref={explorer} className="object-explorer" aria-label="Object explorer" data-test="object-explorer" onKeyDown={event=>{
      const editable=(event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]') !== null
      if(!objectDeleteKey(event.key,editable,event.ctrlKey||event.altKey||event.metaKey||event.shiftKey,event.repeat) || !selected) return
      const match=/^(element|section):(\d+)$/.exec(selected)
      if(!match || blockedNow()) return
      event.preventDefault();event.stopPropagation();deleteObject(match[1] as 'element'|'section',Number(match[2]))
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
      {elementGroups.map(([kind, label]) => { const items = elements.filter(el => el.kind === kind); return <ExplorerGroup key={kind} label={label} values={items.map(el => el.visible && coreMask)} disabled={visibilityLocked} onSet={shown => setCoreVisible('element', items.map(el => el.id), shown)} testId={`explorer-${kind}-group`}>
        {items.map(el => elementRow(el, 'object'))}
      </ExplorerGroup> })}
      <ExplorerGroup label="Sections" values={sections.map(sec => sec.visible && coreMask)} disabled={visibilityLocked} onSet={shown => setCoreVisible('section', sections.map(sec => sec.id), shown)} testId="explorer-sections">
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
    {renaming && <form className="explorer-rename" onSubmit={event=>{event.preventDefault();if(!blockedNow() && renameCoreObject(renaming.kind,renaming.id,renaming.name)) setRenaming(null)}}>
      <label>Rename <input autoFocus aria-label="Object name" value={renaming.name} onChange={event=>setRenaming({...renaming,name:event.target.value})} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setRenaming(null)}}}/></label>
      <button type="submit" disabled={!renaming.name.trim() || locked}>OK</button><button type="button" onClick={()=>setRenaming(null)}>Cancel</button>
    </form>}
    {menu && menuItem && !locked && createPortal(<div role="menu" className="explorer-core-menu" style={{ left: menu.x, top: menu.y, zIndex: 1000 }}>
      <div className="explorer-core-menu-head">{menuItem.name}</div>
      <button type="button" role="menuitem" data-test="explorer-core-edit" disabled={menu.kind === 'element' ? !onEditElement : !onEditSection} onClick={() => menu.kind === 'element' ? editElement(menu.id) : editSection(menu.id)}>Edit ...</button>
      <button type="button" role="menuitem" onClick={()=>toggleVisible(menu.kind,menu.id)}>{menuItem.visible && coreMask ? 'Hide' : 'Show'}</button>
      <button type="button" role="menuitem" onClick={()=>{setRenaming({kind:menu.kind,id:menu.id,name:menuItem.name});setMenu(null)}}>Rename…</button>
      {menu.kind==='element' && <button type="button" role="menuitem" onClick={()=>{if(!blockedNow()){const id=duplicateCoreElement(menu.id);if(id!==null)pick(`element:${id}`)}setMenu(null)}}>Duplicate</button>}
      <button type="button" role="menuitem" disabled={menu.kind==='element'?!onDeleteElement:!onDeleteSection} onClick={()=>deleteObject(menu.kind,menu.id)}>Delete</button>
    </div>, document.body)}
  </aside>
}

