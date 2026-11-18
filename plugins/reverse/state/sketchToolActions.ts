// SPDX-License-Identifier: AGPL-3.0-only
import { useReverse, type SketchTool } from './reStore'
import { useSketchBrush } from './sketchBrushStore'
import { useSketchCornerTrim } from './sketchCornerTrimStore'
import { useSketchProject } from './sketchProjectStore'
import { useSketchPresentation, type ExtraSketchTool, type SketchEditPanel } from './sketchPresentation'
import { mirrorSketchSelection } from './sketchExtraTools'
import { useSketchMirror } from './sketchMirrorStore'
import { useSketchPattern } from './sketchPatternStore'

/** Buttons and shortcuts leave the same provisional tools before the next
 * command takes the pointer. None of these cancellations changes geometry. */
export function closeSketchToolOverlays(): void {
  useSketchPresentation.getState().setTool(null)
  useSketchBrush.getState().setOpen(false)
  useSketchCornerTrim.getState().cancel()
  useSketchProject.getState().cancel()
  useSketchMirror.getState().cancel()
  useSketchPattern.getState().cancel()
}

export function activateSketchTool(tool: SketchTool): void {
  closeSketchToolOverlays()
  useReverse.getState().setSketchTool(tool)
}

export function activateExtraSketchTool(tool: ExtraSketchTool): void {
  activateSketchTool('select')
  useSketchPresentation.getState().setTool(tool)
}

export function dimensionSketchSelection(): void {
  closeSketchToolOverlays()
  const re = useReverse.getState()
  if (re.sketchDraft?.selection.length) re.dimensionSelection()
  else re.setSketchTool('dimension')
}

/** With exactly one construction line among the selection, mirror about it
 *  at once (the quick path); otherwise open Mirror mode to pick the axis. */
export function mirrorSelectedSketchEntities(): void {
  const draft = useReverse.getState().sketchDraft
  if (!draft?.selection.length) return
  const chosen = new Set(draft.selection)
  const axes = draft.sketch.entities.filter((e) => chosen.has(e.id) && e.kind === 'line' && e.construction)
  closeSketchToolOverlays()
  if (axes.length === 1 && draft.selection.length > 1) { mirrorSketchSelection(); return }
  activateSketchTool('select')
  useSketchMirror.getState().start(draft.selection)
}

/** Duplicate / Pattern: the selected pieces copied in one of four modes,
 *  previewed until Accept. */
export function openSketchPatternPanel(): void {
  const draft = useReverse.getState().sketchDraft
  if (!draft?.selection.length) return
  const ids = [...draft.selection]
  closeSketchToolOverlays()
  activateSketchTool('select')
  useSketchPresentation.getState().setEdit(null)
  useSketchPattern.getState().start(ids)
}

export function openSketchEditPanel(edit: SketchEditPanel): void {
  if (edit && !useReverse.getState().sketchDraft?.selection.length) return
  activateSketchTool('select')
  useSketchPresentation.getState().setEdit(edit)
}
