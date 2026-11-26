// SPDX-License-Identifier: AGPL-3.0-only
// What an edit of the sketch must not do to what was already drawn. The
// solver meets a relation or a dimension that contradicts the others by
// shrinking a piece to a point (Horizontal on a vertical side, Collinear on
// two sides of a rectangle, an angle a rectangle cannot take), and a
// Coincident joined a Fixed piece's end by moving it. Each was reported as
// solved. A fillet, chamfer or sharp corner made from the selection solved
// the whole sketch afterwards, so a length dimension turned the lines off
// the carriers they were drawn on. Such an edit is now refused and the
// sketch left as it was, with the reason, as Corner Trim already does.

import type { Sketch, SketchEntity } from '../core/sketch'

const MOVED = 1e-7

const lengthOf = (e: SketchEntity): number | null =>
  e.kind === 'line' ? Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) : e.kind === 'circle' || e.kind === 'arc' ? e.r : null

const label = (e: SketchEntity) => `${e.kind} ${e.id}`

/** The numbers that place a piece, in one flat list. */
function placement(e: SketchEntity): number[] {
  switch (e.kind) {
    case 'line': return [...e.a, ...e.b]
    case 'circle': return [...e.c, e.r]
    case 'arc': return [...e.c, e.r, e.start, e.sweep]
    case 'point': return [...e.p]
    case 'spline': return e.pts.flat()
  }
}

function moved(a: SketchEntity, b: SketchEntity, tolerance = MOVED): boolean {
  const p = placement(a), q = placement(b)
  return p.length !== q.length || p.some((v, i) => Math.abs(v - q[i]) > tolerance)
}

/** A line's carrier: its unit direction and its signed offset. */
function carrierMoved(a: SketchEntity, b: SketchEntity): boolean {
  if (a.kind === 'line' && b.kind === 'line') {
    const la = Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1])
    if (!(la > 1e-9)) return false
    const n = [-(a.b[1] - a.a[1]) / la, (a.b[0] - a.a[0]) / la]
    const off = (p: readonly number[]) => (p[0] - a.a[0]) * n[0] + (p[1] - a.a[1]) * n[1]
    return Math.abs(off(b.a)) > 1e-6 || Math.abs(off(b.b)) > 1e-6
  }
  if ((a.kind === 'arc' || a.kind === 'circle') && (b.kind === 'arc' || b.kind === 'circle')) return Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) > 1e-6 || Math.abs(a.r - b.r) > 1e-6
  return false
}

/** Whether two pieces of one kind cover the same ground: a line on the
 *  same two ends (either way round), a circle on the same rim, an arc on
 *  the same rim between the same ends. */
function sameGround(a: SketchEntity, b: SketchEntity, tol: number): boolean {
  const at = (p: readonly number[], q: readonly number[]) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol
  if (a.kind === 'line' && b.kind === 'line') return (at(a.a, b.a) && at(a.b, b.b)) || (at(a.a, b.b) && at(a.b, b.a))
  if (a.kind === 'circle' && b.kind === 'circle') return at(a.c, b.c) && Math.abs(a.r - b.r) <= tol
  if (a.kind === 'arc' && b.kind === 'arc') {
    if (!at(a.c, b.c) || Math.abs(a.r - b.r) > tol) return false
    const end = (e: typeof a, t: number) => [e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)]
    const [a0, a1, b0, b1] = [end(a, a.start), end(a, a.start + a.sweep), end(b, b.start), end(b, b.start + b.sweep)]
    return at(a0, b0) && at(a1, b1) && Math.abs(a.sweep - b.sweep) <= 1e-6
  }
  return false
}

/** Two pieces the edit laid one on the other, which were apart before. The
 *  solver meets a mirror or a relation the sketch cannot take that way —
 *  Symmetric about a plane's line with one of the pair held level on it
 *  folded the other line back onto it and called it solved. */
function laidOnEachOther(before: Sketch, now: Map<number, SketchEntity>): [SketchEntity, SketchEntity] | null {
  const pieces = before.entities.filter((e) => e.kind === 'line' || e.kind === 'circle' || e.kind === 'arc')
  if (pieces.length < 2 || pieces.length > 400) return null
  let span = 1
  for (const e of pieces) for (const v of placement(e)) span = Math.max(span, Math.abs(v))
  const tol = 1e-6 * span
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i], b = pieces[j]
      if (a.kind !== b.kind || sameGround(a, b, tol)) continue
      const a1 = now.get(a.id), b1 = now.get(b.id)
      if (a1 && b1 && sameGround(a1, b1, tol)) return [a, b]
    }
  }
  return null
}

/** Linear-time checks suitable for every drag frame. Small pieces that
 * were explicitly dimensioned at their new size are intentional. */
export function pieceDamage(before: Sketch, after: Sketch, carriers = false, held?: ReadonlySet<number>): string | null {
  const now = new Map(after.entities.map((e) => [e.id, e]))
  const axisHeld = held && new Set(before.constraints.flatMap(c => c.kind === 'horizontal' || c.kind === 'vertical' ? [c.entity] : []))
  for (const e of before.entities) {
    const f = now.get(e.id)
    if (!f) continue
    // A cursor can jump across the zero-length frame between two samples.
    // An axis-constrained side cannot reverse without passing through it.
    if (axisHeld?.has(e.id) && e.kind === 'line' && f.kind === 'line' &&
        (e.b[0]-e.a[0])*(f.b[0]-f.a[0]) + (e.b[1]-e.a[1])*(f.b[1]-f.a[1]) < 0) {
      return `it would reverse the endpoints of constrained line ${e.id}.`
    }
    if (e.fixed && f.fixed && moved(e, f)) return `it would move the fixed ${label(e)}.`
    if (held?.has(e.id) && moved(e, f, 1e-6)) return `it would move the fully constrained ${label(e)}.`
    const l0 = lengthOf(e), l1 = lengthOf(f)
    if (l0 !== null && l1 !== null && l0 >= 1e-3 && l1 < Math.min(0.05, l0 * 0.01)) {
      const sized = after.constraints.some(c => (c.kind === 'length' || c.kind === 'radius' || c.kind === 'diameter') &&
        !c.driven && c.entity === e.id && c.value > 0 && Math.abs((c.kind === 'diameter' ? c.value / 2 : c.value) - l1) <= 1e-6)
      if (!sized) return `it would shrink ${label(e)} to a point.`
    }
    if (carriers && carrierMoved(e, f)) return `it would move ${label(e)} off where it lies; a dimension or relation on it holds it. Remove that first.`
  }
  return null
}

/** Complete edit checks include overlapping pairs and newly created pieces. */
export function editDamage(before: Sketch, after: Sketch, carriers = false, held?: ReadonlySet<number>): string | null {
  const damage = pieceDamage(before, after, carriers, held)
  if (damage) return damage
  const laid = laidOnEachOther(before, new Map(after.entities.map(e => [e.id, e])))
  if (laid) return `it would lay ${label(laid[0])} on top of ${label(laid[1])}.`
  const had = new Set(before.entities.map((e) => e.id))
  for (const e of after.entities) {
    const l = had.has(e.id) ? null : lengthOf(e)
    if (l !== null && !(l > 1e-6)) return `it would leave a ${e.kind} of no size; the corner has no room for it.`
  }
  return null
}
