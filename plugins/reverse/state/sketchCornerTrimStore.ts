// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import type { Vec2 } from '../../../src/core/flat/types'
import { piecesInBox } from '../core/boxSelect'
import { buildCornerTrim, cornerEndsNearPath, pointsInCornerArea, sweepCornerTrim, type CornerTrimMode, type CornerTrimResult } from '../core/sketchCornerTrim'
import { pathDistance } from '../core/cornerGesture'
import { arcMiddle, filletScanFit, type FilletScanFit } from '../core/filletFit'
import { anchorPoint, entityOf, type Anchor, type Sketch } from '../core/sketch'
import { useReverse } from './reStore'
import { useSketchAnalysis } from './sketchAnalysisStore'

type Built = Extract<CornerTrimResult, { ok: true }>
/** The last fillet the brush made, kept so its radius can be changed while
 *  it is still the latest edit: `base` is the sketch with the corner joined
 *  sharp, from which the fillet is rebuilt exactly at any radius (never
 *  driven through the solver, which would refit brushed pieces to their
 *  scan points). `madeKey` is the sketch the fillet left: any other edit
 *  ends the radius editing. */
export interface LastFillet {
  base: Sketch
  ids: [number, number]
  ends: Anchor[]
  arcId: number
  radiusMm: number
  corner: [number, number]
  middle: [number, number]
  addDimension: boolean
  profile?: [number, number][]
  madeKey: string
  /** What the panel says about this radius (restored with it by Undo/Redo). */
  fit?: LastFit
}
type LastFit = { radiusMm?: number; rms?: number; usedPoints?: number; shape?: 'sharp' | 'arc'; unswept?: boolean; scanFit?: FilletScanFit }

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
  /** The last fillet made: its radius and, for Auto Fillet, the scan fit. */
  lastFit: LastFit | null
  /** The fillet whose radius the panel field and the arc's handle edit. */
  lastFillet: LastFillet | null
  /** Every radius the last fillet has had: Undo or Redo back to one of
   *  them makes it the fillet the field and the handle edit again. */
  trail: LastFillet[]
  /** The fillet rebuilt at the radius the handle is dragged to. */
  radiusPreview: { radiusMm: number; result: Built; scanFit: FilletScanFit | null } | null
  /** A swept result the scan supports only weakly: shown, applied only on
   *  Accept. `sourceKey` is the sketch it was built on. */
  pending: { result: Extract<CornerTrimResult, { ok: true }>; sourceKey: string; source?: Sketch; ends?: Anchor[] } | null
  setOpen: (open: boolean) => void
  setMode: (mode: CornerTrimMode) => void
  setRadiusMm: (radiusMm: number) => void
  setAddDimension: (on: boolean) => void
  previewSelected: (points?: readonly Vec2[]) => void
  selectArea: (corners: readonly Vec2[], points: readonly Vec2[]) => void
  paint: (path: readonly Vec2[], radius: number, points: readonly Vec2[]) => boolean
  /** Release of a swept area (path[0] is where the button went down). */
  sweep: (path: readonly Vec2[], radius: number, points: readonly Vec2[], chains?: readonly (readonly Vec2[])[]) => boolean
  acceptPending: () => boolean
  discardPending: () => void
  apply: () => boolean
  cancel: () => void
  undo: () => void
  /** Rebuilds the last fillet at `radiusMm` for the handle's preview (null
   *  clears it). Nothing in the sketch changes. */
  previewFilletRadius: (radiusMm: number | null) => boolean
  /** Rebuilds the last fillet at `radiusMm` and puts it in as one undo step. */
  setFilletRadius: (radiusMm: number) => boolean
}

