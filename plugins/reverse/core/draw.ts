// SPDX-License-Identifier: AGPL-3.0-only
// What the drawing tools of the sketch work out before a piece is made: the
// arc that leaves a chain's last end tangent to the piece before it, and the
// dimension two clicks of the Dimension tool ask for. No store, no sheet —
// the store calls these with what was clicked.

import type { Vec2 } from '../../../src/core/flat/types'
import { add2, cross2, dot2, len2, perp2, scale2, sub2 } from '../../../src/core/flat/vec2'
import { MIN_SKETCH_EDGE, usableSketchLoop, anchorPoint, anchorsOf, entityOf, lineDir, nearestOnEntity, type Anchor, type AnchorAt, type ConstraintInput, type PolygonFit, type Sketch, type SketchEntity, quadrantsOf } from './sketch'
import { traceNear, traceOf, type DatumPlane, type DatumTrace } from './datums'
import { measureDimension } from './solver'

/** The direction a piece runs on in past one of its ends — what a tangent
 *  arc begun there leaves along. Null for a piece without ends. */
export function outwardTangent(e: SketchEntity, at: AnchorAt): Vec2 | null {
  if (e.kind === 'line') {
    const d = lineDir(e)
    if (!d || at === 'center') return null
    return at === 'b' ? d : scale2(d, -1)
  }
  if (e.kind === 'arc') {
    if (at === 'center') return null
    // Counter-clockwise past the end, clockwise back past the start.
    const theta = at === 'b' ? e.start + e.sweep : e.start
    const ccw: Vec2 = [-Math.sin(theta), Math.cos(theta)]
    return at === 'b' ? ccw : scale2(ccw, -1)
  }
  return null
}

/**
 * The arc from `p` to `q` that leaves `p` along the unit direction `t` — the
 * one a line tool draws when the hand presses on the chain's last end and
 * drags. In the entity's terms: an arc runs counter-clockwise, so
 * `startsAtP` says whether anchor 'a' lies at `p` or at `q`. Null when `q`
 * lies straight ahead or on `p`, where no arc is tangent.
 */
export function tangentArc(p: Vec2, t: Vec2, q: Vec2): { c: Vec2; r: number; start: number; sweep: number; startsAtP: boolean } | null {
  const pq = sub2(q, p)
  const l = len2(pq)
  if (!(l > 1e-9)) return null
  const n = perp2(t)
  const h = dot2(pq, n)
  if (Math.abs(h) < 1e-6 * l) return null
  // The centre lies square to the tangent, as far off as puts q on the rim.
  const signed = (l * l) / (2 * h)
  if (!Number.isFinite(signed) || Math.abs(signed) <= MIN_SKETCH_EDGE) return null
  const c = add2(p, scale2(n, signed))
  const two = 2 * Math.PI
  const thetaP = Math.atan2(p[1] - c[1], p[0] - c[0])
  const thetaQ = Math.atan2(q[1] - c[1], q[0] - c[0])
  const ccw = (from: number, to: number) => (((to - from) % two) + two) % two
  // Centre on the left: the hand goes round counter-clockwise from p.
  return signed > 0
    ? { c, r: signed, start: thetaP, sweep: ccw(thetaP, thetaQ), startsAtP: true }
    : { c, r: -signed, start: thetaQ, sweep: ccw(thetaQ, thetaP), startsAtP: false }
}

/** What the Dimension tool has under a click: a whole piece, a point — an
 *  end of a line or an arc, a point piece — or one of the part's coordinate
 *  planes, clicked on the line it cuts the sheet in. */
export type DimPick = { kind: 'piece'; id: number; via?: Anchor } | { kind: 'point'; anchor: Anchor } | { kind: 'datum'; plane: DatumPlane } | { kind: 'origin'; planes: DatumPlane[] }

/** The sheet's zero as a pick: where the coordinate planes' lines cross.
 *  A point held there is held on each of them — the sketch origin of every
 *  CAD sketcher. Null where no two planes' lines cross at the zero. */
export function originPick(datums: readonly DatumTrace[]): Extract<DimPick, { kind: 'origin' }> | null {
  const planes = datums.filter((t) => Math.abs(t.d) < 1e-6).map((t) => t.plane)
  return planes.length >= 2 ? { kind: 'origin', planes } : null
}

