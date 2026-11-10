// SPDX-License-Identifier: AGPL-3.0-only
import { fmtLen } from '../../../src/core/units'
import { usePrefs } from '../../../src/state/prefsStore'
import type { Vec2 } from '../../../src/core/flat/types'
import { classifyCornerGesture } from '../core/cornerGesture'
import { buildCornerTrim } from '../core/sketchCornerTrim'
import { chooseInstantFit, pointsUnderPath } from '../core/instantFit'
import { sketchWithBrushFit, type BrushFitOptions, type BrushPoint } from '../core/sketchBrush'
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
  return `Fillet fitted to ${result.usedPoints ?? 0} scan points (R ${fmtLen(result.radiusMm ?? 0, usePrefs.getState().units)}).`
}

/** Apply a Shift+drag Instant Fit: line or arc fitted to the scan points under the brush. */
export function applyInstantFit(path: readonly Vec2[], radius: number, scan: readonly BrushPoint[], options: BrushFitOptions): string {
  const r = useReverse.getState(), d = r.sketchDraft
  if (!d) return 'Open a sketch first.'
  const selected = pointsUnderPath(scan, path, radius)
  if (selected === null) return fail('Instant Fit takes at most 12,000 reference points. Brush a shorter section.')
  if (selected.length < 2) return 'No reference points under the brush.'
  const fit = chooseInstantFit(selected, options)
  const sketch = fit.ok ? sketchWithBrushFit(d.sketch, fit) : null
  if (!fit.ok || !sketch) return fail(fit.ok ? 'The primitive could not be fitted.' : fit.error)
  // As in Fit Primitives: append without refitting satisfied existing geometry.
  r.setSketch(sketch, undefined, true)
  return `Fitted ${fit.kind ?? 'primitive'} to ${selected.length} points (maximum deviation ${fmtLen(fit.maxDeviation, usePrefs.getState().units)}).`
}

function fail(error: string): string {
  const d = useReverse.getState().sketchDraft
  if (d) useReverse.setState({ sketchDraft: { ...d, error } })
  return error
}
