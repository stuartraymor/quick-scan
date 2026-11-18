// SPDX-License-Identifier: AGPL-3.0-only
// Independent line-line corner finishing. Auto Fillet estimates its scalar
// radius from actual section samples; it never substitutes a default radius.
import type { Vec2 } from '../../../src/core/flat/types'
import { lineIntersection } from './corners'
import { filletLines } from './filletCorner'
import { addConstraint, anchorPoint, cloneSketch, constraintEntities, damagedPiece, endsOf, entityOf, type Anchor, type Constraint, type Sketch, type SketchEntity, type SketchLine } from './sketch'
import { joinCurveEnds } from './cornerJoin'
import { solveSketch } from './solver'
import { pathDistance } from './cornerGesture'

export type CornerTrimMode = 'trim' | 'autoFillet' | 'fixedFillet'
export interface CornerTrimOptions { mode: CornerTrimMode; radiusMm: number; addDimension: boolean }
export type CornerTrimResult = { ok: true; sketch: Sketch; changedIds: number[]; farAnchors: { anchor: Anchor; to: Vec2 }[]; radiusMm?: number; rms?: number; usedPoints?: number } | { ok: false; error: string }
type Side = { line: SketchLine; near: 'a' | 'b'; far: 'a' | 'b'; direction: Vec2; reach: number }
const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Includes boundary points and works for a screen box rotated on the sheet. */
export function pointsInCornerArea(points: readonly Vec2[], corners: readonly Vec2[]): Vec2[] {
  if (corners.length < 3) return []
  const area = corners.reduce((sum, p, i) => { const q = corners[(i + 1) % corners.length]; return sum + p[0] * q[1] - q[0] * p[1] }, 0)
  if (!Number.isFinite(area) || Math.abs(area) < 1e-12) return []
  return points.filter((p) => {
    let sign = 0
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i], b = corners[(i + 1) % corners.length]
      const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
      if (Math.abs(cross) <= 1e-9) continue
      const next = Math.sign(cross)
      if (sign && sign !== next) return false
      sign = next
    }
    return true
  })
}

/** Native Corner Trim paints endpoints, not whole pieces or their bounding box. */
export function cornerEndsNearPath(sketch: Sketch, path: readonly Vec2[], radius: number): Anchor[] {
  if (!(radius > 0) || !Number.isFinite(radius) || !path.length || path.some((p) => !p.every(Number.isFinite))) return []
  return sketch.entities.flatMap((e): Anchor[] => endsOf(e).length === 0 ? [] : (['a', 'b'] as const)
    .filter((at) => pathDistance(anchorPoint(e, at), path) <= radius).map((at) => ({ entity: e.id, at })))
}

function side(line: SketchLine, corner: Vec2, painted?: 'a' | 'b'): Side | null {
  const near = painted ?? (distance(line.a, corner) <= distance(line.b, corner) ? 'a' : 'b')
  const far = near === 'a' ? 'b' : 'a'
  const reach = distance(line[far], corner)
  return reach > 1e-8 ? { line, near, far, reach, direction: [(line[far][0] - corner[0]) / reach, (line[far][1] - corner[1]) / reach] } : null
}

function protectedConstraint(c: Constraint, sides: readonly Side[]): boolean {
  if (!constraintEntities(c).some((id) => sides.some((s) => s.line.id === id))) return false
  // These constrain only the unchanged line carriers/directions.
  if (['horizontal', 'vertical', 'parallel', 'perpendicular', 'angle', 'collinear'].includes(c.kind)) return false
  if (c.kind === 'coincident') {
    const changing = (p: Anchor) => sides.some((s) => s.line.id === p.entity && s.near === p.at)
    // The mutual near-end join is intentionally replaced; far-end joins stay.
    return (changing(c.p) || changing(c.q)) && !(changing(c.p) && changing(c.q))
  }
  // Lengths, equal lengths, tangent curves and point-on constraints may
  // conflict with a trim. Refuse rather than silently delete or distort them.
  return true
}

