// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'

/** View aids shared by the corner menu and Objects tree. No model geometry changes. */
export const useNavigationView = create<{
  coordinates: boolean
  grid: boolean
  spacing: number
  setCoordinates: (on: boolean) => void
  setGrid: (on: boolean, spacing: number) => void
}>((set) => ({
  coordinates: false,
  grid: false,
  spacing: 10,
  setCoordinates: (coordinates) => set({ coordinates }),
  setGrid: (grid, spacing) => {
    if (Number.isFinite(spacing) && spacing > 0) set({ grid, spacing })
  },
}))
