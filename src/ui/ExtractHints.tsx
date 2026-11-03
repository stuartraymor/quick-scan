// SPDX-License-Identifier: AGPL-3.0-only
// What QUICKSURFACE shows while Extract primitives is open: a three-line hint
// boxed in the bottom-right corner of the 3D view, and Ctrl + mouse wheel
// over the view sizing the brush, or with the Magic Wand its sensitivity,
// instead of zooming.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../state/store'
import { useShell } from '../state/shellStore'
import { brushRange, useMark } from '../state/markStore'
import { usePrefs } from '../state/prefsStore'
import { cornerBoxPlace } from './cornerBox'

export const EXTRACT_HINT_LINES = [
  'Paint with the mouse to select triangles. Use Control plus mouse wheel to change brush size',
  'Hold ALT key while dragging with the mouse to unselect triangles.',
  'Use Ctrl + mouse wheel to change the sensitivity for Magic Wand',
]

/** What QUICKSURFACE's Align by Coordinate System says in the same corner. */
export const ALIGN_HINT_LINES = [
  'Select primary, secondary and tertiary features to define coordinate system.',
  'Press Apply to apply the transformation to the scene objects',
]

/** One Ctrl + wheel notch: the wand's degrees in 0.1° steps, the brush by a
 *  tenth of its width, both held to their ranges. Up (a negative deltaY)
 *  grows either. */
export function ctrlWheelStep(deltaY: number): void {
  const m = useMark.getState()
  const up = deltaY < 0
  if (m.gesture === 'wand') {
    if (m.wandConnected) return
    m.setWandDegrees(Math.round((m.wandDegrees + (up ? 0.1 : -0.1)) * 100) / 100)
    useStore.getState().setStatus(`Magic Wand sensitivity ${useMark.getState().wandDegrees}°`)
    return
  }
  const { min, max } = brushRange(useStore.getState().modelSize)
  m.setDiameter(Math.min(Math.max(m.diameter * (up ? 1.1 : 1 / 1.1), min), max))
  useStore.getState().setStatus(`Brush ${useMark.getState().diameter.toFixed(2)} mm across`)
}

export function ExtractHints() {
  const extracting = useShell((s) => s.extractOpen)
  const aligning = useStore((s) => s.alignDraft !== null)
  const open = extracting || aligning
  const lines = extracting ? EXTRACT_HINT_LINES : ALIGN_HINT_LINES
  const gesture = useMark((s) => s.gesture)
  const help = usePrefs((s) => s.onScreenHelp)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!open) return
    const view = () => document.querySelector('.desktop-mid')
    const measure = () => setRect(view()?.getBoundingClientRect() ?? null)
    measure()
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !useMark.getState().gesture || !(e.target as Element | null)?.closest?.('.desktop-mid canvas')) return
      e.preventDefault()
      e.stopPropagation()
      ctrlWheelStep(e.deltaY)
    }
    window.addEventListener('resize', measure)
    document.addEventListener('wheel', wheel, { capture: true, passive: false })
    return () => {
      window.removeEventListener('resize', measure)
      document.removeEventListener('wheel', wheel, { capture: true })
    }
  }, [open])

  if (!open || !rect || !help) return null
  return createPortal(
    <div
      data-test="extract-hints"
      style={{
        position: 'fixed',
        ...cornerBoxPlace(rect),
        maxWidth: Math.max(rect.width - 24, 200),
        padding: '4px 8px',
        background: 'color-mix(in srgb, var(--panel, #1e2126) 88%, transparent)',
        border: '1px solid var(--line, #3a3f47)',
        color: 'var(--ink, #e8eaed)',
        fontSize: 12,
        lineHeight: 1.35,
        pointerEvents: 'none',
        zIndex: 40,
        opacity: gesture ? 1 : 0.85,
      }}
    >
      {lines.map((l) => <div key={l}>{l}</div>)}
    </div>,
    document.body,
  )
}
