// SPDX-License-Identifier: AGPL-3.0-only
// Edit Sketch → Display → Curvature: whether the comb is drawn, and how long
// its teeth are (the slider beside the box) — millimetres of tooth per unit
// of curvature (1/mm).

import { create } from 'zustand'

export const useSketchCurvature = create<{ on: boolean; scale: number; setOn: (on: boolean) => void; setScale: (scale: number) => void }>((set) => ({
  on: false,
  scale: 50,
  setOn: (on) => set({ on }),
  setScale: (scale) => set({ scale }),
}))
