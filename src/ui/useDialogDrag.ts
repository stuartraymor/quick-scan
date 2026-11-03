// SPDX-License-Identifier: AGPL-3.0-only
// A floating dialog moved by its title bar, as QUICKSURFACE's dialogs are:
// press on the header and drag; the dialog keeps inside the window.

import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

export function useDialogDrag(start: { left: number; top: number }) {
  const [at, setAt] = useState(start)
  const grab = useRef<{ dx: number; dy: number } | null>(null)
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    // The header's own buttons (the ×) click as buttons.
    if ((e.target as HTMLElement).closest('button')) return
    grab.current = { dx: e.clientX - at.left, dy: e.clientY - at.top }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const g = grab.current
    if (!g) return
    setAt({
      left: Math.min(Math.max(0, e.clientX - g.dx), window.innerWidth - 80),
      top: Math.min(Math.max(0, e.clientY - g.dy), window.innerHeight - 40),
    })
  }
  const onPointerUp = () => { grab.current = null }
  return { position: at, handle: { onPointerDown, onPointerMove, onPointerUp, style: { cursor: 'move' } } }
}
