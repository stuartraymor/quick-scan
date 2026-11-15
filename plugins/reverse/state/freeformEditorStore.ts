// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import type { PreviewColouring } from '../core/freeform/previewDeviation'

/** Editor presentation state, shared by the Freeform ribbon and History. */
export const useFreeformEditor = create<{
  open: boolean; targetId: number | null; controlNet: boolean
  tolerance: number; colouring: PreviewColouring
  display: 'shaded' | 'deviation' | 'zebra'
  setDisplay(display: 'shaded' | 'deviation' | 'zebra'): void
  setDeviationOptions(tolerance: number, colouring: PreviewColouring): void
  setTargetId(id: number | null): void
  setControlNet(value: boolean): void; setOpen(open: boolean): void; editFeature(id: number): void
}>(set => ({
  open: false, targetId: null, controlNet: false,
  tolerance: .01, colouring: 'gradient',
  display: 'shaded', setDisplay: display => set({ display }),
  setDeviationOptions: (tolerance, colouring) => {
    if (Number.isFinite(tolerance) && tolerance > 0 && Number.isFinite(5 * tolerance)) set({ tolerance, colouring })
  },
  setTargetId: targetId => set({ targetId }),
  setControlNet: controlNet => set({ controlNet }),
  setOpen: open => set({ open, targetId: null }),
  editFeature: targetId => set({ open: true, targetId }),
}))
