// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import { fitBrushPrimitive, sketchWithBrushFit, type BrushFit, type BrushPoint, type BrushPrimitive } from '../core/sketchBrush'
import { useReverse } from './reStore'

interface SketchBrushState {
  open: boolean
  primitive: BrushPrimitive
  brushPx: number
  instant: boolean
  tolerance: number
  axisDegrees: number
  curvePoints: number
  selected: BrushPoint[]
  selectionOverflow: boolean
  preview: BrushFit | null
  message: string | null
  setOpen: (open: boolean) => void
  setPrimitive: (primitive: BrushPrimitive) => void
  setBrushPx: (pixels: number) => void
  setInstant: (instant: boolean) => void
  setTolerance: (tolerance: number) => void
  setAxisDegrees: (degrees: number) => void
  setCurvePoints: (points: number) => void
  setSelected: (selected: BrushPoint[]) => void
  apply: () => boolean
  clear: () => void
}

export const useSketchBrush = create<SketchBrushState>()((set, get) => {
  let fitTimer: ReturnType<typeof setTimeout> | null = null
  const cancelFit = () => { if (fitTimer !== null) clearTimeout(fitTimer); fitTimer = null }
  const preview = () => {
    cancelFit()
    const s = get()
    if (s.selectionOverflow) { set({ preview: null }); return }
    set({ preview: s.selected.length ? fitBrushPrimitive(s.primitive, s.selected, s) : null, message: null })
  }
  return {
    open: false, primitive: 'line', brushPx: 52, instant: true,
    tolerance: 0.1, axisDegrees: 1, curvePoints: 8, selected: [], selectionOverflow: false, preview: null, message: null,
    setOpen: (open) => {
      cancelFit()
      if (open) useReverse.getState().setSketchTool('select')
      set({ open, selected: [], selectionOverflow: false, preview: null, message: null })
    },
    setPrimitive: (primitive) => { set({ primitive }); preview() },
    setBrushPx: (brushPx) => set({ brushPx: Math.max(8, Math.min(200, brushPx)) }),
    setInstant: (instant) => set({ instant }),
    setTolerance: (tolerance) => { set({ tolerance }); preview() },
    setAxisDegrees: (axisDegrees) => { set({ axisDegrees: Math.max(0, Math.min(45, axisDegrees)) }); preview() },
    setCurvePoints: (curvePoints) => { set({ curvePoints: Math.max(4, Math.min(64, Math.round(curvePoints))) }); preview() },
    setSelected: (selected) => {
      cancelFit()
      const kind = get().primitive
      set({ selected, selectionOverflow: false })
      // Closed-shape optimization waits until a stroke pauses; painting
      // thousands of points must remain responsive. Release/Apply always
      // performs a fresh full-data fit synchronously before committing.
      if (kind === 'rectangle' || kind === 'slot' || kind === 'hexagon') {
        set({ preview: null, message: null })
        fitTimer = setTimeout(preview, 120)
      } else preview()
    },
    clear: () => { cancelFit(); set({ selected: [], selectionOverflow: false, preview: null, message: null }) },
    apply: () => {
      cancelFit()
      const s = get(), draft = useReverse.getState().sketchDraft
      if (s.selectionOverflow) { set({ message: 'The brush selection exceeded 12,000 points. Clear the selection and fit a smaller area.' }); return false }
      if (!draft || !s.selected.length) { set({ message: 'Highlight section points with the circular brush first.' }); return false }
      const fit = fitBrushPrimitive(s.primitive, s.selected, s)
      const sketch = sketchWithBrushFit(draft.sketch, fit)
      if (!sketch || !fit.ok) { set({ preview: fit, message: fit.ok ? 'The primitive could not be fitted.' : fit.error }); return false }
      // The brush already fitted the new primitive. Appending it must not
      // refit unrelated, satisfied geometry. Unsatisfied relations still solve.
      useReverse.getState().setSketch(sketch, undefined, true)
      set({ preview: null, selected: [], message: `Fitted ${s.primitive === 'curve' ? 'curve' : s.primitive} to ${s.selected.length} points (maximum deviation ${fit.maxDeviation.toFixed(3)} mm).` })
      return true
    },
  }
})
