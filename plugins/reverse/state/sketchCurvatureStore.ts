// SPDX-License-Identifier: AGPL-3.0-only
// Edit Sketch → Display → Curvature: whether the comb is drawn, and its
// options — scale (mm of tooth per 1/mm of curvature; the slider beside the
// box), teeth per piece, the longest tooth (mm), signed or one-sided, the
// noise filter, an optional offset reference line and the extreme labels.

import { create } from 'zustand'
import { DEFAULT_COMB } from '../core/curvatureComb'

export interface SketchCurvatureState {
  on: boolean
  scale: number
  density: number
  maxLength: number
  signed: boolean
  smooth: number
  offsetOn: boolean
  offset: number
  labels: boolean
  optionsOpen: boolean
  setOn: (on: boolean) => void
  setScale: (scale: number) => void
  set: (patch: Partial<Omit<SketchCurvatureState, 'setOn' | 'setScale' | 'set'>>) => void
}

export const useSketchCurvature = create<SketchCurvatureState>((set) => ({
  on: false,
  scale: DEFAULT_COMB.scale,
  density: DEFAULT_COMB.density,
  maxLength: DEFAULT_COMB.maxLength,
  signed: DEFAULT_COMB.signed,
  smooth: DEFAULT_COMB.smooth,
  offsetOn: false,
  offset: 5,
  labels: true,
  optionsOpen: false,
  setOn: (on) => set({ on }),
  setScale: (scale) => set({ scale }),
  set: (patch) => set(patch),
}))
