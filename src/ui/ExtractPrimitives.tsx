// SPDX-License-Identifier: AGPL-3.0-only
// "Extract primitives", laid out as QUICKSURFACE's dialog is (Pro 8.0.127
// photo; manual "Mesh Selection" and "Extract Primitives"): 1. select the
// area — the selection tools, the degrees slider, "Select all connected
// triangles", and the selection options — then 2. click the type of the
// primitive, which is fitted to the selection and previewed until Create. The dialog
// stays open for the next one; Close puts it away.
//
// The selection is the app's shared marking (markStore / viewer/marking); the
// fit is the element fit a hand-marked element uses.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMark, WAND_MAX_DEG, WAND_MIN_DEG, type MarkGesture } from '../state/markStore'
import { useExtract } from '../state/extractStore'
import { constraintOptions, type AutoChoice, type ConstraintId } from '../core/elements/constrain'
import { useStore } from '../state/store'
import { useShell } from '../state/shellStore'
import type { ElementKind } from '../core/types'
import { ExtractIcon as Icon, type ExtractIconName as IconName } from './ExtractIcon'
import { extractQuickPlacement } from './extractQuickPlacement'
import { useLength } from '../app/useUnits'

export type Tool = { id: MarkGesture | null | 'through'; icon: IconName; title: string }
/** Keep partial decimals editable; valid angles still regrow the wand live. */
export function WandDegreesField() {
  const degrees = useMark(s => s.wandDegrees), disabled = useMark(s => s.wandConnected)
  const [text, setText] = useState(String(Number(degrees.toFixed(2))))
  const [focused, setFocused] = useState(false)
  const canceled = useRef(false)
  useEffect(() => { if (!focused) setText(String(Number(degrees.toFixed(2)))) }, [degrees, focused])
  const commit = () => {
    if (!canceled.current && text.trim() !== '' && Number.isFinite(Number(text))) useMark.getState().setWandDegrees(Number(text))
    canceled.current = false
    setText(String(Number(useMark.getState().wandDegrees.toFixed(2))))
    setFocused(false)
  }
  return <input type="number" min={WAND_MIN_DEG} max={WAND_MAX_DEG} step="0.01" value={text} disabled={disabled}
    aria-label="Sensitivity in degrees" data-test="extract-degrees" onFocus={() => setFocused(true)} onBlur={commit}
    onChange={e => { const value = e.target.value; setText(value); const n = Number(value); if (value !== '' && Number.isFinite(n) && n >= WAND_MIN_DEG && n <= WAND_MAX_DEG) useMark.getState().setWandDegrees(n) }}
    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur() } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); canceled.current = true; e.currentTarget.blur() } }} />
}
export const SELECTION_TOOLS: Tool[] = [
  { id: null, icon: 'navigate', title: 'Navigate — no selection tool; the mouse turns the view' },
  { id: 'wand', icon: 'wand', title: 'Magic Wand — click a well-defined area; it spreads over neighbouring triangles within the degrees below' },
  { id: 'brush', icon: 'brush', title: 'Free hand (filled) — brush; Alt-drag or right-drag removes' },
  { id: 'lasso', icon: 'lasso', title: 'Free hand — draw an outline; everything inside is selected' },
  { id: 'line', icon: 'line', title: 'Select by drawing a line — drag across the surface; a narrow band along the line is taken. Alt-drag removes' },
  { id: 'window', icon: 'window', title: 'Select by drawing a rectangle — visible triangles only unless Select through is on' },
  { id: 'circle', icon: 'circle', title: 'Select by drawing a circle — drag from the centre out; visible triangles only unless Select through is on' },
  { id: 'through', icon: 'through', title: 'Select through — the tools also take triangles facing away' },
]

const TYPES: { kind: ElementKind; icon: IconName; label: string }[] = [
  { kind: 'plane', icon: 'plane', label: 'Plane' },
  { kind: 'cylinder', icon: 'cylinder', label: 'Cylinder' },
  { kind: 'line', icon: 'axis', label: 'Line' },
  { kind: 'cone', icon: 'cone', label: 'Cone' },
  { kind: 'sphere', icon: 'sphere', label: 'Sphere' },
]

