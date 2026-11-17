// SPDX-License-Identifier: AGPL-3.0-only
// The lines a Mirror can be picked about: any sketch line (construction or
// not), the sheet's own X and Y axes, and the traces of the part's
// coordinate planes. All are exact lines in sheet millimetres.
import type { Vec2 } from '../../../src/core/flat/types'
import type { Sketch } from './sketch'
import { datumName, type DatumTrace } from './datums'
import type { MirrorAxis } from './sketchEdits'

export interface MirrorAxisChoice extends MirrorAxis {
  /** What the panel calls it. */
  label: string
  /** The sketch line it is, when it is one. */
  entity?: number
  /** Infinite lines (sheet axes, plane traces) are hit anywhere along them. */
  infinite: boolean
}

function lineDistance(p: Vec2, a: Vec2, b: Vec2, infinite: boolean): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy
  if (!(l2 > 0)) return Math.hypot(p[0] - a[0], p[1] - a[1])
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2
  if (!infinite) t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

export function mirrorAxisChoices(sketch: Sketch, traces: readonly DatumTrace[], exclude: readonly number[] = []): MirrorAxisChoice[] {
  const skip = new Set(exclude), out: MirrorAxisChoice[] = []
  for (const e of sketch.entities) {
    if (e.kind !== 'line' || skip.has(e.id)) continue
    if (Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) < 1e-9) continue
    out.push({ a: e.a, b: e.b, entity: e.id, infinite: false, label: `${e.construction ? 'Construction line' : 'Line'} ${e.id}` })
  }
  out.push({ a: [0, 0], b: [1, 0], infinite: true, label: 'Sketch X axis' }, { a: [0, 0], b: [0, 1], infinite: true, label: 'Sketch Y axis' })
  for (const t of traces) {
    const foot: Vec2 = [-t.d * t.n[0], -t.d * t.n[1]]
    out.push({ a: foot, b: [foot[0] - t.n[1], foot[1] + t.n[0]], infinite: true, label: datumName(t.plane) })
  }
  return out
}

/** The pickable axis nearest `spot` within `reach`; sketch lines win a tie
 *  with an infinite axis they lie on. */
export function mirrorAxisNear(choices: readonly MirrorAxisChoice[], spot: Vec2, reach: number): MirrorAxisChoice | null {
  let best: MirrorAxisChoice | null = null, bestD = Infinity
  for (const c of choices) {
    const d = lineDistance(spot, c.a, c.b, c.infinite) + (c.infinite ? reach * 1e-3 : 0)
    if (d <= reach && d < bestD) { best = c; bestD = d }
  }
  return best
}
