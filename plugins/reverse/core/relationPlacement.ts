// SPDX-License-Identifier: AGPL-3.0-only
// Where the lines go when a relation is added, as QUICKSURFACE 8.0.128 puts
// them (its own DXF exports before and after each relation, read 2026-11-10,
// analysis/sketch-modify-constraints-2026-11-10/constraints-observed):
//
// - Horizontal / Vertical: the line's second end stays; the first end moves
//   along one axis only, onto the second's height (or across).
// - Equal: each line keeps its direction and its midpoint; every length
//   becomes their mean.
// - Parallel / Perpendicular: each line turns about its midpoint, keeping its
//   length. The turn is shared in inverse proportion to length², the least
//   motion of the ends: a long line turns less than a short one (native:
//   -12.80° and -23.96° → -17.62° for lines 6.52 and 5.69 long).
//
// Fixed lines do not move; the others take the whole turn or change. The
// result is where the solver starts and what its pull holds; this module
// only reads the sketch it is given and returns new lines.
import type { Vec2 } from '../../../src/core/flat/types'
import type { SketchLine } from './sketch'

export type PlacedRelation = 'horizontal' | 'vertical' | 'parallel' | 'perpendicular' | 'equal'

const mid = (l: SketchLine): Vec2 => [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2]
const len = (l: SketchLine): number => Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1])
const angle = (l: SketchLine): number => Math.atan2(l.b[1] - l.a[1], l.b[0] - l.a[0])

/** The line about its midpoint at `theta`, `length` long. */
function lineAt(l: SketchLine, theta: number, length: number): SketchLine {
  const [mx, my] = mid(l)
  const hx = (Math.cos(theta) * length) / 2, hy = (Math.sin(theta) * length) / 2
  return { ...l, a: [mx - hx, my - hy], b: [mx + hx, my + hy] }
}

/** An angle brought into (-π, π]. */
function wrap(a: number): number {
  const t = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
  return t === -Math.PI ? Math.PI : t
}

/** The turn, in (-π/2, π/2], that brings direction `a` onto the undirected
 *  direction `b` (a line has no arrow). */
function undirectedTurn(a: number, b: number): number {
  let t = wrap(b - a)
  if (t > Math.PI / 2) t -= Math.PI
  if (t <= -Math.PI / 2) t += Math.PI
  return t
}

const finite = (l: SketchLine): boolean => [...l.a, ...l.b].every(Number.isFinite) && len(l) > 1e-12

/**
 * The lines as the relation puts them, keyed by id; lines that do not move
 * are left out. Null when nothing can be placed (a degenerate or non-finite
 * line, or everything fixed) — the caller then leaves the solver to it.
 */
export function placeForRelation(kind: PlacedRelation, lines: readonly SketchLine[]): Map<number, SketchLine> | null {
  const out = new Map<number, SketchLine>()
  if (lines.length === 0 || !lines.every(finite)) return null
  const free = lines.filter((l) => !l.fixed)
  if (free.length === 0) return null

  if (kind === 'horizontal' || kind === 'vertical') {
    for (const l of free) {
      const a: Vec2 = kind === 'horizontal' ? [l.a[0], l.b[1]] : [l.b[0], l.a[1]]
      if (Math.hypot(l.b[0] - a[0], l.b[1] - a[1]) <= 1e-12) continue // would collapse: leave to the solver
      out.set(l.id, { ...l, a })
    }
    return out
  }

  if (kind === 'equal') {
    if (lines.length < 2) return null
    const fixedLens = lines.filter((l) => l.fixed).map(len)
    // A fixed line's length is the one the others take; otherwise the mean.
    const target = fixedLens.length ? fixedLens[0] : lines.reduce((s, l) => s + len(l), 0) / lines.length
    if (!(target > 1e-12) || !Number.isFinite(target)) return null
    for (const l of free) out.set(l.id, lineAt(l, angle(l), target))
    return out
  }

  // Parallel and perpendicular, between the first line and each other one.
  if (lines.length < 2) return null
  const first = lines[0]
  const quarter = kind === 'perpendicular' ? Math.PI / 2 : 0
  // Each line's direction measured as the first's would be: the others
  // turned back by the quarter they should stand at.
  const aim = lines.map((l, i) => (i === 0 ? angle(first) : angle(first) + undirectedTurn(angle(first), angle(l) - quarter)))
  const fixed = lines.findIndex((l) => l.fixed)
  let common: number
  if (fixed >= 0) common = aim[fixed]
  else {
    // The least motion of the ends: each line's turn weighted by its length².
    const w = lines.map((l) => len(l) ** 2)
    const total = w.reduce((s, x) => s + x, 0)
    if (!(total > 0)) return null
    common = aim[0] + lines.reduce((s, _l, i) => s + w[i] * (aim[i] - aim[0]), 0) / total
  }
  lines.forEach((l, i) => {
    if (l.fixed) return
    const theta = angle(l) + (common - aim[i])
    if (Math.abs(common - aim[i]) > 1e-15) out.set(l.id, lineAt(l, theta, len(l)))
  })
  return out
}
