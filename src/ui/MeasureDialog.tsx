// SPDX-License-Identifier: AGPL-3.0-only
// Analysis → Measure: QUICKSURFACE 8.0.128's Measure dialog and what it lays
// over the view, recorded live. 3D Distance: two clicks on the mesh, a line
// between them and its length boxed at the middle. Extended Distance: the
// same, with its X, Y and Z parts boxed in red, green and blue along dotted
// lines. Point: the clicked point's X, Y and Z. Every figure to four
// decimals. Delete All, Delete Last; closing takes the measurements away.

import { useDialogDrag } from './useDialogDrag'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShell } from '../state/shellStore'
import { useStore } from '../state/store'
import { measuredDistance, useMeasureTool, type MeasureMode, type Measurement } from '../state/measureToolStore'
import { useLength } from '../app/useUnits'
import type { Vec3 } from '../core/types'

const MODES: { id: MeasureMode; label: string }[] = [
  { id: '3d', label: '3D Distance' },
  { id: 'extended', label: 'Extended Distance' },
  { id: 'point', label: 'Point' },
  { id: 'curve', label: 'Curve length' },
]
const AXIS = ['#d8282d', '#2fa33c', '#1f4fd0']

export function MeasureDialog() {
  const t = useMeasureTool()
  const wireframe = useStore((s) => s.wireframe)
  const drag = useDialogDrag({ left: 270, top: 230 })
  // Clicks on the view become picks while the dialog is open.
  useEffect(() => {
    if (!t.open) return
    let down: { x: number; y: number } | null = null
    const press = (e: PointerEvent) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null }
    const click = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('.desktop-mid canvas') || !down) return
      // A drag turns the view; only a click measures.
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
      const p = useShell.getState().scanPointAt?.(e.clientX, e.clientY, e.ctrlKey)
      if (!p) return
      e.stopPropagation()
      useMeasureTool.getState().pick(p)
    }
    document.addEventListener('pointerdown', press, true)
    document.addEventListener('click', click, true)
    return () => { document.removeEventListener('pointerdown', press, true); document.removeEventListener('click', click, true) }
  }, [t.open])
  if (!t.open) return null
  return (
    <>
      <MeasureLayer />
      {createPortal(
        <section className="qs-dialog measure-dialog" data-test="measure-dialog" aria-label="Measure"
          style={{ position: 'fixed', left: drag.position.left, top: drag.position.top, width: 290, zIndex: 60 }}>
          <header {...drag.handle}><b>Measure</b><button className="qs-x" title="Close" onClick={() => t.setOpen(false)}>×</button></header>
          <p className="qs-step">Distances</p>
          <div className="measure-modes" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            {MODES.map((m) => (
              <button key={m.id} data-test={`measure-${m.id}`} className={t.mode === m.id ? 'on' : undefined} aria-pressed={t.mode === m.id}
                title={m.id === 'curve' ? 'Curve length is not built in Quick Scan yet' : m.label} disabled={m.id === 'curve'} onClick={() => t.setMode(m.id)}>{m.label}</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <button data-test="measure-delete-all" disabled={t.items.length === 0 && !t.pending} onClick={t.deleteAll}>Delete All</button>
            <button data-test="measure-delete-last" disabled={t.items.length === 0 && !t.pending} onClick={t.deleteLast}>Delete Last</button>
          </div>
          <label className="checkrow">
            <input type="checkbox" checked={wireframe} onChange={(e) => useStore.getState().setWireframe(e.target.checked)} />
            <span>Show mesh wireframe</span>
          </label>
          <p className="hint">Hold Ctrl to pick vertices from the meshes</p>
          <footer style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button data-test="measure-close" onClick={() => t.setOpen(false)}>Close</button>
          </footer>
        </section>,
        document.body,
      )}
    </>
  )
}

/** The lines and boxed figures over the view, following it as it turns. */
function MeasureLayer() {
  const items = useMeasureTool((s) => s.items)
  const pending = useMeasureTool((s) => s.pending)
  const len = useLength()
  const [, redraw] = useState(0)
  useEffect(() => {
    let id = 0
    const tick = () => { redraw((n) => n + 1); id = requestAnimationFrame(tick) }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])
  const at = useShell.getState().screenPointOf
  if (!at) return null
  const fig = (mm: number) => `${len.toDisplay(mm).toFixed(4)} ${len.word()}`
  const box = (key: string, x: number, y: number, text: string, bg = '#000') => (
    <div key={key} className="measure-label" style={{ position: 'fixed', left: x, top: y, transform: 'translate(-50%, -50%)', background: bg, color: '#fff', padding: '1px 5px', font: '13px/1.3 var(--ui-font, sans-serif)', whiteSpace: 'pre', pointerEvents: 'none', zIndex: 55 }}>{text}</div>
  )
  const lines: React.ReactNode[] = []
  const labels: React.ReactNode[] = []
  const dot = (key: string, s: { x: number; y: number }) => lines.push(<circle key={key} cx={s.x} cy={s.y} r={3} fill="#000" />)
  items.forEach((m: Measurement, i) => {
    const sa = at(m.a)
    if (!sa) return
    dot(`a${i}`, sa)
    if (m.kind === 'point') {
      labels.push(box(`p${i}`, sa.x + 60, sa.y, `X: ${fig(m.a[0])}\nY: ${fig(m.a[1])}\nZ: ${fig(m.a[2])}`))
      return
    }
    const sb = at(m.b)
    if (!sb) return
    dot(`b${i}`, sb)
    lines.push(<line key={`l${i}`} x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} stroke="#000" strokeWidth={1.5} />)
    const d = measuredDistance(m.a, m.b)
    labels.push(box(`d${i}`, (sa.x + sb.x) / 2, (sa.y + sb.y) / 2 + (m.kind === 'extended' ? 12 : 0), fig(d.d)))
    if (m.kind === 'extended') {
      // The parts along X, Y and Z: a dotted leg for each, walked from the
      // first point to the second axis by axis.
      let from: Vec3 = [...m.a]
      ;([0, 1, 2] as const).forEach((k) => {
        const to: Vec3 = [...from]
        to[k] = m.b[k]
        const s0 = at(from), s1 = at(to)
        if (s0 && s1) {
          lines.push(<line key={`e${i}${k}`} x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} stroke={AXIS[k]} strokeWidth={1.5} strokeDasharray="3 3" />)
          labels.push(box(`e${i}${k}`, (s0.x + s1.x) / 2, (s0.y + s1.y) / 2 - 10, `${'XYZ'[k]}: ${fig([d.dx, d.dy, d.dz][k])}`, AXIS[k]))
        }
        from = to
      })
    }
  })
  if (pending) { const s = at(pending); if (s) dot('pending', s) }
  return createPortal(
    <>
      <svg data-test="measure-layer" style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 54 }}>{lines}</svg>
      {labels}
    </>,
    document.body,
  )
}
