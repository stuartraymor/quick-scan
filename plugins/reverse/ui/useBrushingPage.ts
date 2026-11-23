// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react'

/**
 * While a brush tool (Corner Trim, the Fit brushes) is open, the sketch's
 * labels — relation glyphs and dimension numbers — let presses through to
 * the brush: a sweep that starts on a glyph sitting on the corner it is
 * meant for must still sweep. Counted, so two overlays open at once and
 * closing in either order leave the page as it was.
 */
export function useBrushingPage(open: boolean): void {
  useEffect(() => {
    if (!open) return
    const root = document.documentElement
    root.dataset.sketchBrushing = String(Number(root.dataset.sketchBrushing ?? 0) + 1)
    root.classList.add('sketch-brushing')
    return () => {
      const left = Number(root.dataset.sketchBrushing ?? 1) - 1
      if (left > 0) {
        root.dataset.sketchBrushing = String(left)
        return
      }
      delete root.dataset.sketchBrushing
      root.classList.remove('sketch-brushing')
    }
  }, [open])
}
