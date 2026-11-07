// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { Vec2 } from '../../../src/core/flat/types'
import type { SketchChains } from '../app/useReverseWorkspace'
import { applyCornerGesture } from '../state/cornerGestureAction'
import { useReverse } from '../state/reStore'
import { useSketchBrush } from '../state/sketchBrushStore'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'

/** Ctrl+left-drag in plain Edit Sketch (select tool): join the corner under
 *  the brush, or fillet an already joined one. Brush modes keep their own input. */
export function SketchCornerGestureOverlay({ scene, chainsOf }: { scene: FlatScene | null; chainsOf: () => SketchChains | null }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const host = anchor.current?.parentElement ?? null
    if (!scene || !host) return
    let path: Vec2[] = [], pointer: number | null = null, fade = 0
    // QUICKSURFACE paints the brushed area blue while Ctrl is held.
    const draw = (stroke: Vec2[], alpha: number) => {
      const el = canvas.current, ctx = el?.getContext('2d')
      if (!el || !ctx) return
      const rect = host.getBoundingClientRect(), ratio = window.devicePixelRatio || 1
      if (el.width !== Math.round(rect.width * ratio) || el.height !== Math.round(rect.height * ratio)) { el.width = Math.round(rect.width * ratio); el.height = Math.round(rect.height * ratio) }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height)
      if (alpha <= 0) return
      const pts = stroke.map((q) => scene.sheetScreenPoint(q)).filter((q): q is { x: number; y: number } => !!q)
      if (!pts.length) return
      ctx.globalAlpha = alpha; ctx.strokeStyle = '#2f7bff66'; ctx.lineCap = ctx.lineJoin = 'round'
      ctx.lineWidth = Math.max(useSketchBrush.getState().brushPx, 14)
      ctx.beginPath(); pts.forEach((q, i) => { if (i) ctx.lineTo(q.x - rect.left, q.y - rect.top); else ctx.moveTo(q.x - rect.left, q.y - rect.top) })
      if (pts.length === 1) ctx.lineTo(pts[0].x - rect.left + 0.01, pts[0].y - rect.top)
      ctx.stroke(); ctx.globalAlpha = 1
    }
    const fadeOut = (stroke: Vec2[]) => {
      cancelAnimationFrame(fade)
      let a = 1
      const step = () => { a -= 0.08; draw(stroke, a); if (a > 0) fade = requestAnimationFrame(step) }
      step()
    }
    const active = () => {
      const d = useReverse.getState().sketchDraft
      return !!d && d.tool === 'select' && !useSketchBrush.getState().open && !useSketchCornerTrim.getState().open
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !e.ctrlKey || e.shiftKey || e.altKey || !active()) return
      const p = scene.sheetPoint(e.clientX, e.clientY)
      if (!p) return
      e.preventDefault(); e.stopImmediatePropagation()
      path = [p]; pointer = e.pointerId; cancelAnimationFrame(fade); draw(path, 1)
      host.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (pointer !== e.pointerId) return
      e.preventDefault(); e.stopImmediatePropagation()
      const p = scene.sheetPoint(e.clientX, e.clientY)
      if (p) path.push(p)
      draw(path, 1)
    }
    const up = (e: PointerEvent) => {
      if (pointer !== e.pointerId) return
      e.preventDefault(); e.stopImmediatePropagation()
      const p = scene.sheetPoint(e.clientX, e.clientY)
      if (p) path.push(p)
      pointer = null
      if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId)
      const upp = scene.unitsPerScreenPx()
      const brush = Math.max(useSketchBrush.getState().brushPx, 14) / 2
      applyCornerGesture(path, brush * upp, chainsOf()?.chains.flat() ?? [])
      fadeOut(path); path = []
    }
    const cancel = () => { pointer = null; path = [] }
    host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true)
    host.addEventListener('pointerup', up, true); host.addEventListener('pointercancel', cancel, true)
    return () => {
      cancelAnimationFrame(fade)
      host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true)
      host.removeEventListener('pointerup', up, true); host.removeEventListener('pointercancel', cancel, true)
    }
  }, [scene, chainsOf])
  return <><span ref={anchor} hidden data-test="sketch-corner-gesture" /><canvas ref={canvas} aria-hidden="true" data-test="sketch-corner-gesture-paint" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 6 }} /></>
}
