import './freeformControls.css'
import { FreeformIcon } from './FreeformIcon'
import { useShell } from '../../../src/state/shellStore'
// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform's dialog, laid out as QUICKSURFACE 8.0.128's (read off its
// own window: analysis/quick-scan-v0.0.184/native-auto-controls.json and the
// pictures in analysis/quick-scan-v1.1.4/reference): Algorithm, Extract from
// selected triangles only, Target Quads Count, Feature Details, Symmetry,
// Improve holes' boundaries, Draw guide curves on the mesh with Remove Last
// Curve and Clear all curves, Preview, Clear Result, Actual number of quads,
// Surface Display, and ? OK Cancel. With Basic the four feature controls are
// not shown, their room kept, as there.
//
// Beyond it: the run's progress with a Stop, what the result measures, and
// under More the two settings QUICKSURFACE has no equal of — Refine to
// tolerance and the hard edge angle.
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { FreeformSurfaceDisplay } from './FreeformSurfaceDisplay'
import { useFreeformNavigation } from './useFreeformNavigation'
import { useLength } from '../../../src/app/useUnits'
import { useLengthDraft } from '../../../src/app/useLengthDraft'
import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { useMark } from '../../../src/state/markStore'
import { commandHost } from '../../../src/commands/host'
import type { Vec3 } from '../../../src/core/types'
import { tracePath } from '../../../src/core/geometry/scanPath'
import { ready } from '../app/reCommandCore'
import { writeQuadObj } from '../core/freeform/cageIO'
import { prepareAutoCage, selectedTriangles } from '../app/reFreeformAutoCommand'
import { scanPaths } from '../app/reNetworkCommands'
import { reverseSession } from '../app/reSession'
import { reSceneOf } from '../viewer/reScene'
import { AutoStopped, type AutoRun } from '../core/freeform/autoClient'
import {
  AUTO_BUILD_STEPS, AUTO_HARD_EDGE_DEG, AUTO_QUADS_MAX, AUTO_QUADS_MIN, AUTO_STAGE_LABEL, AUTO_SYMMETRIES, AUTO_TARGETS,
  type AutoAlgorithm, type AutoDetails, type AutoOutcome, type AutoSettings, type AutoStage, type AutoSymmetry,
} from '../core/freeform/autoFreeform'
import { boundedBuildSteps } from '../core/freeform/make'
import { reEditorOpen, useReverse } from '../state/reStore'

export const useAutoFreeformDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>(set => ({
  open: false, setOpen: open => set({ open }),
}))

/** QUICKSURFACE's own words, shown in the status strip while the dialog waits. */
const HINT = 'Set desired resolution and press Preview.'
const GUIDE_HINT = 'Click on the mesh to draw a guide curve. Double-click or right-click to finish it.'

interface Guide { clicks: Vec3[]; line: number[] }

interface Stats {
  quads: number
  irregular: number
  edge: number
  vertices: number
  rms: number
  max: number
  within: number
  tolerance: number
  coverage: AutoOutcome['coverage']
  faults: AutoOutcome['faults']
  missed: number
  closed: boolean
  seconds: number
  refined: number
  topologyResolutionRaised: boolean
}

