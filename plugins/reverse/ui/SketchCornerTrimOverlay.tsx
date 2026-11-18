// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { Vec2 } from '../../../src/core/flat/types'
import type { SketchChains } from '../app/useReverseWorkspace'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'
import { useReverse } from '../state/reStore'
import { buildCornerTrim, cornerEndsNearPath } from '../core/sketchCornerTrim'
import { pathDistance } from '../core/cornerGesture'
import { anchorPoint, entityOf, entityPolyline, type Anchor } from '../core/sketch'

/** Corner Trim brush. A ring follows the cursor and rings the piece ends it
 *  would take; holding the left button paints a stroke (as QUICKSURFACE
 *  draws it, grey), every end the stroke passes is taken — the stroke is
 *  tested segment by segment, so a fast sweep skips nothing — and the
 *  resulting corner is previewed while held. Release commits it as one undo
 *  step; Esc or a lost pointer cancels with nothing changed. Navigation
 *  (middle button, wheel) still belongs to the scene. */
export function SketchCornerTrimOverlay({ scene, chainsOf }: { scene: FlatScene | null; chainsOf: () => SketchChains | null }) {
  const open = useSketchCornerTrim((s) => s.open)
  const canvas = useRef<HTMLCanvasElement>(null)
  const chainsRef = useRef(chainsOf)
  chainsRef.current = chainsOf
  useEffect(() => {
    const el = canvas.current, host = el?.parentElement
    if (!open || !scene || !el || !host) return
    let pointer: number | null = null, path: Vec2[] = [], suppressClick = false
    let source = '', settings = '', hover: { x: number; y: number } | null = null, frame = 0
    const radiusPx = 7
    // The ring is the cursor: hide the system one over the sheet, including
    // the scene's own crosshair/hand on its inner elements.
    host.dataset.cornerBrush = ''
    const style = document.createElement('style')
    style.textContent = '[data-corner-brush], [data-corner-brush] * { cursor: none !important; }'
    document.head.appendChild(style)
    const configuration = () => { const s = useSketchCornerTrim.getState(); return JSON.stringify([s.mode, s.radiusMm, s.addDimension]) }
    const accent = () => getComputedStyle(host).getPropertyValue('--accent').trim() || '#3f93d6'
    const toLocal = (p: Vec2, rect: DOMRect) => { const at = scene.sheetScreenPoint(p); return at ? { x: at.x - rect.left, y: at.y - rect.top } : null }
    const draw = () => {
      frame = 0
      const ctx = el.getContext('2d'), rect = host.getBoundingClientRect(), ratio = window.devicePixelRatio || 1
      if (!ctx) return
      el.width = Math.round(rect.width * ratio); el.height = Math.round(rect.height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)
      const blue = accent(), draft = useReverse.getState().sketchDraft
      const units = scene.unitsPerScreenPx(), reach = radiusPx * units
      // The stroke, as the native tool paints it.
      if (path.length) {
        ctx.strokeStyle = '#71838b'; ctx.lineWidth = radiusPx * 2; ctx.lineCap = ctx.lineJoin = 'round'
        ctx.beginPath()
        path.forEach((p, i) => { const at = toLocal(p, rect); if (at) { if (!i) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y) } })
        if (path.length === 1) { const at = toLocal(path[0], rect); if (at) ctx.lineTo(at.x + .01, at.y) }
        ctx.stroke()
      }
      // Ends the brush (or the stroke so far) would take.
      const here = hover ? scene.sheetPoint(hover.x + rect.left, hover.y + rect.top) : null
      const brush = path.length ? path : here ? [here] : []
      const ends: Anchor[] = draft && brush.length ? cornerEndsNearPath(draft.sketch, brush, reach) : []
      if (draft) {
        ctx.strokeStyle = blue; ctx.lineWidth = 2
        for (const end of ends) {
          const e = entityOf(draft.sketch, end.entity)
          const at = e && toLocal(anchorPoint(e, end.at), rect)
          if (at) { ctx.beginPath(); ctx.arc(at.x, at.y, 5, 0, 2 * Math.PI); ctx.stroke() }
        }
      }
      // While held: the corner the release would make.
      if (draft && path.length && ends.length === 2 && ends[0].entity !== ends[1].entity) {
        const s = useSketchCornerTrim.getState()
        const scan = s.mode === 'autoFillet' ? (chainsRef.current()?.chains.flat() ?? []).filter((p) => pathDistance(p, path) <= reach) : []
        const result = buildCornerTrim(draft.sketch, ends.map((p) => p.entity), s, scan, ends)
        if (result.ok) {
          ctx.strokeStyle = blue; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]); ctx.lineCap = 'round'
          for (const id of result.changedIds) {
            const e = entityOf(result.sketch, id)
            if (!e) continue
            ctx.beginPath()
            entityPolyline(e, 96).forEach((p, i) => { const at = toLocal(p, rect); if (at) { if (!i) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y) } })
            ctx.stroke()
          }
          ctx.setLineDash([])
        }
      }
      // The brush ring and its centre.
      if (hover) {
        ctx.lineWidth = 1.5; ctx.strokeStyle = blue; ctx.fillStyle = 'rgba(63,147,214,0.12)'
        ctx.beginPath(); ctx.arc(hover.x, hover.y, radiusPx, 0, 2 * Math.PI); ctx.fill(); ctx.stroke()
        ctx.beginPath(); ctx.arc(hover.x, hover.y, 1.2, 0, 2 * Math.PI); ctx.fillStyle = blue; ctx.fill()
      }
    }
    const request = () => { if (!frame) frame = requestAnimationFrame(draw) }
    const cancel = () => {
      const id = pointer; pointer = null; path = []; request()
      if (id !== null && host.hasPointerCapture(id)) host.releasePointerCapture(id)
    }
    const track = (e: PointerEvent) => { const rect = host.getBoundingClientRect(); hover = { x: e.clientX - rect.left, y: e.clientY - rect.top } }
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.altKey || e.shiftKey) return
      const p = scene.sheetPoint(e.clientX, e.clientY), draft = useReverse.getState().sketchDraft
      if (!p || !draft) return
      e.preventDefault(); e.stopImmediatePropagation()
      track(e)
      pointer = e.pointerId; path = [p]; source = JSON.stringify(draft.sketch); settings = configuration(); suppressClick = true
      host.setPointerCapture(e.pointerId); request()
    }
    const move = (e: PointerEvent) => {
      track(e)
      if (pointer !== e.pointerId) { request(); return }
      e.preventDefault(); e.stopImmediatePropagation()
      // Coalesced events keep a fast sweep's full path on slow frames.
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
      for (const c of events.length ? events : [e]) { const p = scene.sheetPoint(c.clientX, c.clientY); if (p) path.push(p) }
      request()
    }
    const up = (e: PointerEvent) => {
      if (pointer !== e.pointerId) return
      e.preventDefault(); e.stopImmediatePropagation()
      const p = scene.sheetPoint(e.clientX, e.clientY)
      if (p) path.push(p)
      const stroke = path.slice(), valid = source === JSON.stringify(useReverse.getState().sketchDraft?.sketch) && settings === configuration()
      cancel()
      if (valid) useSketchCornerTrim.getState().paint(stroke, radiusPx * scene.unitsPerScreenPx(), chainsRef.current()?.chains.flat() ?? [])
      else useSketchCornerTrim.setState({ message: 'The sketch or corner settings changed. Paint the endpoints again.' })
    }
    const leave = () => { hover = null; request() }
    const click = (e: MouseEvent) => { if (suppressClick && e.button === 0) { suppressClick = false; e.preventDefault(); e.stopImmediatePropagation() } }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement | null)?.closest('input,textarea,[contenteditable="true"]')) return
      e.preventDefault(); e.stopImmediatePropagation()
      if (pointer !== null) cancel()
      else useSketchCornerTrim.getState().cancel()
    }
    // Zoom and pan move the sheet under the brush: redraw with them.
    const redraw = () => request()
    host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true); host.addEventListener('pointerup', up, true)
    host.addEventListener('pointercancel', cancel, true); host.addEventListener('lostpointercapture', cancel, true); host.addEventListener('click', click, true)
    host.addEventListener('pointerleave', leave); host.addEventListener('wheel', redraw, { passive: true })
    window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel)
    const unsubscribe = useReverse.subscribe(redraw)
    return () => {
      cancel(); if (frame) cancelAnimationFrame(frame)
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height)
      delete host.dataset.cornerBrush; style.remove()
      unsubscribe()
      host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true); host.removeEventListener('pointerup', up, true)
      host.removeEventListener('pointercancel', cancel, true); host.removeEventListener('lostpointercapture', cancel, true); host.removeEventListener('click', click, true)
      host.removeEventListener('pointerleave', leave); host.removeEventListener('wheel', redraw)
      window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel)
    }
  }, [open, scene])
  return open ? <canvas ref={canvas} aria-label="Corner Trim brush" data-test="sketch-corner-trim-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 6 }} /> : null
}
