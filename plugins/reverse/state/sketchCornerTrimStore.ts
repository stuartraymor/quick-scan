// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import type { Vec2 } from '../../../src/core/flat/types'
import { piecesInBox } from '../core/boxSelect'
import { buildCornerTrim, cornerEndsNearPath, pointsInCornerArea, type CornerTrimMode, type CornerTrimResult } from '../core/sketchCornerTrim'
import { pathDistance } from '../core/cornerGesture'
import { useReverse } from './reStore'

interface SketchCornerTrimState {
  open: boolean
  mode: CornerTrimMode
  radiusMm: number
  addDimension: boolean
  preview: CornerTrimResult | null
  message: string | null
  ids: number[]
  points: Vec2[]
  sourceKey: string | null
  setOpen: (open: boolean) => void
  setMode: (mode: CornerTrimMode) => void
  setRadiusMm: (radiusMm: number) => void
  setAddDimension: (on: boolean) => void
  previewSelected: (points?: readonly Vec2[]) => void
  selectArea: (corners: readonly Vec2[], points: readonly Vec2[]) => void
  paint: (path: readonly Vec2[], radius: number, points: readonly Vec2[]) => boolean
  apply: () => boolean
  cancel: () => void
  undo: () => void
}

export const useSketchCornerTrim = create<SketchCornerTrimState>()((set, get) => {
  const preview = () => {
    const s = get(), draft = useReverse.getState().sketchDraft
    if (!draft) { set({ preview: null, sourceKey: null, message: 'Open a sketch first.' }); return }
    const result = buildCornerTrim(draft.sketch, s.ids, s, s.points)
    set({ preview: result, sourceKey: JSON.stringify(draft.sketch), message: result.ok ? null : result.error })
  }
  return {
    open: false, mode: 'trim', radiusMm: 1, addDimension: false, preview: null, message: null, ids: [], points: [], sourceKey: null,
    setOpen: (open) => {
      if (open) useReverse.getState().setSketchTool('select')
      set({ open, preview: null, message: null, ids: [], points: [], sourceKey: null })
    },
    setMode: (mode) => { set({ mode }); if (get().ids.length) preview() },
    setRadiusMm: (radiusMm) => { set({ radiusMm }); if (get().ids.length) preview() },
    setAddDimension: (addDimension) => { set({ addDimension }); if (get().ids.length) preview() },
    previewSelected: (points = []) => {
      const draft = useReverse.getState().sketchDraft
      set({ ids: [...(draft?.selection ?? [])], points: points.map((p): Vec2 => [...p]) })
      preview()
    },
    selectArea: (corners, points) => {
      const draft = useReverse.getState().sketchDraft
      if (!draft) return
      const ids = piecesInBox(draft.sketch, corners, true)
      set({ ids, points: pointsInCornerArea(points, corners) })
      preview()
    },
    paint: (path, radius, points) => {
      const s = get(), draft = useReverse.getState().sketchDraft
      if (!s.open || !draft) return false
      const ends = cornerEndsNearPath(draft.sketch, path, radius)
      const selectedPoints = points.filter((p) => pathDistance(p, path) <= radius)
      const result = buildCornerTrim(draft.sketch, ends.map((p) => p.entity), s, selectedPoints, ends)
      set({ preview: null, ids: [], points: [], sourceKey: null })
      if (!result.ok) { set({ message: result.error }); return false }
      if (JSON.stringify(result.sketch) === JSON.stringify(draft.sketch)) return false
      useReverse.getState().setSketch(result.sketch, result.farAnchors)
      set({ message: s.mode === 'trim' ? 'Corner trimmed. Paint another pair of endpoints.' : 'Fillet created. Paint another pair of endpoints.' })
      return true
    },
    apply: () => {
      const s = get(), draft = useReverse.getState().sketchDraft
      if (!draft || !s.preview?.ok) { set({ message: 'Preview a valid corner before applying.' }); return false }
      if (JSON.stringify(draft.sketch) !== s.sourceKey) { set({ preview: null, message: 'The sketch changed. Select the corner again to update its preview.' }); return false }
      // Rebuild once at Apply, using exactly the points and settings shown.
      const result = buildCornerTrim(draft.sketch, s.ids, s, s.points)
      if (!result.ok) { set({ preview: result, message: result.error }); return false }
      useReverse.getState().setSketch(result.sketch, result.farAnchors)
      set({ preview: null, ids: [], points: [], sourceKey: null, message: s.mode === 'trim' ? 'Corner trimmed. Shift-drag another corner, or Undo.' : 'Fillet created. Shift-drag another corner, or Undo.' })
      return true
    },
    cancel: () => set({ open: false, preview: null, ids: [], points: [], sourceKey: null, message: null }),
    undo: () => {
      useReverse.getState().undoSketch()
      set({ preview: null, ids: [], points: [], sourceKey: null, message: 'Undid the last sketch edit.' })
    },
  }
})
