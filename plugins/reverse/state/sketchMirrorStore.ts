// SPDX-License-Identifier: AGPL-3.0-only
// Mirror mode: the pieces are chosen first, then the axis is picked on the
// sheet; the copies are previewed until Accept (one undo step) or Cancel
// (nothing changed).
import { create } from 'zustand'
import { mirrorAbout, type SketchEditResult } from '../core/sketchEdits'
import type { MirrorAxisChoice } from '../core/mirrorAxes'
import { useReverse } from './reStore'

interface SketchMirrorState {
  open: boolean
  ids: number[]
  axis: MirrorAxisChoice | null
  preview: SketchEditResult | null
  message: string | null
  start: (ids: readonly number[]) => void
  pick: (axis: MirrorAxisChoice) => void
  accept: () => boolean
  cancel: () => void
}

export const useSketchMirror = create<SketchMirrorState>()((set, get) => ({
  open: false, ids: [], axis: null, preview: null, message: null,
  start: (ids) => {
    if (!ids.length) { set({ open: false }); return }
    set({ open: true, ids: [...ids], axis: null, preview: null, message: 'Click a line, a construction line, a sketch axis or a plane trace to mirror about.' })
  },
  pick: (axis) => {
    const draft = useReverse.getState().sketchDraft
    if (!draft) return
    const preview = mirrorAbout(draft.sketch, get().ids, axis)
    set({ axis, preview, message: preview.ok ? `Preview about ${axis.label}. Accept to add the copies.` : preview.error })
  },
  accept: () => {
    const s = get(), draft = useReverse.getState().sketchDraft
    if (!draft || !s.axis) { set({ message: 'Pick the mirror line first.' }); return false }
    // Rebuild from the sketch as it is now: the preview is never applied stale.
    const result = mirrorAbout(draft.sketch, s.ids, s.axis)
    if (!result.ok) { set({ message: result.error, preview: result }); return false }
    useReverse.getState().setSketch(result.sketch)
    useReverse.setState(st => st.sketchDraft ? { sketchDraft: { ...st.sketchDraft, selection: result.ids, tool: 'select', error: null } } : {})
    set({ open: false, ids: [], axis: null, preview: null, message: null })
    return true
  },
  cancel: () => set({ open: false, ids: [], axis: null, preview: null, message: null }),
}))
