// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { Vec2 } from '../../../src/core/flat/types'
import { useSketchPattern } from '../state/sketchPatternStore'
import { useReverse } from '../state/reStore'
import { entityOf, entityPolyline, type Sketch, type SketchEntity } from '../core/sketch'
import { centreOf, directionOf, selectionCentre, type PatternSpec } from '../core/sketchPatterns'

const segDist = (p: Vec2, a: Vec2, b: Vec2) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
const distTo = (e: SketchEntity, p: Vec2): number => {
  if (e.kind === 'point') return Math.hypot(p[0] - e.p[0], p[1] - e.p[1])
  const pts = entityPolyline(e, 128)
  let best = Infinity
  for (let i = 0; i + 1 < pts.length; i++) best = Math.min(best, segDist(p, pts[i], pts[i + 1]))
  // A circle or arc is also picked at its centre, for a pattern centre.
  if (e.kind === 'circle' || e.kind === 'arc') best = Math.min(best, Math.hypot(p[0] - e.c[0], p[1] - e.c[1]))
  return best
}

/** The piece under the cursor that the armed pick could take. */
function pickable(sketch: Sketch, p: Vec2, reach: number, kind: NonNullable<ReturnType<typeof useSketchPattern.getState>['picking']>, ids: readonly number[]): SketchEntity | null {
  let best: SketchEntity | null = null, d = reach
  for (const e of sketch.entities) {
    const fits = kind === 'd1' || kind === 'd2' ? e.kind === 'line' : kind === 'curve' ? e.kind !== 'point' && !ids.includes(e.id) : e.kind === 'point' || e.kind === 'circle' || e.kind === 'arc'
    if (!fits) continue
    const at = distTo(e, p)
    if (at <= d) { d = at; best = e }
  }
  return best
}

/** The Linear arrows: from the selection's centre one step along each
 *  direction that is on. Their tips drag the spacing. */
function arrowsOf(sketch: Sketch, ids: readonly number[], spec: PatternSpec): { key: 'd1' | 'd2'; from: Vec2; dir: Vec2; to: Vec2 }[] {
  if (spec.mode !== 'linear') return []
  const from = selectionCentre(sketch, ids)
  if (!from) return []
  const out: { key: 'd1' | 'd2'; from: Vec2; dir: Vec2; to: Vec2 }[] = []
  for (const key of ['d1', 'd2'] as const) {
    const d = spec[key]
    if (!d.on) continue
    const dir = directionOf(sketch, d)
    if (typeof dir === 'string') continue
    out.push({ key, from, dir, to: [from[0] + dir[0] * d.spacing, from[1] + dir[1] * d.spacing] })
  }
  return out
}

/** Duplicate / Pattern on the sheet: the chosen pieces highlighted, the
 *  copies previewed dashed, the reference the panel waits for picked by a
 *  click (highlighted under the cursor), and the Linear arrows dragged to
 *  set the spacing. Enter accepts, Esc cancels a pick, then the pattern.
 *  Navigation (middle button, wheel) still belongs to the scene. */
