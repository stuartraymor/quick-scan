// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'

/** Keep unrelated controls blocked while passing camera gestures to the viewport. */
export function useFreeformNavigation(editing = false) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const backdrop = ref.current
    if (!backdrop) return
    const held = new Map<number, HTMLCanvasElement>()
    let hoveredCanvas: HTMLCanvasElement | null = null
    const canvasAt = (e: MouseEvent) => {
      if (e.target !== backdrop) return null
      const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas')
      if (!canvas) return null
      const r = canvas.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom ? canvas : null
    }
    const down = (e: PointerEvent) => {
      if ((!editing && e.button !== 1) || e.pointerType === 'touch') return
      const canvas = canvasAt(e)
      if (!canvas) return
      e.preventDefault()
      backdrop.querySelector<HTMLFormElement>('form')?.focus()
      if (editing) held.set(e.pointerId, canvas)
      // Navigation already tracks subsequent moves/releases on document.
      canvas.dispatchEvent(new PointerEvent('pointerdown', e))
    }
    // A forwarded press normally transfers native pointer capture to the
    // canvas. When capture is unavailable, keep canvas-local editor handlers
    // supplied with moves/releases too. Do not bubble the forwarded events:
    // navigation already sees the original event on document.
    const move = (e: PointerEvent) => {
      if (!editing) return
      const canvas = held.get(e.pointerId) ?? canvasAt(e)
      if (canvas) {
        hoveredCanvas = canvas
        canvas.dispatchEvent(new PointerEvent('pointermove', { ...pointerData(e), bubbles: false }))
      } else if (hoveredCanvas) {
        hoveredCanvas.dispatchEvent(new PointerEvent('pointerleave', { ...pointerData(e), bubbles: false }))
        hoveredCanvas = null
      }
    }
    const finish = (e: PointerEvent) => {
      const canvas = held.get(e.pointerId)
      held.delete(e.pointerId)
      if (canvas) canvas.dispatchEvent(new PointerEvent(e.type, { ...pointerData(e), bubbles: false }))
    }
    const released = (e: PointerEvent) => { held.delete(e.pointerId) }
    const wheel = (e: WheelEvent) => {
      const canvas = canvasAt(e)
      if (!canvas) return
      e.preventDefault()
      canvas.dispatchEvent(new WheelEvent('wheel', e))
    }
    const context = (e: MouseEvent) => {
      const canvas = editing ? canvasAt(e) : null
      if (canvas) { e.preventDefault(); canvas.dispatchEvent(new MouseEvent('contextmenu', e)) }
    }
    backdrop.addEventListener('contextmenu', context)
    backdrop.addEventListener('pointerdown', down)
    backdrop.addEventListener('pointermove', move)
    backdrop.addEventListener('pointerup', finish)
    backdrop.addEventListener('pointercancel', finish)
    document.addEventListener('pointerup', released)
    document.addEventListener('pointercancel', released)
    backdrop.addEventListener('wheel', wheel, { passive: false })
    return () => {
      backdrop.removeEventListener('contextmenu', context)
      backdrop.removeEventListener('pointerdown', down)
      backdrop.removeEventListener('pointermove', move)
      backdrop.removeEventListener('pointerup', finish)
      backdrop.removeEventListener('pointercancel', finish)
      document.removeEventListener('pointerup', released)
      document.removeEventListener('pointercancel', released)
      backdrop.removeEventListener('wheel', wheel)
    }
  }, [editing])
  return ref
}

// Event properties live on the prototype; spreading the event itself loses
// coordinates and the pointer id in browsers.
function pointerData(e: PointerEvent): PointerEventInit {
  return { pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, clientX: e.clientX, clientY: e.clientY,
    screenX: e.screenX, screenY: e.screenY, button: e.button, buttons: e.buttons, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey,
    altKey: e.altKey, metaKey: e.metaKey, pressure: e.pressure, cancelable: e.cancelable }
}
