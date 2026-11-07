// SPDX-License-Identifier: AGPL-3.0-only
// Shift+drag Instant Fit in plain Edit Sketch. Observed in QUICKSURFACE 8.0.128
// (analysis/auto-join-gesture-study-2026-11-06.md): a brushed straight edge
// became a line snapped H/V; a brushed multi-segment corner became ONE arc
// spanning the stroke, not line+arc+line. Choose between the two the same way.
import type { Vec2 } from '../../../src/core/flat/types'
import { pathDistance } from './cornerGesture'
import { fitBrushPrimitive, type BrushFit, type BrushFitOptions, type BrushPoint } from './sketchBrush'

/** Reference points within `radius` of the brush path. */
export function pointsUnderPath(points: readonly BrushPoint[], path: readonly Vec2[], radius: number, cap = 12000): BrushPoint[] | null {
  if (!(radius > 0) || !Number.isFinite(radius) || path.length === 0) return []
  const out: BrushPoint[] = []
  for (const p of points) if (pathDistance(p.p, path) <= radius) { out.push(p); if (out.length > cap) return null }
  return out
}

/** Line unless an arc explains the points clearly better (half the line's maximum deviation or less). */
export function chooseInstantFit(selected: readonly BrushPoint[], options: BrushFitOptions): BrushFit & { kind?: 'line' | 'arc' } {
  const line = fitBrushPrimitive('line', selected, options)
  if (line.ok && line.maxDeviation <= options.tolerance) return { ...line, kind: 'line' }
  const arc = fitBrushPrimitive('arc', selected, options)
  if (arc.ok && (!line.ok || arc.maxDeviation <= 0.5 * line.maxDeviation)) return { ...arc, kind: 'arc' }
  return line.ok ? { ...line, kind: 'line' } : arc
}
