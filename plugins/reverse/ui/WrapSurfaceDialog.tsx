// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { create } from 'zustand'
import { runCommand } from '../../../src/commands/registry'
import { commandHost } from '../../../src/commands/host'
import { useStore } from '../../../src/state/store'
import { reverseSession } from '../app/reSession'
import { SURFACE_MIN_REGION } from '../core/features'
import type { WrapDensity } from '../core/freeform/wrap'
import { reEditorOpen, useReverse } from '../state/reStore'

interface WrapSelection { vertices: number[]; scanVersion: number }
export const useWrapSurfaceDialog = create<{ selection: WrapSelection | null; close: () => void }>(set => ({
  selection: null, close: () => set({ selection: null }),
}))

export function openWrapSurface(): void {
  const scene = reverseSession()?.sceneRef.current
  const vertices = scene?.paintedVertices(), scan = scene?.scanPositions()
  if (!scan || !vertices || vertices.length < SURFACE_MIN_REGION) {
    useStore.getState().setStatus('Select a region of the scan before using Wrap Surface.')
    return
  }
  useWrapSurfaceDialog.setState({ selection: { vertices: Array.from(vertices), scanVersion: commandHost().session.clientRef.current?.scanVersion ?? -1 } })
}

export function WrapSurfaceDialog() {
  const selection = useWrapSurfaceDialog(s => s.selection)
  const [density, setDensity] = useState<WrapDensity>('low')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const close = () => { if (!working) useWrapSurfaceDialog.getState().close() }
  async function generate() {
    if (!selection || working) return
    const state = useReverse.getState()
    if (commandHost().session.clientRef.current?.scanVersion !== selection.scanVersion) {
      setError('The scan changed. Close this dialog and select the region again.'); return
    }
    if (useStore.getState().busy || state.building || state.playback !== null || reEditorOpen(state)) {
      setError('Finish the current operation first.'); return
    }
    setWorking(true); setError('')
    try {
      await runCommand('reverse.freeform.wrap', { region: selection.vertices, density }, text => useStore.getState().setStatus(text))
      useStore.getState().setStatus('Wrap Surface created.')
      useWrapSurfaceDialog.getState().close()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setWorking(false) }
  }
  return <div className="modalback" data-test="wrap-surface-dialog" onKeyDown={e => {
    e.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); close() }
  }}>
    <form className="modal" role="dialog" aria-modal="true" aria-labelledby="wrap-surface-title"
      style={{ width: 300, display: 'grid', gap: 12, padding: 14 }}
      onSubmit={e => { e.preventDefault(); void generate() }}>
      <header id="wrap-surface-title" style={{ fontWeight: 600 }}>Wrap Surface</header>
      <small>{selection?.vertices.length.toLocaleString()} selected points</small>
      <label>Details <select autoFocus aria-label="Details" disabled={working} value={density} onChange={e => setDensity(e.target.value as WrapDensity)}>
        <option value="low">Low</option><option value="medium">Medium</option><option value="fine">Fine</option>
      </select></label>
      {error && <small role="alert">{error}</small>}
      {working && <small role="status">Creating wrap surface…</small>}
      <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" disabled={working} onClick={close}>Cancel</button>
        <button type="submit" data-test="wrap-surface-ok" disabled={working}>OK</button>
      </footer>
    </form>
  </div>
}
