// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { Vec2 } from '../../../src/core/flat/types'
import type { SketchChains } from '../app/useReverseWorkspace'
import { entityPolyline } from '../core/sketch'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'

/** Only Shift-left-drag belongs to corner selection. Ordinary selection and
 *  middle/right navigation continue through to the existing sketch scene. */
export function SketchCornerTrimOverlay({ scene, chainsOf }: { scene: FlatScene | null; chainsOf: () => SketchChains | null }) {
  const open = useSketchCornerTrim((s) => s.open)
  const canvas = useRef<HTMLCanvasElement>(null)
  const chainsRef = useRef(chainsOf)
  chainsRef.current = chainsOf
  useEffect(() => {
    const el = canvas.current, host = el?.parentElement
    if (!open || !scene || !el || !host) return
    let start: { x: number; y: number } | null = null, end: { x: number; y: number } | null = null
    let pointer: number | null = null, suppressClick = false, frame = 0
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !e.shiftKey) { if (e.button === 0) suppressClick = false; return }
      e.preventDefault(); e.stopImmediatePropagation()
      start = end = { x: e.clientX, y: e.clientY }; pointer = e.pointerId; suppressClick = true
      host.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!start || pointer !== e.pointerId) return
      e.preventDefault(); e.stopImmediatePropagation(); end = { x: e.clientX, y: e.clientY }
    }
    const up = (e: PointerEvent) => {
      if (!start || pointer !== e.pointerId) return
      e.preventDefault(); e.stopImmediatePropagation()
      const x0 = Math.min(start.x, e.clientX), x1 = Math.max(start.x, e.clientX)
      const y0 = Math.min(start.y, e.clientY), y1 = Math.max(start.y, e.clientY)
      const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => scene.sheetPoint(x, y)).filter((p): p is Vec2 => p !== null)
      start = end = null; pointer = null
      if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId)
      if (x1 - x0 >= 4 && y1 - y0 >= 4 && corners.length === 4) useSketchCornerTrim.getState().selectArea(corners, chainsRef.current()?.chains.flat() ?? [])
      else useSketchCornerTrim.setState({ preview: null, message: 'Shift-drag a box around the corner area.' })
    }
    const cancel = () => { if (pointer !== null && host.hasPointerCapture(pointer)) host.releasePointerCapture(pointer); start = end = null; pointer = null }
    const click = (e: MouseEvent) => { if (suppressClick && e.button === 0) { suppressClick = false; e.preventDefault(); e.stopImmediatePropagation() } }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement | null)?.closest('input,textarea,[contenteditable="true"]')) return
      e.preventDefault(); e.stopImmediatePropagation(); useSketchCornerTrim.getState().cancel()
    }
    host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true); host.addEventListener('pointerup', up, true)
    host.addEventListener('pointercancel', cancel, true); host.addEventListener('click', click, true); window.addEventListener('keydown', key, true)
    const render = () => {
      const ctx = el.getContext('2d'), rect = host.getBoundingClientRect(), state = useSketchCornerTrim.getState()
      const ratio = window.devicePixelRatio || 1
      const width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio)
      if (el.width !== width || el.height !== height) { el.width = width; el.height = height }
      if (ctx) {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height)
        if (state.preview?.ok) {
          for (const entity of state.preview.sketch.entities.filter((e) => state.preview?.ok && state.preview.changedIds.includes(e.id))) {
            ctx.beginPath()
            entityPolyline(entity, 144).forEach((p, i) => {
              const at = scene.sheetScreenPoint(p)
              if (at) { if (!i) ctx.moveTo(at.x - rect.left, at.y - rect.top); else ctx.lineTo(at.x - rect.left, at.y - rect.top) }
            })
            ctx.strokeStyle = '#00a447'; ctx.lineWidth = 3; ctx.stroke()
          }
        }
        if (start && end) {
          ctx.fillStyle = '#00a44718'; ctx.strokeStyle = '#008b3d'; ctx.lineWidth = 1; ctx.setLineDash([5, 4])
          ctx.fillRect(start.x - rect.left, start.y - rect.top, end.x - start.x, end.y - start.y)
          ctx.strokeRect(start.x - rect.left, start.y - rect.top, end.x - start.x, end.y - start.y); ctx.setLineDash([])
        }
      }
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => {
      cancel(); cancelAnimationFrame(frame)
      host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true); host.removeEventListener('pointerup', up, true)
      host.removeEventListener('pointercancel', cancel, true); host.removeEventListener('click', click, true); window.removeEventListener('keydown', key, true)
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height)
    }
  }, [open, scene])
  return open ? <canvas ref={canvas} aria-label="Corner area selection and provisional geometry" data-test="sketch-corner-trim-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 6 }} /> : null
}