/** The fillet a result made, and what its radius editing needs. */
function filletOf(result: Built, source: Sketch, ends: readonly Anchor[] | undefined, addDimension: boolean): LastFillet | null {
  if (result.shape === 'sharp' || result.unswept || result.radiusMm === undefined || !ends || ends.length !== 2) return null
  const arcId = result.changedIds[2]
  const arc = arcId === undefined ? undefined : entityOf(result.sketch, arcId)
  if (arc?.kind !== 'arc') return null
  const ids = [result.changedIds[0], result.changedIds[1]] as [number, number]
  const base = result.joined ?? source
  const first = entityOf(base, ids[0]), at = ends.find((e) => e.entity === ids[0])?.at
  if (!first || (at !== 'a' && at !== 'b')) return null
  const corner = anchorPoint(first, at)
  const middle = arcMiddle(arc)
  return {
    base, ids, ends: ends.map((e) => ({ ...e })), arcId, radiusMm: result.radiusMm, corner: [corner[0], corner[1]], middle: [middle[0], middle[1]], addDimension,
    ...(result.profile?.length ? { profile: result.profile.map((p): [number, number] => [p[0], p[1]]) } : {}),
    madeKey: JSON.stringify(result.sketch),
  }
}

/** The scan points a fillet was read from, against the finished corner. */
function scanFitOf(result: Built, profile: readonly (readonly [number, number])[] | undefined): FilletScanFit | null {
  if (!profile?.length) return null
  return filletScanFit(result.sketch, result.changedIds, profile as [number, number][], useSketchAnalysis.getState().toleranceMm)
}

/** Applies a built corner to the sketch. A fillet between separate lines
 *  is two undo steps, as in QUICKSURFACE: the sharp join, then the fillet.
 *  A corner built exactly on its pieces' carriers is put in as it is, like
 *  a brushed fit: a pulled solve would refit the fitted pieces to their
 *  slice points and move the carriers the corner was built on. */
function applyCorner(result: Extract<CornerTrimResult, { ok: true }>) {
  const put = (sketch: typeof result.sketch) => result.exact ? useReverse.getState().setSketch(sketch, undefined, true) : useReverse.getState().setSketch(sketch, result.farAnchors)
  if (result.joined) put(result.joined)
  put(result.sketch)
}

