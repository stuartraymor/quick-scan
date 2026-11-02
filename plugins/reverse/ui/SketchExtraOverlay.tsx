// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type { Vec2 } from '../../../src/core/flat/types'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import { outwardTangent, tangentArc } from '../core/draw'
import { entityOf, entityPolyline, nearestOnEntity, emptySketch, type SketchEntity } from '../core/sketch'
import { slotSketch, trimAt } from '../core/sketchEdits'
import { useReverse } from '../state/reStore'
import { addSketchSlot, addSketchTangentArc, middleLineSketchSelection, trimSketchAt } from '../state/sketchExtraTools'
import { useSketchPresentation } from '../state/sketchPresentation'

type End = { entity: number; at: 'a' | 'b'; point: Vec2 }
const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
const slotWidth = (a: Vec2, b: Vec2, p: Vec2) => 2 * Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / distance(a, b)

/** Tool-owned SVG ghost, with native capture on its parent for left input only.
 * Wheel and middle/right navigation are left with the existing sheet. */
export function SketchExtraOverlay({ scene }: { scene: FlatScene | null }) {
  const tool = useSketchPresentation(s => s.tool)
  const svg = useRef<SVGSVGElement>(null)
  const ghost = useRef<SVGPathElement>(null), highlight = useRef<SVGPathElement>(null), guide = useRef<SVGPathElement>(null)
  const label = useRef<SVGTextElement>(null)
  useEffect(() => {
    const el = svg.current, host = el?.parentElement
    if (!tool || !scene || !el || !host) return
    let cursor: Vec2 | null = null, points: Vec2[] = [], firstLine: number | null = null, start: End | null = null
    let down = false, frame = 0, painted = new Set<number>()
    const previousCursor = host.style.cursor
    host.style.cursor = 'crosshair'
    const error = (message: string) => useReverse.setState(s => s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, error: message } } : {})
    const radius = () => Math.max(1e-7, scene.unitsPerScreenPx() * 10)
    const pickPiece = (p: Vec2, linesOnly = false) => {
      const draft = useReverse.getState().sketchDraft
      let best: SketchEntity | null = null, miss = radius()
      for (const e of draft?.sketch.entities ?? []) {
        if (linesOnly && e.kind !== 'line') continue
        const hit = nearestOnEntity(e, p)
        if (hit.dist < miss) { best = e; miss = hit.dist }
      }
      return best
    }
    const pickEnd = (p: Vec2): End | null => {
      let best: End | null = null, miss = radius()
      for (const e of useReverse.getState().sketchDraft?.sketch.entities ?? []) {
        if (e.kind !== 'line') continue
        for (const at of ['a', 'b'] as const) {
          const d = distance(e[at], p)
          if (d < miss) { best = { entity: e.id, at, point: e[at] }; miss = d }
        }
      }
      return best
    }
    const editable = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('button,input,textarea,select,[contenteditable="true"],.viewport-label'))
    const trim = (p: Vec2) => {
      const e = pickPiece(p)
      if (!e || painted.has(e.id)) return
      const at = nearestOnEntity(e, p).point
      if (trimSketchAt(e.id, at)) painted.add(e.id)
    }
    const clickAt = (p: Vec2) => {
      if (tool === 'trim') { trim(p); return }
      if (tool === 'slot') {
        if (points.length === 0) points = [p]
        else if (points.length === 1) {
          if (distance(points[0], p) < radius() * .1) { error('Pick a different second slot centre.'); return }
          points.push(p)
        } else if (addSketchSlot(points[0], points[1], slotWidth(points[0], points[1], p))) points = []
        return
      }
      if (tool === 'middle') {
        const line = pickPiece(p, true)
        if (!line) { error('Click a line for the middle-line construction.'); return }
        if (firstLine === null) {
          firstLine = line.id
          useReverse.setState(s => s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, selection: [line.id], error: null } } : {})
        } else if (firstLine !== line.id) {
          useReverse.setState(s => s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, selection: [firstLine!, line.id] } } : {})
          if (middleLineSketchSelection()) firstLine = null
        }
        return
      }
      if (tool === 'tangentArc') {
        if (!start) { start = pickEnd(p); if (!start) error('Click an endpoint of a line to start the tangent arc.'); return }
        const end = pickEnd(p), q = end?.point ?? p
        if (addSketchTangentArc(start.entity, start.at, q, end ? { entity: end.entity, at: end.at } : undefined)) start = null
      }
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || editable(e.target)) return
      const p = scene.sheetPoint(e.clientX, e.clientY)
      if (!p) return
      e.preventDefault(); e.stopImmediatePropagation()
      cursor = p; down = true; painted = new Set()
      host.setPointerCapture(e.pointerId)
      clickAt(p)
    }
    const onMove = (e: PointerEvent) => {
      if (editable(e.target) || (e.buttons !== 0 && !down)) { cursor = null; return }
      cursor = scene.sheetPoint(e.clientX, e.clientY)
      if (down && e.buttons === 1) {
        e.preventDefault(); e.stopImmediatePropagation()
        if (tool === 'trim' && cursor) trim(cursor)
      }
    }
    const onUp = (e: PointerEvent) => {
      if (!down || e.button !== 0) return
      e.preventDefault(); e.stopImmediatePropagation(); down = false
      if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId)
    }
    const onCancel = () => { down = false; cursor = null }
    const onLeave = () => { if (!down) cursor = null }
    const onClick = (e: MouseEvent) => { if (e.button === 0 && !editable(e.target)) { e.preventDefault(); e.stopImmediatePropagation() } }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || (e.target instanceof Element && e.target.matches('input,textarea,select,[contenteditable="true"]'))) return
      e.preventDefault(); e.stopImmediatePropagation()
      useSketchPresentation.getState().setTool(null)
    }
    host.addEventListener('pointerdown', onDown, true); host.addEventListener('pointermove', onMove, true); host.addEventListener('pointerup', onUp, true)
    host.addEventListener('pointercancel', onCancel, true); host.addEventListener('pointerleave', onLeave); host.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKey, true)
    const render = () => {
      const rect = host.getBoundingClientRect(), draft = useReverse.getState().sketchDraft
      el.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`)
      const path = (ps: Vec2[]) => ps.map((p, i) => { const q = scene.sheetScreenPoint(p); return q ? `${i ? 'L' : 'M'}${q.x - rect.left},${q.y - rect.top}` : '' }).join(' ')
      const curves = (es: SketchEntity[]) => es.map(e => path(entityPolyline(e, 96))).join(' ')
      let green = '', red = '', dashed = '', hint = ''
      if (tool === 'slot') {
        hint = points.length === 0 ? 'Slot: click first centre' : points.length === 1 ? 'Slot: click second centre' : 'Slot: click width'
        if (cursor && points.length === 1) dashed = path([points[0], cursor])
        if (cursor && points.length === 2) {
          dashed = path(points)
          const preview = slotSketch(emptySketch(), points[0], points[1], slotWidth(points[0], points[1], cursor))
          if (preview.ok) green = curves(preview.sketch.entities)
        }
      } else if (tool === 'middle') {
        hint = firstLine === null ? 'Middle line: click first line' : 'Middle line: click second line'
        const first = draft && firstLine !== null ? entityOf(draft.sketch, firstLine) : null, second = cursor ? pickPiece(cursor, true) : null
        if (first) dashed = curves([first])
        if (second) red = curves([second])
        if (first?.kind === 'line' && second?.kind === 'line' && first.id !== second.id) {
          const swap = distance(first.a, second.a) + distance(first.b, second.b) > distance(first.a, second.b) + distance(first.b, second.a)
          const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          green = path([mid(first.a, swap ? second.b : second.a), mid(first.b, swap ? second.a : second.b)])
        }
      } else if (tool === 'trim') {
        hint = 'Trim: click or paint a span between intersections'
        const hit = cursor ? pickPiece(cursor) : null
        if (hit && draft && cursor) {
          const result = trimAt(draft.sketch, hit.id, nearestOnEntity(hit, cursor).point)
          // Red candidate, green retained spans: the result is explicit before commit.
          red = curves([hit])
          if (result.ok) green = curves(result.sketch.entities.filter(e => result.ids.includes(e.id)))
        }
      } else if (tool === 'tangentArc') {
        hint = start ? 'Tangent arc: click its endpoint' : 'Tangent arc: click a line endpoint'
        if (!start && cursor) {
          const end = pickEnd(cursor)
          if (end) { const r = radius() * .4; green = path([[end.point[0] - r, end.point[1]], [end.point[0] + r, end.point[1]]]) + ' ' + path([[end.point[0], end.point[1] - r], [end.point[0], end.point[1] + r]]) }
        }
        if (start && cursor && draft) {
          const line = entityOf(draft.sketch, start.entity), t = line ? outwardTangent(line, start.at) : null, q = pickEnd(cursor)?.point ?? cursor
          const arc = t ? tangentArc(start.point, t, q) : null
          dashed = path([start.point, q])
          if (arc) green = curves([{ kind: 'arc', id: 0, c: arc.c, r: arc.r, start: arc.start, sweep: arc.sweep }])
        }
      }
      ghost.current?.setAttribute('d', green); highlight.current?.setAttribute('d', red); guide.current?.setAttribute('d', dashed)
      if (label.current) label.current.textContent = hint
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(frame); host.style.cursor = previousCursor
      host.removeEventListener('pointerdown', onDown, true); host.removeEventListener('pointermove', onMove, true); host.removeEventListener('pointerup', onUp, true)
      host.removeEventListener('pointercancel', onCancel, true); host.removeEventListener('pointerleave', onLeave); host.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [tool, scene])
  return tool ? <svg ref={svg} aria-label={`${tool} sketch preview`} data-test="sketch-extra-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 6 }}>
    <path ref={highlight} fill="none" stroke="#e54838" strokeWidth="3" />
    <path ref={guide} fill="none" stroke="#317bb7" strokeWidth="1.5" strokeDasharray="5 4" />
    <path ref={ghost} fill="none" stroke="#009c42" strokeWidth="2.5" />
    <text ref={label} x="16" y="24" fill="#202020" stroke="white" strokeWidth="3" paintOrder="stroke" fontSize="13" />
  </svg> : null
}
