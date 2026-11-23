// SPDX-License-Identifier: AGPL-3.0-only
// Circles and arcs held about one centre: Concentric on the two pieces, or
// Coincident on their two centres — one relation reached two ways, as
// SolidWorks, Inventor and Onshape all treat it. What the sketch needs to
// know before adding one: whether the two already share a centre (so a
// second, redundant relation is not added), which piece stays where it is
// (the first picked, unless something holds the other), and, when the
// solver cannot meet it, why — so the relation is refused, not left unmet.

import type { Vec2 } from '../../../src/core/flat/types'
import { anchorPoint, entityOf, type Anchor, type ConstraintInput, type Sketch, type SketchEntity } from './sketch'
import type { Pull } from './solver'

/** Whether a piece has a centre a relation can hold: an arc, a circle, or a
 *  point piece (its one point). */
export function hasCentre(e: SketchEntity | undefined | null): e is Extract<SketchEntity, { kind: 'arc' | 'circle' | 'point' }> {
  return !!e && (e.kind === 'arc' || e.kind === 'circle' || e.kind === 'point')
}

const isRound = (e: SketchEntity | undefined | null) => !!e && (e.kind === 'arc' || e.kind === 'circle')

/** The point an anchor names on a round piece or a point piece is its
 *  centre only at 'center'; a quadrant is a rim point, not the centre. */
const centreAnchor = (sketch: Sketch, a: Anchor): number | null => {
  const e = entityOf(sketch, a.entity)
  return a.at === 'center' && hasCentre(e) ? e.id : null
}

/** Pieces whose centres the sketch already ties together, directly or
 *  through a chain of relations: concentric pairs and coincident centres. */
export function centreGroups(sketch: Sketch): Map<number, number> {
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    let r = x
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!
    return r
  }
  const join = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const c of sketch.constraints) {
    if (c.kind === 'concentric') join(c.a, c.b)
    else if (c.kind === 'coincident') {
      const p = centreAnchor(sketch, c.p)
      const q = centreAnchor(sketch, c.q)
      if (p !== null && q !== null) join(p, q)
    }
  }
  const out = new Map<number, number>()
  for (const e of sketch.entities) out.set(e.id, find(e.id))
  return out
}

/** Whether two pieces already share a centre by a relation — Concentric, or
 *  Coincident between their centres, or a chain of those. */
export function sharesCentre(sketch: Sketch, a: number, b: number): boolean {
  if (a === b) return false
  const g = centreGroups(sketch)
  return g.get(a) !== undefined && g.get(a) === g.get(b)
}

/** The relation Coincident makes of two round pieces picked whole: their
 *  centres meet — what Concentric does, reached through Coincident because
 *  a centre is what a circle is held by. Null when either is not round. */
export function centresCoincident(sketch: Sketch, a: number, b: number): ConstraintInput | null {
  const ea = entityOf(sketch, a)
  const eb = entityOf(sketch, b)
  if (!isRound(ea) || !isRound(eb)) return null
  return { kind: 'coincident', p: { entity: a, at: 'center' }, q: { entity: b, at: 'center' } }
}

/** The hand that keeps the first pick where it is while the relation is
 *  solved: its anchor pulled to where it stands, so the second pick comes
 *  to it — SolidWorks' and Inventor's rule, the first selection the
 *  reference. A pull is soft: a Fix, a dimension or another relation that
 *  holds the second pick still wins, and the first then goes to it. */
export function referencePull(sketch: Sketch, anchor: Anchor): Pull[] {
  const e = entityOf(sketch, anchor.entity)
  if (!e) return []
  const to: Vec2 = anchorPoint(e, anchor.at)
  return [{ anchor, to: [to[0], to[1]] }]
}

/** Why a relation just added could not be met, in a sentence: both pieces
 *  fixed, or held by the sketch's other relations and dimensions. */
export function whyUnmet(sketch: Sketch, ids: readonly number[], what: string): string {
  const pieces = ids.map((id) => entityOf(sketch, id)).filter((e): e is SketchEntity => Boolean(e))
  const name = (e: SketchEntity) => `${e.kind} ${e.id}`
  const held = pieces.filter((e) => e.fixed || e.projected)
  if (pieces.length > 1 && held.length === pieces.length) {
    return `${what} cannot be met: ${pieces.map(name).join(' and ')} are ${pieces.length === 2 ? 'both' : 'all'} fixed where they are. Unfix one of them first. Nothing was changed.`
  }
  return `${what} cannot be met: the sketch's other relations and dimensions hold ${pieces.map(name).join(' and ')} apart. Remove or change one of them first (Select overdefining constraints shows which). Nothing was changed.`
}

/** The round piece whose centre lies within reach of a click — how
 *  Concentric takes a circle clicked at its centre, where there is no rim. */
export function roundByCentre(sketch: Sketch, spot: Vec2, radius: number): SketchEntity | null {
  let best: SketchEntity | null = null
  let bestD = radius * 0.75
  for (const e of sketch.entities) {
    if (e.kind !== 'arc' && e.kind !== 'circle') continue
    const d = Math.hypot(e.c[0] - spot[0], e.c[1] - spot[1])
    if (d <= bestD) {
      bestD = d
      best = e
    }
  }
  return best
}
