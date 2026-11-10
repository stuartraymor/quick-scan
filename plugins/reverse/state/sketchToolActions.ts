// SPDX-License-Identifier: AGPL-3.0-only
import { useReverse, type SketchTool } from './reStore'
import { useSketchBrush } from './sketchBrushStore'
import { useSketchCornerTrim } from './sketchCornerTrimStore'
import { useSketchProject } from './sketchProjectStore'
import { useSketchPresentation, type ExtraSketchTool, type SketchEditPanel } from './sketchPresentation'
import { mirrorSketchSelection } from './sketchExtraTools'

/** Buttons and shortcuts leave the same provisional tools before the next
 * command takes the pointer. None of these cancellations changes geometry. */
export function closeSketchToolOverlays(): void {
  useSketchPresentation.getState().setTool(null)
  useSketchBrush.getState().setOpen(false)
  useSketchCornerTrim.getState().cancel()
  useSketchProject.getState().cancel()
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

export function mirrorSelectedSketchEntities(): void {
  if (!useReverse.getState().sketchDraft?.selection.length) return
  closeSketchToolOverlays()
  mirrorSketchSelection()
}

export function openSketchEditPanel(edit: SketchEditPanel): void {
  if (edit && !useReverse.getState().sketchDraft?.selection.length) return
  activateSketchTool('select')
  useSketchPresentation.getState().setEdit(edit)
}
