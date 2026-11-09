// SPDX-License-Identifier: AGPL-3.0-only
// Fit Surface → Control Net: whether the open surface's control net is drawn
// over the part. A view of the box, as in QUICKSURFACE (where the tick is in
// the dialog and goes with it), so it is not part of the feature, does not
// change what is built, and is put away when the box closes.

import { create } from 'zustand'

export const useControlNet = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: false,
  set: (on) => set({ on }),
}))
