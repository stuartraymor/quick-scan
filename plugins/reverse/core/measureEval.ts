// SPDX-License-Identifier: AGPL-3.0-only
// What Measure reads off a sketch: a read-only library of typed results —
// a radius, a circumference, a chord, the short and the long way round a
// circle between two of its points, a point's distance and its X and Y
// parts, a loop's perimeter and the area it closes. Nothing here changes
// a sketch: no relation, no dimension, no move. The Dimension tool's picks
// (core/draw.ts `dimPickAt`) name what is measured, so Measure and Smart
// Dimension take the same centre, the same quadrant point and the same
// piece from the same click, and the same geometry gives the same number.
//
// Every result says what it is (`label`), its value in millimetres or
// degrees, whether it is exact (from the piece's own definition) or
// estimated (a spline's length, integrated; a piece fitted to scan points
// is exact geometry of the fit, and says it was fitted), and the points
// it is measured between (`witness`), for the overlay.

import type { Vec2 } from '../../../src/core/flat/types'
import { len2, sub2 } from '../../../src/core/flat/vec2'
import { anchorPoint, entityOf, isQuadrant, lineLength, type Anchor, type Sketch, type SketchArc, type SketchCircle, type SketchEntity, type SketchLine } from './sketch'
import { isClosed, splineCurve, splineSamples } from './sketchSpline'
import type { Region, RegionLoop } from './regions'

const TWO_PI = 2 * Math.PI
const DEG = 180 / Math.PI

/** What a value is: a length (millimetres), an area (square millimetres),
 *  an angle (degrees) or a point — shown in the units chosen in Settings. */
export type MeasureUnit = 'length' | 'area' | 'deg' | 'point'

export interface MeasureResult {
  /** What the number is, in words: never just "Distance" when it is a
   *  chord, a centre distance or a clearance. */
  label: string
  /** A key a filter or a test can find the result by. */
  key: string
  value: number
  unit: MeasureUnit
  /** For a point: its coordinates. */
  point?: Vec2
  exact: boolean
  /** The points it is measured between, for the overlay. */
  witness?: Vec2[]
  /** A short note beside it — "fitted to 412 scan points", "the long way
   *  round", "not applicable: …". */
  note?: string
}

/** What a Measure pick is: a piece, a point on one (end, centre, middle,
 *  quadrant point), or the sheet's zero. The Dimension tool's DimPick
 *  without its coordinate planes. */
export type MeasureRef = { kind: 'piece'; id: number } | { kind: 'point'; anchor: Anchor } | { kind: 'origin' }

const r = (label: string, key: string, value: number, unit: MeasureUnit, extra: Partial<MeasureResult> = {}): MeasureResult => ({ label, key, value, unit, exact: true, ...extra })

// A note is plain words, not a figure the dialog converts: the count of
// scan points a piece was fitted to, not their scatter, which is a length.
const fitted = (e: SketchEntity): string | undefined => ('points' in e && e.points && e.points.length > 0 ? `fitted to ${e.points.length} scan points` : undefined)

/** What a point anchor is, in words. */
export function anchorName(sketch: Sketch, a: Anchor): string {
  const e = entityOf(sketch, a.entity)
  if (!e) return 'a point that is gone'
  const piece = `${e.kind} ${e.id}`
  if (e.kind === 'point') return `point ${e.id}`
  if (isQuadrant(a.at)) return `${Number(a.at.slice(1)) * 90}° quadrant point of ${piece}`
  if (a.at === 'center') return e.kind === 'line' ? `middle of ${piece}` : `centre of ${piece}`
  if (a.at === 'a') return `start of ${piece}`
  if (a.at === 'b') return `end of ${piece}`
  return `${a.at} of ${piece}`
}

export function refName(sketch: Sketch, ref: MeasureRef): string {
  if (ref.kind === 'origin') return 'origin'
  if (ref.kind === 'point') return anchorName(sketch, ref.anchor)
  const e = entityOf(sketch, ref.id)
  return e ? `${e.kind} ${e.id}${fitted(e) ? ' (fitted)' : ''}` : 'a piece that is gone'
}

/** The point a ref stands for, or null for a whole piece. */
export function refPoint(sketch: Sketch, ref: MeasureRef): Vec2 | null {
  if (ref.kind === 'origin') return [0, 0]
  if (ref.kind === 'piece') {
    const e = entityOf(sketch, ref.id)
    return e?.kind === 'point' ? e.p : null
  }
  const e = entityOf(sketch, ref.anchor.entity)
  return e ? anchorPoint(e, ref.anchor.at) : null
}

