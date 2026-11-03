// SPDX-License-Identifier: AGPL-3.0-only
// A selection box drawn on the stage, as in QUICKSURFACE: a left-drag over
// the 3D view draws a dotted rectangle, and the primitives and the scan
// whose centres lie inside it become the selection the Objects tree shows.
// Shift adds to the selection, Alt takes out of it. It stays out of the way
// of everything else a left-drag does: a mouse scheme that orbits on it, a
// tool, a draft or a marking in hand.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../state/store'
import { useShell } from '../state/shellStore'
import { useMark } from '../state/markStore'
import { schemeById } from '../viewer/navSchemes'
import type { SceneManager } from '../viewer/SceneManager'

const MOVE_PX = 4

/** Whether a plain left-drag is free for a selection box right now. */
function boxFree(): boolean {
  const s = useStore.getState()
  if (s.draft || s.alignDraft || s.dimDraft || s.sectionDraft || s.busy) return false
  if (useShell.getState().extractOpen || useMark.getState().gesture !== null) return false
  // A scheme that orbits or pans on the bare left button keeps it.
  return !schemeById(s.navScheme).bindings.some((b) => b.buttons === 1 && !b.shift && !b.ctrl && !b.alt)
}

export function BoxSelect({ scene }: { scene: () => SceneManager | null }) {
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const start = useRef<{ x: number; y: number; shift: boolean; alt: boolean } | null>(null)

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || e.ctrlKey || !(e.target as Element | null)?.closest?.('.desktop-mid canvas') || !boxFree()) return
      start.current = { x: e.clientX, y: e.clientY, shift: e.shiftKey, alt: e.altKey }
    }
    const move = (e: PointerEvent) => {
      const s = start.current
      if (!s) return
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < MOVE_PX && !box) return
      setBox({ x0: s.x, y0: s.y, x1: e.clientX, y1: e.clientY })
    }
    const up = (e: PointerEvent) => {
      const s = start.current
      start.current = null
      if (!s) return
      setBox(null)
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < MOVE_PX) return
      const view = scene()
      if (!view) return
      const [l, r] = [Math.min(s.x, e.clientX), Math.max(s.x, e.clientX)]
      const [t, b] = [Math.min(s.y, e.clientY), Math.max(s.y, e.clientY)]
      const inside = (p: { x: number; y: number } | null) => p !== null && p.x >= l && p.x <= r && p.y >= t && p.y <= b
      const st = useStore.getState()
      const hits: string[] = []
      for (const el of st.elements) {
        if (el.visible === false || !el.fit || !('center' in el.fit)) continue
        if (inside(view.screenPointOf(el.fit.center as [number, number, number]))) hits.push(`element:${el.id}`)
      }
      if (st.fileName && inside(view.screenPointOf(st.modelCenter as [number, number, number]))) hits.push('scan')
      const now = useShell.getState().selection
      const next = s.alt ? now.filter((k) => !hits.includes(k)) : s.shift ? [...now, ...hits.filter((k) => !now.includes(k))] : hits
      useShell.getState().setSelection(next)
      st.setStatus(next.length ? `${next.length} object${next.length === 1 ? '' : 's'} selected.` : 'Nothing selected.')
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
    }
  }, [scene, box])

  if (!box) return null
  return createPortal(
    <div
      data-test="box-select"
      style={{
        position: 'fixed',
        left: Math.min(box.x0, box.x1),
        top: Math.min(box.y0, box.y1),
        width: Math.abs(box.x1 - box.x0),
        height: Math.abs(box.y1 - box.y0),
        border: '1px dashed var(--ink)',
        background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
        pointerEvents: 'none',
        zIndex: 900,
      }}
    />,
    document.body,
  )
}
