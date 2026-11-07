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

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

/** Exact distance between segment ab and segment cd. */
function segmentSegmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsCross(a, b, c, d)) return 0
  return Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b))
}

/** Exact distance from segment ab to a brush path (a single point allowed). */
function segmentPathDistance(a: Vec2, b: Vec2, path: readonly Vec2[]): number {
  if (path.length === 1) return segmentDistance(path[0], a, b)
  let best = Infinity
  for (let i = 1; i < path.length; i++) best = Math.min(best, segmentSegmentDistance(a, b, path[i - 1], path[i]))
  return best
}

/** Editable profile pieces whose outline passes within `radius` of the brush path. */
export function piecesNearPath(sketch: Sketch, path: readonly Vec2[], radius: number): number[] {
  if (!(radius > 0) || !Number.isFinite(radius) || path.length === 0) return []
  const out: number[] = []
  for (const e of sketch.entities) {
    if (e.construction || e.fixed || e.projected) continue
    // Exact segment-to-path distance: a brush crossing the middle of a long
    // line must take it (0.0.145 sampled only segment ends and midpoints).
    const outline = entityPolyline(e, 96)
    let hit = false
    if (outline.length === 1) hit = pathDistance(outline[0], path) <= radius
    for (let i = 1; i < outline.length && !hit; i++) hit = segmentPathDistance(outline[i - 1], outline[i], path) <= radius
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