/** A spline's length by its samples: estimated, to the sampling's accuracy. */
function splineLength(e: Extract<SketchEntity, { kind: 'spline' }>): number {
  const fit = splineCurve(e)
  const pts = splineSamples(fit, 256).map((s) => s.p)
  let l = 0
  for (let i = 1; i < pts.length; i++) l += len2(sub2(pts[i], pts[i - 1]))
  if (isClosed(e) && pts.length > 1) l += len2(sub2(pts[0], pts[pts.length - 1]))
  return l
}

/** The length of a piece along itself: a line's, an arc's path, a circle's
 *  circumference, a spline's (estimated). */
export function curveLength(e: SketchEntity): { value: number; exact: boolean } {
  switch (e.kind) {
    case 'line':
      return { value: lineLength(e), exact: true }
    case 'arc':
      return { value: e.r * Math.abs(e.sweep), exact: true }
    case 'circle':
      return { value: TWO_PI * e.r, exact: true }
    case 'spline':
      return { value: splineLength(e), exact: false }
    case 'point':
      return { value: 0, exact: true }
  }
}

/** What one pick measures by itself. */
export function measureOne(sketch: Sketch, ref: MeasureRef): MeasureResult[] {
  const p = refPoint(sketch, ref)
  if (ref.kind !== 'piece' || p) {
    if (!p) return [r('Gone', 'gone', NaN, 'length', { exact: false, note: 'The picked point is no longer in the sketch.' })]
    return [r(`Position of ${refName(sketch, ref)}`, 'position', 0, 'point', { point: p, witness: [p] })]
  }
  const e = entityOf(sketch, ref.id)
  if (!e) return [r('Gone', 'gone', NaN, 'length', { exact: false, note: 'The picked piece is no longer in the sketch.' })]
  const note = fitted(e)
  const out: MeasureResult[] = []
  if (e.kind === 'line') {
    const dx = e.b[0] - e.a[0]
    const dy = e.b[1] - e.a[1]
    out.push(r('Length', 'length', lineLength(e), 'length', { witness: [e.a, e.b], note }))
    out.push(r('ΔX (sketch X)', 'dx', Math.abs(dx), 'length', { witness: [e.a, [e.b[0], e.a[1]]] }))
    out.push(r('ΔY (sketch Y)', 'dy', Math.abs(dy), 'length', { witness: [[e.b[0], e.a[1]], e.b] }))
    out.push(r('Angle to sketch X', 'angle', ((Math.atan2(dy, dx) * DEG) % 180 + 180) % 180, 'deg'))
    out.push(r('Start', 'start', 0, 'point', { point: e.a }), r('End', 'end', 0, 'point', { point: e.b }), r('Middle', 'middle', 0, 'point', { point: anchorPoint(e, 'center') }))
  } else if (e.kind === 'circle') {
    out.push(r('Radius', 'radius', e.r, 'length', { witness: [e.c, [e.c[0] + e.r, e.c[1]]], note }))
    out.push(r('Diameter', 'diameter', 2 * e.r, 'length', { witness: [[e.c[0] - e.r, e.c[1]], [e.c[0] + e.r, e.c[1]]] }))
    out.push(r('Circumference', 'circumference', TWO_PI * e.r, 'length'))
    out.push(r('Area of the disk it bounds', 'area', Math.PI * e.r * e.r, 'area', { note: 'the circle is an edge; this is the planar region inside it' }))
    out.push(r('Centre', 'center', 0, 'point', { point: e.c }))
  } else if (e.kind === 'arc') {
    const a = anchorPoint(e, 'a')
    const b = anchorPoint(e, 'b')
    out.push(r('Radius', 'radius', e.r, 'length', { witness: [e.c, a], note }))
    out.push(r('Diameter (of its circle)', 'diameter', 2 * e.r, 'length'))
    out.push(r('Arc length', 'arcLength', e.r * Math.abs(e.sweep), 'length'))
    out.push(r('Chord', 'chord', len2(sub2(b, a)), 'length', { witness: [a, b] }))
    out.push(r('Sweep angle', 'sweep', Math.abs(e.sweep) * DEG, 'deg', { witness: [a, e.c, b] }))
    out.push(r('Centre', 'center', 0, 'point', { point: e.c }), r('Start', 'start', 0, 'point', { point: a }), r('End', 'end', 0, 'point', { point: b }))
  } else if (e.kind === 'spline') {
    const l = curveLength(e)
    out.push(r('Curve length', 'length', l.value, 'length', { exact: false, note: `integrated along the curve${note ? `; ${note}` : ''}; not a circle, so no radius` }))
  }
  return out
}

