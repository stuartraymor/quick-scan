// SPDX-License-Identifier: AGPL-3.0-only
// Analysis → Zebra Stripes: whether the CAD bodies are drawn with reflection
// stripes, which show where a surface's curvature jumps.

import { create } from 'zustand'

export type BodyAnalysis = 'zebra' | 'draft' | 'envmap' | null

/** Which surface-quality view the bodies wear: Zebra Stripes, Draft (faces
 *  coloured by their angle to the Z pull direction), or none. */
export const useZebra = create<{ mode: BodyAnalysis; toggle: (m: Exclude<BodyAnalysis, null>) => void }>((set) => ({
  mode: null,
  toggle: (m) => set((s) => ({ mode: s.mode === m ? null : m })),
}))
