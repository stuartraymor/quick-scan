// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { Vec2 } from '../../../src/core/flat/types'
import type { SketchChains } from '../app/useReverseWorkspace'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'
import { useReverse } from '../state/reStore'

/** Paint endpoints while held; join once on release. Navigation still belongs to the scene. */
export function SketchCornerTrimOverlay({ scene, chainsOf }: { scene: FlatScene | null; chainsOf: () => SketchChains | null }) {
  const open = useSketchCornerTrim((s) => s.open)
  const canvas = useRef<HTMLCanvasElement>(null)
  const chainsRef = useRef(chainsOf)
  chainsRef.current = chainsOf
  useEffect(() => {
    const el = canvas.current, host = el?.parentElement
    if (!open || !scene || !el || !host) return
    let pointer: number | null = null, path: Vec2[] = [], suppressClick = false
    let source = '', settings = ''
    const radiusPx = 7
    const configuration = () => { const s = useSketchCornerTrim.getState(); return JSON.stringify([s.mode, s.radiusMm, s.addDimension]) }
    const clear = () => el.getContext('2d')?.clearRect(0, 0, el.width, el.height)
    const draw = () => {
      const ctx = el.getContext('2d'), rect = host.getBoundingClientRect(), ratio = window.devicePixelRatio || 1
      if (!ctx) return
      el.width = Math.round(rect.width * ratio); el.height = Math.round(rect.height * ratio)
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.strokeStyle = '#71838b'; ctx.lineWidth = radiusPx * 2; ctx.lineCap = ctx.lineJoin = 'round'
      ctx.beginPath()
      path.forEach((p, i) => { const at = scene.sheetScreenPoint(p); if (at) { if (!i) ctx.moveTo(at.x - rect.left, at.y - rect.top); else ctx.lineTo(at.x - rect.left, at.y - rect.top) } })
      if (path.length === 1) { const p = scene.sheetScreenPoint(path[0]); if (p) ctx.lineTo(p.x - rect.left + .01, p.y - rect.top) }
      ctx.stroke()
    }
    const cancel = () => {
      const id = pointer; pointer = null; path = []; clear()
      if (id !== null && host.hasPointerCapture(id)) host.releasePointerCapture(id)
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.altKey || e.shiftKey) return
      const p = scene.sheetPoint(e.clientX, e.clientY), draft = useReverse.getState().sketchDraft
      if (!p || !draft) return
      e.preventDefault(); e.stopImmediatePropagation()
      pointer = e.pointerId; path = [p]; source = JSON.stringify(draft.sketch); settings = configuration(); suppressClick = true
      host.setPointerCapture(e.pointerId); draw()
    }
    const move = (e: PointerEvent) => {
      if (pointer !== e.pointerId) return
      e.preventDefault(); e.stopImmediatePropagation()
      const p = scene.sheetPoint(e.clientX, e.clientY)
      if (p) path.push(p)
      draw()
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
    const click = (e: MouseEvent) => { if (suppressClick && e.button === 0) { suppressClick = false; e.preventDefault(); e.stopImmediatePropagation() } }
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target as HTMLElement | null)?.closest('input,textarea,[contenteditable="true"]')) return
      e.preventDefault(); e.stopImmediatePropagation()
      if (pointer !== null) cancel()
      else useSketchCornerTrim.getState().cancel()
    }
    host.addEventListener('pointerdown', down, true); host.addEventListener('pointermove', move, true); host.addEventListener('pointerup', up, true)
    host.addEventListener('pointercancel', cancel, true); host.addEventListener('lostpointercapture', cancel, true); host.addEventListener('click', click, true)
    window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel)
    return () => {
      cancel()
      host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true); host.removeEventListener('pointerup', up, true)
      host.removeEventListener('pointercancel', cancel, true); host.removeEventListener('lostpointercapture', cancel, true); host.removeEventListener('click', click, true)
      window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel)
    }
  }, [open, scene])
  return open ? <canvas ref={canvas} aria-label="Corner endpoint paint" data-test="sketch-corner-trim-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 6 }} /> : null
}