/** Tangent fillet between the two lines, its centre on the angle bisector,
 *  so radius is the one unknown. The scan is compared with the whole corner
 *  profile (line, arc, line), not with the arc alone: straight flank samples
 *  then cost nothing at any radius, the round alone decides it, and shallow
 *  corners whose round lies within a hair of the lines still fit. */
function autoRadius(a: Side, b: Side, corner: Vec2, points: readonly Vec2[]): { radius: number; rms: number; points: Vec2[] } | string {
  if (points.length > 12000) return 'Select at most 12,000 reference points for one corner.'
  const cosine = Math.max(-1, Math.min(1, a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1]))
  const half = Math.acos(cosine) / 2, sin = Math.sin(half), tan = Math.tan(half)
  const bx = a.direction[0] + b.direction[0], by = a.direction[1] + b.direction[1], bl = Math.hypot(bx, by)
  if (!(sin > 1e-6) || !(tan > 1e-6) || !(bl > 1e-6)) return 'These lines do not form a usable fillet corner.'
  const reach = Math.min(a.reach, b.reach), maximum = 0.94 * reach * tan
  if (!(maximum > 1e-8) || !Number.isFinite(maximum)) return 'There is no room for a fillet on these lines.'
  const cx = bx / bl / sin, cy = by / bl / sin, sweep = Math.PI - 2 * half
  const unique = new Map<string, Vec2>()
  for (const p of points) {
    if (!p.every(Number.isFinite)) continue
    const dx = p[0] - corner[0], dy = p[1] - corner[1]
    // Inside the angle between the two forward rays (also for obtuse corners,
    // where the round near one tangent point lies behind the other ray).
    const turn = a.direction[0] * b.direction[1] - a.direction[1] * b.direction[0]
    const fromA = a.direction[0] * dy - a.direction[1] * dx, toB = dx * b.direction[1] - dy * b.direction[0]
    const inWedge = fromA * turn > 0 && toB * turn > 0
    if (inWedge && Math.hypot(dx, dy) <= reach) unique.set(`${p[0]},${p[1]}`, p)
  }
  let samples = [...unique.values()]
  if (samples.length < 5) return 'Auto Fillet needs at least five curved reference points near this corner. Highlight the rounded section area.'
  // Signed distance to the profile of radius r, and whether p faces the arc.
  const place = (p: Vec2, r: number): { d: number; onArc: boolean } => {
    const t = r / tan, ox = corner[0] + cx * r, oy = corner[1] + cy * r
    const ta: Vec2 = [corner[0] + a.direction[0] * t, corner[1] + a.direction[1] * t], tb: Vec2 = [corner[0] + b.direction[0] * t, corner[1] + b.direction[1] * t]
    // Past a tangent point along its line: the line is the profile there.
    const alongA = (p[0] - ta[0]) * a.direction[0] + (p[1] - ta[1]) * a.direction[1]
    const alongB = (p[0] - tb[0]) * b.direction[0] + (p[1] - tb[1]) * b.direction[1]
    if (alongA > 0 || alongB > 0) {
      const da = Math.abs((p[0] - corner[0]) * a.direction[1] - (p[1] - corner[1]) * a.direction[0])
      const db = Math.abs((p[0] - corner[0]) * b.direction[1] - (p[1] - corner[1]) * b.direction[0])
      return { d: alongA > 0 && alongB > 0 ? Math.min(da, db) : alongA > 0 ? da : db, onArc: false }
    }
    return { d: Math.hypot(p[0] - ox, p[1] - oy) - r, onArc: true }
  }
  const lossOf = (set: readonly Vec2[]) => (r: number) => set.reduce((sum, p) => sum + place(p, r).d ** 2, 0) / set.length
  // A logarithmic bracket avoids assuming the scan's radius or scale.
  const minimum = maximum * 1e-5
  const radii = Array.from({ length: 129 }, (_, i) => minimum * Math.pow(maximum / minimum, i / 128))
  const search = (loss: (r: number) => number) => {
    let best = 0
    for (let i = 1; i < radii.length; i++) if (loss(radii[i]) < loss(radii[best])) best = i
    let lo = radii[Math.max(0, best - 1)], hi = radii[Math.min(radii.length - 1, best + 1)]
    for (let i = 0; i < 80; i++) {
      const l = lo + (hi - lo) / 3, r = hi - (hi - lo) / 3
      if (loss(l) < loss(r)) hi = r; else lo = l
    }
    return (lo + hi) / 2
  }
  let radius = search(lossOf(samples))
  // A few stray scan points (a burr, a stitching seam) must not bend the
  // radius: drop points beyond 3 robust standard deviations (median absolute
  // deviation) and fit again, at most twice, keeping at least 80 %.
  for (let pass = 0; pass < 2; pass++) {
    const abs = samples.map((p) => Math.abs(place(p, radius).d)).sort((x, y) => x - y)
    const limit = Math.max(3 * 1.4826 * abs[Math.floor(abs.length / 2)], reach * 1e-6)
    const kept = samples.filter((p) => Math.abs(place(p, radius).d) <= limit)
    if (kept.length === samples.length || kept.length < Math.max(5, Math.ceil(samples.length * 0.8))) break
    samples = kept
    radius = search(lossOf(samples))
  }
  const curved = samples.filter((p) => place(p, radius).onArc)
  if (curved.length < 5 || radius >= maximum * 0.995 || radius <= minimum * 1.01) return 'The reference points do not establish a reliable tangent fillet. Highlight only the rounded corner or use Fixed Size Fillet.'
  const ox = corner[0] + cx * radius, oy = corner[1] + cy * radius
  const angles = curved.map((p) => Math.atan2(p[1] - oy, p[0] - ox))
  const relative = angles.map((v) => Math.atan2(Math.sin(v - angles[0]), Math.cos(v - angles[0])))
  const span = Math.max(...relative) - Math.min(...relative)
  if (span < 0.4 * sweep) return 'The reference points cover too little of the rounded corner. Highlight the whole round, or use Fixed Size Fillet.'
  const rms = Math.sqrt(curved.reduce((sum, p) => sum + place(p, radius).d ** 2, 0) / curved.length)
  if (rms > Math.max(radius * 0.035, reach * 0.002)) return 'The rounded corner is not circular: even the best tangent arc is off the scan by more than 3.5 % of its radius. Use Fit Curve for a free-form blend, or Fixed Size Fillet.'
  return { radius, rms, points: curved }
}

