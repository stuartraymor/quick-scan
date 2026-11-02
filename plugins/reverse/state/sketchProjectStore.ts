// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import { visibleSketchProjection, sketchWithVisibleProjection, type SketchProjectionPreview } from '../core/sketchProject'
import { useReverse } from './reStore'
import { useSketchBrush } from './sketchBrushStore'
import { useSketchPresentation } from './sketchPresentation'
interface SketchProjectState {
  open: boolean
  preview: SketchProjectionPreview | null
  message: string | null
  setOpen: (open: boolean) => void
  refresh: () => void
  apply: () => boolean
  cancel: () => void
}
const current = () => {
  const s = useReverse.getState(), d = s.sketchDraft
  return d ? visibleSketchProjection(s.features, d) : null
}
export const useSketchProject = create<SketchProjectState>()((set, get) => ({
  open: false, preview: null, message: null,
  setOpen: open => {
    if (!open) { set({ open: false, preview: null, message: null }); return }
    const s = useReverse.getState()
    if (!s.sketchDraft) { set({ open: false, preview: null, message: null }); return }
    useSketchPresentation.getState().setTool(null)
    useSketchBrush.getState().setOpen(false)
    s.setSketchTool('select'); s.clearSelection()
    set({ open: true, preview: current(), message: null })
  },
  refresh: () => { if (get().open) set({ preview: current(), message: null }) },
  cancel: () => set({ open: false, preview: null, message: null }),
  apply: () => {
    const s = useReverse.getState(), d = s.sketchDraft, shown = get().preview
    if (!get().open || !d) { set({ open: false, preview: null, message: null }); return false }
    const preview = current()!
    if (!shown || preview.fingerprint !== shown.fingerprint) {
      set({ preview, message: 'The visible sketches changed. Review the refreshed preview, then choose Create.' }); return false
    }
    const result = sketchWithVisibleProjection(d.sketch, preview)
    if (!result) {
      set({ preview, message: preview.issues.length ? 'Projection was not created. Resolve the listed issues or hide those sketches.' : preview.duplicates ? 'All visible sketch geometry is already projected.' : 'There are no other visible sketches to project.' }); return false
    }
    s.setSketch(result.sketch)
    useReverse.setState(state => state.sketchDraft ? { sketchDraft: { ...state.sketchDraft, selection: result.ids, error: null } } : {})
    set({ open: false, preview: null, message: null }); return true
  },
}))
