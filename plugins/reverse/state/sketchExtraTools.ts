// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec2 } from '../../../src/core/flat/types'
import { duplicateSelected, middleLineSelected, mirrorSelected, offsetSelected, slotSketch, tangentArcSketch, trimAt, type SketchEditResult } from '../core/sketchEdits'
import { useReverse } from './reStore'

function apply(result: SketchEditResult): boolean {
  const store = useReverse.getState()
  if (!result.ok) {
    useReverse.setState(s => s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, error: result.error } } : {})
    return false
  }
  store.setSketch(result.sketch)
  useReverse.setState(s => s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, selection: result.ids, tool: 'select', error: null } } : {})
  return true
}
export function mirrorSketchSelection(): boolean {
  const d = useReverse.getState().sketchDraft
  return d ? apply(mirrorSelected(d.sketch, d.selection)) : false
}
export function duplicateSketchSelection(delta: Vec2 = [10, 0]): boolean {
  const d = useReverse.getState().sketchDraft
  return d ? apply(duplicateSelected(d.sketch, d.selection, delta)) : false
}
export function offsetSketchSelection(distance: number): boolean {
  const d = useReverse.getState().sketchDraft
  return d ? apply(offsetSelected(d.sketch, d.selection, distance)) : false
}
export function middleLineSketchSelection(): boolean {
  const d = useReverse.getState().sketchDraft
  return d ? apply(middleLineSelected(d.sketch, d.selection)) : false
}
export function trimSketchAt(id: number, point: Vec2): boolean {
  const d = useReverse.getState().sketchDraft
  return d ? apply(trimAt(d.sketch, id, point)) : false
}
export function addSketchSlot(from: Vec2, to: Vec2, width: number): boolean {
  const d = useReverse.getState().sketchDraft
  return d ? apply(slotSketch(d.sketch, from, to, width)) : false
}

export function addSketchTangentArc(lineId: number, at: 'a' | 'b', point: Vec2, end?: { entity: number; at: 'a' | 'b' }): boolean {
  const d = useReverse.getState().sketchDraft
  return d ? apply(tangentArcSketch(d.sketch, lineId, at, point, end)) : false
}
