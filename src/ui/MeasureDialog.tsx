// SPDX-License-Identifier: AGPL-3.0-only
// Analysis → Measure: QUICKSURFACE 8.0.128's Measure dialog and what it lays
// over the view, recorded live. 3D Distance: two clicks on the mesh, a line
// between them and its length boxed at the middle. Extended Distance: the
// same, with its X, Y and Z parts boxed in red, green and blue along dotted
// lines. Point: the clicked point's X, Y and Z. Every figure to four
// decimals. Delete All, Delete Last; closing takes the measurements away.
// A plugin's ways of measuring (PluginRuntime `measure`) stand after these:
// while one is chosen the plugin takes the clicks, and its readouts — named
// results, read only — are listed here with Copy and boxed over the view.

import { useDialogDrag } from './useDialogDrag'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShell } from '../state/shellStore'
import { snapFlags, useSnapFilter } from '../state/snapFilterStore'
import { useStore } from '../state/store'
import { measuredDistance, readoutText, useMeasureTool, type MeasureMode, type MeasurePreview, type MeasureReadout, type MeasureRow, type Measurement } from '../state/measureToolStore'
import type { PluginRuntime } from '../plugins/api'
import { useLength } from '../app/useUnits'
import type { Vec3 } from '../core/types'

type PluginMeasure = NonNullable<PluginRuntime['measure']>

const MODES: { id: MeasureMode; label: string }[] = [
  { id: '3d', label: '3D Distance' },
  { id: 'extended', label: 'Extended Distance' },
  { id: 'point', label: 'Point' },
  { id: 'curve', label: 'Curve length' },
]
const AXIS = ['#d8282d', '#2fa33c', '#1f4fd0']
/** The preview's colour: the light blue a sketch lights a piece in under
 *  the cursor. */
const PREVIEW = '#62aae4'

/** How near a mesh vertex a click must be, in pixels, for All to take it. */
const SMART_VERTEX_PX = 10