/** A piece clicked on the square of its middle or of a quadrant point
 *  (`via`) is two things at once: by itself it is the piece — a line's
 *  length, a circle's diameter, as a click anywhere along it is — and
 *  paired with a second pick it is that point: the dimension runs from
 *  the middle or from the rim's point, which is what the square was
 *  clicked for. This reads it as the point. */
export function pickAsPoint(p: DimPick): DimPick {
  return p.kind === 'piece' && p.via ? { kind: 'point', anchor: p.via } : p
}

/** The kinds of thing a pick may take: the snap bar's Pick switches. */
export interface PickAllow {
  endpoint: boolean
  midpoint: boolean
  center: boolean
  quadrant: boolean
  curve: boolean
  /** All — the smart pick: every point reaches as far as an end, and the
   *  one closest to the cursor is taken. */
  nearest?: boolean
}
/** How far the square of a middle or a quadrant point reaches, as a share
 *  of an end's reach: about the square itself on the screen. */
const BODY_POINT_REACH = 0.6
/** Ends and whole pieces: what the tool takes when nothing says otherwise. */
export const PICK_ENDS: PickAllow = { endpoint: true, midpoint: false, center: false, quadrant: false, curve: true }

/** Named points offered to hover, click and Select Other under the same switches. */
export function visitPickAnchors(sketch: Sketch, allow: PickAllow, take: (id: number, at: AnchorAt, p: Vec2, onBody?: boolean) => void) {
  for (const e of sketch.entities) {
    if (e.kind === 'circle' || e.kind === 'arc') {
      if (allow.center) take(e.id, 'center', e.c)
      if (allow.quadrant) for (const q of quadrantsOf(e)) take(e.id, q.at, q.point, true)
    }
    if (e.kind === 'circle') continue
    if (e.kind === 'line' && allow.midpoint) take(e.id, 'center', anchorPoint(e, 'center'), true)
    if (!allow.endpoint) continue
    for (const at of anchorsOf(e)) take(e.id, at, anchorPoint(e, at))
  }
}

/** Share the sketch's named point targets and snap filters between sheet
 * picks and viewport picks on a sketch seen edge-on. */
export function dimAnchorAt(sketch: Sketch, radius: number, allow: PickAllow, distance: (p: Vec2) => number, samePixel?: (a: Vec2, b: Vec2) => boolean, fullPointReach = false): Extract<DimPick, { kind: 'point' | 'piece' }> | null {
  let point: Anchor | null = null
  let position: Vec2 | null = null
  let onBody = false
  const pointReach = fullPointReach ? radius : radius * 0.75
  let pointD = pointReach
  const take = (entity: number, at: Anchor['at'], p: Vec2, body = false) => {
    const d = distance(p)
    // A point on a piece's own body reaches less far than an end: the
    // piece round it is a pick too.
    if (d <= pointD && d <= pointReach * (body ? bodyReach : 1)) {
      // A center and quadrant less than one pixel apart cannot be reliably
      // distinguished by mouse. The center filter lets the user choose.
      if (body && point?.entity === entity && point.at === 'center' && position && samePixel?.(position, p)) return
      pointD = d
      point = { entity, at }
      position = p
      onBody = body
    }
  }
  // The square of a middle or a quadrant point is what is clicked for it:
  // its reach is the square's own (BODY_POINT_REACH), or an end's with All.
  const bodyReach = allow.nearest || fullPointReach ? 1 : BODY_POINT_REACH
  visitPickAnchors(sketch, allow, take)
  if (point) {
    const anchor: Anchor = point
    // On the piece's own body the pick is the piece, with the point kept
    // for a second pick to pair with — see pickAsPoint.
    return onBody && allow.curve ? { kind: 'piece', id: anchor.entity, via: anchor } : { kind: 'point', anchor }
  }
  return null
}

/** The pick at a spot on the sheet: an end within reach wins over the piece
 *  it ends, as the smaller target; a centre is taken through its piece; a
 *  coordinate plane's line is taken last, where nothing of the sketch is. */
export function dimPickAt(sketch: Sketch, spot: Vec2, radius: number, datums: readonly DatumTrace[] = [], allow: PickAllow = PICK_ENDS, fullPointReach = false): DimPick | null {
  const anchor = dimAnchorAt(sketch, radius, allow, p => len2(sub2(p, spot)), undefined, fullPointReach)
  if (anchor) return anchor
  let piece: SketchEntity | null = null
  let pieceD = radius
  for (const e of sketch.entities) {
    // Standalone points were considered with the endpoint switch above.
    if (!allow.curve || e.kind === 'point') continue
    const { dist } = nearestOnEntity(e, spot)
    if (dist <= pieceD) {
      pieceD = dist
      piece = e
    }
  }
  if (piece) return { kind: 'piece', id: piece.id }
  const datum = traceNear(datums, spot, radius)
  return datum ? { kind: 'datum', plane: datum.plane } : null
}

