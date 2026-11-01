// SPDX-License-Identifier: AGPL-3.0-only
// "Extract primitives", laid out as QUICKSURFACE's dialog is (Pro 8.0.127
// photo; manual "Mesh Selection" and "Extract Primitives"): 1. select the
// area — the selection tools, the degrees slider, "Select all connected
// triangles", and the selection options — then 2. click the type of the
// primitive, which is fitted to the selection and created at once. The dialog
// stays open for the next one; Close puts it away.
//
// The selection is the app's shared marking (markStore / viewer/marking); the
// fit is the element fit a hand-marked element uses.

import { useEffect, useState } from 'react'
import { useMark, WAND_MAX_DEG, WAND_MIN_DEG, type MarkGesture } from '../state/markStore'
import { useStore } from '../state/store'
import { useShell } from '../state/shellStore'
import type { ElementKind } from '../core/types'
import { Icon, type IconName } from './icons'

type Tool = { id: MarkGesture | null | 'through' | 'line' | 'circle'; icon: IconName; title: string }
const TOOLS: Tool[] = [
  { id: null, icon: 'navigate', title: 'Navigate — no selection tool; the mouse turns the view' },
  { id: 'wand', icon: 'markWand', title: 'Magic Wand — click a well-defined area; it spreads over neighbouring triangles within the degrees below' },
  { id: 'brush', icon: 'markBrush', title: 'Free hand (filled) — brush; Alt-drag or right-drag removes' },
  { id: 'lasso', icon: 'markLasso', title: 'Free hand — draw an outline; everything inside is selected' },
  { id: 'line', icon: 'line', title: 'Select by drawing a line — not built in Quick Scan yet' },
  { id: 'window', icon: 'markWindow', title: 'Select by drawing a rectangle — visible triangles only unless Select through is on' },
  { id: 'circle', icon: 'circle', title: 'Select by drawing a circle — not built in Quick Scan yet' },
  { id: 'through', icon: 'backfaces', title: 'Select through — the tools also take triangles facing away' },
]

const TYPES: { kind: ElementKind; icon: IconName; label: string }[] = [
  { kind: 'plane', icon: 'elPlane', label: 'Plane' },
  { kind: 'cylinder', icon: 'elCylinder', label: 'Cylinder' },
  { kind: 'line', icon: 'elLine', label: 'Line' },
  { kind: 'cone', icon: 'elCone', label: 'Cone' },
  { kind: 'sphere', icon: 'elSphere', label: 'Sphere' },
]