export function MeasureDialog({ plugins = [] }: { plugins?: readonly PluginMeasure[] }) {
  const t = useMeasureTool()
  const pluginsRef = useRef(plugins)
  pluginsRef.current = plugins
  const extra = plugins.flatMap((p) => p.modes)
  // The mesh's ways need a scan; with none, Measure is a plugin's.
  const hasScan = useStore((s) => s.fileName !== null)
  // A way that cannot be used — a plugin's that has gone (its workspace
  // closed), or the mesh's with no scan — gives way to the first that can:
  // 3D Distance with a scan, a plugin's without one.
  useEffect(() => {
    if (!t.open) return
    const usable = t.mode.startsWith('plugin:') ? extra.some((m) => m.id === t.mode && !m.disabled) : hasScan
    if (usable) return
    const other = hasScan ? null : extra.find((m) => !m.disabled)
    if (other) {
      other.choose?.()
      t.setMode(other.id)
    } else if (t.mode !== '3d') t.setMode('3d')
  })
  // The snap bar's switches the chosen way picks by.
  const snapAs = extra.find((m) => m.id === t.mode)?.snap ?? 'measure'
  const wireframe = useStore((s) => s.wireframe)
  const drag = useDialogDrag({ left: 270, top: 230 })
  // Clicks on the view become picks while the dialog is open.
  // While the dialog is open the snap bar shows what a click takes: the
  // mesh's switches, or those of the set a plugin's way picks by — a
  // sketch's Pick switches, the Dimension tool's.
  useEffect(() => {
    if (!t.open) return
    const before = useSnapFilter.getState().context
    useSnapFilter.getState().setContext(snapAs)
    return () => useSnapFilter.getState().setContext(before === 'measure' ? null : before)
  }, [t.open, snapAs])
  useEffect(() => {
    if (!t.open) return
    let down: { x: number; y: number } | null = null
    const press = (e: PointerEvent) => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null }
    // While a plugin's way is chosen, the left button on the view is the
    // Measure's alone: the press, the release and a double click are kept
    // from what lies under it — a sketch would select the piece or start
    // dragging it — so measuring changes nothing. The other buttons still
    // turn and pan the view.
    const hold = (e: MouseEvent) => {
      if (e.button !== 0 || !useMeasureTool.getState().mode.startsWith('plugin:')) return
      if (!(e.target as HTMLElement | null)?.closest?.('.desktop-mid canvas')) return
      e.stopPropagation()
    }
    const held = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick'] as const
    // A plugin's way shows what a click would take before it: asked once a
    // frame while the cursor moves over the view with no button down.
    let frame = 0
    let at: { x: number; y: number } | null = null
    const look = () => {
      frame = 0
      const tool = useMeasureTool.getState()
      const mode = tool.mode
      if (!at || !mode.startsWith('plugin:')) return tool.setPreview(null)
      let seen: MeasurePreview | null = null
      for (const p of pluginsRef.current) {
        seen = p.hover?.(mode, at.x, at.y) ?? null
        if (seen) break
      }
      tool.setPreview(seen)
    }
    const move = (e: PointerEvent) => {
      const over = e.buttons === 0 && !!(e.target as HTMLElement | null)?.closest?.('.desktop-mid canvas')
      at = over ? { x: e.clientX, y: e.clientY } : null
      if (!frame) frame = requestAnimationFrame(look)
    }
    const click = (e: MouseEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('.desktop-mid canvas') || !down) return
      // A drag turns the view; only a click measures.
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return
      // A plugin's way: the plugin takes the click, or nothing does.
      const mode = useMeasureTool.getState().mode
      if (mode.startsWith('plugin:')) {
        if (pluginsRef.current.some((m) => m.pick(mode, e.clientX, e.clientY, { ctrl: e.ctrlKey, shift: e.shiftKey }))) e.stopPropagation()
        // What the next click would take has changed with this one.
        at = { x: e.clientX, y: e.clientY }
        if (!frame) frame = requestAnimationFrame(look)
        return
      }
      // The snap bar's Vertex switch, or Ctrl, takes the mesh vertex nearest
      // the click; with Surface switched off there is nothing else to take.
      const snap = snapFlags('measure')
      const shell = useShell.getState()
      let p = shell.scanPointAt?.(e.clientX, e.clientY, e.ctrlKey || (!snap.nearest && (snap.endpoint || !snap.curve)))
      if (p && snap.nearest && !e.ctrlKey) {
        // All: the mesh vertex when the click is on one (within a hand's
        // reach on the screen), otherwise where the click lands.
        const v = shell.scanPointAt?.(e.clientX, e.clientY, true)
        const at = v ? shell.screenPointOf?.(v) : null
        if (v && at && Math.hypot(at.x - e.clientX, at.y - e.clientY) <= SMART_VERTEX_PX) p = v
      }
      if (!p) return
      e.stopPropagation()
      useMeasureTool.getState().pick(p)
    }
    document.addEventListener('pointerdown', press, true)
    for (const kind of held) document.addEventListener(kind, hold, true)
    document.addEventListener('click', click, true)
    document.addEventListener('pointermove', move, true)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerdown', press, true)
      document.removeEventListener('click', click, true)
      for (const kind of held) document.removeEventListener(kind, hold, true)
    }
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
                title={m.id === 'curve' ? 'Curve length is not built in Quick Scan yet' : hasScan ? m.label : `${m.label}: open a scan to measure on the mesh`} disabled={m.id === 'curve' || !hasScan} onClick={() => t.setMode(m.id)}>{m.label}</button>
            ))}
            {extra.map((m) => (
              <button key={m.id} data-test={`measure-${m.id.replace(':', '-')}`} className={t.mode === m.id ? 'on' : undefined} aria-pressed={t.mode === m.id}
                title={m.title} disabled={m.disabled} onClick={() => { m.choose?.(); t.setMode(m.id) }}>{m.label}</button>
            ))}
          </div>
          {t.mode.startsWith('plugin:') && <p className="hint" data-test="measure-plugin-hint">{extra.find((m) => m.id === t.mode)?.title}</p>}
          <Readouts items={t.items} />
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

/** A row's figure in the display units: lengths and areas as the app
 *  shows them, angles in degrees, points as their coordinates. */
function rowText(r: MeasureRow, len: ReturnType<typeof useLength>): string {
  if (!Number.isFinite(r.value) && r.unit !== 'point') return '—'
  const approx = r.exact ? '' : '≈ '
  if (r.unit === 'point') return (r.point ?? []).map((v, i) => `${'XYZ'[i]} ${len.fmt(v, 4)}`).join('  ')
  if (r.unit === 'deg') return `${approx}${r.value.toFixed(4)}°`
  if (r.unit === 'area') return `${approx}${len.area(r.value, 4)}`
  return `${approx}${len.fmt(r.value, 4)}`
}

/** The plugins' readouts in the dialog, the newest first: each one's
 *  results by name, and Copy for all of them at full precision. */
