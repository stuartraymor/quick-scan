// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { commandHost } from '../../../src/commands/host'
import { ready } from '../app/reCommandCore'
import { prepareSketchCage } from '../app/reFreeformSketchCommand'
import { reverseSession } from '../app/reSession'
import { reSceneOf } from '../viewer/reScene'
import { SKETCH_RESOLUTION_MAX } from '../core/freeform/sketch'
import { reEditorOpen, useReverse } from '../state/reStore'

export const useFreeformSketchDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>(set => ({
  open: false, setOpen: open => set({ open }),
}))

export function FreeformSketchDialog() {
  const features = useReverse(s => s.features)
  const networks = features.filter(f => f.kind === 'network')
  const [network, setNetwork] = useState(networks.length === 1 ? String(networks[0].id) : '')
  const [resolution, setResolution] = useState('1')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const level = Number(resolution)
  const valid = networks.some(f => String(f.id) === network) && Number.isInteger(level) && level >= 1 && level <= SKETCH_RESOLUTION_MAX
  const [previewReady, setPreviewReady] = useState(false)
  const alive = useRef(true)
  const form = useRef<HTMLFormElement>(null)
  const source = features.find(f => f.kind === 'network' && String(f.id) === network)
  const clearMesh = () => {
    const scene = reverseSession()?.sceneRef.current
    if (scene) reSceneOf(scene).setBodyPreview(null, '#ffffff')
  }
  useEffect(() => { clearMesh(); setPreviewReady(false) }, [source, level])
  useEffect(() => { alive.current = true; return () => { alive.current = false; clearMesh() } }, [])
  async function preview() {
    if (!valid || working || source?.kind !== 'network') return
    form.current?.focus()
    setWorking(true); setError(''); clearMesh(); setPreviewReady(false)
    try {
      const state = useReverse.getState()
      if (useStore.getState().busy || state.building || state.playback !== null || reEditorOpen(state)) throw new Error('Finish the current operation first.')
      const version = commandHost().session.clientRef.current?.scanVersion
      const session = await ready()
      const { cage } = await prepareSketchCage(session, source, level)
      const result = await session.client()!.preview({ kind: 'freeform', id: -1, name: 'From 3D Sketch preview', positions: Array.from(cage.positions), faces: cage.faces, creases: cage.creases, steps: 2, snap: true }, undefined)
      if (!alive.current) return
      if (version === undefined || version !== commandHost().session.clientRef.current?.scanVersion || useReverse.getState().features.find(f => f.id === source.id) !== source) throw new Error('The scan or sketch changed. Preview again.')
      if (!result) throw new Error('The preview was superseded. Preview again.')
      const scene = session.sceneRef.current
      if (!scene) throw new Error('The viewport is unavailable.')
      reSceneOf(scene).setBodyPreview(result.mesh, '#5da9d6')
      setPreviewReady(true)
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (alive.current) setWorking(false) }
  }
  const close = () => { if (!working) useFreeformSketchDialog.getState().setOpen(false) }
  async function generate() {
    if (!valid || working) return
    const state = useReverse.getState()
    if (useStore.getState().busy || state.building || state.playback !== null || reEditorOpen(state)) {
      setError('Finish the current operation first.'); return
    }
    setWorking(true); setError('')
    try {
      await runCommand('reverse.freeform.from_sketch', { network: Number(network), resolution: level }, text => useStore.getState().setStatus(text))
      useStore.getState().setStatus('Freeform from 3D Sketch created.')
      useFreeformSketchDialog.getState().setOpen(false)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setWorking(false) }
  }
  return <div className="modalback" data-test="freeform-sketch-dialog" onKeyDown={e => {
    e.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); close() }
  }}>
    <form ref={form} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="freeform-sketch-title"
      style={{ width: 330, display: 'grid', gap: 12, padding: 14 }}
      onSubmit={e => { e.preventDefault(); void generate() }}>
      <header id="freeform-sketch-title" style={{ fontWeight: 600 }}>Freeform from 3D Sketch</header>
      <label>3D Sketch <select autoFocus aria-label="3D Sketch" disabled={working} value={network} onChange={e => setNetwork(e.target.value)}>
        <option value="">Select a sketch…</option>
        {networks.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select></label>
      <label>Resolution <input aria-label="Resolution" type="number" min="1" max={SKETCH_RESOLUTION_MAX} step="1" disabled={working} value={resolution} onChange={e => setResolution(e.target.value)} /></label>
      <button type="button" data-test="freeform-sketch-preview" disabled={!valid || working} onClick={() => void preview()}>Preview</button>
      {previewReady && <small data-test="freeform-sketch-preview-ready">Preview ready</small>}
      {error && <small role="alert">{error}</small>}
      {working && <small role="status">Creating freeform surface…</small>}
      <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" disabled={working} onClick={close}>Cancel</button>
        <button type="submit" data-test="freeform-sketch-ok" disabled={!valid || working}>OK</button>
      </footer>
    </form>
  </div>
}