export function ExtractPrimitives({ onType, onClose, onClear, fitting, onHide, onIsolate, onShowAll }: {
  onType: (kind: ElementKind) => void
  onClose: () => void
  onClear: () => void
  fitting: boolean
  onHide: () => void
  onIsolate: () => void
  onShowAll: () => void
}) {
  const open = useShell((s) => s.extractOpen)
  const m = useMark()
  const labels = useStore((s) => s.showLabels)
  const hidden = useShell((s) => s.hiddenTriangles)
  // The quick tools float where the last wand click landed, while that pick is
  // the selection: a release on the viewport with the wand armed places them.
  const [quickAt, setQuickAt] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!open) return
    const up = (e: PointerEvent) => {
      const onView = (e.target as Element | null)?.closest?.('.viewport')
      if (onView && e.button === 0 && useMark.getState().gesture === 'wand') setQuickAt({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('pointerup', up, true)
    return () => window.removeEventListener('pointerup', up, true)
  }, [open])
  useEffect(() => {
    if (m.count === 0 || m.gesture !== 'wand' || !open) setQuickAt(null)
  }, [m.count, m.gesture, open])
  if (!open) return null
  const toolOn = (t: Tool) => (t.id === 'through' ? m.backfaces : m.gesture === t.id)
  const pick = (t: Tool) => {
    if (t.id === 'through') m.setBackfaces(!m.backfaces)
    else if (t.id !== 'line' && t.id !== 'circle') m.setGesture(m.gesture === t.id ? null : t.id)
  }
  const none = m.count === 0
  return (
    <>
    {m.quickTools && quickAt && !none && (
      <div className="qs-quick" data-test="extract-quick" role="toolbar" aria-label="Quick tools"
        style={{ left: Math.min(quickAt.x + 36, window.innerWidth - 300), top: Math.max(8, Math.min(quickAt.y - 40, window.innerHeight - 110)) }}>
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
    <section className="qs-dialog extract-dialog" data-test="extract-dialog" aria-label="Extract primitives">
      <header>
        <b>Extract primitives</b>
        <button className="qs-x" data-test="extract-x" title="Close" onClick={onClose}>×</button>
      </header>
      <p className="qs-step">1. Select the area that you want to fit a primitive</p>
      <div className="qs-iconrow" role="toolbar" aria-label="Selection tools">
        {TOOLS.map((t) => (
          <button key={String(t.id)} className={toolOn(t) ? 'on' : undefined} aria-pressed={toolOn(t)} disabled={t.id === 'line' || t.id === 'circle'}
            data-test={`extract-tool-${t.id ?? 'navigate'}`} title={t.title} onClick={() => pick(t)}>
            <Icon name={t.icon} size={20} />
          </button>
        ))}
      </div>
      <div className="qs-degrees">
        <input type="range" min={WAND_MIN_DEG} max={WAND_MAX_DEG} step={0.01} value={m.wandDegrees} disabled={m.wandConnected} aria-label="Sensitivity in degrees"
          data-test="extract-degrees-slider" onChange={(e) => m.setWandDegrees(Number(e.target.value))} />
        <input type="number" min={WAND_MIN_DEG} max={WAND_MAX_DEG} step="any" value={Number(m.wandDegrees.toFixed(2))} disabled={m.wandConnected}
          data-test="extract-degrees" onChange={(e) => e.target.value !== '' && m.setWandDegrees(Number(e.target.value))} />
        <span>degrees</span>
      </div>
      <label className="checkrow">
        <input type="checkbox" checked={m.wandConnected} data-test="extract-connected" onChange={(e) => m.setWandConnected(e.target.checked)} />
        <span>Select all connected triangles</span>
      </label>
      <div className="qs-iconrow" role="toolbar" aria-label="Selection options">
        <button data-test="extract-enlarge" disabled={none} title="Enlarge currently selected area" onClick={() => m.resize(1)}><Icon name="markWindow" size={20} /></button>
        <button data-test="extract-shrink" disabled={none} title="Shrink currently selected area" onClick={() => m.resize(-1)}><Icon name="markBrush" size={20} /></button>
        <button data-test="extract-isolate" disabled={none} title="Isolate (leave selected and hide others)" onClick={onIsolate}><Icon name="model" size={20} /></button>
        <button data-test="extract-hide" disabled={none} title="Hide selected" onClick={onHide}><Icon name="eyeOff" size={20} /></button>
        <button data-test="extract-show-all" disabled={hidden === 0} title="Show all hidden triangles" onClick={onShowAll}><Icon name="eye" size={20} /></button>
        <button data-test="extract-deselect" disabled={none} title="Deselect all selected triangles" onClick={onClear}><Icon name="erase" size={20} /></button>
        <button data-test="extract-invert" disabled={none} title="Invert selection" onClick={m.invert}><Icon name="markInvert" size={20} /></button>
      </div>
      <p className="qs-count" data-test="extract-count">{none ? 'Nothing selected' : `${m.count.toLocaleString('en-US')} points selected`}</p>
      <hr />
      <p className="qs-step">2. Select the type of the primitive</p>
      <div className="qs-typerow" role="toolbar" aria-label="Primitive type">
        {TYPES.map((t) => (
          <button key={t.kind} data-test={`extract-type-${t.kind}`} disabled={none || fitting} title={none ? `Select an area first, then click ${t.label}` : `Fit a ${t.label.toLowerCase()} to the selection and create it`} onClick={() => onType(t.kind)}>
            <Icon name={t.icon} size={26} />
          </button>
        ))}
      </div>
      {fitting && <p className="qs-count">Fitting…</p>}
      <div className="qs-spacer" />
      <hr />
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
        <button className="qs-help" title="Select an area with the tools in step 1 — the Magic Wand takes a well-defined face in one click — then click the primitive type in step 2. The primitive is fitted to the selection and created; select the next area for the next one.">?</button>
        <button data-test="extract-close" onClick={onClose}>Close</button>
      </footer>
    </section>
    </>
  )
}
