// SPDX-License-Identifier: AGPL-3.0-only
// Create Sketch → "Pick ...", as in QUICKSURFACE: the button arms a pick, and
// the next plane clicked in the view becomes the sketch's plane.

import { create } from 'zustand'
import type { PlaneRef } from '../core/features'

export const usePlacePick = create<{
  armed: boolean
  picked: PlaneRef | null
  setArmed: (armed: boolean) => void
  pick: (ref: PlaneRef) => void
  take: () => PlaneRef | null
}>((set, get) => ({
  armed: false,
  picked: null,
  setArmed: (armed) => set({ armed }),
  pick: (ref) => set({ armed: false, picked: ref }),
  take: () => { const p = get().picked; if (p) set({ picked: null }); return p },
}))
