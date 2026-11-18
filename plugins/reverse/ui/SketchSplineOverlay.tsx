// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { Vec2 } from '../../../src/core/flat/types'
import { useReverse } from '../state/reStore'
import { usePrefs } from '../../../src/state/prefsStore'
import { pieceNear } from '../state/reSketchDraft'
import { entityOf, type Sketch, type SketchSpline } from '../core/sketch'
import { isClosed, splineCurve, splineDirAt, splineEnd } from '../core/sketchSpline'
import { insertSplinePoint, MAX_SPLINE_POINTS, rebuildSpline, removeSplinePoint, setSplineEndDirection, splinePointNear } from '../core/splineEdits'

type MenuItem = { label: string; test: string; enabled: boolean; run: () => void; title?: string }
interface MenuState { x: number; y: number; title: string; items: MenuItem[]; rebuild?: { id: number; count: number } }

const HANDLE_PX = 46
const SNAP_DEG = 4

/** The open, fit-point spline selected alone with the Select tool, whose
 *  end tangents get handles. */
function handleSpline(): SketchSpline | null {
  const d = useReverse.getState().sketchDraft
  if (!d || d.tool !== 'select' || d.selection.length !== 1) return null
  const e = entityOf(d.sketch, d.selection[0])
  return e?.kind === 'spline' && !isClosed(e) && !e.controlKnots ? e : null
}

/** Each end's handle: the end point and the direction the curve leaves the
 *  start or reaches the end, and whether a direction is set by hand. */
function endsOf(e: SketchSpline): { end: 'a' | 'b'; p: Vec2; dir: Vec2; set: boolean }[] {
  const fit = splineCurve(e)
  const n = e.pts.length - 1
  return [
    { end: 'a', p: e.pts[0], dir: splineDirAt(fit, 0), set: Boolean(e.startSet) },
    { end: 'b', p: e.pts[n], dir: splineDirAt(fit, splineEnd(fit)), set: Boolean(e.endSet) },
  ]
}

const apply = (sketch: Sketch, select: number[]) => {
  const re = useReverse.getState()
  re.setSketch(sketch)
  useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, selection: select } } : {}))
}

/** The spline's tangent handles and its right-click menus. While drawing a
 *  spline: Finish, Close and finish, Remove last point, Restart drawing.
 *  On a finished spline: Modify, Add point here, Remove this point,
 *  Rebuild…, Fixed, Construction, Delete — only what is implemented, each
 *  enabled only when it can act. With one open spline selected, a handle
 *  at each end sets its tangent (snapping to level and upright; hold Alt
 *  for free); double-click a handle to let the end run free again. */
