// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { Vec2 } from '../../../src/core/flat/types'
import type { SketchChains } from '../app/useReverseWorkspace'
import { brushPoints, type BrushPoint } from '../core/sketchBrush'
import { entityPolyline, type SketchEntity } from '../core/sketch'
import { useSketchBrush } from '../state/sketchBrushStore'

/** A plugin-owned canvas over the real sheet. Input is captured only for
 *  left-button paint; middle/right navigation still reaches FlatScene. */
/** The tag beside the brush: the fit in hand. */
const FIT_TAG: Record<string, string> = { line: 'Fit Line', arc: 'Fit Arc', circle: 'Fit Circle', rectangle: 'Rectangle', slot: 'Slot', hexagon: 'Hexagon', curve: 'Fit Curve' }

export function SketchBrushOverlay({ scene, chainsOf }: { scene: FlatScene | null; chainsOf: () => SketchChains | null }) {
  const open = useSketchBrush((s) => s.open)
  const canvas = useRef<HTMLCanvasElement>(null)
  const ring = useRef<HTMLDivElement>(null)
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
    // Index projected CSS pixels: paint and the displayed circle now share one
    // coordinate system, even with application zoom, DPI scaling or a turned sheet.
    type Dot = { point: BrushPoint; x: number; y: number }
    let grid = new Map<string, Dot[]>(), dots: Dot[] = [], projection = '', indexed: BrushPoint[] | null = null
    let lastDrawn: typeof points | null = null, lastPreview: unknown, lastSelected: unknown
    const cell = 48
    const project = () => {
      refreshPoints()
      const o = scene.sheetScreenPoint([0,0]), u = scene.sheetScreenPoint([1,0]), v = scene.sheetScreenPoint([0,1])
      if (!o || !u || !v) return false
      const key = [o.x,o.y,u.x,u.y,v.x,v.y].join(',')
      if (indexed === points && projection === key) return true
      indexed = points; projection = key; grid = new Map(); lastDrawn = null
      dots = points.map(point => {
        const [a,b] = point.p
        const x = o.x + a*(u.x-o.x) + b*(v.x-o.x), y = o.y + a*(u.y-o.y) + b*(v.y-o.y)
        const dot = {point,x,y}, k = Math.floor(x/cell)+':'+Math.floor(y/cell)
        const bin = grid.get(k); if (bin) bin.push(dot); else grid.set(k,[dot])
        return dot
      })
      return true
    }
    const follow = () => {
      const node = ring.current
      if (!node) return
      node.hidden = !cursor
      if (!cursor) return
      const rect = host.getBoundingClientRect(), scale = rect.width / (host.offsetWidth || 1)
      const state = useSketchBrush.getState(), size = state.brushPx / scale
      node.style.width = node.style.height = size+'px'
      node.style.transform = 'translate3d('+((cursor.x-rect.left)/scale-size/2)+'px,'+((cursor.y-rect.top)/scale-size/2)+'px,0)'
      node.dataset.fit = FIT_TAG[state.primitive] ?? 'Fit'
    }
    const paint = (e: PointerEvent) => {
      if (!project()) return
      const state = useSketchBrush.getState(), r = state.brushPx / 2
      const selected = new Map(state.selected.map(q=>[q.key,q]))
      let changed = false
      for (const sample of [...(e.getCoalescedEvents?.() ?? []), e]) {
        const x = sample.clientX, y = sample.clientY, [a,b] = last ?? [x,y]
        const dx=x-a, dy=y-b, len=dx*dx+dy*dy
        for(let i=Math.floor((Math.min(x,a)-r)/cell);i<=Math.floor((Math.max(x,a)+r)/cell);i++)
          for(let j=Math.floor((Math.min(y,b)-r)/cell);j<=Math.floor((Math.max(y,b)+r)/cell);j++)
            for(const dot of grid.get(i+':'+j) ?? []) {
              const t=len ? Math.max(0, Math.min(1, ((dot.x-a)*dx+(dot.y-b)*dy)/len)) : 0
              if ((dot.x-a-t*dx)**2 + (dot.y-b-t*dy)**2 > r*r+1e-7) continue
              if(e.altKey) { if(selected.delete(dot.point.key)) changed=true }
              else if(!selected.has(dot.point.key)){selected.set(dot.point.key,dot.point);changed=true}
            }
        last=[x,y]
      }
      if (!changed) return
      if (selected.size <= 12000 && !state.selectionOverflow) state.setSelected([...selected.values()])
      else useSketchBrush.setState({selectionOverflow:true,preview:null,message:'Highlight at most 12,000 points per fit. Clear the selection and fit one contour at a time.'})
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault(); e.stopImmediatePropagation()
      painting = true; last = null
      cursor = { x: e.clientX, y: e.clientY }; follow()
      if (useSketchBrush.getState().instant && !e.shiftKey && !e.altKey) useSketchBrush.getState().clear()
      host.setPointerCapture(e.pointerId)
      paint(e)
    }
    const move = (e: PointerEvent) => {
      cursor = { x: e.clientX, y: e.clientY }; follow()
      host.style.cursor = e.buttons === 0 || painting ? 'none' : previousCursor
      if (!painting) return
      e.preventDefault(); e.stopImmediatePropagation(); paint(e)
    }
    const up = (e: PointerEvent) => {
      if (!painting || e.button !== 0) return
      e.preventDefault(); e.stopImmediatePropagation(); paint(e)
      painting = false; lastDrawn = null; last = null
      if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId)
      if (useSketchBrush.getState().instant && !e.shiftKey && !e.altKey) useSketchBrush.getState().apply()
    }
    const cancel = () => { painting = false; lastDrawn = null; last = null; cursor = null; follow(); host.style.cursor = previousCursor }
    const leave = () => { if (!painting) { cursor = null; follow(); host.style.cursor = previousCursor } }
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault(); e.stopImmediatePropagation()
      const state = useSketchBrush.getState()
      state.setBrushPx(state.brushPx + (e.deltaY < 0 ? 4 : -4)); follow()
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
      project()
      const ctx = el.getContext('2d'), rect = host.getBoundingClientRect(), state = useSketchBrush.getState()
      const ratio = window.devicePixelRatio || 1
      const width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio)
      if (el.width !== width || el.height !== height) { el.width = width; el.height = height; lastDrawn = null }
      if (ctx && (lastDrawn !== points || lastSelected !== state.selected || lastPreview !== state.preview)) {
        lastDrawn = points; lastSelected = state.selected; lastPreview = state.preview
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height)
        const selected = new Set(state.selected.map((p) => p.key))
        for (const {point, x:cx, y:cy} of dots) {
          const x = cx - rect.left, y = cy - rect.top
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
            ctx.strokeStyle = state.primitive === 'line' && !painting ? '#000000' : '#009c42'; ctx.lineWidth = 2.5; ctx.stroke()
          }
        }
      }
      frame = requestAnimationFrame(render)
    }
    const unsubscribe = useSketchBrush.subscribe((s, old) => { if (s.brushPx !== old.brushPx || s.primitive !== old.primitive) follow() })
    frame = requestAnimationFrame(render)
    return () => {
      unsubscribe(); cancelAnimationFrame(frame); host.style.cursor = previousCursor
      host.removeEventListener('pointerdown', down, true); host.removeEventListener('pointermove', move, true); host.removeEventListener('pointerup', up, true)
      host.removeEventListener('pointercancel', cancel, true); host.removeEventListener('pointerleave', leave); host.removeEventListener('click', click, true); host.removeEventListener('wheel', wheel, true)
      window.removeEventListener('keydown', key, true)
      el.getContext('2d')?.clearRect(0, 0, el.width, el.height)
    }
  }, [open, scene])
  return open ? <><div ref={ring} hidden className="sketch-fit-cursor" aria-hidden="true"/><canvas ref={canvas} aria-label="Circular section-point fitting brush" data-test="sketch-fit-brush-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }} /></> : null
}
