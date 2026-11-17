// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import type { PreviewColouring } from '../core/freeform/previewDeviation'

/** Editor presentation state, shared by the Freeform ribbon and History. */
export const useFreeformEditor = create<{
  open: boolean; targetId: number | null; controlNet: boolean
  tolerance: number; colouring: PreviewColouring
  meshDisplay: 'offset' | 'transparent'; meshOpacity: number; meshOffset: number
  setMeshDisplay(value: 'offset' | 'transparent'): void
  setMeshOpacity(value: number): void; setMeshOffset(value: number): void
  display: 'shaded' | 'deviation' | 'zebra'
  setDisplay(display: 'shaded' | 'deviation' | 'zebra'): void
  setDeviationOptions(tolerance: number, colouring: PreviewColouring): void
  setTargetId(id: number | null): void
  setControlNet(value: boolean): void; setOpen(open: boolean): void; editFeature(id: number): void
}>(set => ({
  open: false, targetId: null, controlNet: false,
  tolerance: .01, colouring: 'gradient',
  meshDisplay: 'offset', meshOpacity: 85, meshOffset: 70,
  setMeshDisplay: meshDisplay => set({meshDisplay}),
  setMeshOpacity: meshOpacity => set({meshOpacity:Math.max(0,Math.min(100,meshOpacity))}),
  setMeshOffset: meshOffset => set({meshOffset:Math.max(0,Math.min(100,meshOffset))}),
  display: 'shaded', setDisplay: display => set({ display }),
  setDeviationOptions: (tolerance, colouring) => {
    if (Number.isFinite(tolerance) && tolerance > 0 && Number.isFinite(5 * tolerance)) set({ tolerance, colouring })
  },
  setTargetId: targetId => set({ targetId }),
  setControlNet: controlNet => set({ controlNet }),
  setOpen: open => set({ open, targetId: null }),
  editFeature: targetId => set({ open: true, targetId }),
}))