export function SketchSplineOverlay({ scene }: { scene: FlatScene | null }) {
  const draftOpen = useReverse((s) => s.sketchDraft !== null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    const el = canvas.current, host = el?.parentElement
    if (!draftOpen || !scene || !el || !host) return
    let frame = 0, hover: { x: number; y: number } | null = null
    let drag: { id: number; end: 'a' | 'b'; p: Vec2; orig: Sketch } | null = null
    let lastKnob: { end: 'a' | 'b'; at: number } | null = null
    const accent = () => getComputedStyle(host).getPropertyValue('--accent').trim() || '#3f93d6'
    const local = (p: Vec2, rect: DOMRect) => { const at = scene.sheetScreenPoint(p); return at ? { x: at.x - rect.left, y: at.y - rect.top } : null }
    const knobs = (rect: DOMRect) => {
      const e = handleSpline()
      if (!e) return []
      return endsOf(e).flatMap((h) => {
        const at = local(h.p, rect)
        if (!at) return []
        // Screen y runs down: the sheet's direction flipped in y.
        return [{ ...h, id: e.id, at, knob: { x: at.x + h.dir[0] * HANDLE_PX, y: at.y - h.dir[1] * HANDLE_PX } }]
      })
    }
    const knobUnder = (rect: DOMRect) => hover ? knobs(rect).find((k) => Math.hypot(k.knob.x - hover!.x, k.knob.y - hover!.y) <= 8) ?? null : null
    const draw = () => {
      frame = 0
      const ctx = el.getContext('2d'), rect = host.getBoundingClientRect(), ratio = window.devicePixelRatio || 1
      if (!ctx) return
      el.width = Math.round(rect.width * ratio); el.height = Math.round(rect.height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)
      const blue = accent(), over = knobUnder(rect)
      for (const k of knobs(rect)) {
        const hot = drag ? drag.end === k.end : over?.end === k.end
        ctx.strokeStyle = blue; ctx.fillStyle = hot ? blue : 'rgba(0,0,0,0.35)'; ctx.lineWidth = hot ? 2.5 : 1.5
        ctx.setLineDash(k.set ? [] : [4, 3])
        ctx.beginPath(); ctx.moveTo(k.at.x, k.at.y); ctx.lineTo(k.knob.x, k.knob.y); ctx.stroke()
        ctx.setLineDash([])
        ctx.beginPath(); ctx.arc(k.knob.x, k.knob.y, hot ? 6 : 5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke()
      }
    }
    const request = () => { if (!frame) frame = requestAnimationFrame(draw) }
    const track = (e: PointerEvent | MouseEvent) => { const rect = host.getBoundingClientRect(); hover = { x: e.clientX - rect.left, y: e.clientY - rect.top } }
    const angleTo = (p: Vec2, e: PointerEvent): number | null => {
      const q = scene.sheetPoint(e.clientX, e.clientY)
      if (!q) return null
      const dx = q[0] - p[0], dy = q[1] - p[1]
      if (!(Math.hypot(dx, dy) > 1e-9)) return null
      let a = Math.atan2(dy, dx)
      if (!e.altKey) {
        const quarter = Math.PI / 2, snapped = Math.round(a / quarter) * quarter
        if (Math.abs(a - snapped) < (SNAP_DEG * Math.PI) / 180) a = snapped
      }
      return a
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      track(e)
      const k = knobUnder(host.getBoundingClientRect())
      const d = useReverse.getState().sketchDraft
      if (!k || !d) return
      e.preventDefault(); e.stopImmediatePropagation()
      const now = performance.now(), again = lastKnob?.end === k.end && now - lastKnob.at < 400
      lastKnob = { end: k.end, at: now }
      if (again) {
        lastKnob = null
        // Double-click: the end runs free again.
        const r = setSplineEndDirection(d.sketch, k.id, k.end, null)
        if (r.ok) apply(r.sketch, [k.id]); else setMessage(r.error)
        return
      }
      drag = { id: k.id, end: k.end, p: k.p, orig: d.sketch }
      host.setPointerCapture?.(e.pointerId)
      request()
    }
    const move = (e: PointerEvent) => {
      track(e)
      if (drag) {
        e.preventDefault(); e.stopImmediatePropagation()
        const a = angleTo(drag.p, e), d = useReverse.getState().sketchDraft
        if (a !== null && d) {
          const r = setSplineEndDirection(drag.orig, drag.id, drag.end, a)
          if (r.ok) useReverse.setState({ sketchDraft: { ...d, sketch: r.sketch } })
          else { setMessage(r.error); drag = null }
        }
      }
      request()
    }
    const up = (e: PointerEvent) => {
      if (!drag) return
      e.preventDefault(); e.stopImmediatePropagation()
      const done = drag; drag = null
      host.releasePointerCapture?.(e.pointerId)
      const d = useReverse.getState().sketchDraft
      if (!d) return
      const final = d.sketch
      // One undo step: back to the sketch before the drag, then the result.
      useReverse.setState({ sketchDraft: { ...d, sketch: done.orig } })
      apply(final, [done.id])
      request()
    }
    const contextMenu = (e: MouseEvent) => {
      const d = useReverse.getState().sketchDraft
      if (!d) return
      const spot = scene.sheetPoint(e.clientX, e.clientY)
      if (!spot) return
      const reach = 8 * scene.unitsPerScreenPx()
      const re = useReverse.getState()
      if (d.tool === 'spline' && d.pending.length > 0) {
        e.preventDefault(); e.stopImmediatePropagation()
        const n = d.pending.length
        setMenu({ x: e.clientX, y: e.clientY, title: `Spline · ${n} point${n === 1 ? '' : 's'}`, items: [
          { label: 'Finish', test: 'spline-menu-finish', enabled: n >= 2, run: () => re.finishSpline(false), title: 'End the curve here (2 points at least)' },
          { label: 'Close and finish', test: 'spline-menu-close', enabled: n >= 3, run: () => re.finishSpline(true), title: 'Close the curve round to its first point (3 points at least)' },
          { label: 'Remove last point', test: 'spline-menu-remove-last', enabled: n >= 1, run: () => useReverse.setState((s) => s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, pending: s.sketchDraft.pending.slice(0, -1), snaps: (s.sketchDraft.snaps ?? []).slice(0, -1) } } : {}) },
          { label: 'Restart drawing', test: 'spline-menu-restart', enabled: n >= 1, run: () => useReverse.setState((s) => s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, pending: [], snaps: [] } } : {}) },
        ] })
        return
      }
      const piece = pieceNear(d.sketch, spot, reach)
      if (!piece || piece.kind !== 'spline') return
      e.preventDefault(); e.stopImmediatePropagation()
      const id = piece.id, closed = isClosed(piece), atPoint = splinePointNear(piece, spot, reach)
      const select = () => { re.setSketchTool('select'); useReverse.setState((s) => s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, selection: [id] } } : {}) }
      const run = (r: ReturnType<typeof insertSplinePoint>) => { if (r.ok) { apply(r.sketch, [id]); setMessage(r.note ?? null) } else setMessage(r.error) }
      const fixed = Boolean(piece.fixed)
      setMenu({ x: e.clientX, y: e.clientY, title: `Spline ${id} · ${piece.pts.length} points`, items: [
        { label: 'Modify', test: 'spline-menu-modify', enabled: true, run: select, title: 'Select it: drag its points, and its end tangents by their handles' },
        { label: 'Add point here', test: 'spline-menu-add', enabled: !piece.controlKnots && atPoint === null && piece.pts.length < MAX_SPLINE_POINTS, run: () => run(insertSplinePoint(d.sketch, id, spot)) },
        { label: 'Remove this point', test: 'spline-menu-remove', enabled: !piece.controlKnots && atPoint !== null && piece.pts.length > (closed ? 3 : 2), run: () => atPoint !== null && run(removeSplinePoint(d.sketch, id, atPoint)), title: 'Right-click on one of its points' },
        { label: 'Rebuild…', test: 'spline-menu-rebuild', enabled: true, run: () => setMenu({ x: e.clientX, y: e.clientY, title: `Rebuild spline ${id}`, items: [], rebuild: { id, count: piece.pts.length } }) },
        { label: fixed ? 'Unfix' : 'Fixed', test: 'spline-menu-fixed', enabled: true, run: () => { select(); useReverse.getState().toggleFixedSelected() } },
        { label: piece.construction ? 'Make regular' : 'Construction', test: 'spline-menu-construction', enabled: true, run: () => { select(); useReverse.getState().toggleConstructionSelected() } },
        { label: 'Delete', test: 'spline-menu-delete', enabled: true, run: () => { select(); useReverse.getState().deleteSelected() } },
      ] })
    }
    const leave = () => { hover = null; request() }
    const redraw = () => request()
    host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true); host.addEventListener('pointerup', up, true)
    host.addEventListener('contextmenu', contextMenu, true); host.addEventListener('pointerleave', leave); host.addEventListener('wheel', redraw, { passive: true })
    const unsubscribe = useReverse.subscribe(redraw)
    request()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      unsubscribe()
      host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true); host.removeEventListener('pointerup', up, true)
      host.removeEventListener('contextmenu', contextMenu, true); host.removeEventListener('pointerleave', leave); host.removeEventListener('wheel', redraw)
    }
  }, [draftOpen, scene])
  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => { if (!(e.target as HTMLElement | null)?.closest?.('[data-test=spline-menu]')) setMenu(null) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setMenu(null) } }
    window.addEventListener('pointerdown', close, true); window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', key, true) }
  }, [menu])
  useEffect(() => { if (!message) return; const t = setTimeout(() => setMessage(null), 4000); return () => clearTimeout(t) }, [message])
  if (!draftOpen) return null
  return <>
    <canvas ref={canvas} aria-label="Spline handles" data-test="sketch-spline-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }} />
    {message && <div role="status" className="hint" data-test="spline-message" style={{ position: 'absolute', left: 12, bottom: 12, zIndex: 7, background: 'var(--panel, #222)', padding: '4px 8px', borderRadius: 4 }}>{message}</div>}
    {menu && createPortal(<div className="contextmenu" role="menu" data-test="spline-menu" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000, minWidth: 180, background: 'var(--panel, #1f2328)', border: '1px solid var(--line, #444)', borderRadius: 4, padding: 4, boxShadow: '0 4px 14px rgba(0,0,0,0.4)' }}>
      <div className="hint" style={{ padding: '2px 8px 4px' }}>{menu.title}</div>
      {menu.rebuild ? <RebuildForm id={menu.rebuild.id} count={menu.rebuild.count} done={(msg) => { setMenu(null); setMessage(msg) }} />
        : menu.items.map((it) => <button key={it.test} role="menuitem" data-test={it.test} disabled={!it.enabled} title={it.title} style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => { setMenu(null); it.run() }}>{it.label}</button>)}
    </div>, document.body)}
  </>
}

function RebuildForm({ id, count, done }: { id: number; count: number; done: (msg: string) => void }) {
  const [text, setText] = useState(String(count))
  const n = Number(text), ok = Number.isInteger(n) && n >= 2 && n <= MAX_SPLINE_POINTS
  const go = () => {
    const d = useReverse.getState().sketchDraft
    if (!d || !ok) return
    const r = rebuildSpline(d.sketch, id, n, usePrefs.getState().units)
    if (r.ok) { apply(r.sketch, [id]); done(r.note ?? 'Rebuilt.') } else done(r.error)
  }
  return <form style={{ display: 'grid', gap: 6, padding: 6 }} onSubmit={(e) => { e.preventDefault(); go() }}>
    <label className="field"><span>Points</span><input autoFocus data-test="spline-rebuild-count" type="number" min={2} max={MAX_SPLINE_POINTS} value={text} aria-invalid={!ok} onChange={(e) => setText(e.currentTarget.value)} /></label>
    <span className="hint">Evenly spaced along the curve; the ends stay.</span>
    <button type="submit" className="primary" data-test="spline-rebuild-ok" disabled={!ok}>Rebuild</button>
  </form>
}
