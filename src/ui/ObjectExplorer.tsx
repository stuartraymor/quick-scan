// SPDX-License-Identifier: AGPL-3.0-only
// Document browser. Every eye calls the existing visibility action; the
// explorer does not own geometry or introduce a second document model.
import { useState, type ReactNode } from 'react'
import { useStore } from '../state/store'
import { useShell } from '../state/shellStore'
import { useHistory } from '../state/historyStore'
import { useUnits } from '../app/useUnits'
import './object-explorer.css'

function TreeMark({ kind = 'object' }: { kind?: 'object' | 'mesh' | 'plane' | 'history' }) {
  return <svg className="explorer-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    {kind === 'plane' ? <path d="M2 13 7 5l11 2-5 8Z M10 2v16" /> : kind === 'history' ? <><path d="M5 5a7 7 0 1 1-2 7 M2 3v5h5" /><path d="M10 6v5l3 2" /></> : kind === 'mesh' ? <><path d="m10 2 7 5v8l-7 3-7-5V5Z M3 5l7 6 7-4 M10 11v7 M10 2v9 M3 13l14 2" /></> : <><path d="m10 2 7 4v9l-7 3-7-4V6Z M3 6l7 4 7-4 M10 10v8" /></>}
  </svg>
}

function Eye({ shown, label, onClick, disabled }: { shown: boolean; label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className={`explorer-eye${shown ? '' : ' is-hidden'}`} aria-label={`${shown ? 'Hide' : 'Show'} ${label}`} title={`${shown ? 'Hide' : 'Show'} ${label}`} aria-pressed={shown} disabled={disabled} onClick={onClick}>
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><path d="M1.5 10s3-5 8.5-5 8.5 5 8.5 5-3 5-8.5 5-8.5-5-8.5-5Z" /><circle cx="10" cy="10" r="2.3" />{!shown && <path d="m3 2 14 16" />}</svg>
  </button>
}

function Group({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  return <details className="explorer-group" open><summary><span>{label}</span>{count !== undefined && <small>{count}</small>}</summary><div className="explorer-children">{children}</div></details>
}

export function ObjectExplorer({ pluginObjects, pluginHistory, onEditElement, onEditSection, interactionBlocked = false, scanVisibility }: { pluginObjects?: ReactNode; pluginHistory?: ReactNode; onEditElement?: (id: number) => void; onEditSection?: (id: number) => void; interactionBlocked?: boolean; scanVisibility?: { shown: boolean; toggle: () => void; disabled?: boolean } } = {}) {
  const [selected, setSelected] = useState<string | null>(null)
  const name = useStore(s => s.projectName)
  const fileName = useStore(s => s.fileName)
  const triangles = useStore(s => s.triangleCount)
  const elements = useStore(s => s.elements)
  const sections = useStore(s => s.sections)
  const busy = useStore(s => s.busy)
  const scanHidden = useStore(s => s.scanHidden)
  const workspace = useShell(s => s.workspace)
  const coreEditor = useStore(s => Boolean(s.draft || s.sectionDraft || s.dimDraft || s.alignDraft))
  const history = useHistory(s => s.past)
  const locked = busy || coreEditor || interactionBlocked
  const units = useUnits()
  const pick = (key: string) => setSelected(key)
  const editElement = (id: number) => {
    if (locked || !onEditElement) return
    useShell.getState().setWorkspace('elements')
    onEditElement(id)
  }
  const editSection = (id: number) => {
    if (locked || !onEditSection) return
    useShell.getState().setWorkspace('elements')
    onEditSection(id)
  }

  return <aside className="object-explorer" aria-label="Object explorer" data-test="object-explorer">
    <div className="explorer-heading" id="explorer-objects-heading"><span>OBJECTS</span><small>{elements.length + sections.length + (fileName ? 1 : 0)}</small></div>
    <div className="explorer-document"><TreeMark /><strong title={name || fileName || 'Untitled project'}>{name || fileName || 'Untitled project'}</strong></div>
    <section className="explorer-content explorer-objects" id="explorer-objects" aria-labelledby="explorer-objects-heading">
      <Group label="Scan data" count={fileName ? 1 : 0}>
        {fileName ? <div className={`explorer-row${selected === 'scan' ? ' selected' : ''}`}>
          <Eye shown={scanVisibility?.shown ?? !scanHidden} label={fileName} disabled={busy || (scanVisibility ? scanVisibility.disabled : !['elements', 'deviation', 'thickness'].includes(workspace))} onClick={scanVisibility?.toggle ?? (() => useStore.getState().setScanHidden(!scanHidden))} />
          <button type="button" className="explorer-item" onClick={() => pick('scan')} title={`${fileName} · ${triangles.toLocaleString()} triangles`}><TreeMark kind="mesh" /><span>{fileName}</span></button>
        </div> : <p className="explorer-empty">Open a scan to begin.</p>}
      </Group>
      <Group label="Coordinate system"><div className="explorer-row"><span className="explorer-item"><TreeMark kind="plane" /><span>Origin · X / Y / Z</span></span></div></Group>
      <Group label="Measured elements" count={elements.length}>
        {elements.map(el => <div key={el.id} className={`explorer-row${selected === `element:${el.id}` ? ' selected' : ''}`}>
          <Eye shown={el.visible} label={el.name} onClick={() => useStore.getState().toggleElementVisible(el.id)} />
          <button type="button" className="explorer-item" onClick={() => pick(`element:${el.id}`)} onDoubleClick={() => editElement(el.id)} title={`${el.kind} · Double-click to edit`}><span className="explorer-color" style={{ background: el.color }} /><span>{el.name}</span><small>{el.kind}</small></button>
        </div>)}
        {!elements.length && <p className="explorer-empty">Fitted and constructed geometry appears here.</p>}
      </Group>
      <Group label="Sections" count={sections.length}>
        {sections.map(sec => <div key={sec.id} className={`explorer-row${selected === `section:${sec.id}` ? ' selected' : ''}`}><Eye shown={sec.visible} label={sec.name} onClick={() => useStore.getState().toggleSectionVisible(sec.id)} /><button type="button" className="explorer-item" onClick={() => pick(`section:${sec.id}`)} onDoubleClick={() => editSection(sec.id)} title="Double-click to edit section"><TreeMark kind="plane" /><span>{sec.name}</span></button></div>)}
        {!sections.length && <p className="explorer-empty">Cross sections appear here.</p>}
      </Group>
      {pluginObjects}
    </section>
    <section className="explorer-history-panel" aria-labelledby="explorer-history-heading">
      <div className="explorer-heading" id="explorer-history-heading"><TreeMark kind="history" /><span>HISTORY</span><small>{history.length}</small></div>
      <div className="explorer-content" id="explorer-history">
      {pluginHistory}
      <Group label="Session edits" count={history.length}>
        {history.map((entry, index) => <div key={index} className="explorer-history-entry"><small>{index + 1}</small><span>{entry.label}</span></div>)}
        {!history.length && <p className="explorer-empty">Completed edits appear here. Use Undo and Redo to step through them.</p>}
      </Group>
      </div>
    </section>
    <div className="explorer-footer">{triangles ? `${triangles.toLocaleString()} triangles` : 'No scan loaded'}<span>{units}</span></div>
  </aside>
}

