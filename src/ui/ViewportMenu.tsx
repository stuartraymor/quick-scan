// SPDX-License-Identifier: AGPL-3.0-only
// Right-click on the 3D stage: the commands a QUICKSURFACE user reaches for
// there, in the order they expect them. A right-drag (pan in some mouse
// schemes) is navigation, so only a click that stays put opens the menu.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Item {
  label: string
  key?: string
  run?: () => void
}

interface Props {
  hasScan: boolean
  onZoomFit: () => void
  onHideSelected: () => void
  onIsolate: () => void
  onShowHidden: () => void
  onToggleScans?: () => void
  onExtract: () => void
  onSketch?: () => void
}

const STILL_PX = 4

export function ViewportMenu({ hasScan, onZoomFit, onHideSelected, onIsolate, onShowHidden, onToggleScans, onExtract, onSketch }: Props) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const down = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onStage = (e: Event) => (e.target as Element | null)?.closest?.('.desktop-mid canvas') != null
    // Windows sends the context menu on release, Linux and macOS on press:
    // then the menu waits for the release, and a drag in between drops it.
    let held: { x: number; y: number } | null = null
    const pointerDown = (e: PointerEvent) => { if (e.button === 2 && onStage(e)) { down.current = { x: e.clientX, y: e.clientY }; held = null } }
    const place = (x: number, y: number) => setAt({ x: Math.min(x, innerWidth - 240), y: Math.min(y, innerHeight - 320) })
    const pointerUp = (e: PointerEvent) => {
      if (e.button !== 2 || !held) return
      const h = held
      held = null
      if (Math.hypot(e.clientX - h.x, e.clientY - h.y) <= STILL_PX) place(h.x, h.y)
    }
    const context = (e: MouseEvent) => {
      if (!onStage(e)) return
      e.preventDefault()
      const d = down.current
      down.current = null
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > STILL_PX) return
      if (e.buttons & 2) held = { x: e.clientX, y: e.clientY }
      else place(e.clientX, e.clientY)
    }
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('contextmenu', context)
    window.addEventListener('pointerup', pointerUp, true)
    return () => {
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('contextmenu', context)
      window.removeEventListener('pointerup', pointerUp, true)
    }
  }, [])

  useEffect(() => {
    if (!at) return
    const close = (e: Event) => { if (!(e.target as Element | null)?.closest?.('.viewport-menu')) setAt(null) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null) }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', close, true)
      document.removeEventListener('keydown', key)
    }
  }, [at])

  if (!at) return null
  const scan = (run: () => void) => (hasScan ? run : undefined)
  const groups: Item[][] = [
    [{ label: 'Zoom to Fit', key: 'A', run: onZoomFit }],
    [
      { label: 'Hide', key: 'H', run: scan(onHideSelected) },
      { label: 'Hide All But This', run: scan(onIsolate) },
      { label: 'Show Hidden', run: scan(onShowHidden) },
    ],
    [{ label: 'Hide all scans', run: hasScan ? onToggleScans : undefined }],
    [
      { label: 'Extract primitives …', run: scan(onExtract) },
      { label: '2D Sketch …', key: 'S', run: hasScan ? onSketch : undefined },
    ],
  ]
  return createPortal(
    <div role="menu" className="explorer-core-menu viewport-menu" data-test="viewport-menu" style={{ left: at.x, top: at.y, zIndex: 1000 }}>
      {groups.map((g, i) => (
        <div key={i} style={i ? { borderTop: '1px solid var(--line)', marginTop: 3, paddingTop: 3 } : undefined}>
          {g.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={!item.run}
              style={{ display: 'flex', justifyContent: 'space-between', opacity: item.run ? 1 : 0.45 }}
              onClick={() => { setAt(null); item.run?.() }}
            >
              <span>{item.label}</span>
              {item.key && <span style={{ color: 'var(--dim)' }}>{item.key}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  )
}