/** The end of `e` nearest to any end of `other`: the end a box or selection
 *  means when no end was painted. */
function nearerEnd(e: SketchEntity, other: SketchEntity): 'a' | 'b' {
  const ends = (x: SketchEntity) => (['a', 'b'] as const).map((at) => anchorPoint(x, at))
  const [oa, ob] = ends(other)
  const reach = (at: 'a' | 'b') => Math.min(distance(anchorPoint(e, at), oa), distance(anchorPoint(e, at), ob))
  return reach('a') <= reach('b') ? 'a' : 'b'
}

/** Corner Trim for pairs with an arc or an open curve (see cornerJoin.ts). */
function curveCornerTrim(source: Sketch, ids: readonly number[], ends?: readonly Anchor[]): CornerTrimResult {
  const fail = (error: string): CornerTrimResult => ({ ok: false, error })
  const [ea, eb] = ids.map((id) => entityOf(source, id)!) as [SketchEntity, SketchEntity]
  if (ea.fixed || eb.fixed || ea.projected || eb.projected) return fail('Fixed and projected pieces cannot be trimmed. Release the Fix or use editable pieces.')
  if (Boolean(ea.construction) !== Boolean(eb.construction)) return fail('Choose two profile pieces or two construction pieces; a mixed corner is ambiguous.')
  const endOf = (e: SketchEntity, other: SketchEntity) => (ends?.find((p) => p.entity === e.id)?.at as 'a' | 'b' | undefined) ?? nearerEnd(e, other)
  const pa = endOf(ea, eb), pb = endOf(eb, ea)
  const painted = (p: Anchor) => (p.entity === ea.id && p.at === pa) || (p.entity === eb.id && p.at === pb)
  const far = (p: Anchor) => (p.entity === ea.id && p.at !== pa) || (p.entity === eb.id && p.at !== pb)
  for (const c of source.constraints) {
    const touched = constraintEntities(c).filter((id) => id === ea.id || id === eb.id)
    if (!touched.length) continue
    if (c.kind === 'coincident') {
      // The mutual painted join is replaced; a far-end join stays where it is.
      if ((painted(c.p) && painted(c.q)) || ((far(c.p) || !touched.includes(c.p.entity)) && (far(c.q) || !touched.includes(c.q.entity)))) continue
      return fail('Another piece is joined at a painted end. Remove that join first.')
    }
    // An arc keeps its circle: its radius and centre relations still hold.
    if (['radius', 'diameter', 'concentric'].includes(c.kind) && touched.every((id) => entityOf(source, id)?.kind === 'arc')) continue
    if (['horizontal', 'vertical', 'parallel', 'perpendicular', 'angle', 'collinear'].includes(c.kind) && touched.every((id) => entityOf(source, id)?.kind === 'line')) continue
    return fail('A dimension or relation on these pieces prevents trimming them. Remove it first.')
  }
  const joined = joinCurveEnds(source, { entity: ea.id, at: pa }, { entity: eb.id, at: pb })
  if (!joined.ok) return fail(joined.error)
  const sketch = cloneSketch(source)
  sketch.entities = sketch.entities.map((e) => e.id === ea.id ? joined.a : e.id === eb.id ? joined.b : e)
  if (!sketch.constraints.some((c) => c.kind === 'coincident' && painted(c.p) && painted(c.q))) addConstraint(sketch, { kind: 'coincident', p: { entity: ea.id, at: pa }, q: { entity: eb.id, at: pb } })
  const farAnchors = ([[ea, pa], [eb, pb]] as const).map(([e, at]) => {
    const keep = at === 'a' ? 'b' : 'a'
    return { anchor: { entity: e.id, at: keep } as Anchor, to: anchorPoint(e, keep) }
  })
  const report = solveSketch(sketch, { pull: farAnchors })
  if (!report.ok) return fail('The corner conflicts with existing sketch constraints. Nothing was changed.')
  for (const f of farAnchors) if (distance(anchorPoint(entityOf(sketch, f.anchor.entity)!, f.anchor.at), f.to) > 1e-5) return fail('This operation would move a far end. Nothing was changed.')
  return { ok: true, sketch, changedIds: [ea.id, eb.id], farAnchors }
}