/** A number the user types: partial entries stay editable, a valid one is passed on at once. */
function NumberField({ value, onValid, min, label, test, disabled }: { value: number; onValid: (v: number) => void; min: number; label: string; test: string; disabled?: boolean }) {
  const [text, setText] = useState(String(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(String(value)) }, [value, focused])
  return <input type="number" min={min} step="any" value={text} disabled={disabled} aria-label={label} data-test={test}
    onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setText(String(value)) }}
    onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min) onValid(n) }}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.currentTarget.blur() } }} />
}

export function ExtractPrimitives({ onType, preview, onCreate, onClearPreview, onClose, onClear, fitting, onHide, onIsolate, onShowAll, onAnalyse, onAnalysisOff }: {
  onType: (kind: ElementKind) => void
  /** The fit on show, not created yet: QUICKSURFACE previews, then Create. */
  preview: { kind: ElementKind; sigma: number | null; autoChoice?: AutoChoice; autoCoincident?: boolean; problem?: string } | null
  /** Create the previewed primitive; `stay` keeps the dialog for the next. */
  onCreate: (stay?: boolean) => boolean
  onClearPreview: () => void
  onClose: () => void
  onClear: () => void
  fitting: boolean
  onHide: () => void
  onIsolate: () => void
  onShowAll: () => void
  /** Analysis: mark the points further than the tolerance from the previewed primitive. */
  onAnalyse: () => void
  /** Analysis turned off: the marked area is shown whole again. */
  onAnalysisOff: () => void
}) {
  const open = useShell((s) => s.extractOpen)
  const m = useMark()
  const ex = useExtract()
  const len = useLength()
  const labels = useStore((s) => s.showLabels)
  // Primitives already made, offered as constraints the way QUICKSURFACE lists them.
  const elements = useStore((s) => s.elements)
  const constraintRefs = elements.flatMap((e) => (e.fit ? [{ id: e.id, name: e.name, fit: e.fit }] : []))
  const options = constraintOptions(constraintRefs)
  const inferred = ex.autoConstrain ? preview?.autoChoice : undefined
  if (inferred && !options.some(option => option.id === inferred.id)) options.push(inferred)
  const hidden = useShell((s) => s.hiddenTriangles)
  // The quick tools float where the last wand click landed, while that pick is
  // the selection: only a successful surface pick places them.
  const [quickAt, setQuickAt] = useState<{ x: number; y: number } | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  useEffect(() => { if (!open) setConfirmClose(false) }, [open])
  // Once a type has fitted, its preview owns the next step. The floating
  // type picker returns after the user marks another area.
  useEffect(() => { if (preview) setQuickAt(null) }, [preview])
  useEffect(() => {
    if (!open) return
    let press: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      press = null
      if ((e.target as Element | null)?.closest?.('.viewport')) {
        setQuickAt(null)
        if (e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) press = { x: e.clientX, y: e.clientY }
      }
    }
    const up = (e: PointerEvent) => {
      const start = press; press = null
      const mark = useMark.getState()
      if (start && e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 4 && mark.gesture === 'wand' && mark.count > 0) setQuickAt({ x: e.clientX, y: e.clientY })
      else if (start) setQuickAt(null)
    }
    const picked = (e: Event) => {
      const point = (e as CustomEvent<{ x: number; y: number }>).detail
      if (useMark.getState().gesture === 'wand' && point && Number.isFinite(point.x) && Number.isFinite(point.y)) setQuickAt(point)
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('scanruler:wand-pick', picked)
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('scanruler:wand-pick', picked) }
  }, [open])
  useEffect(() => {
    if (m.count === 0 || m.gesture !== 'wand' || !open) setQuickAt(null)
  }, [m.count, m.gesture, open])
  const [quickPosition, setQuickPosition] = useState<{ left: number; top: number; width: number } | null>(null)
  useLayoutEffect(() => {
    if (!quickAt || !open) { setQuickPosition(null); return }
    const place = () => {
      const viewport = document.querySelector('.viewport')?.getBoundingClientRect()
      const panel = document.querySelector('[data-test="tool-inspector"]')?.getBoundingClientRect()
      setQuickPosition(extractQuickPlacement(quickAt, viewport ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }, panel))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [quickAt, open])
  if (!open) return null
  const toolOn = (t: Tool) => (t.id === 'through' ? m.backfaces : m.gesture === t.id)
  const pick = (t: Tool) => {
    if (t.id === 'through') m.setBackfaces(!m.backfaces)
    else m.setGesture(t.id)
  }
  const none = m.count === 0
  const requestClose = () => {
    if (fitting) return
    if (preview && !preview.problem) setConfirmClose(true)
    else onClose()
  }
  // QuickScan uses its existing inspector slot; the reference dialog floats.
  const slot = typeof document !== 'undefined' ? document.getElementById('inspector-command-slot') : null
  const dock = (node: React.ReactNode) => (slot ? createPortal(node, slot) : node)
  return (
    <>
    {m.quickTools && quickAt && quickPosition && !none && (
      <div className="qs-quick" data-test="extract-quick" role="toolbar" aria-label="Quick tools"
        style={quickPosition}>
        <span className="qs-quick-bar" aria-hidden />
        <div className="qs-quick-body">
          <div className="qs-quick-types">
            {TYPES.map((t) => (
              <button key={t.kind} data-test={`extract-quick-${t.kind}`} disabled={fitting} title={`Fit a ${t.label.toLowerCase()} to the selection`} onClick={() => { setQuickAt(null); onType(t.kind) }}>
                <Icon name={t.icon} size={22} />
              </button>
            ))}
          </div>
          <input type="range" min={WAND_MIN_DEG} max={WAND_MAX_DEG} step={0.01} value={m.wandDegrees} disabled={m.wandConnected}
            aria-label="Sensitivity in degrees" data-test="extract-quick-degrees" onChange={(e) => m.setWandDegrees(Number(e.target.value))} />
        </div>
      </div>
    )}
    {dock(<section className={slot ? 'qs-dialog extract-dialog docked' : 'qs-dialog extract-dialog'} data-test="extract-dialog" aria-label="Extract primitives">
      <header>
        <b>Extract primitives</b>
        <button className="qs-x" data-test="extract-x" title="Close" disabled={fitting} onClick={requestClose}>×</button>
      </header>
      <p className="qs-step">1. Select the area that you want to fit a primitive</p>
      <div className="qs-iconrow" role="toolbar" aria-label="Selection tools">
        {SELECTION_TOOLS.map((t) => (
          <button key={String(t.id)} className={toolOn(t) ? 'on' : undefined} aria-pressed={toolOn(t)}
            data-test={`extract-tool-${t.id ?? 'navigate'}`} title={t.title} onClick={() => pick(t)}>
            <Icon name={t.icon} size={20} />
          </button>
        ))}
      </div>
      <div className="qs-degrees">
        <input type="range" min={WAND_MIN_DEG} max={WAND_MAX_DEG} step={0.01} value={m.wandDegrees} disabled={m.wandConnected} aria-label="Sensitivity in degrees"
          data-test="extract-degrees-slider" onChange={(e) => m.setWandDegrees(Number(e.target.value))} />
        <WandDegreesField />
        <span>degrees</span>
      </div>
      <label className="checkrow">
        <input type="checkbox" checked={m.wandConnected} data-test="extract-connected" onChange={(e) => m.setWandConnected(e.target.checked)} />
        <span>Select all connected triangles</span>
      </label>
      <div className="qs-iconrow" role="toolbar" aria-label="Selection options">
        <button data-test="extract-enlarge" disabled={none} title="Enlarge currently selected area" onClick={() => m.resize(1)}><Icon name="enlarge" size={20} /></button>
        <button data-test="extract-shrink" disabled={none} title="Shrink currently selected area" onClick={() => m.resize(-1)}><Icon name="shrink" size={20} /></button>
        <button data-test="extract-isolate" disabled={none} title="Isolate (leave selected and hide others)" onClick={onIsolate}><Icon name="isolate" size={20} /></button>
        <button data-test="extract-hide" disabled={none} title="Hide selected" onClick={onHide}><Icon name="hide" size={20} /></button>
        <button data-test="extract-show-all" disabled={hidden === 0} title="Show all hidden triangles" onClick={onShowAll}><Icon name="show" size={20} /></button>
        <button data-test="extract-deselect" disabled={none} title="Deselect all selected triangles" onClick={onClear}><Icon name="deselect" size={20} /></button>
        {/* QUICKSURFACE ends this row with Select all; inverting an empty selection selects everything. */}
        <button data-test="extract-select-all" title="Select all triangles" onClick={() => { onClear(); m.invert() }}><Icon name="all" size={20} /></button>
      </div>
      <p className="qs-count" data-test="extract-count">{none ? 'Nothing selected' : `${m.count.toLocaleString('en-US')} points selected`}</p>
      <hr />
      <p className="qs-step">2. Select the type of the primitive</p>
      <div className="qs-typerow" role="toolbar" aria-label="Primitive type">
        {TYPES.map((t) => (
          <button key={t.kind} data-test={`extract-type-${t.kind}`} className={preview?.kind === t.kind ? 'on' : undefined} aria-pressed={preview?.kind === t.kind} disabled={none || fitting} title={none ? `Select an area first, then click ${t.label}` : `Fit a ${t.label.toLowerCase()} to the selection and preview it`} onClick={() => onType(t.kind)}>
            <Icon name={t.icon} size={26} />
          </button>
        ))}
        {preview && !fitting && <button data-test="extract-clear-preview" className="qs-clear" onClick={onClearPreview}>Clear</button>}
      </div>
      {preview && <>
      <select className="qs-constraint" data-test="extract-constraint" aria-label="Constraint" value={inferred?.id ?? ex.constraint} disabled={fitting}
        title="Hold the fitted primitive parallel or perpendicular to a coordinate plane: a plane by its normal, a cylinder or line by its axis"
        onChange={(e) => { ex.setConstraint(e.target.value as ConstraintId); if (preview) onType(preview.kind) }}>
        {options.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
      {preview.kind === 'cylinder' && (() => {
        // QUICKSURFACE's "Coincident axis", under the constraint: enabled for a
        // cylinder held parallel to another axis; Auto Constrain ticks it when
        // it moved the axis onto a parallel one within the coincidence tolerance.
        const target = ex.constraint.startsWith('parallel-el') ? constraintRefs.find((r) => r.id === Number(ex.constraint.slice('parallel-el'.length))) : undefined
        const can = !!target && (target.fit.kind === 'cylinder' || target.fit.kind === 'cone' || target.fit.kind === 'line')
        const checked = ex.autoConstrain ? !!preview.autoCoincident : can && ex.coincidentAxis
        return <label className="checkrow" title="Hold the cylinder's axis on the axis it is parallel to; only the radius is fitted">
          <input type="checkbox" checked={checked} disabled={fitting || ex.autoConstrain || !can} data-test="extract-coincident-axis"
            onChange={(e) => { ex.setCoincidentAxis(e.target.checked); onType(preview.kind) }} />
          <span>Coincident axis</span>
        </label>
      })()}
      {preview && !fitting && (preview.kind === 'cone' || preview.kind === 'sphere') && (ex.constraint !== 'none' || ex.autoConstrain) && <p className="qs-count" data-test="extract-constraint-note">A {preview.kind} has no direction to hold here.</p>}
      <label className="checkrow">
        <input type="checkbox" checked={ex.autoConstrain} data-test="extract-auto-constrain" onChange={(e) => { ex.setAutoConstrain(e.target.checked); if (preview) onType(preview.kind) }} />
        <span>Auto Constrain</span>
      </label>
      <div className="qs-tol" title="A direction within this many degrees of parallel or perpendicular to a primitive already made is held to it">
        <span>Tilt tolerance</span>
        <NumberField value={ex.tiltDeg} min={0} label="Tilt tolerance in degrees" test="extract-tilt" disabled={!ex.autoConstrain} onValid={(v) => ex.setTiltDeg(v)} />
        <span>degrees</span>
      </div>
      <div className="qs-tol" title="A plane within this distance of a parallel one already made is moved onto it; likewise a cylinder's axis">
        <span>Coincidence tolerance</span>
        <NumberField value={len.toDisplay(ex.coincidenceMm)} min={0} label="Coincidence tolerance" test="extract-coincidence" disabled={!ex.autoConstrain} onValid={(v) => ex.setCoincidenceMm(len.fromDisplay(v))} />
        <span>{len.word()}</span>
      </div>
      </>}
      {fitting && <p className="qs-count">Fitting…</p>}
      {preview && !fitting && (
        <div className="qs-preview" data-test="extract-preview">
          <p className="qs-count">{preview.problem || <>{preview.kind[0].toUpperCase() + preview.kind.slice(1)} preview{preview.sigma != null ? ` · σ ${len.fmt(preview.sigma, 4)}` : ''}</>}</p>
        </div>
      )}
      <div className="qs-spacer" />
      <hr />
      {preview && <>
      <div className="qs-tol qs-analysis">
        <label className="checkrow">
          <input type="checkbox" checked={ex.analysis} data-test="extract-analysis" onChange={(e) => { ex.setAnalysis(e.target.checked); if (!e.target.checked) onAnalysisOff() }} />
          <span>Analysis</span>
        </label>
        <NumberField value={len.toDisplay(ex.analysisMm)} min={0} label="Analysis tolerance" test="extract-analysis-tolerance" disabled={!ex.analysis} onValid={(v) => { onAnalysisOff(); ex.setAnalysisMm(len.fromDisplay(v)) }} />
        <span>{len.word()}</span>
        <button data-test="extract-analysis-apply" disabled={!ex.analysis || !preview || !!preview.problem || fitting} title="Show the marked points that lie further than this from the previewed primitive" onClick={onAnalyse}>Apply</button>
      </div>
      {ex.analysis && ex.analysed && <p className="qs-count" data-test="extract-analysis-result">{ex.analysed.far === 0 ? `All ${ex.analysed.total.toLocaleString('en-US')} points are within the tolerance.` : `${ex.analysed.far.toLocaleString('en-US')} of ${ex.analysed.total.toLocaleString('en-US')} points beyond it, the worst ${len.fmt(ex.analysed.worst, 3)}.`}</p>}
      </>}
      <label className="checkrow">
        <input type="checkbox" checked={m.quickTools} data-test="extract-quick-tools" onChange={(e) => m.setQuickTools(e.target.checked)} />
        <span>Show quick tools dialog</span>
      </label>
      <label className="checkrow">
        <input type="checkbox" checked={labels} data-test="extract-labels" onChange={(e) => useStore.getState().setShowLabels(e.target.checked)} />
        <span>Show primitives labels</span>
      </label>
      <hr />
      <footer>
        <button className="qs-help" title="Select an area with the tools in step 1 — the Magic Wand takes a well-defined face in one click — then click the primitive type in step 2 to preview the fit, and Create to keep it. Select the next area for the next one.">?</button>
        <div className="qs-command-actions">
          {preview && !preview.problem && !fitting && <button data-test="extract-create-stay" onClick={() => onCreate(true)}>Create &amp; Stay</button>}
          <div className="qs-command-end">
            {preview && !preview.problem && !fitting && <button data-test="extract-create" onClick={() => { if (onCreate(false)) onClose() }}>Create</button>}
            <button data-test="extract-close" data-command-close disabled={fitting} onClick={requestClose}>Close</button>
          </div>
        </div>
      </footer>
    </section>)}
    {confirmClose && createPortal(
      <div className="modalback">
        <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="extract-close-title" aria-describedby="extract-close-description"
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setConfirmClose(false) }}>
          <h2 id="extract-close-title">Extract primitive</h2>
          <p id="extract-close-description">Add the previewed primitive to the scene before exiting?</p>
          <div className="toolrow">
            <button autoFocus data-test="extract-close-yes" onClick={() => { if (onCreate(false)) { setConfirmClose(false); onClose() } }}>Yes</button>
            <button data-test="extract-close-no" onClick={() => { setConfirmClose(false); onClose() }}>No</button>
            <button data-test="extract-close-cancel" onClick={() => setConfirmClose(false)}>Cancel</button>
          </div>
        </div>
      </div>, document.body,
    )}
    </>
  )
}
