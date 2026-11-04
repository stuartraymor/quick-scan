// SPDX-License-Identifier: AGPL-3.0-only
// The words QUICKSURFACE writes by an extrude's grips in the view — "Top
// plane / Depth 1" on the end it grows to, "Bottom plane / Depth 2" on the
// one it starts from — and its Labels box, which shows or hides them.

import { create } from 'zustand'
import type { Vec3 } from '../../../src/core/types'

export interface GripLabel { text: string; at: Vec3 }

export const useGripLabels = create<{
  labels: GripLabel[]
  shown: boolean
  setLabels: (labels: GripLabel[]) => void
  setShown: (shown: boolean) => void
}>((set) => ({
  labels: [],
  shown: true,
  setLabels: (labels) => set({ labels }),
  setShown: (shown) => set({ shown }),
}))

/** The label a grip side wears, or null for a grip QUICKSURFACE leaves bare. */
export function gripLabelText(side: string): string | null {
  return side === 'extrudeTo' ? 'Top plane / Depth 1' : side === 'extrudeFrom' ? 'Bottom plane / Depth 2' : null
}
