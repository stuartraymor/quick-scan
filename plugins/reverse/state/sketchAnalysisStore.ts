// SPDX-License-Identifier: AGPL-3.0-only
// Edit Sketch → Display → Analysis: the live tolerance check of the sketch
// against the scan's section — on or off, the tolerance (millimetres, shown
// in the current units) and how it is coloured.
import { create } from 'zustand'
import type { DeviationMode } from '../core/sketchDeviation'

interface SketchAnalysisState {
  on: boolean
  toleranceMm: number
  mode: DeviationMode
  optionsOpen: boolean
  setOn: (on: boolean) => void
  setToleranceMm: (mm: number) => void
  setMode: (mode: DeviationMode) => void
  setOptionsOpen: (open: boolean) => void
}

export const DEFAULT_TOLERANCE_MM = 0.1

export const useSketchAnalysis = create<SketchAnalysisState>()((set) => ({
  on: false, toleranceMm: DEFAULT_TOLERANCE_MM, mode: 'passFail', optionsOpen: false,
  setOn: (on) => set({ on }),
  // Kept positive and finite: a bad entry leaves the last good tolerance.
  setToleranceMm: (mm) => { if (Number.isFinite(mm) && mm > 0 && mm < 1e6) set({ toleranceMm: mm }) },
  setMode: (mode) => set({ mode }),
  setOptionsOpen: (optionsOpen) => set({ optionsOpen }),
}))