/** The angle at the centre, 0–2π, from `p` round to `q` counter-clockwise. */
const ccw = (c: Vec2, p: Vec2, q: Vec2) => {
  const t = Math.atan2(q[1] - c[1], q[0] - c[0]) - Math.atan2(p[1] - c[1], p[0] - c[0])
  return ((t % TWO_PI) + TWO_PI) % TWO_PI
}

/** The round piece two point refs both lie on (centre or rim points of one
 *  circle or arc), when they do. */
function sharedRound(sketch: Sketch, a: MeasureRef, b: MeasureRef): SketchCircle | SketchArc | null {
  if (a.kind !== 'point' || b.kind !== 'point' || a.anchor.entity !== b.anchor.entity) return null
  const e = entityOf(sketch, a.anchor.entity)
  return e && (e.kind === 'circle' || e.kind === 'arc') ? e : null
}

function pointPoint(sketch: Sketch, a: MeasureRef, b: MeasureRef, p: Vec2, q: Vec2): MeasureResult[] {
  const d = len2(sub2(q, p))
  const centres = a.kind === 'point' && b.kind === 'point' && a.anchor.at === 'center' && b.anchor.at === 'center' && [a, b].every((x) => { const e = entityOf(sketch, (x as { anchor: Anchor }).anchor.entity); return e?.kind === 'circle' || e?.kind === 'arc' })
  const out: MeasureResult[] = [
    r(centres ? 'Centre-to-centre distance' : 'Straight-line distance', 'distance', d, 'length', { witness: [p, q], note: centres && d < 1e-9 ? 'concentric: the centres coincide' : undefined }),
    r('ΔX (sketch X)', 'dx', Math.abs(q[0] - p[0]), 'length', { witness: [p, [q[0], p[1]]] }),
    r('ΔY (sketch Y)', 'dy', Math.abs(q[1] - p[1]), 'length', { witness: [[q[0], p[1]], q] }),
  ]
  const round = sharedRound(sketch, a, b)
  const rim = (x: MeasureRef) => x.kind === 'point' && x.anchor.at !== 'center'
  if (round && rim(a) && rim(b) && d > 1e-12) {
    // Two rim points of one circle: the chord above, and the angle and the
    // two ways round between them — the short way and the long way, each
    // named, never one passed off as the other.
    const t = ccw(round.c, p, q)
    const short = Math.min(t, TWO_PI - t)
    out[0] = { ...out[0], label: 'Chord (straight line between the two points)' }
    out.push(r('Central angle (short way)', 'centralAngle', short * DEG, 'deg', { witness: [p, round.c, q] }))
    if (round.kind === 'circle') {
      out.push(r('Arc length, short way round', 'arcShort', round.r * short, 'length'))
      out.push(r('Arc length, long way round', 'arcLong', round.r * (TWO_PI - short), 'length'))
    } else {
      // On an arc only the way along the arc itself is a path of it.
      // An arc runs counter-clockwise from its start: each point's angle
      // from the start along it, and the stretch between the two.
      const start = anchorPoint(round, 'a')
      const along = Math.abs(ccw(round.c, start, p) - ccw(round.c, start, q))
      out.push(r('Arc length along the arc', 'arcAlong', round.r * along, 'length'))
    }
  } else if (round && (a.kind === 'point' && b.kind === 'point') && (a.anchor.at === 'center') !== (b.anchor.at === 'center')) {
    out[0] = { ...out[0], label: 'Centre to rim point (the radius)' }
  }
  return out
}

/** The point of a line segment nearest `p`, and of its unbounded line. */
function lineFeet(l: SketchLine, p: Vec2): { seg: Vec2; inf: Vec2 } {
  const ab = sub2(l.b, l.a)
  const ll = ab[0] * ab[0] + ab[1] * ab[1]
  const t = ll > 0 ? ((p[0] - l.a[0]) * ab[0] + (p[1] - l.a[1]) * ab[1]) / ll : 0
  const at = (s: number): Vec2 => [l.a[0] + ab[0] * s, l.a[1] + ab[1] * s]
  return { seg: at(Math.max(0, Math.min(1, t))), inf: at(t) }
}

/** The point of a circle or an arc nearest `p` and farthest from it, on the
 *  piece itself — an arc's own sweep, not its whole circle. */