export function relPickAt(sketch: Sketch, spot: Vec2, radius: number, datums: readonly DatumTrace[] = [], allow: PickAllow = { ...PICK_ENDS, center: true }): DimPick | null {
  const pick = dimPickAt(sketch, spot, radius, datums, allow, true)
  // The sheet's zero, where nothing of the sketch is nearer: the origin a
  // centre or an end is held at — not just one of the axis lines crossing
  // there, which held only one coordinate.
  if ((!pick || pick.kind === 'datum') && len2(spot) <= radius * 0.75) {
    const origin = originPick(datums)
    if (origin) return origin
  }
  return pick && pickAsPoint(pick)
}

/**
 * The relation two picks make coincident, as CAD reads the pair: two
 * points meet; a point lies on a line, on a round piece's rim or on a
 * coordinate plane's line; a line lies along another line or along a
 * plane's line. A pair that makes none — two round pieces, two planes, a
 * round piece and a line — says why in a sentence.
 */
export function coincidentFor(sketch: Sketch, first: DimPick, second: DimPick): ConstraintInput | string {
  // A clicked midpoint/quadrant square explicitly names that point. Whole
  // lines clicked away from their squares still make their carriers collinear.
  first = pickAsPoint(first)
  second = pickAsPoint(second)
  const piece = (p: DimPick) => (p.kind === 'piece' ? (entityOf(sketch, p.id) ?? null) : null)
  const round = (e: SketchEntity | null) => e !== null && (e.kind === 'arc' || e.kind === 'circle')
  if (first.kind === 'origin' || second.kind === 'origin') return 'The origin takes a point — an end, a centre or a point piece.'
  const same = (a: DimPick, b: DimPick) => (a.kind === 'point' && b.kind === 'point' ? a.anchor.entity === b.anchor.entity : a.kind === 'piece' && b.kind === 'piece' ? a.id === b.id : a.kind === 'point' && b.kind === 'piece' ? a.anchor.entity === b.id : a.kind === 'piece' && b.kind === 'point' ? a.id === b.anchor.entity : a.kind === 'datum' && b.kind === 'datum' && a.plane === b.plane)
  if (same(first, second)) return 'Pick two different things to make coincident.'
  // A point pick, whichever came first, and what it lies on.
  const point = first.kind === 'point' ? first : second.kind === 'point' ? second : null
  const other = point === first ? second : first
  if (point) {
    if (other.kind === 'point') return { kind: 'coincident', p: point.anchor, q: other.anchor }
    if (other.kind === 'datum') return { kind: 'pointOn', p: point.anchor, on: { datum: other.plane } }
    const e = piece(other)
    if (!e) return 'That piece is gone.'
    if (e.kind === 'line') return { kind: 'pointOn', p: point.anchor, on: { line: e.id } }
    if (round(e) || e.kind === 'spline') return { kind: 'pointOn', p: point.anchor, on: { curve: e.id } }
    // A point piece: its one point.
    return { kind: 'coincident', p: point.anchor, q: { entity: e.id, at: 'center' } }
  }
  if (first.kind === 'datum' && second.kind === 'datum') return 'Two coordinate planes cannot be made coincident.'
  // Two pieces, or a piece and a plane.
  const a = piece(first)
  const b = piece(second)
  const line = a?.kind === 'line' ? a : b?.kind === 'line' ? b : null
  const rest = line === a ? (second.kind === 'datum' ? second : b) : first.kind === 'datum' ? first : a
  if (a?.kind === 'point' || b?.kind === 'point') {
    const pt = a?.kind === 'point' ? a : b!
    const onto = a?.kind === 'point' ? second : first
    return coincidentFor(sketch, { kind: 'point', anchor: { entity: pt.id, at: 'center' } }, onto)
  }
  if (a?.kind === 'spline' || b?.kind === 'spline') return 'A spline is joined by its ends or its fit points — pick one of those, then what it lies on.'
  // Two round pieces clicked whole: their centres meet — Concentric,
  // reached through Coincident as the centres' relation.
  if (!line && a && b && round(a) && round(b)) return { kind: 'coincident', p: { entity: a.id, at: 'center' }, q: { entity: b.id, at: 'center' } }
  if (!line) return 'Coincident takes a point, a line, or a coordinate plane’s line.'
  if (!rest) return 'That piece is gone.'
  if ('kind' in rest && rest.kind === 'datum') return { kind: 'collinear', line: line.id, on: { datum: rest.plane } }
  const e = rest as SketchEntity
  if (e.kind === 'line') return { kind: 'collinear', line: line.id, on: { line: e.id } }
  if (round(e)) return 'A line and a round piece are held by Tangent, not Coincident — or pick an end of the line.'
  return 'Coincident takes a point, a line, or a coordinate plane’s line.'
}

