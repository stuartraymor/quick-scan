// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../../../src/state/store'
import { commandHost } from '../../../src/commands/host'
import { reverseSession } from '../app/reSession'
import { reSceneOf } from '../viewer/reScene'
import { previewDeviationColours, type PreviewColouring } from '../core/freeform/previewDeviation'

/** Display-only controls. The reference scan and committed bodies are untouched. */
export function FreeformSurfaceDisplay({ positions }: { positions: Float32Array }) {
  const [surfaceOnly, setSurfaceOnly] = useState(false)
  const [deviation, setDeviation] = useState(false)
  const [options, setOptions] = useState(false)
  const [tolerance, setTolerance] = useState(.01)
  const [colouring, setColouring] = useState<PreviewColouring>('gradient')
  const [draft, setDraft] = useState('0.01')
  const [draftColouring, setDraftColouring] = useState<PreviewColouring>('gradient')
  const [values, setValues] = useState<Float32Array | null>(null)
  const [error, setError] = useState('')
  const optionsButton = useRef<HTMLButtonElement>(null)
  const closeOptions = () => { setOptions(false); optionsButton.current?.focus() }
  const version = useRef(commandHost().session.clientRef.current?.scanVersion)
  useEffect(() => {
    if (!deviation) return
    let alive = true
    const session = reverseSession()
    const current = () => version.current === commandHost().session.clientRef.current?.scanVersion
    if (!current()) { setError('The scan changed. Preview again.'); return }
    if (!values) {
      setError('')
      void session?.client()?.previewSurfaceDeviation(positions).then(result => {
        if (!alive) return
        if (!current()) { setError('The scan changed. Preview again.'); return }
        setValues(result)
      }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    }
    return () => { alive = false }
  }, [positions, deviation, values])
  useEffect(() => {
    const scene = reverseSession()?.sceneRef.current
    if (!scene) return
    const view = reSceneOf(scene)
    if (view.bodyPreview?.geometry.getAttribute('position').array !== positions) return
    if (version.current !== commandHost().session.clientRef.current?.scanVersion) return
    view.setPreviewColours(deviation && values ? previewDeviationColours(values, tolerance, colouring) : null)
  }, [positions, deviation, values, tolerance, colouring])
  useEffect(() => {
    const scene = reverseSession()?.sceneRef.current
    if (!scene) return
    scene.setScanVisible(!surfaceOnly && !useStore.getState().scanHidden)
    const unsubscribe = useStore.subscribe((state, before) => {
      if (state.scanHidden !== before.scanHidden) scene.setScanVisible(!surfaceOnly && !state.scanHidden)
    })
    const key = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || event.ctrlKey || event.altKey || event.metaKey || options) return
      if ((event.target as HTMLElement)?.closest('input, select, textarea, button, [contenteditable=true]')) return
      event.preventDefault(); event.stopPropagation(); setSurfaceOnly(on => !on)
    }
    document.addEventListener('keydown', key, true)
    return () => { unsubscribe(); document.removeEventListener('keydown', key, true); scene.setScanVisible(!useStore.getState().scanHidden) }
  }, [surfaceOnly, options])
  const valid = Number.isFinite(Number(draft)) && Number(draft) > 0
  return <section data-test="freeform-surface-display" style={{ display: 'grid', gap: 8 }}>
    <div style={{ display: 'flex', gap: 6 }}>
      <button type="button" aria-pressed={!deviation} onClick={() => { setDeviation(false); setOptions(false) }}>Shaded</button>
      <button type="button" aria-pressed={deviation} onClick={() => setDeviation(true)}>Deviation</button>
      <button ref={optionsButton} type="button" disabled={!deviation} onClick={() => { setDraft(String(tolerance)); setDraftColouring(colouring); setOptions(true) }}>Options</button>
    </div>
    <button type="button" aria-pressed={surfaceOnly} onClick={() => setSurfaceOnly(on => !on)}>Surface Only (Space)</button>
    {deviation && !values && !error && <small role="status">Measuring surface deviation…</small>}
    {error && <small role="alert">{error}</small>}
    {deviation && values && <div data-test="freeform-deviation-legend" aria-label="Surface deviation in millimetres">
      <div style={{ height: 10, background: 'linear-gradient(to right, blue, cyan 20%, lime 40%, lime 60%, yellow 80%, red)' }} />
      <small style={{ display: 'flex', justifyContent: 'space-between' }}><span>{-5*tolerance}</span><span>±{tolerance} mm</span><span>{5*tolerance}</span></small>
    </div>}
    {options && createPortal(<div className="modalback" style={{ zIndex: 10000 }} onKeyDown={e => {
      e.stopPropagation()
      if (e.key === 'Escape') { e.preventDefault(); closeOptions() }
      if (e.key === 'Tab') {
        const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)'))
        const first = controls[0], last = controls[controls.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }}>
      <form className="modal" role="dialog" aria-modal="true" aria-label="Deviation Options" data-test="freeform-deviation-options"
        style={{ width: 310, display: 'grid', gap: 12, padding: 14 }}
        onSubmit={e => { e.preventDefault(); e.stopPropagation(); if (valid) { setTolerance(Number(draft)); setColouring(draftColouring); closeOptions() } }}>
        <header>Deviation Options</header>
        <label>Tolerance ± <input autoFocus aria-label="Deviation tolerance" type="number" step="any" value={draft} onChange={e => setDraft(e.target.value)} /> mm</label>
        <fieldset><legend>Colouring</legend>
          <label><input type="radio" name="preview-colouring" value="pass-fail" checked={draftColouring === 'pass-fail'} onChange={() => setDraftColouring('pass-fail')} /> Pass / Fail</label>
          <label><input type="radio" name="preview-colouring" value="gradient" checked={draftColouring === 'gradient'} onChange={() => setDraftColouring('gradient')} /> Gradient</label>
        </fieldset>
        <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={closeOptions}>Cancel</button>
          <button type="submit" data-test="deviation-options-ok" disabled={!valid}>OK</button>
        </footer>
      </form>
    </div>, document.body)}
  </section>
}
