// SPDX-License-Identifier: AGPL-3.0-only
// Moving the pieces of a sketch by hand: an end or a centre dragged to a
// new spot, a whole piece carried along, and the sketch turned so that an
// edge the scanner left crooked lies along the sheet. Pure geometry on one
// piece; the solver settles what the move does to the rest — but for a
// shape defined in all but its place, which the hand carries whole.

import type { Vec2 } from '../../../src/core/flat/types'
import { add2, sub2 } from '../../../src/core/flat/vec2'
import { addConstraint, addEntity, anchorPoint, anchorsOf, arcThrough, constraintEntities, entityOf, isQuadrant, quadrantsOf, splinePointIndex, type Anchor, type AnchorAt, type Constraint, type Sketch, type SketchArc, type SketchEntity } from './sketch'
import { solveSketch } from './solver'

const TWO_PI = 2 * Math.PI

/** Fraction of the counter-clockwise sweep at the picked through-point. */
export function arcGripFraction(arc: Pick<SketchArc, 'c' | 'start' | 'sweep'>, through: Vec2): number {
  const angle = Math.atan2(through[1] - arc.c[1], through[0] - arc.c[0])
  return (((angle - arc.start) % TWO_PI + TWO_PI) % TWO_PI) / arc.sweep
}

/** Three-point arc grips. Preserve the two untouched defining points;
 * solving toward just one endpoint otherwise moves the entire circle. */
export function reshapeArc(e: SketchArc, at: AnchorAt, p: Vec2): SketchArc {
  const a = at === 'a' ? p : anchorPoint(e, 'a')
  const b = at === 'b' ? p : anchorPoint(e, 'b')
  const through = at === 'p0' ? p : anchorPoint(e, 'p0')
  const fit = arcThrough(a, b, through)
  // Keep endpoint identity for existing relations. Crossing the chord to
  // reverse winding needs an explicit topology change, not silent swapping.
  if (!fit || !fit.startsAtP) return e
  const gripT = arcGripFraction(fit, through)
  return { ...e, c: fit.c, r: fit.r, start: fit.start, sweep: fit.sweep, gripT }
}

export function sketchGrips(e: SketchEntity, selected = false): { at: AnchorAt | 'body'; point: Vec2 }[] {
  if (e.kind === 'line') return [{at:'a',point:e.a},{at:'b',point:e.b},{at:'body',point:anchorPoint(e,'center')}]
  if (e.kind === 'arc') return (['a','b','p0','center'] as const).map(at=>({at,point:anchorPoint(e,at)}))
  if (e.kind === 'circle' && selected) return [{ at: 'center', point: e.c }, ...quadrantsOf(e)]
  return anchorsOf(e).map(at=>({at,point:anchorPoint(e,at)}))
}

/** Editable grips that represent the same sketch vertex. A fit on one of
 * its incident pieces is released when the operator drags that vertex.
 * Midpoints and quadrant points are derived locations on their carriers;
 * their relations are enforced by the solver. */
export function joinedGrips(sketch: Sketch, start: Anchor): Map<number, AnchorAt> {
  const grips = new Map<number, AnchorAt>([[start.entity, start.at]])
  const links = new Map<string, Anchor[]>()
  const key = (p: Anchor) => p.entity + ':' + p.at
  const link = (p: Anchor, q: Anchor) => {
    const k = key(p)
    const others = links.get(k)
    if (others) others.push(q)
    else links.set(k, [q])
  }
  for (const c of sketch.constraints) {
    if (c.kind !== 'coincident' && c.kind !== 'concentric') continue
    const p: Anchor = c.kind === 'coincident' ? c.p : { entity: c.a, at: 'center' }
    const q: Anchor = c.kind === 'coincident' ? c.q : { entity: c.b, at: 'center' }
    link(p, q)
    link(q, p)
  }
  const pieces = new Map(sketch.entities.map(e => [e.id, e]))
  const queue = [start]
  for (let i = 0; i < queue.length; i++) {
    for (const q of links.get(key(queue[i])) ?? []) {
      if (grips.has(q.entity)) continue
      const e = pieces.get(q.entity)
      if (!e || (q.at === 'center' && e.kind === 'line') || !sketchGrips(e).some(g => g.at === q.at)) continue
      grips.set(q.entity, q.at)
      queue.push(q)
    }
  }
  return grips
}

