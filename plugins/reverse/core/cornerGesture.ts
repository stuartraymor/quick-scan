// SPDX-License-Identifier: AGPL-3.0-only
// Ctrl+drag corner gesture (QUICKSURFACE manual, "2D Sketch: Using Auto
// Fillet"): paint over a corner to join the pieces under the brush; paint
// over an already joined corner to fillet it with a radius fitted to the
// scan points under the brush. Manual-derived; not yet native-verified.
import type { Vec2 } from '../../../src/core/flat/types'
import { alreadyJoined } from './corners'
import { entityPolyline, type AnchorAt, type Sketch, type SketchLine } from './sketch'

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy
  const t = len > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** Distance from a point to a polyline (single point allowed). */
export function pathDistance(p: Vec2, path: readonly Vec2[]): number {
  if (path.length === 0) return Infinity
  if (path.length === 1) return Math.hypot(p[0] - path[0][0], p[1] - path[0][1])
  let best = Infinity
  for (let i = 1; i < path.length; i++) best = Math.min(best, segmentDistance(p, path[i - 1], path[i]))
  return best
}

/** Editable profile pieces whose outline passes within `radius` of the brush path. */
export function piecesNearPath(sketch: Sketch, path: readonly Vec2[], radius: number): number[] {
  if (!(radius > 0) || !Number.isFinite(radius)) return []
  const out: number[] = []
  for (const e of sketch.entities) {
    if (e.construction || e.fixed || e.projected) continue
    const outline = entityPolyline(e, 96)
    let hit = false
    for (let i = 0; i < outline.length && !hit; i++) {
      const a = outline[i], b = outline[Math.min(i + 1, outline.length - 1)]
      // Sample the outline segment against the brush path.
      for (const t of [0, 0.5, 1]) {
        const p: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        if (pathDistance(p, path) <= radius) { hit = true; break }
      }
    }
    if (hit) out.push(e.id)
  }
  return out
}

export type CornerGesture =
  | { kind: 'none'; reason: string }
  | { kind: 'join'; ids: number[] }
  | { kind: 'fillet'; ids: [number, number]; points: Vec2[] }

const NEAR_END: [AnchorAt, AnchorAt][] = [['a', 'a'], ['a', 'b'], ['b', 'a'], ['b', 'b']]

/** Decide what a Ctrl+drag means for the sketch as it stands. */
export function classifyCornerGesture(sketch: Sketch, path: readonly Vec2[], radius: number, scan: readonly Vec2[]): CornerGesture {
  const ids = piecesNearPath(sketch, path, radius)
  if (ids.length < 2) return { kind: 'none', reason: 'Ctrl-drag over a corner between two sketch pieces.' }
  const lines = ids.map((id) => sketch.entities.find((e) => e.id === id)).filter((e): e is SketchLine => e?.kind === 'line')
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const joined = NEAR_END.some(([p, q]) => alreadyJoined(sketch, { entity: lines[i].id, at: p }, { entity: lines[j].id, at: q }))
    if (!joined) continue
    const points = scan.filter((p) => pathDistance(p, path) <= radius)
    return { kind: 'fillet', ids: [lines[i].id, lines[j].id], points }
  }
  return { kind: 'join', ids }
}
