// SPDX-License-Identifier: AGPL-3.0-only
// The lower half of QUICKSURFACE's Edit Scan dialog, recorded live on
// 8.0.128: Save selection status… — a name asked for, the selection kept
// under it with Apply, Update to current, Rename and Delete — the
// Additional tools — Smooth selected area (Ctrl + M), Project the mesh
// boundaries on OXY plane, Defeature selected area (Ctrl + D) — and Show
// mesh wireframe.

import { useState } from 'react'
import { useStore } from '../../../src/state/store'
import { useMark } from '../../../src/state/markStore'
import { useMeshTools } from '../state/meshStore'
import { meshHotkeys } from '../app/meshHotkeys'
import { ClippingBox } from './ClippingBox'

export function EditScanExtras({ busy }: { busy: boolean }) {
  const marked = useMark((s) => s.count)
  const wireframe = useStore((s) => s.wireframe)
  const quickTools = useMark((s) => s.quickTools)
  const statuses = useMeshTools((s) => s.selectionStatuses)
  // The name box Save selection status… opens, as QUICKSURFACE's does.
  const [naming, setNaming] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
  const none = busy || marked === 0
  const [clipping, setClipping] = useState(false)
  const save = () => {
    const name = naming?.trim()
    if (!name || name === '<<name>>') return
    if (meshHotkeys.saveSelection?.(name)) setNaming(null)
  }
  return (
    <div className="group" data-test="edit-scan-extras">
      {clipping && <ClippingBox onClose={() => setClipping(false)} />}
      <div className="toolrow">
        <button data-test="clipping-box-open" disabled={busy || clipping} title="Show only what is inside a box you size with handles — to hide or delete the rest" onClick={() => setClipping(true)}>
          Clipping Box …
        </button>
        <button data-test="save-selection" disabled={none} title="Keep the surface selected now under a name, to apply it again later" onClick={() => setNaming('<<name>>')}>
          Save selection status …
        </button>
      </div>
      {naming !== null && (
        <form className="field" data-test="selection-status-name" onSubmit={(e) => { e.preventDefault(); save() }}>
          <span>Selection status</span>
          <input autoFocus value={naming} onFocus={(e) => e.target.select()} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNaming(null) }} />
          <button type="submit">OK</button>
          <button type="button" onClick={() => setNaming(null)}>Cancel</button>
        </form>
      )}
      {statuses.map((st) => (
        <div className="kv" key={st.name} data-test="selection-status">
          {renaming?.from === st.name ? (
            <form onSubmit={(e) => { e.preventDefault(); useMeshTools.getState().renameSelectionStatus(st.name, renaming.to); setRenaming(null) }}>
              <input autoFocus value={renaming.to} onChange={(e) => setRenaming({ from: st.name, to: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null) }} onBlur={() => setRenaming(null)} />
            </form>
          ) : (
            <span className="name" title={`${st.vertices.length.toLocaleString()} points`} onKeyDown={(e) => { if (e.key === 'F2') setRenaming({ from: st.name, to: st.name }) }} tabIndex={0}>{st.name}</span>
          )}
          <span className="toolrow">
            <button data-test="selection-apply" disabled={busy} onClick={() => meshHotkeys.applySelection?.(st.name)}>Apply</button>
            <button data-test="selection-update" disabled={none} title="Update to current: keep the selection as it is now under this name" onClick={() => meshHotkeys.saveSelection?.(st.name)}>Update to current</button>
            <button data-test="selection-rename" title="Rename (F2)" onClick={() => setRenaming({ from: st.name, to: st.name })}>Rename …</button>
            <button data-test="selection-delete" onClick={() => useMeshTools.getState().deleteSelectionStatus(st.name)}>Delete …</button>
          </span>
        </div>
      ))}
      <div className="sec-head">Additional tools</div>
      <div className="toolrow">
        <button data-test="smooth-selected" disabled={none} title="Smooth selected area (Ctrl + M)" onClick={() => meshHotkeys.smooth?.()}>Smooth selected</button>
        <button data-test="project-boundaries" disabled={busy} title="Project the mesh boundaries on OXY plane" onClick={() => meshHotkeys.projectBoundaries?.()}>Project boundaries</button>
        <button data-test="defeature-selected" disabled={none} title="Defeature selected area (Ctrl + D)" onClick={() => meshHotkeys.defeature?.()}>Defeature</button>
      </div>
      <label className="checkrow">
        <input type="checkbox" data-test="edit-scan-quick-tools" checked={quickTools} onChange={(e) => useMark.getState().setQuickTools(e.target.checked)} />
        <span>Show quick tools dialog</span>
      </label>
      <label className="checkrow">
        <input type="checkbox" data-test="edit-scan-wireframe" checked={wireframe} onChange={(e) => useStore.getState().setWireframe(e.target.checked)} />
        <span>Show mesh wireframe</span>
      </label>
    </div>
  )
}
