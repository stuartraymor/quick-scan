// SPDX-License-Identifier: AGPL-3.0-only
// Extract primitives' step-2 options beyond the type: the constraint a fit is
// held to, Auto Constrain and its tolerances, and Analysis (points further
// than a tolerance from the previewed primitive). Session state, not saved
// with the project.

import { create } from 'zustand'
import { DEFAULT_TOLERANCES, type ConstraintId } from '../core/elements/constrain'

export const DEFAULT_ANALYSIS_MM = 0.1

interface ExtractState {
  constraint: ConstraintId
  autoConstrain: boolean
  tiltDeg: number
  coincidenceMm: number
  analysis: boolean
  analysisMm: number
  /** What Analysis found on the preview on show, until it is changed. */
  analysed: { far: number; total: number; worst: number } | null
  setConstraint: (c: ConstraintId) => void
  setAutoConstrain: (on: boolean) => void
  setTiltDeg: (v: number) => void
  setCoincidenceMm: (v: number) => void
  setAnalysis: (on: boolean) => void
  setAnalysisMm: (v: number) => void
  setAnalysed: (a: ExtractState['analysed']) => void
}

export const useExtract = create<ExtractState>((set) => ({
  constraint: 'none',
  autoConstrain: false,
  tiltDeg: DEFAULT_TOLERANCES.tiltDeg,
  coincidenceMm: DEFAULT_TOLERANCES.coincidenceMm,
  analysis: false,
  analysisMm: DEFAULT_ANALYSIS_MM,
  analysed: null,
  setConstraint: (constraint) => set({ constraint, autoConstrain: false }),
  setAutoConstrain: (autoConstrain) => set({ autoConstrain, constraint: 'none' }),
  setTiltDeg: (tiltDeg) => set({ tiltDeg }),
  setCoincidenceMm: (coincidenceMm) => set({ coincidenceMm }),
  setAnalysis: (analysis) => set(analysis ? { analysis } : { analysis, analysed: null }),
  setAnalysisMm: (analysisMm) => set({ analysisMm, analysed: null }),
  setAnalysed: (analysed) => set({ analysed }),
}))
