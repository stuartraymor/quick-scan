// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec2 } from '../../../src/core/flat/types'
import { classifyCornerGesture } from '../core/cornerGesture'
import { buildCornerTrim } from '../core/sketchCornerTrim'
import { useReverse } from './reStore'

/** Apply a Ctrl+drag over the sketch. Returns a short status message. */
export function applyCornerGesture(path: readonly Vec2[], radius: number, scan: readonly Vec2[]): string {
  const r = useReverse.getState(), d = r.sketchDraft
  if (!d) return 'Open a sketch first.'
  const g = classifyCornerGesture(d.sketch, path, radius, scan)
  if (g.kind === 'none') return g.reason
  if (g.kind === 'join') {
    useReverse.setState({ sketchDraft: { ...d, selection: g.ids, selectedConstraint: null, error: null } })
    r.joinSelected()
    return 'Corner joined.'
  }
  const result = buildCornerTrim(d.sketch, g.ids, { mode: 'autoFillet', radiusMm: 0, addDimension: true }, g.points)
  if (!result.ok) {
    useReverse.setState({ sketchDraft: { ...d, error: result.error } })
    return result.error
  }
  r.setSketch(result.sketch, result.farAnchors)
  return `Fillet fitted to ${result.usedPoints ?? 0} scan points (R ${result.radiusMm?.toFixed(3)} mm).`
}