function roundExtremes(e: SketchCircle | SketchArc, p: Vec2): { near: Vec2; far: Vec2 } {
  const along = (t: number): Vec2 => [e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)]
  const toward = Math.atan2(p[1] - e.c[1], p[0] - e.c[0])
  const cands = [toward, toward + Math.PI]
  if (e.kind === 'circle') return { near: along(toward), far: along(toward + Math.PI) }
  const on = (t: number) => { const s = ((((t - e.start) * Math.sign(e.sweep || 1)) % TWO_PI) + TWO_PI) % TWO_PI; return s <= Math.abs(e.sweep) + 1e-12 }
  const pts = [...cands.filter(on).map(along), anchorPoint(e, 'a'), anchorPoint(e, 'b')]
  const dist = (x: Vec2) => len2(sub2(x, p))
  return { near: pts.reduce((m, x) => (dist(x) < dist(m) ? x : m)), far: pts.reduce((m, x) => (dist(x) > dist(m) ? x : m)) }
}

/** What two picks measure between them. */
export function measureTwo(sketch: Sketch, a: MeasureRef, b: MeasureRef): MeasureResult[] {
  const p = refPoint(sketch, a)
  const q = refPoint(sketch, b)
  if (p && q) return pointPoint(sketch, a, b, p, q)
  const piece = (x: MeasureRef) => (x.kind === 'piece' ? (entityOf(sketch, x.id) ?? null) : null)
  const ea = piece(a)
  const eb = piece(b)
  const round = (e: SketchEntity | null): e is SketchCircle | SketchArc => !!e && (e.kind === 'circle' || e.kind === 'arc')
  // A point and a piece.
  if (p || q) {
    const pt = (p ?? q)!
    const e = p ? eb : ea
    if (!e) return []
    if (e.kind === 'line') {
      const { seg, inf } = lineFeet(e, pt)
      const out = [r('Distance to the line segment (nearest point on it)', 'minDistance', len2(sub2(seg, pt)), 'length', { witness: [pt, seg] })]
      if (len2(sub2(seg, inf)) > 1e-9) out.push(r('Distance to the line extended (perpendicular)', 'lineDistance', len2(sub2(inf, pt)), 'length', { witness: [pt, inf], note: 'the foot lies beyond the segment' }))
      return out
    }
    if (round(e)) {
      const { near, far } = roundExtremes(e, pt)
      return [
        r(`Distance to the centre of ${e.kind} ${e.id}`, 'centerDistance', len2(sub2(e.c, pt)), 'length', { witness: [pt, e.c] }),
        r('Minimum distance to the rim', 'minDistance', len2(sub2(near, pt)), 'length', { witness: [pt, near] }),
        r('Maximum distance to the rim', 'maxDistance', len2(sub2(far, pt)), 'length', { witness: [pt, far] }),
      ]
    }
    return []
  }
  if (!ea || !eb) return []
  if (round(ea) && round(eb)) {
    const d = len2(sub2(eb.c, ea.c))
    const out = [r('Centre-to-centre distance', 'centerDistance', d, 'length', { witness: [ea.c, eb.c], note: d < 1e-9 ? 'concentric: the centres coincide' : undefined })]
    out.push(r('Difference of radii', 'radiusDifference', Math.abs(ea.r - eb.r), 'length'), r('Difference of diameters', 'diameterDifference', 2 * Math.abs(ea.r - eb.r), 'length'))
    if (ea.kind === 'circle' && eb.kind === 'circle') {
      const gap = d - ea.r - eb.r
      const inside = d + Math.min(ea.r, eb.r) <= Math.max(ea.r, eb.r)
      const min = gap >= 0 ? gap : inside ? Math.max(ea.r, eb.r) - d - Math.min(ea.r, eb.r) : 0
      out.push(r('Minimum distance between the circles', 'minDistance', min, 'length', { note: gap < 0 && !inside ? 'the circles cross' : inside ? 'one lies inside the other' : undefined }))
      out.push(r('Maximum distance between the circles', 'maxDistance', d + ea.r + eb.r, 'length'))
    } else {
      out.push(r('Minimum / maximum distance between arcs', 'minDistance', NaN, 'length', { exact: false, note: 'not applicable yet: pick the points to measure between' }))
    }
    return out
  }
  if (ea.kind === 'line' && eb.kind === 'line') {
    const ua = sub2(ea.b, ea.a)
    const ub = sub2(eb.b, eb.a)
    const la = len2(ua)
    const lb = len2(ub)
    if (!(la > 0) || !(lb > 0)) return []
    const cos = Math.max(-1, Math.min(1, (ua[0] * ub[0] + ua[1] * ub[1]) / (la * lb)))
    const angle = Math.acos(Math.abs(cos)) * DEG
    const out = [r('Angle between the lines', 'angle', angle, 'deg'), r('Supplementary angle', 'angleSupplement', 180 - angle, 'deg')]
    if (angle < 1e-6) {
      const { inf } = lineFeet(eb, ea.a)
      out.push(r('Distance between the parallel lines', 'parallelDistance', len2(sub2(inf, ea.a)), 'length', { witness: [ea.a, inf] }))
    }
    return out
  }
  const line = ea.kind === 'line' ? ea : eb.kind === 'line' ? eb : null
  const rnd = round(ea) ? ea : round(eb) ? eb : null
  if (line && rnd) {
    const { seg, inf } = lineFeet(line, rnd.c)
    return [
      r(`Centre of ${rnd.kind} ${rnd.id} to the line extended`, 'centerLineDistance', len2(sub2(inf, rnd.c)), 'length', { witness: [rnd.c, inf] }),
      r('Centre to the line segment', 'centerSegmentDistance', len2(sub2(seg, rnd.c)), 'length', { witness: [rnd.c, seg] }),
    ]
  }
  return []
}

