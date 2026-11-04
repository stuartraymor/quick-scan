// SPDX-License-Identifier: AGPL-3.0-only
// The application menu: opened from the Quick Scan mark at the top left, the
// way the File menu of the reference opens. Commands on the left, recent
// documents on the right. Recent documents exist in the desktop app only —
// a browser cannot reopen a file by its path.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ExampleLibrarySettings } from './ExampleLibrarySettings'
import { useDismiss } from './useDismiss'
import { Icon, type IconName } from './icons'
import { ExportMeshButton } from './ExportMeshButton'
import { useUpdater } from './UpdateButton'
import { useShell } from '../state/shellStore'
import { useStore } from '../state/store'
import { PROJECT_EXTENSION } from '../core/project/manifest'
import type { MeshFormat } from '../core/exportMesh'

export interface RecentDocument {
  path: string
  name: string
  folder: string
  openedAt: number
  exists: boolean
}
interface FilesBridge {
  recent(): Promise<RecentDocument[]>
  open(path: string): Promise<{ name: string; data: Uint8Array }>
  clear(): Promise<RecentDocument[]>
  onChanged(cb: () => void): () => void
}
export const OPEN_FILE_EVENT = 'quickscan:open-file'
export const filesBridge = (): FilesBridge | undefined => (window as unknown as { quickScanFiles?: FilesBridge }).quickScanFiles

/** "2 h ago", "yesterday", or the date — for the recent list. */
export function ago(then: number, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - then) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : new Date(then).toLocaleDateString()
}

export function AppMenu({
  onNew,
  onSave,
  onOpen,
  onImportScan,
  onImportCad,
  onExportModel,
  onExportMesh,
  onOpenFile,
  savable,
}: {
  onNew: () => void
  onSave: () => void
  onOpen: () => void
  onImportScan: () => void
  onImportCad: () => void
  onExportModel: () => void
  onExportMesh: (format: MeshFormat) => void
  onOpenFile: (file: File) => void
  savable: boolean
}) {
  const open = useShell((s) => s.appMenuOpen)
  const setOpen = useShell((s) => s.setAppMenuOpen)
  const busy = useStore((s) => s.busy)
  const hasScan = useStore((s) => s.fileName !== null)
  const updater = useUpdater()
  const files = filesBridge()
  const [settings, setSettings] = useState(false)
  const [recent, setRecent] = useState<RecentDocument[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const panel = useRef<HTMLDivElement>(null)
  const refresh = useCallback(() => {
    void files?.recent().then(setRecent).catch(() => setRecent([]))
  }, [files])
  useEffect(() => {
    if (open) {
      setProblem(null)
      refresh()
    }
  }, [open, refresh])
  useEffect(() => files?.onChanged(refresh), [files, refresh])
  useDismiss(open, () => setOpen(false), { outside: '[data-app-menu],[data-app-menu-button]' })
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
  }, [open])
  if (settings) return <ExampleLibrarySettings onClose={() => { setSettings(false); document.querySelector<HTMLElement>('[data-app-menu-button]')?.focus() }} />
  if (!open) return null
  const close = () => setOpen(false)
  const item = (label: string, icon: IconName, run: () => void, opts: { disabled?: boolean; title?: string; test: string; hint?: string }) => (
    <button
      key={opts.test}
      className="appmenu-item"
      role="menuitem"
      data-test={opts.test}
      disabled={opts.disabled}
      title={opts.title ?? label}
      onClick={() => {
        close()
        run()
      }}
    >
      <Icon name={icon} size={18} />
      <span>{label}</span>
      {opts.hint && <kbd>{opts.hint}</kbd>}
    </button>
  )
  const openRecent = async (doc: RecentDocument) => {
    if (!files) return
    try {
      const { name, data } = await files.open(doc.path)
      close()
      onOpenFile(new File([new Uint8Array(data)], name))
    } catch (e) {
      setProblem(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(e))
      refresh()
    }
  }
  return (
    <div className="appmenu" data-app-menu data-test="app-menu" role="dialog" aria-label="Quick Scan menu" ref={panel}>
      <div className="appmenu-commands" role="menu">
        {item('New project', 'newProject', onNew, { test: 'menu-new', disabled: busy })}
        {item('Open…', 'load', onOpen, { test: 'menu-open', disabled: busy, hint: 'Ctrl+O', title: `Open a .${PROJECT_EXTENSION} project, a scan or an image` })}
        {item('Import scan…', 'scan', onImportScan, { test: 'menu-import-scan', disabled: busy, title: 'Import an STL, PLY, OBJ or 3MF scan' })}
        {item('Import CAD…', 'exportStep', onImportCad, { test: 'menu-import-cad', disabled: busy, title: 'Import a STEP model' })}
        <hr />
        {item('Save', 'save', onSave, { test: 'menu-save', disabled: busy || !savable, hint: 'Ctrl+S' })}
        {item('Save as…', 'save', onSave, { test: 'menu-save-as', disabled: busy || !savable, title: 'Save the project under a new name — the desktop app asks where on every save' })}
        <hr />
        {item('Export model', 'exportStep', onExportModel, { test: 'menu-export-model', disabled: busy, title: 'Export the CAD model and fitted geometry as STEP' })}
        <div className="appmenu-export" role="none">
          <Icon name="scan" size={18} />
          <ExportMeshButton
            label="Export scan data"
            testId="menu-export-scan"
            block
            disabled={busy || !hasScan}
            onExport={(f) => {
              close()
              onExportMesh(f)
            }}
            title="Save the scan as an STL or 3MF where it now stands"
          />
        </div>
        <hr />
        {item('Settings', 'settings', () => setSettings(true), { test: 'menu-settings' })}
        {updater && (
          <>
            <hr />
            <button className="appmenu-item" role="menuitem" data-test="update-button" data-phase={updater.phase.kind} disabled={updater.busy} title={updater.title} onClick={updater.run}>
              <Icon name="load" size={18} />
              <span>{updater.label}</span>
            </button>
          </>
        )}
      </div>
      <div className="appmenu-recent" role="group" aria-label="Recent documents">
        <div className="appmenu-recent-head">
          <b>Recent documents</b>
          {files && recent.length > 0 && (
            <button className="linkish" data-test="menu-clear-recent" onClick={() => void files.clear().then(setRecent)}>
              Clear
            </button>
          )}
        </div>
        {!files && <p className="hint">Recent documents appear here in the Quick Scan desktop app.</p>}
        {files && recent.length === 0 && (
          <p className="hint" data-test="menu-recent-empty">
            Files you open or save will be listed here.
          </p>
        )}
        {problem && (
          <p className="hint" role="alert">
            {problem}
          </p>
        )}
        <ul>
          {recent.map((d) => (
            <li key={d.path}>
              <button className="appmenu-doc" data-test="menu-recent-item" disabled={!d.exists || busy} title={d.exists ? d.path : `${d.path} — file not found`} onClick={() => void openRecent(d)}>
                <b>{d.name}</b>
                <span>{d.exists ? d.folder : 'File not found'}</span>
                <small>{ago(d.openedAt)}</small>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