/** Produces a solved candidate without ever mutating the source sketch. */
export function buildCornerTrim(source: Sketch, ids: readonly number[], options: CornerTrimOptions, points: readonly Vec2[] = [], ends?: readonly Anchor[]): CornerTrimResult {
  const fail = (error: string): CornerTrimResult => ({ ok: false, error })
  if (ids.length !== 2 || new Set(ids).size !== 2) return fail('Paint over one endpoint on each of two lines.')
  const damaged = damagedPiece(source, ids)
  if (damaged) return fail(damaged)
  if (ends && (ends.length !== 2 || ids.some((id) => ends.filter((p) => p.entity === id && (p.at === 'a' || p.at === 'b')).length !== 1))) return fail('Paint exactly two endpoints, one on each line.')
  const chosen = ids.map((id) => entityOf(source, id))
  if (chosen.every((e) => e && (e.kind === 'line' || e.kind === 'arc' || e.kind === 'spline')) && chosen.some((e) => e!.kind !== 'line')) {
    if (options.mode !== 'trim') return fail('Fillets are made between two straight lines. Use Corner Trim to join this pair.')
    return curveCornerTrim(source, ids, ends)
  }
  if (chosen.some((e) => !e || e.kind !== 'line')) return fail('Corner Trim joins the ends of lines, arcs and open curves. Circles, points and closed curves have no ends to join.')
  const [la, lb] = chosen as SketchLine[]
  if (chosen.some((e) => e?.fixed || e?.projected)) return fail('Fixed and projected lines cannot be trimmed. Release the Fix or use editable lines.')
  if (Boolean(la.construction) !== Boolean(lb.construction)) return fail('Choose two profile lines or two construction lines; a mixed corner is ambiguous.')
  const corner = lineIntersection(la, lb)
  if (!corner) return fail('These lines are parallel or nearly parallel; no stable corner intersection exists.')
  const endOf = (id: number) => ends?.find((p) => p.entity === id)?.at as 'a' | 'b' | undefined
  const a = side(la, corner, endOf(la.id)), b = side(lb, corner, endOf(lb.id))
  if (!a || !b) return fail('The corner would consume an entire line.')
  const sides = [a, b]
  if (source.constraints.some((c) => protectedConstraint(c, sides))) return fail('A dimension or another constrained corner prevents trimming these endpoints. Remove that constraint first.')
  const sketch = cloneSketch(source)
  let radiusMm: number | undefined, rms: number | undefined, usedPoints: number | undefined
  const changedIds = [...ids]
  if (options.mode === 'trim') {
    for (const s of sides) (entityOf(sketch, s.line.id) as SketchLine)[s.near] = [...corner]
    const joined = sketch.constraints.some((c) => c.kind === 'coincident' && c.p.entity !== c.q.entity && [c.p, c.q].every((p) => sides.some((s) => s.line.id === p.entity && s.near === p.at)))
    if (!joined) addConstraint(sketch, { kind: 'coincident', p: { entity: la.id, at: a.near }, q: { entity: lb.id, at: b.near } })
  } else {
    radiusMm = options.radiusMm
    if (options.mode === 'autoFillet') {
      const fit = autoRadius(a, b, corner, points)
      if (typeof fit === 'string') return fail(fit)
      radiusMm = fit.radius; rms = fit.rms; usedPoints = fit.points.length
    }
    if (!(radiusMm > 0) || !Number.isFinite(radiusMm)) return fail('Enter a finite radius above zero.')
    const made = filletLines(sketch, la.id, lb.id, radiusMm, undefined, [a.near, b.near])
    if (typeof made === 'string') return fail(made)
    changedIds.push(made.arc)
    if (!options.addDimension) sketch.constraints = sketch.constraints.filter((c) => c.id !== made.dimension)
    const arc = entityOf(sketch, made.arc)
    if (arc?.kind === 'arc') {
      // The radius was fitted with both lines held: the scan is not attached
      // as soft data, which would let the solver swing the user's lines.
      if (la.construction && lb.construction) arc.construction = true
    }
  }
  const far = sides.map((s) => ({ anchor: { entity: s.line.id, at: s.far }, to: s.line[s.far] }))
  const report = solveSketch(sketch, { pull: far })
  if (!report.ok) return fail('The corner conflicts with existing sketch constraints. Nothing was changed.')
  for (const s of sides) {
    const e = entityOf(sketch, s.line.id)!
    if (distance(anchorPoint(e, s.far), s.line[s.far]) > 1e-5) return fail('This operation would move a far endpoint. Nothing was changed.')
  }
  return { ok: true, sketch, changedIds, farAnchors: far, ...(radiusMm !== undefined ? { radiusMm } : {}), ...(rms !== undefined ? { rms, usedPoints } : {}) }
}