function Readouts({ items }: { items: readonly Measurement[] }) {
  const len = useLength()
  const readouts = items.filter((m): m is MeasureReadout => m.kind === 'readout')
  if (readouts.length === 0) return null
  return (
    <div className="measure-readouts" data-test="measure-readouts" style={{ maxHeight: 260, overflowY: 'auto', marginTop: 6 }}>
      {readouts.slice().reverse().map((m, i) => (
        <div key={readouts.length - i} className="measure-readout" data-test="measure-readout" style={{ borderTop: '1px solid var(--line, #8884)', padding: '4px 0' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'baseline' }}>
            <b style={{ flex: 1, fontSize: 12 }}>{m.title}</b>
            <button data-test="measure-readout-copy" title="Copy every result at full precision" onClick={() => void navigator.clipboard?.writeText(readoutText(m)).catch(() => {})}>Copy</button>
          </div>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <tbody>
              {m.rows.map((r, k) => (
                <tr key={k} data-test="measure-row" data-label={r.label} data-value={r.unit === 'point' ? (r.point ?? []).join(',') : String(r.value)} data-exact={String(r.exact)} title={r.note}>
                  <td style={{ paddingRight: 6 }}>{r.label}{r.note ? <span className="hint" style={{ display: 'block', fontSize: 11 }}>{r.note}</span> : null}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{rowText(r, len)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

/** The lines and boxed figures over the view, following it as it turns. */
function MeasureLayer() {
  const items = useMeasureTool((s) => s.items)
  const pending = useMeasureTool((s) => s.pending)
  const preview = useMeasureTool((s) => s.preview)
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
    if (m.kind === 'readout') {
      // A plugin's readout: a line through its points, its first result
      // boxed beside them.
      const place = m.screen ?? at
      const pts = m.witness.map((p) => place(p))
      if (pts.some((s) => !s)) return
      const ss = pts as { x: number; y: number }[]
      ss.forEach((s, k) => dot(`r${i}-${k}`, s))
      if (ss.length > 1) lines.push(<polyline key={`r${i}`} points={ss.map((s) => `${s.x},${s.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={1.5} />)
      const row = m.caption ? m.rows[m.caption.row] : undefined
      if (row && ss.length > 0) {
        const mid = ss.length > 2 ? ss[1] : ss.length === 2 ? { x: (ss[0].x + ss[1].x) / 2, y: (ss[0].y + ss[1].y) / 2 } : { x: ss[0].x + 40, y: ss[0].y }
        labels.push(box(`r${i}`, mid.x, mid.y - (ss.length > 2 ? 14 : 0), `${m.caption!.sign ? `${m.caption!.sign} ` : ''}${rowText(row, len)}`))
      }
      return
    }
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
  if (preview) {
    // What a click would take: its outline lit, the points a reading would
    // stand between joined by a dashed line, that reading boxed in blue.
    const place = preview.screen ?? at
    const run = (pts: Vec3[]) => {
      const ss = pts.map((p) => place(p))
      return ss.some((s) => !s) ? null : (ss as { x: number; y: number }[])
    }
    preview.outline.forEach((loop, k) => {
      const ss = run(loop)
      if (ss && ss.length > 1) lines.push(<polyline key={`po${k}`} data-test="measure-preview-outline" points={ss.map((s) => `${s.x},${s.y}`).join(' ')} fill="none" stroke={PREVIEW} strokeWidth={3} strokeLinejoin="round" opacity={0.9} />)
    })
    const ws = run(preview.witness)
    if (ws) {
      ws.forEach((s, k) => lines.push(<circle key={`pw${k}`} data-test="measure-preview-point" cx={s.x} cy={s.y} r={4} fill={PREVIEW} stroke="#000" strokeWidth={1} />))
      if (ws.length > 1) lines.push(<polyline key="pwl" points={ws.map((s) => `${s.x},${s.y}`).join(' ')} fill="none" stroke={PREVIEW} strokeWidth={1.5} strokeDasharray="5 4" />)
      if (preview.row && ws.length > 0) {
        const mid = ws.length > 2 ? ws[1] : ws.length === 2 ? { x: (ws[0].x + ws[1].x) / 2, y: (ws[0].y + ws[1].y) / 2 } : { x: ws[0].x + 40, y: ws[0].y - 16 }
        const box1 = box('preview', mid.x, mid.y - (ws.length > 2 ? 14 : 0), `${preview.sign ? `${preview.sign} ` : ''}${rowText(preview.row, len)}`, '#1d5f96')
        labels.push(<div key="preview-wrap" data-test="measure-preview-label">{box1}</div>)
      }
    }
  }
  return createPortal(
    <>
      <svg data-test="measure-layer" style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 54 }}>{lines}</svg>
      {labels}
    </>,
    document.body,
  )
}
