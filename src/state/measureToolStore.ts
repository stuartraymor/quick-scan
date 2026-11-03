// SPDX-License-Identifier: AGPL-3.0-only
// Analysis → Measure, as QUICKSURFACE 8.0.128 has it (recorded live): a
// dialog of four ways to measure on the mesh, the measurements laid over
// the view while it is open and gone when it closes; the way chosen is
// kept for the next time.

import { create } from 'zustand'
import type { Vec3 } from '../core/types'

export type MeasureMode = '3d' | 'extended' | 'point' | 'curve'

export type Measurement =
  | { kind: '3d' | 'extended'; a: Vec3; b: Vec3 }
  | { kind: 'point'; a: Vec3 }

interface MeasureToolState {
  open: boolean
  mode: MeasureMode
  items: Measurement[]
  /** The first point of a distance, picked and waiting for its second. */
  pending: Vec3 | null
  setOpen: (open: boolean) => void
  setMode: (mode: MeasureMode) => void
  /** A point picked on the mesh, taken as the mode says. */
  pick: (p: Vec3) => Measurement | null
  deleteAll: () => void
  deleteLast: () => void
}

export const useMeasureTool = create<MeasureToolState>((set, get) => ({
  open: false,
  mode: '3d',
  items: [],
  pending: null,
  // Closing takes every measurement away; opening starts on none.
  setOpen: (open) => set({ open, items: [], pending: null }),
  setMode: (mode) => set({ mode, pending: null }),
  pick: (p) => {
    const { mode, pending, items } = get()
    if (mode === 'point') {
      const m: Measurement = { kind: 'point', a: p }
      set({ items: [...items, m] })
      return m
    }
    if (mode === 'curve') return null
    if (!pending) {
      set({ pending: p })
      return null
    }
    const m: Measurement = { kind: mode, a: pending, b: p }
    set({ items: [...items, m], pending: null })
    return m
  },
  deleteAll: () => set({ items: [], pending: null }),
  deleteLast: () => set((s) => (s.pending ? { pending: null } : { items: s.items.slice(0, -1) })),
}))

/** A distance and its parts along X, Y and Z, mm. */
export function measuredDistance(a: Vec3, b: Vec3): { d: number; dx: number; dy: number; dz: number } {
  const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]), dz = Math.abs(b[2] - a[2])
  return { d: Math.hypot(dx, dy, dz), dx, dy, dz }
}