export const useSketchCornerTrim = create<SketchCornerTrimState>()((set, get) => {
  const preview = () => {
    const s = get(), draft = useReverse.getState().sketchDraft
    if (!draft) { set({ preview: null, sourceKey: null, message: 'Open a sketch first.' }); return }
    const result = buildCornerTrim(draft.sketch, s.ids, s, s.points)
    set({ preview: result, sourceKey: JSON.stringify(draft.sketch), message: result.ok ? null : result.error })
  }
  const commit = (result: Extract<CornerTrimResult, { ok: true }>, source?: Sketch, ends?: readonly Anchor[]) => {
    applyCorner(result)
    const s = get()
    const fillet = source ? filletOf(result, source, ends, s.addDimension) : null
    const scanFit = scanFitOf(result, result.profile as [number, number][] | undefined)
    // The fillet is always an arc, as in QUICKSURFACE. When the scan's round
    // is not circular, the best arc is said to miss the tolerance rather
    // than being left to look right.
    const what = result.unswept ? 'Lines joined: the corner point was outside the painted area. Paint over the corner point to fillet it.'
      : result.shape === 'sharp' ? 'The scan corner is sharp: lines joined.'
      : s.mode === 'trim' ? 'Corner joined.'
      : scanFit?.exceeds ? 'Fillet created, but the scan round is not circular: the arc is off the scan by more than the tolerance. Undo and use Fit Curve for a free-form blend, or change the radius.'
      : 'Fillet created.'
    const lastFit: LastFit | null = result.radiusMm !== undefined || result.shape || result.unswept ? { radiusMm: result.radiusMm, rms: result.rms, usedPoints: result.usedPoints, shape: result.shape, ...(result.unswept ? { unswept: true } : {}), ...(scanFit ? { scanFit } : {}) } : null
    const made = useReverse.getState().sketchDraft?.sketch
    const entry = fillet ? { ...fillet, ...(made ? { madeKey: JSON.stringify(made) } : {}), ...(lastFit ? { fit: lastFit } : {}) } : null
    set({
      lastFit,
      lastFillet: entry, trail: entry ? [entry] : [], radiusPreview: null,
      message: scanFit?.exceeds ? what : `${what} Sweep another corner.`,
    })
    return true
  }
  /** The last fillet, if it is still the latest edit of the open sketch. */
  const liveFillet = (): LastFillet | null => {
    const f = get().lastFillet, draft = useReverse.getState().sketchDraft
    if (!f || !draft) return null
    if (JSON.stringify(draft.sketch) !== f.madeKey) { set({ lastFillet: null, radiusPreview: null }); return null }
    return f
  }
  const rebuild = (f: LastFillet, radiusMm: number): Built | string => {
    if (!(radiusMm > 0) || !Number.isFinite(radiusMm)) return 'Enter a finite radius above zero.'
    const result = buildCornerTrim(f.base, f.ids, { mode: 'fixedFillet', radiusMm, addDimension: f.addDimension }, [], f.ends)
    if (!result.ok) return result.error
    const arc = entityOf(result.sketch, f.arcId)
    return arc?.kind === 'arc' ? result : 'That radius does not fit on these pieces. Enter a smaller radius.'
  }
  // Undo or Redo onto a radius this fillet had makes that radius the one
  // the field and the handle edit, with its own fit text; stepping off the
  // fillet altogether (before it was made) clears what was said about it.
  useReverse.subscribe((r, prev) => {
    const sketch = r.sketchDraft?.sketch
    if (sketch === prev.sketchDraft?.sketch) return
    const s = get()
    if (!s.open || !s.trail.length) return
    const key = sketch ? JSON.stringify(sketch) : null
    if (s.lastFillet && s.lastFillet.madeKey === key) return
    const entry = key === null ? undefined : [...s.trail].reverse().find((e) => e.madeKey === key)
    if (entry) set({ lastFillet: entry, lastFit: entry.fit ?? null, radiusPreview: null, message: 'Radius restored. Undo and Redo step through this fillet’s radii; type or drag to change it.' })
    else if (s.lastFillet) set({ lastFillet: null, radiusPreview: null, lastFit: null, message: null })
  })
  return {
    open: false, mode: 'trim', radiusMm: 1, addDimension: false, preview: null, message: null, ids: [], points: [], sourceKey: null, lastFit: null, pending: null, lastFillet: null, trail: [], radiusPreview: null,
    setOpen: (open) => {
      if (open) useReverse.getState().setSketchTool('select')
      set({ open, preview: null, message: null, ids: [], points: [], sourceKey: null, lastFit: null, pending: null, lastFillet: null, trail: [], radiusPreview: null })
    },
    setMode: (mode) => { set({ mode, pending: null }); if (get().ids.length) preview() },
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
      applyCorner(result)
      set({
        lastFit: result.radiusMm !== undefined ? { radiusMm: result.radiusMm, rms: result.rms, usedPoints: result.usedPoints } : null,
        message: s.mode === 'trim' ? 'Corner joined. Paint another pair of ends.' : 'Fillet created. Paint another pair of ends.',
      })
      return true
    },
    sweep: (path, radius, points, chains) => {
      const s = get(), draft = useReverse.getState().sketchDraft
      if (!s.open || !draft) return false
      set({ preview: null, ids: [], points: [], sourceKey: null, pending: null, radiusPreview: null })
      const source = draft.sketch
      const { result, pair } = sweepCornerTrim(source, { path: [...path], radius }, s, points, s.mode === 'autoFillet' ? chains : undefined)
      if (!result.ok) { set({ message: result.error }); return false }
      const ends = pair?.ends.map((e): Anchor => ({ entity: e.entity, at: e.at }))
      if (result.confirm) {
        set({ pending: { result, sourceKey: JSON.stringify(source), source, ...(ends ? { ends } : {}) }, message: result.confirm })
        return false
      }
      return commit(result, source, ends)
    },
    acceptPending: () => {
      const s = get(), draft = useReverse.getState().sketchDraft
      if (!s.pending || !draft) return false
      if (JSON.stringify(draft.sketch) !== s.pending.sourceKey) { set({ pending: null, message: 'The sketch changed. Sweep the corner again.' }); return false }
      const { result, source, ends } = s.pending
      set({ pending: null })
      return commit(result, source, ends)
    },
    discardPending: () => set({ pending: null, message: 'Nothing was changed. Sweep another corner.' }),
    apply: () => {
      const s = get(), draft = useReverse.getState().sketchDraft
      if (!draft || !s.preview?.ok) { set({ message: 'Preview a valid corner before applying.' }); return false }
      if (JSON.stringify(draft.sketch) !== s.sourceKey) { set({ preview: null, message: 'The sketch changed. Select the corner again to update its preview.' }); return false }
      // Rebuild once at Apply, using exactly the points and settings shown.
      const result = buildCornerTrim(draft.sketch, s.ids, s, s.points)
      if (!result.ok) { set({ preview: result, message: result.error }); return false }
      applyCorner(result)
      set({ preview: null, ids: [], points: [], sourceKey: null, message: s.mode === 'trim' ? 'Corner trimmed. Shift-drag another corner, or Undo.' : 'Fillet created. Shift-drag another corner, or Undo.' })
      return true
    },
    cancel: () => set({ open: false, preview: null, ids: [], points: [], sourceKey: null, message: null, pending: null, lastFillet: null, trail: [], radiusPreview: null }),
    undo: () => {
      useReverse.getState().undoSketch()
      // Back to an earlier radius of the fillet: the sketch watch has made it
      // editable again and said so.
      set({ preview: null, ids: [], points: [], sourceKey: null, radiusPreview: null, ...(get().lastFillet ? {} : { message: 'Undid the last sketch edit.' }) })
    },
    previewFilletRadius: (radiusMm) => {
      if (radiusMm === null) { if (get().radiusPreview) set({ radiusPreview: null }); return false }
      const f = liveFillet()
      if (!f) return false
      const result = rebuild(f, radiusMm)
      if (typeof result === 'string') { set({ radiusPreview: null, message: result }); return false }
      set({ radiusPreview: { radiusMm, result, scanFit: scanFitOf(result, f.profile) }, message: null })
      return true
    },
    setFilletRadius: (radiusMm) => {
      const f = liveFillet()
      if (!f) { set({ radiusPreview: null, message: 'Sweep a corner to make a fillet first; its radius can be changed while it is the latest edit.' }); return false }
      if (Math.abs(radiusMm - f.radiusMm) <= 1e-12) { set({ radiusPreview: null }); return false }
      const result = rebuild(f, radiusMm)
      if (typeof result === 'string') { set({ radiusPreview: null, message: result }); return false }
      // The base is already joined: one undo step, the new fillet.
      applyCorner({ ...result, joined: undefined })
      const made = useReverse.getState().sketchDraft?.sketch
      const arc = made && entityOf(made, f.arcId)
      const scanFit = scanFitOf(result, f.profile)
      // The radius is now the user's, not the scan fit's: its RMS is dropped,
      // and the scan is read against the new corner instead.
      const lastFit: LastFit = { radiusMm, shape: 'arc' as const, ...(scanFit ? { scanFit } : {}) }
      const entry = made && arc?.kind === 'arc' ? { ...f, radiusMm, middle: arcMiddle(arc) as [number, number], madeKey: JSON.stringify(made), fit: lastFit } : null
      set({
        radiusPreview: null,
        lastFillet: entry, trail: entry ? [...get().trail, entry] : [],
        lastFit,
        message: scanFit?.exceeds ? 'Radius changed. The arc is off the scan by more than the tolerance.' : 'Radius changed. Undo restores the previous radius.',
      })
      return true
    },
  }
})