export function AutoFreeformDialog({ onClose }: { onClose: () => void }) {
  const len = useLength()
  const [algorithm, setAlgorithm] = useState<AutoAlgorithm>('feature')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [density, setDensity] = useState<keyof typeof AUTO_TARGETS | 'custom'>('medium')
  const [custom, setCustom] = useState('2000')
  const [details, setDetails] = useState<AutoDetails>('balanced')
  const [symmetry, setSymmetry] = useState<AutoSymmetry>('none')
  const [improveHoles, setImproveHoles] = useState(false)
  const [drawGuides, setDrawGuides] = useState(false)
  const [guides, setGuides] = useState<Guide[]>([])
  const [drawing, setDrawing] = useState<Guide | null>(null)
  const [more, setMore] = useState(false)
  const [refine, setRefine] = useState(false)
  const [refineText, setRefineText, refineMm] = useLengthDraft(0.05)
  const [hardEdge, setHardEdge] = useState(String(AUTO_HARD_EDGE_DEG))
  const [help, setHelp] = useState(false)
  // Whether part of the scan is marked: the brush's own count, and the marking as the viewport holds it now — read when the
  // dialog opens and after each release of the pointer, since a marking put back on the part is not counted by the brush.
  const brushed = useMark(s => s.count > 0)
  const [painted, setPainted] = useState(false)
  useEffect(() => {
    const read = () => setPainted((reverseSession()?.sceneRef.current?.paintedVertices?.().length ?? 0) > 0)
    read()
    window.addEventListener('pointerup', read)
    return () => window.removeEventListener('pointerup', read)
  }, [brushed])
  const hasSelection = brushed || painted
  const backdrop = useFreeformNavigation()
  useEffect(() => {
    const wasOpen = useShell.getState().inspectorOpen
    useShell.getState().setInspectorOpen(false)
    useStore.getState().setStatus(HINT)
    return () => { useShell.getState().setInspectorOpen(wasOpen) }
  }, [])
  const [working, setWorking] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [progress, setProgress] = useState<{ stage: AutoStage; overall: number } | null>(null)
  const request = useRef(0)
  const running = useRef<AutoRun | null>(null)
  const previewCage = useRef<string | null>(null)
  const [error, setError] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const previewVersion = useRef<number | null>(null)
  const alive = useRef(true)
  const form = useRef<HTMLFormElement>(null)
  const [displaySurface, setDisplaySurface] = useState<AutoOutcome['surface'] | null>(null)
  const clearMesh = () => {
    setDisplaySurface(null)
    const scene = reverseSession()?.sceneRef.current
    if (scene) reSceneOf(scene).setBodyPreview(null, '#ffffff')
    previewVersion.current = null
    previewCage.current = null
  }
  const clearPreview = () => { clearMesh(); setStats(null) }
  const feature = algorithm === 'feature'
  const count = density === 'custom' ? Number(custom) : AUTO_TARGETS[density]
  const hardEdgeDeg = Number(hardEdge)
  const validCount = Number.isInteger(count) && count >= AUTO_QUADS_MIN && count <= AUTO_QUADS_MAX
  const validMore = (!refine || (Number.isFinite(refineMm) && refineMm > 0)) && Number.isFinite(hardEdgeDeg) && hardEdgeDeg >= 5 && hardEdgeDeg <= 120
  const valid = validCount && validMore
  const useSelection = selectedOnly && hasSelection
  // A setting changed: the result shown is no longer the one these settings give. The algorithm alone keeps it until the next Preview, as QUICKSURFACE does.
  useEffect(() => { clearPreview() }, [count, details, symmetry, improveHoles, guides, useSelection, refine, refineMm, hardEdge])
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; request.current++; running.current?.stop(); clearMesh() }
  }, [])
  // The guide curves drawn so far, on the part.
  useEffect(() => {
    const scene = reverseSession()?.sceneRef.current
    if (!scene) return
    const view = reSceneOf(scene)
    const lines = [...guides, ...(drawing ? [drawing] : [])].filter(g => g.line.length >= 6).map(g => Float32Array.from(g.line))
    view.setOpenEdges(feature ? lines : [])
    view.setSnapDot(feature && drawGuides && drawing ? drawing.clicks[drawing.clicks.length - 1] : null)
    return () => { view.setOpenEdges([]); view.setSnapDot(null) }
  }, [guides, drawing, feature, drawGuides])
  useEffect(() => { if (!working) useStore.getState().setStatus(feature && drawGuides ? GUIDE_HINT : HINT) }, [feature, drawGuides, working])
  const finishGuide = () => {
    setDrawing(d => {
      if (d && d.clicks.length >= 2) setGuides(g => [...g, d])
      return null
    })
  }
  const guidePoint = (clientX: number, clientY: number) => {
    const session = reverseSession()
    const scene = session?.sceneRef.current
    if (!session || !scene) return
    const at = reSceneOf(scene).scanPointAt(clientX, clientY)
    if (!at) return
    setDrawing(d => {
      if (!d) return { clicks: [at], line: [...at] }
      const from = d.clicks[d.clicks.length - 1]
      // Along the scan from the last point, so the curve lies on the part.
      let piece: number[] = [...at]
      try {
        const path = tracePath(scanPaths(session), from, at)
        if (path.points.length >= 6) piece = Array.from(path.points).slice(3)
      } catch { /* A straight piece then. */ }
      return { clicks: [...d.clicks, at], line: [...d.line, ...piece] }
    })
  }
  const stopRun = () => { request.current++; running.current?.stop(); running.current = null; setWorking(false); setProgress(null) }
  const close = () => { if (!committing) { request.current++; running.current?.stop(); onClose() } }
  function settings(session: Awaited<ReturnType<typeof ready>>): AutoSettings {
    return {
      algorithm,
      quads: count,
      details: feature ? details : undefined,
      symmetry: feature ? symmetry : 'none',
      improveHoles: feature && improveHoles,
      guides: feature ? guides.map(g => g.line) : [],
      selection: useSelection ? selectedTriangles(session) : undefined,
      refineTolerance: refine ? refineMm : undefined,
      hardEdgeAngle: hardEdgeDeg,
    }
  }
  async function preview() {
    if (!valid || working) return
    // Disabling the clicked button must not send keyboard focus outside the
    // dialog: Escape should still reach Cancel when the preview completes.
    form.current?.focus()
    finishGuide()
    const ticket = ++request.current
    setWorking(true); setError(''); clearPreview(); setProgress({ stage: 'prepare', overall: 0 })
    const started = performance.now()
    try {
      const version = commandHost().session.clientRef.current?.scanVersion
      const state = useReverse.getState()
      if (useStore.getState().busy || state.building || reEditorOpen(state) || state.playback !== null) throw new Error('Finish the current operation first.')
      const session = await ready()
      if (!alive.current || ticket !== request.current) return
      const run = prepareAutoCage(session, settings(session), (stage, overall) => {
        if (alive.current && ticket === request.current) setProgress({ stage, overall })
      })
      running.current = run
      const made: AutoOutcome = await run.result
      if (!alive.current || ticket !== request.current) return
      running.current = null
      if (version === undefined || version !== commandHost().session.clientRef.current?.scanVersion) throw new Error('The scan changed. Preview again before continuing.')
      const scene = session.sceneRef.current
      if (!scene) throw new Error('The viewport is unavailable.')
      reSceneOf(scene).setBodyPreview(made.surface, '#56b8a2', { edgeSegments: made.surface.edgeSegments })
      setDisplaySurface(made.surface)
      previewVersion.current = version
      previewCage.current = writeQuadObj(made.cage, 'Auto Freeform preview')
      setStats({
        quads: made.quads, irregular: made.irregular, edge: made.edge, vertices: made.vertices, rms: made.deviation.rms, max: made.deviation.max,
        within: made.deviation.points > 0 ? made.deviation.within / made.deviation.points : 0, tolerance: made.deviation.tolerance,
        coverage: made.coverage, faults: made.faults, missed: made.deviation.missed, closed: made.closed, seconds: (performance.now() - started) / 1000, refined: made.refined, topologyResolutionRaised: made.topologyResolutionRaised,
      })
    } catch (e) {
      if (e instanceof AutoStopped) return
      if (alive.current && ticket === request.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (alive.current && ticket === request.current) { setWorking(false); setProgress(null) }
    }
  }
  async function generate() {
    if (!valid || working || !stats || previewCage.current === null || previewVersion.current === null) return
    const state = useReverse.getState(), scan = useStore.getState()
    if (previewVersion.current !== null && previewVersion.current !== commandHost().session.clientRef.current?.scanVersion) {
      clearPreview(); setError('The scan changed. Preview again before continuing.'); return
    }
    if (!scan.fileName || scan.busy || state.building || state.playback !== null || reEditorOpen(state)) {
      setError('Import a scan and finish the current operation first.')
      return
    }
    setWorking(true)
    setCommitting(true)
    setError('')
    try {
      // The cage is fitted already: the body is its own surface, as shown. Snap stays on for editing it.
      await runCommand('reverse.freeform.create', { obj: previewCage.current, steps: boundedBuildSteps(stats.quads, AUTO_BUILD_STEPS), snap: true, fitToScan: false, autoFreeform: true }, text => useStore.getState().setStatus(text))
      useStore.getState().setStatus('Auto Freeform created.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { if (alive.current) { setWorking(false); setCommitting(false) } }
  }
  const picking = feature && drawGuides && !working
  const hidden = feature ? undefined : ({ visibility: 'hidden' } as const)
  return <div ref={backdrop} className="modalback" style={{ background: 'transparent', alignItems: 'flex-start', justifyContent: 'flex-start', paddingTop: 'min(176px, 20vh)', paddingLeft: 'min(244px, max(12px, calc(100vw - 350px)))', cursor: picking ? 'crosshair' : undefined }} data-test="auto-freeform-dialog"
    onPointerDown={e => {
      if (!picking || e.target !== e.currentTarget || e.button !== 0) return
      e.preventDefault()
      guidePoint(e.clientX, e.clientY)
    }}
    onDoubleClick={e => { if (picking && e.target === e.currentTarget) finishGuide() }}
    onContextMenu={e => { if (picking && e.target === e.currentTarget) { e.preventDefault(); finishGuide() } }}
    onKeyDown={e => {
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        if (drawing) setDrawing(null)
        else close()
      }
      if (e.key === 'Enter' && drawing) { e.preventDefault(); finishGuide() }
    }}>
    <form ref={form} tabIndex={-1} className="modal ff-auto" role="dialog" aria-modal="true" aria-labelledby="auto-freeform-title"
      style={{ width: 282, maxHeight: 'calc(100dvh - min(176px, 20vh) - 12px)', overflowY: 'auto', boxSizing: 'border-box', display: 'grid', gap: 8, padding: 12 }}
      onSubmit={e => { e.preventDefault(); void generate() }}>
      <header id="auto-freeform-title" className="ff-title"><span>Auto Freeform</span><button type="button" aria-label="Close Auto Freeform" disabled={committing} onClick={close}>×</button></header>
      <fieldset disabled={working} style={{ display: 'grid', gap: 8, border: 0, padding: 0, margin: 0 }}>
        <label>Algorithm <select aria-label="Algorithm" data-test="auto-freeform-algorithm" value={algorithm} onChange={e => setAlgorithm(e.target.value as AutoAlgorithm)}>
          <option value="basic">Basic</option><option value="feature">Feature aligned</option>
        </select></label>
        <label className="ff-auto-check" title={hasSelection ? undefined : 'Select part of the scan first.'}><input type="checkbox" data-test="auto-freeform-selected" disabled={!hasSelection} checked={useSelection} onChange={e => setSelectedOnly(e.target.checked)} /> Extract from selected triangles only</label>
        <label>Target Quads Count <select autoFocus aria-label="Target Quads Count" value={density} onChange={e => setDensity(e.target.value as typeof density)}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="fine">Fine</option><option value="custom">Custom</option>
        </select><input aria-label="Quads" type="number" min={AUTO_QUADS_MIN} max={AUTO_QUADS_MAX} step="1" disabled={density !== 'custom'} value={density === 'custom' ? custom : count} onChange={e => setCustom(e.target.value)} /></label>
        <label style={hidden}>Feature Details <select aria-label="Feature Details" data-test="auto-freeform-details" disabled={!feature} value={details} onChange={e => setDetails(e.target.value as AutoDetails)}>
          <option value="low">Low</option><option value="balanced">Balanced</option><option value="higher">Higher</option><option value="highest">Highest</option>
        </select></label>
        <label style={hidden}>Symmetry <select aria-label="Symmetry" disabled={!feature} value={symmetry} onChange={e => setSymmetry(e.target.value as AutoSymmetry)}>
          {AUTO_SYMMETRIES.map(s => <option key={s} value={s}>{s === 'none' ? 'None' : s.toUpperCase()}</option>)}
        </select></label>
        <label className="ff-auto-check" style={hidden}><input type="checkbox" data-test="auto-freeform-holes" disabled={!feature} checked={improveHoles} onChange={e => setImproveHoles(e.target.checked)} /> Improve holes' boundaries</label>
        <label className="ff-auto-check" style={hidden}><input type="checkbox" data-test="auto-freeform-guides" disabled={!feature} checked={drawGuides} onChange={e => { setDrawGuides(e.target.checked); if (!e.target.checked) finishGuide() }} /> Draw guide curves on the mesh</label>
        <div className="ff-auto-pair" style={hidden}>
          <button type="button" data-test="auto-freeform-remove-curve" disabled={!feature || (guides.length === 0 && !drawing)} onClick={() => { if (drawing) setDrawing(null); else setGuides(g => g.slice(0, -1)) }}>Remove Last Curve</button>
          <button type="button" data-test="auto-freeform-clear-curves" disabled={!feature || (guides.length === 0 && !drawing)} onClick={() => { setDrawing(null); setGuides([]) }}>Clear all curves</button>
        </div>
      </fieldset>
      <div className="ff-preview-actions">
        <button type="button" data-test="auto-freeform-preview" disabled={!valid || working} onClick={() => void preview()}>Preview</button>
        <button type="button" data-test="auto-freeform-clear" disabled={working || stats === null} onClick={clearPreview}>Clear Result</button>
      </div>
      {working && !committing && progress && <div className="ff-auto-progress" role="status" data-test="auto-freeform-progress">
        <span>{AUTO_STAGE_LABEL[progress.stage]}…</span>
        <button type="button" data-test="auto-freeform-stop" onClick={stopRun}>Stop</button>
        <div className="ff-auto-bar" aria-hidden="true"><i style={{ width: `${Math.round(progress.overall * 100)}%` }} /></div>
      </div>}
      {committing && <small role="status">Creating freeform surface…</small>}
      <small data-test={stats === null ? undefined : 'auto-freeform-quads'}>Actual number of quads{stats === null ? '' : `: ${stats.quads.toLocaleString()}`}</small>
      {stats && <small className="ff-auto-stats" data-test="auto-freeform-stats">
        <span>Deviation: RMS {len.fmt(stats.rms, 3)}, max {len.fmt(stats.max, 3)}</span>
        <span>{Math.round(stats.within * 100)}% within {len.fmt(stats.tolerance)}{stats.refined > 0 ? ` · ${stats.refined.toLocaleString()} quads added` : ''}</span>
        <span title={`${stats.coverage.samples.toLocaleString()} probes distributed by scan area`}>Scan to surface: RMS {len.fmt(stats.coverage.rms, 3)}, max {len.fmt(stats.coverage.max, 3)}</span>
        {stats.missed > 0 && <span>{stats.missed.toLocaleString()} surface {stats.missed === 1 ? 'sample has' : 'samples have'} no compatible scan measurement.</span>}
        {stats.faults.nonmanifoldEdges + stats.faults.degenerateTriangles > 0 && <span role="alert">Surface faults · {stats.faults.nonmanifoldEdges} nonmanifold edges · {stats.faults.degenerateTriangles} degenerate triangles</span>}
        {stats.faults.alternateLayout && <span>Re-fitted after checking scan coverage.</span>}
        {stats.topologyResolutionRaised && <span>Increased resolution to preserve the scan’s openings and coverage.</span>}
        <span>{stats.irregular.toLocaleString()} irregular point{stats.irregular === 1 ? '' : 's'} · {stats.closed ? 'closed' : 'open'} · {stats.seconds.toFixed(1)} s</span>
      </small>}
      {displaySurface ? <FreeformSurfaceDisplay positions={displaySurface.positions} measured={displaySurface.signed} edge={stats?.edge} /> : <fieldset className="ff-display" disabled><legend>Surface Display</legend><button type="button" aria-label="Shaded"><FreeformIcon name="shaded" /></button><button type="button" aria-label="Tolerance / Deviation"><FreeformIcon name="deviation" /></button><button type="button">Options …</button></fieldset>}
      <details className="ff-auto-more" open={more} onToggle={e => setMore((e.target as HTMLDetailsElement).open)}>
        <summary data-test="auto-freeform-more">More</summary>
        <fieldset disabled={working} style={{ display: 'grid', gap: 6, border: 0, padding: '6px 0 0', margin: 0 }}>
          <label className="ff-auto-value"><span><input type="checkbox" data-test="auto-freeform-refine" checked={refine} onChange={e => setRefine(e.target.checked)} /> Refine to tolerance</span><input aria-label="Refine tolerance" type="number" step="any" min="0" disabled={!refine} value={refineText} onChange={e => setRefineText(e.target.value)} /><span>{len.word()}</span></label>
          <label className="ff-auto-value"><span>Hard edge angle</span><input aria-label="Hard edge angle" type="number" step="1" min="5" max="120" value={hardEdge} onChange={e => setHardEdge(e.target.value)} /><span>°</span></label>
        </fieldset>
      </details>
      {help && <small className="ff-auto-help" data-test="auto-freeform-help-text">Auto Freeform lays quads over the scan and fits them to it. Basic gives an even layout at the target count. Feature aligned follows edges, fillets and cylinders, and Feature Details gives them more quads than the target. Symmetry mirrors the layout about a global plane. Guide curves steer the quads' edges. Preview shows the result; OK keeps it as a freeform you can edit.</small>}
      {error && <small role="alert">{error}</small>}
      <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
        <button type="button" className="ff-auto-helpkey" aria-label="Auto Freeform help" aria-pressed={help} data-test="auto-freeform-help" onClick={() => setHelp(h => !h)}>?</button>
        <button type="submit" data-test="auto-freeform-ok" disabled={!valid || working || stats === null}>OK</button>
        <button type="button" disabled={committing} onClick={close}>Cancel</button>
      </footer>
    </form>
  </div>
}