export function SketchPatternOverlay({ scene }: { scene: FlatScene | null }) {
  const open = useSketchPattern((s) => s.open)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const el = canvas.current, host = el?.parentElement
    if (!open || !scene || !el || !host) return
    let hover: { x: number; y: number } | null = null, frame = 0, suppressClick = false
    let drag: { key: 'd1' | 'd2'; from: Vec2; dir: Vec2 } | null = null
    const reachPx = 8
    const accent = () => getComputedStyle(host).getPropertyValue('--accent').trim() || '#3f93d6'
    const sheetAt = (x: number, y: number) => scene.sheetPoint(x, y)
    const hoveredPiece = (rect: DOMRect): SketchEntity | null => {
      const st = useSketchPattern.getState(), d = useReverse.getState().sketchDraft
      if (!hover || !st.picking || !d) return null
      const p = sheetAt(hover.x + rect.left, hover.y + rect.top)
      return p ? pickable(d.sketch, p, reachPx * scene.unitsPerScreenPx(), st.picking, st.ids) : null
    }
    const arrowUnder = (rect: DOMRect) => {
      const st = useSketchPattern.getState(), d = useReverse.getState().sketchDraft
      if (!hover || st.picking || !d) return null
      for (const a of arrowsOf(d.sketch, st.ids, st.spec)) {
        const tip = scene.sheetScreenPoint(a.to)
        if (tip && Math.hypot(tip.x - rect.left - hover.x, tip.y - rect.top - hover.y) <= 10) return a
      }
      return null
    }
    const draw = () => {
      frame = 0
      const ctx = el.getContext('2d'), rect = host.getBoundingClientRect(), ratio = window.devicePixelRatio || 1
      if (!ctx) return
      el.width = Math.round(rect.width * ratio); el.height = Math.round(rect.height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)
      const draft = useReverse.getState().sketchDraft, st = useSketchPattern.getState()
      if (!draft) return
      const blue = accent()
      const local = (p: Vec2) => { const at = scene.sheetScreenPoint(p); return at ? { x: at.x - rect.left, y: at.y - rect.top } : null }
      const polyline = (pts: readonly Vec2[]) => {
        ctx.beginPath()
        pts.forEach((p, i) => { const at = local(p); if (at) { if (!i) ctx.moveTo(at.x, at.y); else ctx.lineTo(at.x, at.y) } })
        ctx.stroke()
      }
      const piece = (e: SketchEntity) => {
        if (e.kind === 'point') { const at = local(e.p); if (at) { ctx.beginPath(); ctx.arc(at.x, at.y, 3, 0, 2 * Math.PI); ctx.stroke() } }
        else polyline(entityPolyline(e, 96))
      }
      ctx.lineCap = 'round'
      // The chosen pieces.
      ctx.strokeStyle = blue; ctx.lineWidth = 3; ctx.globalAlpha = 0.35
      for (const id of st.ids) { const e = entityOf(draft.sketch, id); if (e) piece(e) }
      ctx.globalAlpha = 1
      // References in use: the guide curve, the centre.
      const spec = st.spec
      if (spec.mode === 'alongCurve' && spec.curve !== null) {
        const g = entityOf(draft.sketch, spec.curve)
        if (g) { ctx.strokeStyle = blue; ctx.lineWidth = 2; ctx.setLineDash([10, 4, 2, 4]); piece(g); ctx.setLineDash([]) }
      }
      if (spec.mode === 'circular' || spec.mode === 'angular') {
        const c = centreOf(draft.sketch, st.ids, spec.mode === 'circular' ? spec.centreRef : spec.pivotRef, spec.mode === 'circular' ? spec.centre : spec.pivot)
        const at = typeof c === 'string' ? null : local(c)
        if (at) { ctx.strokeStyle = blue; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(at.x - 7, at.y); ctx.lineTo(at.x + 7, at.y); ctx.moveTo(at.x, at.y - 7); ctx.lineTo(at.x, at.y + 7); ctx.stroke(); ctx.beginPath(); ctx.arc(at.x, at.y, 4, 0, 2 * Math.PI); ctx.stroke() }
      }
      // The copies, dashed.
      if (st.preview?.ok) {
        ctx.strokeStyle = blue; ctx.lineWidth = 2; ctx.setLineDash([6, 4])
        for (const id of st.preview.ids) { const e = entityOf(st.preview.sketch, id); if (e) piece(e) }
        ctx.setLineDash([])
      }
      // The Linear arrows, their tips the spacing handles.
      for (const a of arrowsOf(draft.sketch, st.ids, spec)) {
        const p = local(a.from), q = local(a.to)
        if (!p || !q) continue
        ctx.strokeStyle = blue; ctx.fillStyle = blue; ctx.lineWidth = 2
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke()
        const ang = Math.atan2(q.y - p.y, q.x - p.x)
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - 10 * Math.cos(ang - 0.4), q.y - 10 * Math.sin(ang - 0.4)); ctx.lineTo(q.x - 10 * Math.cos(ang + 0.4), q.y - 10 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill()
        ctx.font = '11px sans-serif'; ctx.fillText(a.key === 'd1' ? '1' : '2', q.x + 6, q.y - 6)
      }
      // What a click would pick.
      const over = hoveredPiece(rect)
      if (over) { ctx.strokeStyle = blue; ctx.lineWidth = 4; ctx.globalAlpha = 0.8; piece(over); ctx.globalAlpha = 1 }
    }
    const request = () => { if (!frame) frame = requestAnimationFrame(draw) }
    const track = (e: PointerEvent | MouseEvent) => { const rect = host.getBoundingClientRect(); hover = { x: e.clientX - rect.left, y: e.clientY - rect.top } }
    const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); suppressClick = true }
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.altKey) return
      track(e)
      const rect = host.getBoundingClientRect(), st = useSketchPattern.getState()
      if (st.picking) {
        stop(e)
        const piece = hoveredPiece(rect)
        if (piece) st.pickPiece(piece.id)
        else useSketchPattern.setState({ message: 'Nothing there to pick. ' + (st.picking === 'curve' ? 'Click a line, arc, circle or spline.' : st.picking === 'd1' || st.picking === 'd2' ? 'Click a line.' : 'Click a point, circle or arc.') })
        request(); return
      }
      const arrow = arrowUnder(rect)
      if (arrow) { stop(e); drag = arrow; host.setPointerCapture?.(e.pointerId); request() }
    }
    const move = (e: PointerEvent) => {
      track(e)
      if (drag) {
        e.preventDefault(); e.stopImmediatePropagation()
        const p = sheetAt(e.clientX, e.clientY), st = useSketchPattern.getState()
        if (p && st.spec.mode === 'linear') {
          const along = (p[0] - drag.from[0]) * drag.dir[0] + (p[1] - drag.from[1]) * drag.dir[1]
          if (Math.abs(along) > 1e-6) st.update({ ...st.spec, [drag.key]: { ...st.spec[drag.key], spacing: Number(along.toFixed(6)) } })
        }
      }
      request()
    }
    const up = (e: PointerEvent) => {
      if (drag) { drag = null; host.releasePointerCapture?.(e.pointerId) }
      if (e.button === 0 && suppressClick) { e.preventDefault(); e.stopImmediatePropagation() }
    }
    const click = (e: MouseEvent) => { if (suppressClick && e.button === 0) { suppressClick = false; e.preventDefault(); e.stopImmediatePropagation() } }
    const leave = () => { hover = null; request() }
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('input,textarea,select,[contenteditable="true"]')) return
      const st = useSketchPattern.getState()
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); if (st.picking) st.arm(null); else st.cancel() }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); st.accept() }
    }
    const redraw = () => request()
    host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true); host.addEventListener('pointerup', up, true)
    host.addEventListener('click', click, true); host.addEventListener('pointerleave', leave); host.addEventListener('wheel', redraw, { passive: true })
    window.addEventListener('keydown', key, true)
    let lastSketch = useReverse.getState().sketchDraft?.sketch
    const unsubscribe = useReverse.subscribe((s) => {
      // An edit elsewhere (undo) re-plans the preview from the sketch as it is.
      if (s.sketchDraft?.sketch !== lastSketch) { lastSketch = s.sketchDraft?.sketch; useSketchPattern.getState().refresh() }
      request()
    })
    const unsubscribePattern = useSketchPattern.subscribe(redraw)
    request()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height)
      unsubscribe(); unsubscribePattern()
      host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true); host.removeEventListener('pointerup', up, true)
      host.removeEventListener('click', click, true); host.removeEventListener('pointerleave', leave); host.removeEventListener('wheel', redraw)
      window.removeEventListener('keydown', key, true)
    }
  }, [open, scene])
  return open ? <canvas ref={canvas} aria-label="Pattern preview" data-test="sketch-pattern-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 6 }} /> : null
}
