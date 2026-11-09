// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'

/** Keep unrelated controls blocked while passing camera gestures to the viewport. */
export function useFreeformNavigation() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const backdrop = ref.current
    if (!backdrop) return
    const canvasAt = (e: MouseEvent) => {
      if (e.target !== backdrop) return null
      const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas')
      if (!canvas) return null
      const r = canvas.getBoundingClientRect()
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom ? canvas : null
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 1 || e.pointerType === 'touch') return
      const canvas = canvasAt(e)
      if (!canvas) return
      e.preventDefault()
      backdrop.querySelector<HTMLFormElement>('form')?.focus()
      // Navigation already tracks subsequent moves/releases on document.
      canvas.dispatchEvent(new PointerEvent('pointerdown', e))
    }
    const wheel = (e: WheelEvent) => {
      const canvas = canvasAt(e)
      if (!canvas) return
      e.preventDefault()
      canvas.dispatchEvent(new WheelEvent('wheel', e))
    }
    backdrop.addEventListener('pointerdown', down)
    backdrop.addEventListener('wheel', wheel, { passive: false })
    return () => {
      backdrop.removeEventListener('pointerdown', down)
      backdrop.removeEventListener('wheel', wheel)
    }
  }, [])
  return ref
}
