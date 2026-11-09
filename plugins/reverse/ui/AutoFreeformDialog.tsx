// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { useFreeformNavigation } from './useFreeformNavigation'
import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { commandHost } from '../../../src/commands/host'
import { ready } from '../app/reCommandCore'
import { prepareAutoCage } from '../app/reFreeformAutoCommand'
import { reverseSession } from '../app/reSession'
import { reSceneOf } from '../viewer/reScene'
import { AUTO_QUADS_MAX, AUTO_QUADS_MIN, AUTO_SYMMETRIES, AUTO_TARGETS, type AutoSymmetry } from '../core/freeform/auto'
import { reEditorOpen, useReverse } from '../state/reStore'

export const useAutoFreeformDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>(set => ({
  open: false, setOpen: open => set({ open }),
}))

export function AutoFreeformDialog({ onClose }: { onClose: () => void }) {
  const [density, setDensity] = useState<keyof typeof AUTO_TARGETS | 'custom'>('medium')
  const [custom, setCustom] = useState('2000')
  const [symmetry, setSymmetry] = useState<AutoSymmetry>('none')
  const backdrop = useFreeformNavigation()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [previewQuads, setPreviewQuads] = useState<number | null>(null)
  const previewVersion = useRef<number | null>(null)
  const alive = useRef(true)
  const form = useRef<HTMLFormElement>(null)
  const clearMesh = () => {
    const scene = reverseSession()?.sceneRef.current
    if (scene) reSceneOf(scene).setBodyPreview(null, '#ffffff')
    previewVersion.current = null
  }
  const clearPreview = () => { clearMesh(); setPreviewQuads(null) }
  const count = density === 'custom' ? Number(custom) : AUTO_TARGETS[density]
  const valid = Number.isInteger(count) && count >= AUTO_QUADS_MIN && count <= AUTO_QUADS_MAX
  useEffect(() => { clearPreview() }, [count, symmetry])
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; clearMesh() }
  }, [])
  const close = () => { if (!working) onClose() }
  async function preview() {
    if (!valid || working) return
    // Disabling the clicked button must not send keyboard focus outside the
    // dialog: Escape should still reach Cancel when the preview completes.
    form.current?.focus()
    setWorking(true); setError(''); clearPreview()
    try {
      const version = commandHost().session.clientRef.current?.scanVersion
      const state = useReverse.getState()
      if (useStore.getState().busy || state.building || reEditorOpen(state) || state.playback !== null) throw new Error('Finish the current operation first.')
      const session = await ready()
      const { cage, made } = await prepareAutoCage(session, count, symmetry)
      const result = await session.client()!.preview({ kind: 'freeform', id: -1, name: 'Auto Freeform preview', positions: Array.from(cage.positions), faces: cage.faces, creases: cage.creases, steps: 2, snap: true }, undefined)
      if (!alive.current) return
      if (version === undefined || version !== commandHost().session.clientRef.current?.scanVersion) throw new Error('The scan changed. Preview again before continuing.')
      if (!result) throw new Error('The preview was superseded. Preview again.')
      const scene = session.sceneRef.current
      if (!scene) throw new Error('The viewport is unavailable.')
      reSceneOf(scene).setBodyPreview(result.mesh, '#5da9d6', { cage })
      previewVersion.current = version
      setPreviewQuads(made.quads)
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (alive.current) setWorking(false) }
  }
  async function generate() {
    if (!valid || working) return
    const state = useReverse.getState(), scan = useStore.getState()
    if (previewVersion.current !== null && previewVersion.current !== commandHost().session.clientRef.current?.scanVersion) {
      clearPreview(); setError('The scan changed. Preview again before continuing.'); return
    }
    if (!scan.fileName || scan.busy || state.building || state.playback !== null || reEditorOpen(state)) {
      setError('Import a scan and finish the current operation first.')
      return
    }
    setWorking(true)
    setError('')
    try {
      await runCommand('reverse.freeform.auto', { algorithm: 'basic', quads: count, symmetry }, text => useStore.getState().setStatus(text))
      useStore.getState().setStatus('Auto Freeform created.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setWorking(false) }
  }
  return <div ref={backdrop} className="modalback" style={{ background: 'transparent', alignItems: 'flex-start', justifyContent: 'flex-start', paddingTop: 176, paddingLeft: 'min(244px, max(12px, calc(100vw - 350px)))' }} data-test="auto-freeform-dialog" onKeyDown={e => {
    e.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); close() }
  }}>
    <form ref={form} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby="auto-freeform-title"
      style={{ width: 330, display: 'grid', gap: 12, padding: 14 }}
      onSubmit={e => { e.preventDefault(); void generate() }}>
      <header id="auto-freeform-title" style={{ fontWeight: 600 }}>Auto Freeform</header>
      <fieldset disabled={working} style={{ display: 'grid', gap: 10, border: 0, padding: 0, margin: 0 }}>
        <label>Algorithm <select aria-label="Algorithm" value="basic" disabled><option value="basic">Basic</option></select></label>
        <label>Target Quads Count <select autoFocus aria-label="Target Quads Count" value={density} onChange={e => setDensity(e.target.value as typeof density)}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="fine">Fine</option><option value="custom">Custom</option>
        </select></label>
        {density === 'custom' && <label>Quads <input aria-label="Quads" type="number" min={AUTO_QUADS_MIN} max={AUTO_QUADS_MAX} step="1" value={custom} onChange={e => setCustom(e.target.value)} /></label>}
        <label>Symmetry <select aria-label="Symmetry" value={symmetry} onChange={e => setSymmetry(e.target.value as AutoSymmetry)}>
          {AUTO_SYMMETRIES.map(s => <option key={s} value={s}>{s === 'none' ? 'None' : s.toUpperCase()}</option>)}
        </select></label>
      </fieldset>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" data-test="auto-freeform-preview" disabled={!valid || working} onClick={() => void preview()}>Preview</button>
        <button type="button" data-test="auto-freeform-clear" disabled={working || previewQuads === null} onClick={clearPreview}>Clear Result</button>
      </div>
      {previewQuads !== null && <small data-test="auto-freeform-quads">Actual number of quads: {previewQuads.toLocaleString()}</small>}
      {error && <small role="alert">{error}</small>}
      {working && <small role="status">Creating freeform surface…</small>}
      <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" disabled={working} onClick={close}>Cancel</button>
        <button type="submit" data-test="auto-freeform-ok" disabled={!valid || working}>OK</button>
      </footer>
    </form>
  </div>
}