/** What a Coincident pair with the sheet's zero holds there: the point
 *  picked — an end, a centre — or a round or point piece's centre when the
 *  piece was clicked whole. A string says why the pair holds nothing; null
 *  when neither pick is the origin. */
export function originHold(sketch: Sketch, first: DimPick, second: DimPick): { anchor: Anchor; planes: DatumPlane[] } | string | null {
  const origin = first.kind === 'origin' ? first : second.kind === 'origin' ? second : null
  if (!origin) return null
  const other = pickAsPoint(origin === first ? second : first)
  if (other.kind === 'origin') return 'Pick a point to hold at the origin.'
  if (other.kind === 'point') return { anchor: other.anchor, planes: origin.planes }
  const e = other.kind === 'piece' ? entityOf(sketch, other.id) : null
  if (e && (e.kind === 'arc' || e.kind === 'circle' || e.kind === 'point')) return { anchor: { entity: e.id, at: 'center' }, planes: origin.planes }
  return 'The origin takes a point — an end, a centre or a point piece.'
}

/** Two lines closer to parallel than this are dimensioned by the distance
 *  between them, not by an angle of next to nothing. */
const PARALLEL_DEG = 2

/**
 * The dimension the picks ask for, at the value measured now. One pick: a
 * line's length, an arc's radius, a circle's diameter. Two: between parallel lines
 * their distance, between other lines their angle, from a point or a round
 * piece's centre to a line the perpendicular distance, between two points
 * or centres the distance; from a point, a centre or a line lying parallel
 * to it to a coordinate plane the distance to the plane. Null when nothing
 * applies — a point alone, a plane alone.
 */
/** Options → Other → Circular dimensioning, as QUICKSURFACE has it: a full
 *  circle given by its diameter (the default) or by its radius. */
let circularForm: 'diameter' | 'radius' = 'diameter'
export function setCircularDimensioning(form: 'diameter' | 'radius'): void {
  circularForm = form
}

