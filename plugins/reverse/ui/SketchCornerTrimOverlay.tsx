// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { Vec2 } from '../../../src/core/flat/types'
import type { SketchChains } from '../app/useReverseWorkspace'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'
import { useReverse } from '../state/reStore'
import { sweepCornerTrim, sweptCandidates, type CornerTrimResult, type SweptCorner } from '../core/sketchCornerTrim'
import { SweepArea } from '../core/cornerSweep'
import { anchorPoint, entityOf, entityPolyline, type Sketch } from '../core/sketch'
import { arcMiddle, cornerDistances, radiusFromHandle, tidyRadius } from '../core/filletFit'
import { useSketchAnalysis } from '../state/sketchAnalysisStore'
import { usePrefs } from '../../../src/state/prefsStore'
import { boundLength } from '../../../src/app/useUnits'
import { useBrushingPage } from './useBrushingPage'

/** Corner Trim brush. A ring follows the cursor. Holding the left button
 *  fills the area swept since the press — every triangle from the press
 *  point to each step of the cursor, as QUICKSURFACE fills it, grey — so
 *  going up and then across takes the whole triangle between, not the L of
 *  the cursor's track. The pieces the area touches light up, the pair it is
 *  read as is drawn heavier with its moving ends ringed, and the corner the
 *  release would make (for Auto Fillet, the round read off the scan, with
 *  the scan points that decided it) is previewed. Release commits it (a
 *  fillet between separate lines as two undo steps, join then fillet, as in
 *  QUICKSURFACE), or, when the scan supports it only weakly, leaves it
 *  showing for Accept. Esc or a lost pointer cancels with nothing changed.
 *  Navigation (middle button, wheel) still belongs to the scene. */
