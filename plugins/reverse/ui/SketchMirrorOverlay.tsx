// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { Vec2 } from '../../../src/core/flat/types'
import { useSketchMirror } from '../state/sketchMirrorStore'
import { useReverse } from '../state/reStore'
import { datumTraces } from '../core/datums'
import { mirrorAxisChoices, mirrorAxisNear, type MirrorAxisChoice } from '../core/mirrorAxes'
import { mirrorAbout } from '../core/sketchEdits'
import { entityOf, entityPolyline } from '../core/sketch'

/** Mirror mode on the sheet: hovering a line, a sheet axis or a plane trace
 *  highlights it and previews the mirrored copies; a click picks it (the
 *  preview stays until Accept or Cancel). Enter accepts, Esc cancels.
 *  Navigation (middle button, wheel) still belongs to the scene. */
export function SketchMirrorOverlay({ scene }: { scene: FlatScene | null }) {
  const open = useSketchMirror((s) => s.open)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = canvas.current, host = el?.parentElement
    if (!open || !scene || !el || !host) return
    let hover: { x: number; y: number } | null = null, frame = 0, suppressClick = false
    const reachPx = 8
    const accent = () => getComputedStyle(host).getPropertyValue('--accent').trim() || '#3f93d6'
    const choices = (): MirrorAxisChoice[] => {
      const d = useReverse.getState().sketchDraft
      return d ? mirrorAxisChoices(d.sketch, d.frame ? datumTraces(d.frame) : [], useSketchMirror.getState().ids) : []
    }
    const hovered = (rect: DOMRect): MirrorAxisChoice | null => {
      if (!hover) return null
      const p = scene.sheetPoint(hover.x + rect.left, hover.y + rect.top)
      return p ? mirrorAxisNear(choices(), p, reachPx * scene.unitsPerScreenPx()) : null
    }
    const draw = () => {
      frame = 0
      const ctx = el.getContext('2d'), rect = host.getBoundingClientRect(), ratio = window.devicePixelRatio || 1
      if (!ctx) return
      el.width = Math.round(rect.width * ratio); el.height = Math.round(rect.height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)
      const draft = useReverse.getState().sketchDraft, state = useSketchMirror.getState()
      if (!draft) return
      const blue = accent(), units = scene.unitsPerScreenPx()
      const local = (p: Vec2) => { const at = scene.sheetScreenPoint(p); return at ? { x: at.x - rect.left, y: at.y - rect.top } : null }
      const polyline = (pts: readonly Vec2[]) => {
        ctx.beginPath()
        pts.forEach((p, i) => { const at = local(p); if (at) { if (!i) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y) } })
        ctx.stroke()
      }
      const axisLine = (c: MirrorAxisChoice): Vec2[] => {
        if (!c.infinite) return [c.a, c.b]
        const dx = c.b[0] - c.a[0], dy = c.b[1] - c.a[1], l = Math.hypot(dx, dy) || 1, far = 4000 * units
        const mid = scene.sheetPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) ?? c.a
        const t = ((mid[0] - c.a[0]) * dx + (mid[1] - c.a[1]) * dy) / l
        const o: Vec2 = [c.a[0] + t * dx / l, c.a[1] + t * dy / l]
        return [[o[0] - far * dx / l, o[1] - far * dy / l], [o[0] + far * dx / l, o[1] + far * dy / l]]
      }
      // The chosen pieces, so it is plain what will be mirrored.
      ctx.strokeStyle = blue; ctx.lineWidth = 3; ctx.globalAlpha = 0.35; ctx.lineCap = 'round'
      for (const id of state.ids) { const e = entityOf(draft.sketch, id); if (e) polyline(entityPolyline(e, 96)) }
      ctx.globalAlpha = 1
      const over = hovered(rect), axis = over ?? state.axis
      if (over) { ctx.strokeStyle = blue; ctx.lineWidth = 3; ctx.setLineDash([]); polyline(axisLine(over)) }
      if (state.axis && state.axis !== over) { ctx.strokeStyle = blue; ctx.lineWidth = 2; ctx.setLineDash([10, 4, 2, 4]); polyline(axisLine(state.axis)); ctx.setLineDash([]) }
      // The copies the axis would make, dashed.
      const preview = over ? mirrorAbout(draft.sketch, state.ids, over) : state.preview
      if (axis && preview?.ok) {
        ctx.strokeStyle = blue; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4])
        for (const id of preview.ids) { const e = entityOf(preview.sketch, id); if (e) polyline(entityPolyline(e, 96)) }
        ctx.setLineDash([])
      }
    }
    const request = () => { if (!frame) frame = requestAnimationFrame(draw) }
    const track = (e: PointerEvent | MouseEvent) => { const rect = host.getBoundingClientRect(); hover = { x: e.clientX - rect.left, y: e.clientY - rect.top } }
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.altKey) return
      track(e)
      const pick = hovered(host.getBoundingClientRect())
      // The click is the mirror's: it never starts a selection or a drag.
      e.preventDefault(); e.stopImmediatePropagation(); suppressClick = true
      if (pick) useSketchMirror.getState().pick(pick)
      else useSketchMirror.setState({ message: 'Nothing to mirror about there. Click a line, a sketch axis or a plane trace.' })
      request()
    }
    const move = (e: PointerEvent) => { track(e); request() }
    const up = (e: PointerEvent) => { if (e.button === 0 && suppressClick) { e.preventDefault(); e.stopImmediatePropagation() } }
    const click = (e: MouseEvent) => { if (suppressClick && e.button === 0) { suppressClick = false; e.preventDefault(); e.stopImmediatePropagation() } }
    const leave = () => { hover = null; request() }
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input,textarea,[contenteditable="true"]')) return
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); useSketchMirror.getState().cancel() }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); useSketchMirror.getState().accept() }
    }
    const redraw = () => request()
    host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true); host.addEventListener('pointerup', up, true)
    host.addEventListener('click', click, true); host.addEventListener('pointerleave', leave); host.addEventListener('wheel', redraw, { passive: true })
    window.addEventListener('keydown', key, true)
    const unsubscribe = useReverse.subscribe(redraw), unsubscribeMirror = useSketchMirror.subscribe(redraw)
    request()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height)
      unsubscribe(); unsubscribeMirror()
      host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true); host.removeEventListener('pointerup', up, true)
      host.removeEventListener('click', click, true); host.removeEventListener('pointerleave', leave); host.removeEventListener('wheel', redraw)
      window.removeEventListener('keydown', key, true)
    }
  }, [open, scene])
  return open ? <canvas ref={canvas} aria-label="Mirror preview" data-test="sketch-mirror-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 6 }} /> : null
}
