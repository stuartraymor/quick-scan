import { FreeformIcon } from './FreeformIcon'
import './freeformControls.css'
// SPDX-License-Identifier: AGPL-3.0-only
import { useLength } from '../../../src/app/useUnits'
import { FreeformDeviationOptions } from './FreeformDeviationOptions'
import { FreeformToleranceLegend } from './FreeformToleranceLegend'
import { measuredDeviationStats } from '../core/freeform/analysisRamp'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../../src/state/store'
import { commandHost } from '../../../src/commands/host'
import { reverseSession } from '../app/reSession'
import { reSceneOf } from '../viewer/reScene'
import { previewDeviationColours, type PreviewColouring } from '../core/freeform/previewDeviation'

/** Display-only controls. The reference scan and committed bodies are untouched. */
export function FreeformSurfaceDisplay({ positions, measured }: { positions: Float32Array; measured?: Float32Array }) {
  const len = useLength()
  const [shadedOnly, setShadedOnly] = useState(false)
  const [analysisOnly, setAnalysisOnly] = useState(true)
  const [deviation, setDeviation] = useState(false)
  // The registered scan can sit in front of a good fit by just a few microns.
  // Give the analysis its own visibility setting, and restore the shaded view on exit.
  const surfaceOnly = measured && deviation ? analysisOnly : shadedOnly
  const setSurfaceOnly = measured && deviation ? setAnalysisOnly : setShadedOnly
  const [options, setOptions] = useState(false)
  const [savedTolerance, setTolerance] = useState(.01)
  const [savedColouring, setColouring] = useState<PreviewColouring>('gradient')
  const [draft, setDraft] = useState<{ tolerance: number; colouring: PreviewColouring } | null>(null)
  const tolerance = draft?.tolerance ?? savedTolerance
  const colouring = draft?.colouring ?? savedColouring
  const [reading, setReading] = useState<{ positions: Float32Array; values: Float32Array } | null>(null)
  const values = measured ?? (reading?.positions === positions ? reading.values : null)
  const stats = useMemo(() => measured && deviation ? measuredDeviationStats(measured, tolerance) : null, [measured, deviation, tolerance])
  const [error, setError] = useState('')
  const optionsButton = useRef<HTMLButtonElement>(null)
  const closeOptions = () => { setOptions(false); setDraft(null); optionsButton.current?.focus() }
  const version = useRef(commandHost().session.clientRef.current?.scanVersion)
  useEffect(() => {
    if (!deviation || measured) return
    let alive = true
    const session = reverseSession()
    const current = () => version.current === commandHost().session.clientRef.current?.scanVersion
    if (!current()) { setError('The scan changed. Preview again.'); return }
    if (!values) {
      setError('')
      void session?.client()?.previewSurfaceDeviation(positions).then(result => {
        if (!alive) return
        if (!current()) { setError('The scan changed. Preview again.'); return }
        setReading({ positions, values: result })
      }).catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    }
    return () => { alive = false }
  }, [positions, deviation, values, measured])
  useEffect(() => {
    const scene = reverseSession()?.sceneRef.current
    if (!scene) return
    const view = reSceneOf(scene)
    if (view.bodyPreview?.geometry.getAttribute('position').array !== positions) return
    if (version.current !== commandHost().session.clientRef.current?.scanVersion) return
    if (measured) {
      view.setAutoDeviation(deviation ? measured : null, tolerance, colouring === 'pass-fail')
      return
    }
    view.setPreviewColours(deviation && values ? previewDeviationColours(values, tolerance, colouring) : null)
  }, [positions, deviation, values, tolerance, colouring, measured])
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
  }, [surfaceOnly, setSurfaceOnly, options])
  return <section data-test="freeform-surface-display" style={{ display: 'grid', gap: 8 }}>
    <fieldset className="ff-display"><legend>Surface Display</legend>
      <button type="button" aria-label="Shaded" title="Shaded" aria-pressed={!deviation} onClick={() => { setDeviation(false); setOptions(false) }}><FreeformIcon name="shaded" /><span className="ff-accessible-label">Shaded</span></button>
      <button type="button" aria-label="Deviation" title="Deviation" aria-pressed={deviation} onClick={() => setDeviation(true)}><FreeformIcon name="deviation" /><span className="ff-accessible-label">Deviation</span></button>
      <button ref={optionsButton} type="button" disabled={!deviation} onClick={() => setOptions(true)}>Options</button>
    </fieldset>
    <button type="button" aria-pressed={surfaceOnly} onClick={() => setSurfaceOnly(on => !on)}>Surface Only (Space)</button>
    {deviation && !values && !error && <small role="status">Measuring surface deviation…</small>}
    {error && <small role="alert">{error}</small>}
    {measured && <button type="button" className="ff-viewport-deviation" data-test="auto-viewport-deviation" aria-pressed={deviation}
      title="Show signed scan deviation from the fitted surface" onClick={() => setDeviation(active => !active)}>
      <FreeformIcon name="deviation" /> Deviation
    </button>}
    {deviation && measured && <FreeformToleranceLegend tolerance={tolerance} colouring={colouring} testId="freeform-deviation-legend">
      {stats ? <>
        <small>Min {len.fmt(stats.min, 3)} · Max {len.fmt(stats.max, 3)}</small>
        <small>Mean {len.fmt(stats.mean, 3)} · RMS {len.fmt(stats.rms, 3)}</small>
        <small>{(100 * stats.within / stats.count).toFixed(1)}% within tolerance</small>
        {stats.missing > 0 && <small>{stats.missing.toLocaleString()} unmeasured samples (gray)</small>}
      </> : <small>No supported measurements</small>}
    </FreeformToleranceLegend>}
    {deviation && !measured && values && <div data-test="freeform-deviation-legend" aria-label={`Surface deviation in ${len.word()}`}>
      <div style={{ height: 10, background: colouring === 'pass-fail' ? 'linear-gradient(to right, red 40%, lime 40%, lime 60%, red 60%)' : 'linear-gradient(to right, blue, cyan 20%, lime 40%, lime 60%, yellow 80%, red)' }} />
      <small style={{ display: 'flex', justifyContent: 'space-between' }}><span>{len.fmt(-5*tolerance)}</span><span>±{len.fmt(tolerance)}</span><span>{len.fmt(5*tolerance)}</span></small>
    </div>}
    {options && <FreeformDeviationOptions tolerance={savedTolerance} colouring={savedColouring} onPreview={measured ? setDraft : undefined} onApply={(next, mode) => {
      setTolerance(next); setColouring(mode)
    }} onClose={closeOptions} />}
  </section>
}