export function SketchCornerTrimOverlay({ scene, chainsOf }: { scene: FlatScene | null; chainsOf: () => SketchChains | null }) {
  const open = useSketchCornerTrim((s) => s.open)
  useBrushingPage(open)
  const canvas = useRef<HTMLCanvasElement>(null)
  const chainsRef = useRef(chainsOf)
  chainsRef.current = chainsOf
  useEffect(() => {
    const el = canvas.current, host = el?.parentElement
    if (!open || !scene || !el || !host) return
    let pointer: number | null = null, path: Vec2[] = [], suppressClick = false
    let source = '', settings = '', hover: { x: number; y: number } | null = null, frame = 0
    // The costly build (solve, scan read) only reruns when the sweep's
    // reading or the sketch changes, not on every pointer move.
    let cache: { key: string; sketch: Sketch | null; built: SweptCorner } | null = null
    const radiusPx = 7, handlePx = 9
    // The last fillet's radius handle: a square at the middle of its arc,
    // shown while that fillet is the latest edit. Dragging it rebuilds the
    // fillet exactly at the radius asked (dashed), release puts it in.
    let radiusDrag: { pointer: number } | null = null
    let checked: { sketch: Sketch | null; key: string | null; live: boolean } = { sketch: null, key: null, live: false }
    const liveFillet = () => {
      const s = useSketchCornerTrim.getState(), sketch = useReverse.getState().sketchDraft?.sketch ?? null
      const f = s.lastFillet
      if (!f || !sketch) return null
      if (checked.sketch !== sketch || checked.key !== f.madeKey) checked = { sketch, key: f.madeKey, live: JSON.stringify(sketch) === f.madeKey }
      return checked.live ? f : null
    }
    const handleAt = (): [number, number] | null => {
      const s = useSketchCornerTrim.getState(), f = liveFillet()
      if (!f) return null
      const arc = s.radiusPreview ? entityOf(s.radiusPreview.result.sketch, f.arcId) : null
      return arc?.kind === 'arc' ? arcMiddle(arc) as [number, number] : f.middle
    }
    const nearHandle = (x: number, y: number, rect: DOMRect) => {
      const h = handleAt(), at = h && toLocal(h, rect)
      return !!at && Math.hypot(at.x - x, at.y - y) <= handlePx + 2
    }
    // The ring is the cursor: hide the system one over the sheet, including
    // the scene's own crosshair/hand on its inner elements.
    host.dataset.cornerBrush = ''
    const style = document.createElement('style')
    style.textContent = '[data-corner-brush], [data-corner-brush] * { cursor: none !important; }'
    document.head.appendChild(style)
    const configuration = () => { const s = useSketchCornerTrim.getState(); return JSON.stringify([s.mode, s.radiusMm, s.addDimension]) }
    const accent = () => getComputedStyle(host).getPropertyValue('--accent').trim() || '#3f93d6'
    const toLocal = (p: Vec2, rect: DOMRect) => { const at = scene.sheetScreenPoint(p); return at ? { x: at.x - rect.left, y: at.y - rect.top } : null }
    const chains = () => chainsRef.current()?.chains ?? []
    const trace = (ctx: CanvasRenderingContext2D, points: readonly Vec2[], rect: DOMRect) => {
      let started = false
      for (const p of points) { const at = toLocal(p, rect); if (!at) continue; if (!started) { ctx.moveTo(at.x, at.y); started = true } else ctx.lineTo(at.x, at.y) }
    }
    const drawResult = (ctx: CanvasRenderingContext2D, rect: DOMRect, result: Extract<CornerTrimResult, { ok: true }>, blue: string) => {
      // The scan points the shape was read from.
      // Those further off the corner than the sketch tolerance are red: a
      // round that is not circular shows before it is released.
      if (result.profile?.length) {
        const tolerance = useSketchAnalysis.getState().toleranceMm
        const off = result.shape === 'arc' ? cornerDistances(result.sketch, result.changedIds, result.profile) : []
        ctx.globalAlpha = 0.55
        result.profile.forEach((p, i) => {
          const at = toLocal(p, rect)
          if (!at) return
          const bad = (off[i] ?? 0) > tolerance
          ctx.fillStyle = bad ? '#e5484d' : blue; ctx.globalAlpha = bad ? 0.9 : 0.55
          ctx.fillRect(at.x - 1.25, at.y - 1.25, 2.5, 2.5)
        })
        ctx.globalAlpha = 1
      }
      ctx.strokeStyle = blue; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]); ctx.lineCap = 'round'
      for (const id of result.changedIds) {
        const e = entityOf(result.sketch, id)
        if (!e) continue
        ctx.beginPath(); trace(ctx, entityPolyline(e, 96), rect); ctx.stroke()
      }
      ctx.setLineDash([])
    }
    const draw = () => {
      frame = 0
      const ctx = el.getContext('2d'), rect = host.getBoundingClientRect(), ratio = window.devicePixelRatio || 1
      if (!ctx) return
      el.width = Math.round(rect.width * ratio); el.height = Math.round(rect.height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)
      const blue = accent(), draft = useReverse.getState().sketchDraft
      const units = scene.unitsPerScreenPx(), reach = radiusPx * units
      const here = hover ? scene.sheetPoint(hover.x + rect.left, hover.y + rect.top) : null
      const area = path.length ? new SweepArea({ path, radius: reach }) : here ? new SweepArea({ path: [here], radius: reach }) : null
      // The swept area, filled as the native tool fills it: each fan
      // triangle wound the same way so overlapping ones never cancel.
      if (path.length) {
        ctx.fillStyle = ctx.strokeStyle = '#71838b'; ctx.lineWidth = radiusPx * 2; ctx.lineCap = ctx.lineJoin = 'round'
        ctx.beginPath()
        for (const t of area!.triangles) {
          const a = toLocal(t.a, rect), b = toLocal(t.b, rect), c = toLocal(t.c, rect)
          if (!a || !b || !c) continue
          const turn = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
          const [p, q] = turn >= 0 ? [b, c] : [c, b]
          ctx.moveTo(a.x, a.y); ctx.lineTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.closePath()
        }
        ctx.fill('nonzero')
        ctx.beginPath(); trace(ctx, path, rect)
        if (path.length === 1) { const at = toLocal(path[0], rect); if (at) ctx.lineTo(at.x + .01, at.y) }
        ctx.stroke()
      }
      if (draft && area) {
        const s = useSketchCornerTrim.getState()
        let built: SweptCorner | null = null
        if (path.length) {
          const reading = sweptCandidates(draft.sketch, area)
          const key = `${reading.key}#${configuration()}`
          if (!cache || cache.key !== key || cache.sketch !== draft.sketch) {
            cache = { key, sketch: draft.sketch, built: sweepCornerTrim(draft.sketch, area, s, [], s.mode === 'autoFillet' ? chains() : undefined) }
          }
          built = cache.built
        }
        const touched = built?.touched ?? sweptCandidates(draft.sketch, area).touched
        // Every piece the area touches, then the pair it is read as.
        ctx.strokeStyle = blue; ctx.lineCap = 'round'
        for (const id of touched) {
          const e = entityOf(draft.sketch, id)
          if (!e) continue
          const chosen = built?.pair?.ids.includes(id)
          ctx.globalAlpha = chosen ? 1 : 0.55; ctx.lineWidth = chosen ? 4 : 2.5
          ctx.beginPath(); trace(ctx, entityPolyline(e, 96), rect); ctx.stroke()
        }
        ctx.globalAlpha = 1; ctx.lineWidth = 2
        for (const end of built?.pair?.ends ?? []) {
          const e = entityOf(draft.sketch, end.entity)
          const at = e && toLocal(anchorPoint(e, end.at), rect)
          if (at) { ctx.beginPath(); ctx.arc(at.x, at.y, 5, 0, 2 * Math.PI); ctx.stroke() }
        }
        if (built?.result.ok) drawResult(ctx, rect, built.result, blue)
      }
      // A result waiting for Accept.
      const pending = useSketchCornerTrim.getState().pending
      if (!path.length && pending && draft && JSON.stringify(draft.sketch) === pending.sourceKey) drawResult(ctx, rect, pending.result, blue)
      // The fillet at the radius being dragged to, then its handle.
      const radiusPreview = useSketchCornerTrim.getState().radiusPreview
      if (!path.length && radiusPreview && liveFillet()) drawResult(ctx, rect, radiusPreview.result, blue)
      const handle = !path.length ? handleAt() : null
      const handleScreen = handle && toLocal(handle, rect)
      const onHandle = !!handleScreen && !!hover && Math.hypot(handleScreen.x - hover.x, handleScreen.y - hover.y) <= handlePx + 2
      if (handleScreen) {
        const half = (onHandle || radiusDrag ? handlePx + 2 : handlePx) / 2
        ctx.fillStyle = blue; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5
        ctx.fillRect(handleScreen.x - half, handleScreen.y - half, half * 2, half * 2)
        ctx.strokeRect(handleScreen.x - half, handleScreen.y - half, half * 2, half * 2)
        if (radiusPreview) {
          const label = `R ${boundLength(usePrefs.getState().units).fmt(radiusPreview.radiusMm, 3)}`
          ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = blue
          ctx.fillText(label, handleScreen.x + half + 6, handleScreen.y - half - 4)
        }
      }
      // The brush ring and its centre (not over the radius handle).
      if (hover && !onHandle && !radiusDrag) {
        ctx.lineWidth = 1.5; ctx.strokeStyle = blue; ctx.fillStyle = 'rgba(63,147,214,0.12)'
        ctx.beginPath(); ctx.arc(hover.x, hover.y, radiusPx, 0, 2 * Math.PI); ctx.fill(); ctx.stroke()
        ctx.beginPath(); ctx.arc(hover.x, hover.y, 1.2, 0, 2 * Math.PI); ctx.fillStyle = blue; ctx.fill()
      }
    }
    const request = () => { if (!frame) frame = requestAnimationFrame(draw) }
    const cancel = () => {
      const id = pointer ?? radiusDrag?.pointer ?? null; pointer = null; path = []; cache = null
      if (radiusDrag) { radiusDrag = null; useSketchCornerTrim.getState().previewFilletRadius(null) }
      request()
      if (id !== null && host.hasPointerCapture(id)) host.releasePointerCapture(id)
    }
    const dragRadius = (e: PointerEvent) => {
      const f = liveFillet(), p = scene.sheetPoint(e.clientX, e.clientY)
      if (!f || !p) return
      const r = radiusFromHandle(f.corner, f.middle, f.radiusMm, p)
      if (r === null) return
      const tidy = tidyRadius(r, usePrefs.getState().units)
      if (useSketchCornerTrim.getState().radiusPreview?.radiusMm !== tidy) useSketchCornerTrim.getState().previewFilletRadius(tidy)
    }
    const track = (e: PointerEvent) => { const rect = host.getBoundingClientRect(); hover = { x: e.clientX - rect.left, y: e.clientY - rect.top } }
    const add = (p: Vec2 | null) => {
      if (!p) return
      // Steps under half a screen pixel add nothing but cost.
      const last = path[path.length - 1]
      if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.5 * scene.unitsPerScreenPx()) return
      path.push(p)
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.altKey || e.shiftKey) return
      const p = scene.sheetPoint(e.clientX, e.clientY), draft = useReverse.getState().sketchDraft
      if (!p || !draft) return
      e.preventDefault(); e.stopImmediatePropagation()
      track(e)
      if (!useSketchCornerTrim.getState().pending && nearHandle(e.clientX - host.getBoundingClientRect().left, e.clientY - host.getBoundingClientRect().top, host.getBoundingClientRect())) {
        // The radius field gives up the focus (a number typed there is taken
        // first, as on any blur), so Esc and Enter reach the drag.
        if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-test=sketch-corner-trim-panel]')) document.activeElement.blur()
        radiusDrag = { pointer: e.pointerId }; suppressClick = true
        host.setPointerCapture(e.pointerId); request()
        return
      }
      if (useSketchCornerTrim.getState().pending) useSketchCornerTrim.setState({ pending: null })
      pointer = e.pointerId; path = [p]; cache = null; source = JSON.stringify(draft.sketch); settings = configuration(); suppressClick = true
      host.setPointerCapture(e.pointerId); request()
    }
    const move = (e: PointerEvent) => {
      track(e)
      if (radiusDrag?.pointer === e.pointerId) { e.preventDefault(); e.stopImmediatePropagation(); dragRadius(e); request(); return }
      if (pointer !== e.pointerId) { request(); return }
      e.preventDefault(); e.stopImmediatePropagation()
      // Coalesced events keep a fast sweep's full path on slow frames.
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
      for (const c of events.length ? events : [e]) add(scene.sheetPoint(c.clientX, c.clientY))
      request()
    }
    const up = (e: PointerEvent) => {
      if (radiusDrag?.pointer === e.pointerId) {
        e.preventDefault(); e.stopImmediatePropagation()
        dragRadius(e)
        const preview = useSketchCornerTrim.getState().radiusPreview
        radiusDrag = null
        if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId)
        if (preview) useSketchCornerTrim.getState().setFilletRadius(preview.radiusMm)
        request()
        return
      }
      if (pointer !== e.pointerId) return
      e.preventDefault(); e.stopImmediatePropagation()
      add(scene.sheetPoint(e.clientX, e.clientY))
      const stroke = path.slice(), valid = source === JSON.stringify(useReverse.getState().sketchDraft?.sketch) && settings === configuration()
      cancel()
      const c = chainsRef.current()
      if (valid) useSketchCornerTrim.getState().sweep(stroke, radiusPx * scene.unitsPerScreenPx(), c?.chains.flat() ?? [], c?.chains ?? [])
      else useSketchCornerTrim.setState({ message: 'The sketch or corner settings changed. Sweep the corner again.' })
    }
    const leave = () => { hover = null; request() }
    const click = (e: MouseEvent) => { if (suppressClick && e.button === 0) { suppressClick = false; e.preventDefault(); e.stopImmediatePropagation() } }
    const key = (e: KeyboardEvent) => {
      // A drag in hand is cancelled by Esc wherever the focus was left (the
      // radius field keeps it after Enter, as the press here does not move it).
      if (e.key === 'Escape' && (pointer !== null || radiusDrag)) { e.preventDefault(); e.stopImmediatePropagation(); cancel(); return }
      if ((e.target as HTMLElement | null)?.closest('input,textarea,[contenteditable="true"]')) return
      const s = useSketchCornerTrim.getState()
      if (e.key === 'Enter' && s.pending && pointer === null) { e.preventDefault(); e.stopImmediatePropagation(); s.acceptPending(); return }
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopImmediatePropagation()
      if (pointer !== null || radiusDrag) cancel()
      else if (s.pending) s.discardPending()
      else s.cancel()
    }
    // Zoom and pan move the sheet under the brush: redraw with them.
    const redraw = () => request()
    host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true); host.addEventListener('pointerup', up, true)
    host.addEventListener('pointercancel', cancel, true); host.addEventListener('lostpointercapture', cancel, true); host.addEventListener('click', click, true)
    host.addEventListener('pointerleave', leave); host.addEventListener('wheel', redraw, { passive: true })
    window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel)
    const unsubscribe = useReverse.subscribe(redraw)
    const unsubscribeTool = useSketchCornerTrim.subscribe(redraw)
    return () => {
      cancel(); if (frame) cancelAnimationFrame(frame)
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height)
      delete host.dataset.cornerBrush; style.remove()
      unsubscribe(); unsubscribeTool()
      host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true); host.removeEventListener('pointerup', up, true)
      host.removeEventListener('pointercancel', cancel, true); host.removeEventListener('lostpointercapture', cancel, true); host.removeEventListener('click', click, true)
      host.removeEventListener('pointerleave', leave); host.removeEventListener('wheel', redraw)
      window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel)
    }
  }, [open, scene])
  return open ? <canvas ref={canvas} aria-label="Corner Trim brush" data-test="sketch-corner-trim-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 6 }} /> : null
}