/** An angle brought into (0, 2π] — an arc's sweep, which is never nothing. */
function positiveSweep(a: number): number {
  const s = ((a % TWO_PI) + TWO_PI) % TWO_PI
  return s === 0 ? TWO_PI : s
}

/** The piece with its anchor moved to `p`: a line's end goes there, an
 *  arc's end swings round its centre to the angle of `p` — the radius
 *  stays, so the other end stays — and a centre carries the piece. */
export function moveAnchor(e: SketchEntity, at: AnchorAt, p: Vec2): SketchEntity {
  switch (e.kind) {
    case 'line':
      if (at === 'a') return { ...e, a: p }
      if (at === 'b') return { ...e, b: p }
      return translateEntity(e, sub2(p, [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]))
    case 'arc': {
      if (at === 'center') return translateEntity(e, sub2(p, e.c))
      const angle = Math.atan2(p[1] - e.c[1], p[0] - e.c[0])
      if (at === 'a') {
        const end = e.start + e.sweep
        return { ...e, start: angle, sweep: positiveSweep(end - angle) }
      }
      return { ...e, sweep: positiveSweep(angle - e.start) }
    }
    case 'circle': {
      if (!isQuadrant(at)) return translateEntity(e, sub2(p, e.c))
      const axis = at === 'q0' || at === 'q2' ? 0 : 1
      const sign = at === 'q0' || at === 'q1' ? 1 : -1
      const r = sign * (p[axis] - e.c[axis])
      return r > 1e-6 ? { ...e, r } : e
    }
    case 'spline': {
      // A fit point goes where the hand is, the curve bending through it.
      const i = splinePointIndex(e, at)
      if (i === null) return translateEntity(e, sub2(p, anchorPoint(e, at)))
      return { ...e, pts: e.pts.map((q, k) => (k === i ? p : q)) }
    }
    case 'point':
      return { ...e, p }
  }
}

/** The piece carried by `delta`, slice points and all. */
export function translateEntity(e: SketchEntity, delta: Vec2): SketchEntity {
  const points = 'points' in e && e.points ? e.points.map((q) => add2(q, delta)) : undefined
  switch (e.kind) {
    case 'line':
      return { ...e, a: add2(e.a, delta), b: add2(e.b, delta), ...(points ? { points } : {}) }
    case 'arc':
    case 'circle':
      return { ...e, c: add2(e.c, delta), ...(points ? { points } : {}) }
    case 'spline':
      return { ...e, pts: e.pts.map((q) => add2(q, delta)), ...(points ? { points } : {}) }
    case 'point':
      return { ...e, p: add2(e.p, delta) }
  }
}

/** The piece without its slice points: what a dragged fitted piece
 *  becomes, since a hand that moves it has overruled the scan. */
export function detached(e: SketchEntity): SketchEntity {
  if (!('points' in e)) return e
  const { points: _points, scatter: _scatter, ...rest } = e
  if ('pointWeights' in rest) delete rest.pointWeights
  return rest as SketchEntity
}

function rotate(p: Vec2, c: number, s: number): Vec2 {
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]
}

