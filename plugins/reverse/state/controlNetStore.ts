// SPDX-License-Identifier: AGPL-3.0-only
// Fit Surface → Control Net: whether the open surface's control net is drawn
// over the part. A view of the box, as in QUICKSURFACE (where the tick is in
// the dialog and goes with it), so it is not part of the feature, does not
// change what is built. Preferences survive Cancel/reopen, as measured in
// QUICKSURFACE; the scene hides the net and handles while no editor is open.

import { create } from 'zustand'
import type { PoleFrame } from '../viewer/poleFrameGizmo'

export const useControlNet = create<{ on: boolean; strength: number; frame: PoleFrame; setFrame: (frame: PoleFrame) => void; set: (on: boolean) => void; setStrength: (strength: number) => void }>((set) => ({
  on: false,
  strength: 100,
  frame: 'Screen',
  setFrame: frame => set({ frame }),
  set: (on) => set({ on }),
  setStrength: strength => { if (Number.isFinite(strength)) set({ strength: Math.max(0, Math.min(100, strength)) }) },
}))