/** A loop's exact perimeter: each stretch along its own piece. */
export function loopPerimeter(loop: RegionLoop, sketch: Pick<Sketch, 'entities'>): { value: number; exact: boolean } {
  let value = 0
  let exact = true
  for (const piece of loop.pieces) {
    const e = sketch.entities.find((x) => x.id === piece.entity)
    if (!e) continue
    if (e.kind === 'line') value += len2(sub2(piece.p1, piece.p0))
    else if (e.kind === 'arc' || e.kind === 'circle') value += e.r * Math.abs(piece.t1 - piece.t0)
    else {
      // A spline stretch: by the loop's own samples along it.
      exact = false
      value += len2(sub2(piece.p1, piece.p0))
    }
  }
  if (!exact) {
    // Fall back to the sampled loop for the spline stretches.
    const poly = loop.polygon
    let l = 0
    for (let i = 0; i < poly.length; i++) l += len2(sub2(poly[(i + 1) % poly.length], poly[i]))
    return { value: l, exact: false }
  }
  return { value, exact }
}

/** A loop's exact signed area: the polygon of its stretches' ends, with
 *  each arc's segment between its chord and itself added or taken off. */
export function loopArea(loop: RegionLoop, sketch: Pick<Sketch, 'entities'>): { value: number; exact: boolean } {
  let twice = 0
  let segs = 0
  for (const piece of loop.pieces) {
    const e = sketch.entities.find((x) => x.id === piece.entity)
    if (!e) continue
    if (e.kind === 'spline') {
      // Sampled: the loop polygon's area.
      let a = 0
      const poly = loop.polygon
      for (let i = 0; i < poly.length; i++) { const u = poly[i], v = poly[(i + 1) % poly.length]; a += u[0] * v[1] - v[0] * u[1] }
      return { value: a / 2, exact: false }
    }
    twice += piece.p0[0] * piece.p1[1] - piece.p1[0] * piece.p0[1]
    if (e.kind === 'arc' || e.kind === 'circle') {
      const th = piece.t1 - piece.t0
      // The circular segment between the chord and the arc, signed by the
      // way the loop runs along it.
      segs += (e.r * e.r * (th - Math.sin(th))) / 2
    }
  }
  return { value: twice / 2 + segs, exact: true }
}

/** What a closed region measures: its outer perimeter, each hole's, and the
 *  area inside the outer loop less the holes'. */
export function measureRegion(region: Region, sketch: Pick<Sketch, 'entities'>): MeasureResult[] {
  const outer = loopPerimeter(region.outer, sketch)
  const outerArea = Math.abs(loopArea(region.outer, sketch).value)
  const holes = region.holes.map((h) => ({ p: loopPerimeter(h, sketch), a: Math.abs(loopArea(h, sketch).value) }))
  const exact = outer.exact && holes.every((h) => h.p.exact)
  const out = [r('Outer perimeter (closed loop)', 'perimeter', outer.value, 'length', { exact: outer.exact })]
  holes.forEach((h, i) => out.push(r(`Hole ${i + 1} perimeter`, `holePerimeter${i + 1}`, h.p.value, 'length', { exact: h.p.exact })))
  out.push(r(holes.length ? 'Area (outer less holes)' : 'Area', 'area', outerArea - holes.reduce((s, h) => s + h.a, 0), 'area', { exact }))
  return out
}

/** A result's value as Copy gives it: full precision, unit after. */
export function copyText(m: MeasureResult): string {
  if (m.unit === 'point' && m.point) return `${m.label}: X ${m.point[0]} Y ${m.point[1]}`
  return `${m.label}: ${m.value} ${m.unit === 'deg' ? '°' : m.unit}`
}