/** The piece turned by `angle` radians about the sheet origin. */
export function rotateEntity(e: SketchEntity, angle: number): SketchEntity {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const points = 'points' in e && e.points ? e.points.map((q) => rotate(q, c, s)) : undefined
  switch (e.kind) {
    case 'line':
      return { ...e, a: rotate(e.a, c, s), b: rotate(e.b, c, s), ...(points ? { points } : {}) }
    case 'arc':
      return { ...e, c: rotate(e.c, c, s), start: e.start + angle, ...(points ? { points } : {}) }
    case 'circle':
      return { ...e, c: rotate(e.c, c, s), ...(points ? { points } : {}) }
    case 'spline':
      return {
        ...e,
        pts: e.pts.map((q) => rotate(q, c, s)),
        ...(e.startDir !== undefined ? { startDir: e.startDir + angle } : {}),
        ...(e.endDir !== undefined ? { endDir: e.endDir + angle } : {}),
        ...(points ? { points } : {}),
      }
    case 'point':
      return { ...e, p: rotate(e.p, c, s) }
  }
}

/** Turn the whole sketch in place by `angle` about the sheet origin —
 *  what aligning the sheet to one of its lines does to the drawing, the
 *  frame turning the other way underneath. */
export function rotateSketch(sketch: Sketch, angle: number): void {
  sketch.entities = sketch.entities.map((e) => rotateEntity(e, angle))
}

/** Whether a relation or a dimension ties its piece to the sheet itself —
 *  a coordinate plane's line, an axis — rather than to another piece. */
function onSheet(c: Constraint): boolean {
  switch (c.kind) {
    case 'pointOn':
    case 'collinear':
      return 'datum' in c.on
    case 'symmetric':
      return typeof c.about === 'string' || 'datum' in c.about
    case 'distance':
      return 'datum' in c.q
    default:
      return false
  }
}

/** The pieces a drag carries along whole, or null when the solver is to
 *  share the move out. A shape its relations and dimensions leave nothing
 *  but its place on the sheet — a rectangle with its width and height, not
 *  yet put anywhere — can follow the hand only whole: every piece joined to
 *  the one in the hand, through relations and dimensions, is carried by the
 *  hand's move as it is, rather than eased after it by the solver a step
 *  behind. Not a shape held anywhere — a fixed, projected or fitted piece,
 *  a relation to a coordinate plane — nor one with a freedom left besides
 *  its place, which the drag is there to use. */
export function rigidCluster(sketch: Sketch, grab: { entity: number; at: AnchorAt | 'body' }): number[] | null {
  // The shape: what is joined to the piece in the hand.
  const shape = new Set([grab.entity])
  for (let grew = true; grew; ) {
    grew = false
    for (const c of sketch.constraints) {
      const ids = constraintEntities(c)
      if (!ids.some((i) => shape.has(i)) || ids.every((i) => shape.has(i))) continue
      for (const i of ids) shape.add(i)
      grew = true
    }
  }
  const pieces = sketch.entities.filter((e) => shape.has(e.id))
  if (pieces.some((e) => e.fixed || e.projected || ('points' in e && e.points && e.points.length > 0))) return null
  const own = sketch.constraints.filter((c) => constraintEntities(c).some((i) => shape.has(i)))
  if (own.some(onSheet)) return null
  // Defined but for its place: held where the hand has it — the end or the
  // centre at its spot, a piece where it lies — nothing of it is left loose.
  const probe: Sketch = { entities: pieces.map((e) => (e.id === grab.entity && grab.at === 'body' ? { ...e, fixed: true } : { ...e })), constraints: own.map((c) => ({ ...c })), nextId: sketch.nextId }
  if (grab.at !== 'body') {
    const e = entityOf(probe, grab.entity)
    if (!e) return null
    const pin = addEntity(probe, { kind: 'point', p: anchorPoint(e, grab.at), fixed: true })
    addConstraint(probe, { kind: 'coincident', p: { entity: grab.entity, at: grab.at }, q: { entity: pin, at: 'center' } })
  }
  const loose = new Set(solveSketch(probe).underConstrained)
  return pieces.some((e) => loose.has(e.id)) ? null : pieces.map((e) => e.id)
}
