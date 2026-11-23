// SPDX-License-Identifier: AGPL-3.0-only
// The value a dimension in hand reads live. An angle dimension follows the
// cursor's sector (θ, 180 − θ, or the reflex 360 − θ) before it is put down;
// the sheet draws that sector, and the panel's number field shows the same
// value instead of the stored, folded one. Written by the sheet's sync,
// cleared once the dimension is put down or dropped.
import { create } from 'zustand'

interface HeldDimensionState {
  held: { id: number; value: number } | null
  setHeld: (held: { id: number; value: number } | null) => void
}

export const useHeldDimension = create<HeldDimensionState>()((set, get) => ({
  held: null,
  setHeld: (held) => {
    const now = get().held
    if (now === held || (now && held && now.id === held.id && now.value === held.value)) return
    set({ held })
  },
}))
