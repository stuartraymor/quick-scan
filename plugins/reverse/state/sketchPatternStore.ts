// SPDX-License-Identifier: AGPL-3.0-only
// Duplicate / Pattern mode: the pieces are chosen first; the panel sets the
// mode and its numbers, references are picked on the sheet, the copies are
// previewed live, and Accept adds them as one undo step (Cancel or Esc
// changes nothing).
import { create } from 'zustand'
import { applyPattern, defaultPattern, selectionCentre, type PatternMode, type PatternSpec } from '../core/sketchPatterns'
import { entityOf, sketchBounds, type Sketch } from '../core/sketch'
import type { SketchEditResult } from '../core/sketchEdits'
import { useReverse } from './reStore'

/** What a click on the sheet picks while the panel waits for one. */
export type PatternPick = 'd1' | 'd2' | 'centre' | 'pivot' | 'curve' | null

type Preview = (SketchEditResult & { note?: string | null }) | null

interface SketchPatternState {
  open: boolean
  ids: number[]
  spec: PatternSpec
  picking: PatternPick
  preview: Preview
  message: string | null
  start: (ids: readonly number[], mode?: PatternMode) => void
  setMode: (mode: PatternMode) => void
  update: (spec: PatternSpec) => void
  arm: (pick: PatternPick) => void
  /** A piece picked on the sheet for what is armed; false when it cannot
   *  serve (the message says why). */
  pickPiece: (id: number) => boolean
  refresh: () => void
  accept: () => boolean
  cancel: () => void
}

const sizeOf = (sketch: Sketch, ids: readonly number[]): number => {
  const set = new Set(ids)
  const b = sketchBounds({ entities: sketch.entities.filter((e) => set.has(e.id)) })
  return b ? Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) : 10
}

const sketchNow = () => useReverse.getState().sketchDraft?.sketch ?? null

const prompts: Record<Exclude<PatternPick, null>, string> = {
  d1: 'Click a line on the sheet for Direction 1.',
  d2: 'Click a line on the sheet for Direction 2.',
  centre: 'Click a point, or a circle or arc for its centre.',
  pivot: 'Click a point, or a circle or arc for its centre.',
  curve: 'Click the guide curve on the sheet (a line, arc, circle or spline).',
}

export const useSketchPattern = create<SketchPatternState>()((set, get) => {
  const compute = (spec: PatternSpec, ids: readonly number[]): { preview: Preview; message: string | null } => {
    const sketch = sketchNow()
    if (!sketch) return { preview: null, message: null }
    const preview = applyPattern(sketch, ids, spec)
    return { preview, message: preview.ok ? (preview.note ?? null) : preview.error }
  }
  return {
    open: false, ids: [], spec: defaultPattern('linear', 10), picking: null, preview: null, message: null,
    start: (ids, mode = 'linear') => {
      const sketch = sketchNow()
      if (!sketch || !ids.length) { set({ open: false }); return }
      const spec = defaultPattern(mode, sizeOf(sketch, ids))
      set({ open: true, ids: [...ids], spec, picking: mode === 'alongCurve' ? 'curve' : null, ...compute(spec, ids) })
      if (mode === 'alongCurve') set({ message: prompts.curve })
    },
    setMode: (mode) => {
      const s = get(), sketch = sketchNow()
      if (s.spec.mode === mode || !sketch) return
      const spec = defaultPattern(mode, sizeOf(sketch, s.ids))
      // A spacing chosen already carries over between the linear modes.
      if (mode === 'alongCurve' && s.spec.mode === 'linear') (spec as Extract<PatternSpec, { mode: 'alongCurve' }>).spacing = s.spec.d1.spacing
      const picking = mode === 'alongCurve' ? 'curve' : null
      set({ spec, picking, ...compute(spec, s.ids) })
      if (picking) set({ message: prompts.curve })
    },
    update: (spec) => set({ spec, ...compute(spec, get().ids) }),
    arm: (picking) => set({ picking, message: picking ? prompts[picking] : compute(get().spec, get().ids).message }),
    pickPiece: (id) => {
      const s = get(), sketch = sketchNow(), e = sketch ? entityOf(sketch, id) : undefined
      if (!s.picking || !sketch || !e) return false
      const say = (message: string) => { set({ message }); return false }
      const spec = s.spec
      if (s.picking === 'd1' || s.picking === 'd2') {
        if (e.kind !== 'line' || spec.mode !== 'linear') return say('A direction is taken from a line: click a line or construction line.')
        const key = s.picking
        const next: PatternSpec = { ...spec, [key]: { ...spec[key], ref: { kind: 'line', id }, on: true } }
        set({ spec: next, picking: null, ...compute(next, s.ids) })
        return true
      }
      if (s.picking === 'centre' || s.picking === 'pivot') {
        const ref = e.kind === 'point' ? { kind: 'point' as const, id } : e.kind === 'circle' || e.kind === 'arc' ? { kind: 'circle' as const, id } : null
        if (!ref) return say('A centre is a point, or the centre of a circle or arc.')
        let next: PatternSpec
        if (spec.mode === 'circular') next = { ...spec, centreRef: ref }
        else if (spec.mode === 'angular') next = { ...spec, pivotRef: ref }
        else return false
        set({ spec: next, picking: null, ...compute(next, s.ids) })
        return true
      }
      if (spec.mode !== 'alongCurve') return false
      if (e.kind === 'point') return say('A point is not a curve: click a line, arc, circle or spline.')
      if (s.ids.includes(id)) return say('That piece is one of those being copied. Click another curve.')
      const next: PatternSpec = { ...spec, curve: id }
      set({ spec: next, picking: null, ...compute(next, s.ids) })
      return true
    },
    refresh: () => { const s = get(); if (s.open) set(compute(s.spec, s.ids)) },
    accept: () => {
      const s = get(), draft = useReverse.getState().sketchDraft
      if (!draft) return false
      // Rebuilt from the sketch as it is now: a stale preview is never applied.
      const result = applyPattern(draft.sketch, s.ids, s.spec)
      if (!result.ok) { set({ message: result.error, preview: result }); return false }
      useReverse.getState().setSketch(result.sketch)
      useReverse.setState((st) => (st.sketchDraft ? { sketchDraft: { ...st.sketchDraft, selection: result.ids, tool: 'select', error: null } } : {}))
      set({ open: false, ids: [], picking: null, preview: null, message: null })
      return true
    },
    cancel: () => set({ open: false, ids: [], picking: null, preview: null, message: null }),
  }
})

/** The selection's centre, for the panel's read-outs. */
export const patternSelectionCentre = (ids: readonly number[]) => { const s = sketchNow(); return s ? selectionCentre(s, ids) : null }