export function dimensionFor(sketch: Sketch, first: DimPick, second: DimPick | null, datums: readonly DatumTrace[] = []): ConstraintInput | null {
  const piece = (p: DimPick) => (p.kind === 'piece' ? (entityOf(sketch, p.id) ?? null) : null)
  if (first.kind === 'datum' || second?.kind === 'datum') {
    const plane = first.kind === 'datum' ? first : second?.kind === 'datum' ? second : null
    const other = first.kind === 'datum' ? second : first
    if (!plane || !other || other.kind === 'datum') return null
    const trace = traceOf(datums, plane.plane)
    if (!trace) return null
    let p: Anchor | null = null
    if (other.kind === 'point') p = other.anchor
    else {
      const e = piece(other)
      if (e?.kind === 'line') {
        // A line is a distance from the plane only where it runs along it.
        const d = lineDir(e)
        if (!d || Math.abs(dot2(d, trace.n)) > Math.sin((PARALLEL_DEG * Math.PI) / 180)) return null
        p = { entity: e.id, at: 'a' }
      } else if (e && e.kind !== 'spline') p = { entity: e.id, at: 'center' }
    }
    if (!p) return null
    const v = measureDimension(sketch, 'distance', p, { datum: plane.plane }, datums)
    return v === null || v < 1e-6 ? null : { kind: 'distance', p, q: { datum: plane.plane }, value: v }
  }
  /** The pick as a point: itself, or a round piece's centre. */
  const pointOf = (p: DimPick): Anchor | null => {
    if (p.kind === 'point') return p.anchor
    const e = piece(p)
    return e && e.kind !== 'line' && e.kind !== 'spline' ? { entity: e.id, at: 'center' } : null
  }
  const a = piece(first)
  if (!second || (second.kind === 'piece' && first.kind === 'piece' && second.id === first.id)) {
    if (a?.kind === 'line') {
      const v = measureDimension(sketch, 'length', a)
      return v === null ? null : { kind: 'length', entity: a.id, value: v }
    }
    // A full circle is a hole or a boss, given by its diameter as a drawing
    // gives it; an arc — a round corner, a slot's end — by its radius.
    if (a?.kind === 'circle') return circularForm === 'radius' ? { kind: 'radius', entity: a.id, value: a.r } : { kind: 'diameter', entity: a.id, value: 2 * a.r }
    if (a?.kind === 'arc') return { kind: 'radius', entity: a.id, value: a.r }
    return null
  }
  const b = piece(second)
  if (a?.kind === 'line' && b?.kind === 'line') {
    const da = lineDir(a)
    const db = lineDir(b)
    if (!da || !db) return null
    if (Math.abs(cross2(da, db)) < Math.sin((PARALLEL_DEG * Math.PI) / 180)) {
      const p: Anchor = { entity: a.id, at: 'a' }
      const v = measureDimension(sketch, 'distance', p, { line: b.id })
      return v === null ? null : { kind: 'distance', p, q: { line: b.id }, value: v }
    }
    const v = measureDimension(sketch, 'angle', a, b)
    return v === null ? null : { kind: 'angle', a: a.id, b: b.id, value: v }
  }
  const line = a?.kind === 'line' ? a : b?.kind === 'line' ? b : null
  if (line) {
    const p = pointOf(a?.kind === 'line' ? second : first)
    // An end of the line itself is no distance from it.
    if (!p || p.entity === line.id) return null
    const v = measureDimension(sketch, 'distance', p, { line: line.id })
    // A corner the line shares lies on it just the same.
    return v === null || v < 1e-6 ? null : { kind: 'distance', p, q: { line: line.id }, value: v }
  }
  const p = pointOf(first)
  const q = pointOf(second)
  if (!p || !q || (p.entity === q.entity && p.at === q.at)) return null
  // Two round pieces clicked on their rims, an arc among them, are the gap
  // between their edges, as a profile's two rounded ends or a slot's width
  // is given. Two full circles are holes or bosses, pitched by their centres
  // as a drawing gives them. The dimension's Centre / Nearest / Farthest
  // switch takes either to the other.
  const b2 = piece(second)
  const round = (e: SketchEntity | null) => e?.kind === 'arc' || e?.kind === 'circle'
  if (round(a) && round(b2) && (a?.kind === 'arc' || b2?.kind === 'arc')) {
    const gap = measureDimension(sketch, 'distance', p, q, datums, 'near')
    if (gap !== null && gap > 1e-6) return { kind: 'distance', p, q, value: gap, edge: 'near' }
  }
  const v = measureDimension(sketch, 'distance', p, q)
  return v === null || v < 1e-9 ? null : { kind: 'distance', p, q, value: v }
}

/** Whether a first pick is a dimension by itself the moment it is made — a
 *  round piece's radius or diameter, a line's length — or waits for a second click, as
 *  a point and a coordinate plane do. */
export function dimensionIsImmediate(sketch: Sketch, pick: DimPick): boolean {
  if (pick.kind !== 'piece') return false
  const e = entityOf(sketch, pick.id)
  return e?.kind === 'arc' || e?.kind === 'circle' || e?.kind === 'line'
}

// ---- the ways a rectangle, a circle and an arc are drawn ---------------------

/** A rectangle from two opposite corners, from its centre and a corner, or
 *  from one side's two ends and a click where the opposite side lies — the
 *  one way that draws it at an angle. */
export type RectangleMode = 'corners' | 'center' | 'threePoint'
/** A circle from its centre and a point on the rim, from the two ends of a
 *  diameter, or through three points on the rim. */
export type CircleMode = 'center' | 'twoPoint' | 'threePoint'
/** An arc from its two ends and a point it passes through, or from its
 *  centre, its start and where it ends. */
export type ArcMode = 'threePoint' | 'center'
/** A polygon from its centre and a corner (inscribed in its circle), or
 *  from its centre and the middle of a side (circumscribed — the circle's
 *  diameter the width across flats). */
export type PolygonMode = PolygonFit

