// SPDX-License-Identifier: AGPL-3.0-only
// Create Sketch → Stacked sections: on or off, how many, where the upper
// plane is and the box's footprint. The lower plane is the sketch's own; the
// upper is dragged by its own arrow in the view (or typed); the box's sides
// by the handles on its corners, its sides and its centre. The cuts run
// between the planes, both ends included, kept inside the box, flattened onto
// the sketch.

import { create } from 'zustand'

/** The box's footprint, in the sketch plane's own u, v coordinates (as its
 *  reference points are), so it stays put as the plane moves along its
 *  normal. */
export interface StackRect { u0: number; u1: number; v0: number; v1: number }

export const useStack = create<{
  on: boolean
  count: number
  /** The upper plane, in the sketch plane's own offset terms (a distance
   *  along its normal), so it stays where it is in the part when the sketch's
   *  plane — the lower one — is moved. Null until the stack is turned on. */
  upper: number | null
  /** The box's lower plane, in the same terms: it starts on the sketch's
   *  plane and is dragged by the yellow arrow, as the upper is by the blue,
   *  while the sketch's own plane (its big sheet) stays where it is. */
  lower: number | null
  /** Null until the stack is turned on: then the part's own footprint. */
  rect: StackRect | null
  setOn: (on: boolean) => void
  setCount: (count: number) => void
  setUpper: (upper: number | null) => void
  setLower: (lower: number | null) => void
  setRect: (rect: StackRect | null) => void
}>((set) => ({
  on: false,
  count: 10,
  upper: null,
  lower: null,
  rect: null,
  setOn: (on) => set(on ? { on } : { on, upper: null, lower: null, rect: null }),
  setCount: (count) => set({ count }),
  setUpper: (upper) => set({ upper }),
  setLower: (lower) => set({ lower }),
  setRect: (rect) => set({ rect }),
}))
