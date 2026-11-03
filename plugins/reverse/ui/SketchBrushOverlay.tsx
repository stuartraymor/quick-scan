// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { Vec2 } from '../../../src/core/flat/types'
import type { SketchChains } from '../app/useReverseWorkspace'
import { brushPoints, brushedPoints, type BrushPoint } from '../core/sketchBrush'
import { entityPolyline, type SketchEntity } from '../core/sketch'
import { useSketchBrush } from '../state/sketchBrushStore'

/** A plugin-owned canvas over the real sheet. Input is captured only for
 *  left-button paint; middle/right navigation still reaches FlatScene. */
/** The tag beside the brush: the fit in hand. */
const FIT_TAG: Record<string, string> = { line: 'Fit Line', arc: 'Fit Arc', circle: 'Fit Circle', rectangle: 'Rectangle', slot: 'Slot', hexagon: 'Hexagon', curve: 'Fit Curve' }

export function SketchBrushOverlay({ scene, chainsOf }: { scene: FlatScene | null; chainsOf: () => SketchChains | null }) {
  const open = useSketchBrush((s) => s.open)
  const canvas = useRef<HTMLCanvasElement>(null)
  const chainRef = useRef(chainsOf)
  chainRef.current = chainsOf
  useEffect(() => {
    const el = canvas.current, host = el?.parentElement
    if (!open || !scene || !el || !host) return
    let cursor: { x: number; y: number } | null = null
    let painting = false, last: Vec2 | null = null, points: BrushPoint[] = [], chainKey: string | null = null
    let frame = 0, previousCursor = host.style.cursor
    const refreshPoints = () => {
      const chains = chainRef.current()
      if ((chains?.key ?? null) !== chainKey) {
        chainKey = chains?.key ?? null
        points = brushPoints(chains?.chains ?? [])
        useSketchBrush.getState().clear()
      }
    }
    refreshPoints()
    const paint = (e: PointerEvent) => {
      refreshPoints()
      const p = scene.sheetPoint(e.clientX, e.clientY)
      if (!p) return
      const state = useSketchBrush.getState()
      const hit = brushedPoints(points, last ?? p, p, state.brushPx * scene.unitsPerScreenPx() / 2)
      const selected = new Map(state.selected.map((q) => [q.key, q]))
      for (const q of hit) { if (e.altKey) selected.delete(q.key); else selected.set(q.key, q) }
      if (!state.selectionOverflow && selected.size === state.selected.length) { last = p; return }
      // Bound fit work without silently sampling or replacing the chosen data.
      if (selected.size <= 12000 && !state.selectionOverflow) state.setSelected([...selected.values()])
      else useSketchBrush.setState({ selectionOverflow: true, preview: null, message: 'Highlight at most 12,000 points per fit. Clear the selection and fit one contour at a time.' })
      last = p
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault(); e.stopImmediatePropagation()
      painting = true; last = null
      cursor = { x: e.clientX, y: e.clientY }
      if (useSketchBrush.getState().instant && !e.shiftKey && !e.altKey) useSketchBrush.getState().clear()
      host.setPointerCapture(e.pointerId)
      paint(e)
    }
    const move = (e: PointerEvent) => {
      cursor = { x: e.clientX, y: e.clientY }
      host.style.cursor = e.buttons === 0 || painting ? 'none' : previousCursor
      if (!painting) return
      e.preventDefault(); e.stopImmediatePropagation(); paint(e)
    }
    const up = (e: PointerEvent) => {
      if (!painting || e.button !== 0) return
      e.preventDefault(); e.stopImmediatePropagation(); paint(e)
      painting = false; last = null
      if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId)
      if (useSketchBrush.getState().instant && !e.shiftKey && !e.altKey) useSketchBrush.getState().apply()
    }
    const cancel = () => { painting = false; last = null; cursor = null; host.style.cursor = previousCursor }
    const leave = () => { if (!painting) { cursor = null; host.style.cursor = previousCursor } }
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault(); e.stopImmediatePropagation()
      const state = useSketchBrush.getState()
      state.setBrushPx(state.brushPx + (e.deltaY < 0 ? 4 : -4))
    }
    const click = (e: MouseEvent) => { if (e.button === 0) { e.preventDefault(); e.stopImmediatePropagation() } }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement | null)?.closest('input,textarea,[contenteditable="true"]')) return
      e.preventDefault(); e.stopImmediatePropagation(); useSketchBrush.getState().setOpen(false)
    }
    host.addEventListener('pointerdown', down, true)
    host.addEventListener('pointermove', move, true)
    host.addEventListener('pointerup', up, true)
    host.addEventListener('pointercancel', cancel, true)
    host.addEventListener('pointerleave', leave)
    host.addEventListener('click', click, true)
    host.addEventListener('wheel', wheel, { capture: true, passive: false })
    window.addEventListener('keydown', key, true)
    const render = () => {
      refreshPoints()
      const ctx = el.getContext('2d'), rect = host.getBoundingClientRect(), state = useSketchBrush.getState()
      const ratio = window.devicePixelRatio || 1
      const width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio)
      if (el.width !== width || el.height !== height) { el.width = width; el.height = height }
      if (ctx) {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height)
        const selected = new Set(state.selected.map((p) => p.key))
        for (const point of points) {
          const at = scene.sheetScreenPoint(point.p)
          if (!at) continue
          const x = at.x - rect.left, y = at.y - rect.top
          if (x < 0 || y < 0 || x > rect.width || y > rect.height) continue
          const on = selected.has(point.key)
          ctx.fillStyle = on ? '#ff9d00' : '#d94d39'
          ctx.fillRect(x - (on ? 2 : 1), y - (on ? 2 : 1), on ? 4 : 2, on ? 4 : 2)
        }
        if (state.preview?.ok) {
          const entities = state.preview.shapeSketch?.entities.filter((e) => !e.construction) ?? [{ ...state.preview.entity, id: 0 } as SketchEntity]
          for (const entity of entities) {
            const polyline = entityPolyline(entity, 192)
            ctx.beginPath()
            polyline.forEach((p, i) => { const at = scene.sheetScreenPoint(p); if (at) { if (i === 0) ctx.moveTo(at.x - rect.left, at.y - rect.top); else ctx.lineTo(at.x - rect.left, at.y - rect.top) } })
            ctx.strokeStyle = '#009c42'; ctx.lineWidth = 2.5; ctx.stroke()
          }
        }
        if (cursor) {
          ctx.beginPath(); ctx.arc(cursor.x - rect.left, cursor.y - rect.top, state.brushPx / 2, 0, Math.PI * 2)
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.stroke()
          ctx.strokeStyle = '#262626'; ctx.lineWidth = 1; ctx.stroke()
          // The fit in hand, named beside the brush as QUICKSURFACE tags it.
          const tag = FIT_TAG[state.primitive] ?? 'Fit'
          const tx = cursor.x - rect.left + state.brushPx / 2 + 6, ty = cursor.y - rect.top + state.brushPx / 2
          ctx.font = '11px system-ui, sans-serif'
          const w = ctx.measureText(tag).width + 8
          ctx.fillStyle = '#ffffff'; ctx.fillRect(tx, ty - 13, w, 17)
          ctx.strokeStyle = '#262626'; ctx.lineWidth = 1; ctx.strokeRect(tx + 0.5, ty - 12.5, w - 1, 16)
          ctx.fillStyle = '#262626'; ctx.fillText(tag, tx + 4, ty)
        }
      }
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(frame); host.style.cursor = previousCursor
      host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true); host.removeEventListener('pointerup', up, true)
      host.removeEventListener('pointercancel', cancel, true); host.removeEventListener('pointerleave', leave); host.removeEventListener('click', click, true); host.removeEventListener('wheel', wheel, true)
      window.removeEventListener('keydown', key, true)
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height)
    }
  }, [open, scene])
  return open ? <canvas ref={canvas} aria-label="Circular section-point fitting brush" data-test="sketch-fit-brush-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }} /> : null
}
