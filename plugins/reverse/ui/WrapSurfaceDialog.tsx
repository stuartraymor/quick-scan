// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { runCommand } from '../../../src/commands/registry'
import { commandHost } from '../../../src/commands/host'
import { useStore } from '../../../src/state/store'
import { reverseSession } from '../app/reSession'
import { ready } from '../app/reCommandCore'
import { prepareWrapCage } from '../app/reFreeformWrapCommand'
import { reSceneOf } from '../viewer/reScene'
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
  const [previewReady, setPreviewReady] = useState(false)
  const alive = useRef(true)
  const form = useRef<HTMLFormElement>(null)
  const clearMesh = () => {
    const scene = reverseSession()?.sceneRef.current
    if (scene) reSceneOf(scene).setBodyPreview(null, '#ffffff')
  }
  useEffect(() => { clearMesh(); setPreviewReady(false) }, [density, selection])
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearMesh() } }, [])
  async function preview() {
    if (!selection || working) return
    form.current?.focus()
    setWorking(true); setError(''); clearMesh(); setPreviewReady(false)
    try {
      const state = useReverse.getState()
      if (useStore.getState().busy || state.building || state.playback !== null || reEditorOpen(state)) throw new Error('Finish the current operation first.')
      if (commandHost().session.clientRef.current?.scanVersion !== selection.scanVersion) throw new Error('The scan changed. Close this dialog and select the region again.')
      const session = await ready()
      const { cage, snapRegion } = await prepareWrapCage(session, selection.vertices, density)
      const result = await session.client()!.preview({ kind: 'freeform', id: -1, name: 'Wrap Surface preview', positions: Array.from(cage.positions), faces: cage.faces, creases: cage.creases, steps: 2, snap: true, ...(snapRegion ? { snapRegion } : {}) }, undefined)
      if (!alive.current) return
      if (commandHost().session.clientRef.current?.scanVersion !== selection.scanVersion) throw new Error('The scan changed. Close this dialog and select the region again.')
      if (!result) throw new Error('The preview was superseded. Preview again.')
      const scene = session.sceneRef.current
      if (!scene) throw new Error('The viewport is unavailable.')
      reSceneOf(scene).setBodyPreview(result.mesh, '#5da9d6')
      setPreviewReady(true)
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (alive.current) setWorking(false) }
  }
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
  return <div className="modalback" style={{ background: 'transparent', alignItems: 'flex-start', justifyContent: 'flex-start', paddingTop: 176, paddingLeft: 'min(244px, max(12px, calc(100vw - 350px)))' }} data-test="wrap-surface-dialog" onKeyDown={e => {
    e.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); close() }
  }}>
    <form ref={form} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="wrap-surface-title"
      style={{ width: 300, display: 'grid', gap: 12, padding: 14 }}
      onSubmit={e => { e.preventDefault(); void generate() }}>
      <header id="wrap-surface-title" style={{ fontWeight: 600 }}>Wrap Surface</header>
      <small>{selection?.vertices.length.toLocaleString()} selected points</small>
      <label>Details <select autoFocus aria-label="Details" disabled={working} value={density} onChange={e => setDensity(e.target.value as WrapDensity)}>
        <option value="low">Low</option><option value="medium">Medium</option><option value="fine">Fine</option>
      </select></label>
      <button type="button" data-test="wrap-surface-preview" disabled={working} onClick={() => void preview()}>Preview</button>
      {previewReady && <small data-test="wrap-surface-preview-ready">Preview ready</small>}
      {error && <small role="alert">{error}</small>}
      {working && <small role="status">Creating wrap surface…</small>}
      <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" disabled={working} onClick={close}>Cancel</button>
        <button type="submit" data-test="wrap-surface-ok" disabled={working}>OK</button>
      </footer>
    </form>
  </div>
}