export interface DrawModes {
  rectangle: RectangleMode
  circle: CircleMode
  arc: ArcMode
  polygon: PolygonMode
}

export const DEFAULT_DRAW_MODES: DrawModes = { rectangle: 'corners', circle: 'center', arc: 'threePoint', polygon: 'inscribed' }

/** How many clicks a drawing tool takes, in the mode it is in. */
export function drawClicks(tool: string, modes: DrawModes): number {
  if (tool === 'arc') return 3
  if (tool === 'polygon') return 2
  if (tool === 'rectangle') return modes.rectangle === 'threePoint' ? 3 : 2
  if (tool === 'circle') return modes.circle === 'threePoint' ? 3 : 2
  return 2
}

const SAME = 1e-9

/** A rectangle's four corners, in order round it, from the clicks of its
 *  mode; the first is the first click's for the two-corner and three-point
 *  ways, and the clicked corner is the third for the centre way. Null when
 *  it would have no area. */
export function rectangleCorners(mode: RectangleMode, clicks: readonly Vec2[]): Vec2[] | null {
  const [p, q, r] = clicks
  if (!p || !q) return null
  if (mode === 'threePoint') {
    const side = sub2(q, p)
    const l = len2(side)
    if (!r || l < MIN_SKETCH_EDGE) return null
    const n = perp2(scale2(side, 1 / l))
    const h = dot2(sub2(r, q), n)
    if (Math.abs(h) < MIN_SKETCH_EDGE) return null
    const across = scale2(n, h)
    const corners = [p, q, add2(q, across), add2(p, across)]
    return usableSketchLoop(corners) ? corners : null
  }
  // The centre way mirrors the clicked corner through the centre.
  const a = mode === 'center' ? sub2(scale2(p, 2), q) : p
  const b = q
  const corners: Vec2[] = [a, [b[0], a[1]], b, [a[0], b[1]]]
  return usableSketchLoop(corners) ? corners : null
}

/** A circle from the clicks of its mode, or null when three points lie on a
 *  line or two coincide. */
export function circleFrom(mode: CircleMode, clicks: readonly Vec2[]): { c: Vec2; r: number } | null {
  const [p, q, s] = clicks
  if (!p || !q) return null
  if (mode === 'threePoint') {
    const through = s ? circleThrough(p, q, s) : null
    return through
  }
  const r = mode === 'twoPoint' ? len2(sub2(q, p)) / 2 : len2(sub2(q, p))
  if (r < SAME) return null
  return { c: mode === 'twoPoint' ? scale2(add2(p, q), 0.5) : p, r }
}

/** The circle through three points, or null when they lie on a line. */
function circleThrough(p: Vec2, q: Vec2, s: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * cross2(sub2(q, p), sub2(s, p))
  if (Math.abs(d) < SAME) return null
  const qp = sub2(q, p)
  const sp = sub2(s, p)
  const q2 = dot2(qp, qp)
  const s2 = dot2(sp, sp)
  const c: Vec2 = [p[0] + (sp[1] * q2 - qp[1] * s2) / d, p[1] + (qp[0] * s2 - sp[0] * q2) / d]
  return { c, r: len2(sub2(p, c)) }
}

/** An arc from its centre, its start and a click where it ends: the circle
 *  through the start about the centre, from the start round to the end's
 *  direction the shorter way — the way the cursor went, for any arc up to a
 *  half circle; a longer one is drawn through three points. `startsAtP` as
 *  arcThrough has it: whether anchor 'a' is at the start. Null when the
 *  start is on the centre or the end on the start. */
export function arcAbout(c: Vec2, start: Vec2, end: Vec2): { c: Vec2; r: number; start: number; sweep: number; startsAtP: boolean } | null {
  const r = len2(sub2(start, c))
  const towards = sub2(end, c)
  if (r < SAME || len2(towards) < SAME) return null
  const from = Math.atan2(start[1] - c[1], start[0] - c[0])
  const to = Math.atan2(towards[1], towards[0])
  const two = 2 * Math.PI
  const ccw = (((to - from) % two) + two) % two
  if (ccw < 1e-9 || two - ccw < 1e-9) return null
  // Counter-clockwise the shorter way, the start is anchor 'a'; clockwise
  // the arc is the same piece run from the end's side.
  return ccw <= Math.PI ? { c, r, start: from, sweep: ccw, startsAtP: true } : { c, r, start: to, sweep: two - ccw, startsAtP: false }
}
