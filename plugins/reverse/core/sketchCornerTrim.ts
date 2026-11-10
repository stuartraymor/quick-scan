// SPDX-License-Identifier: AGPL-3.0-only
// Independent line-line corner finishing. Auto Fillet estimates its scalar
// radius from actual section samples; it never substitutes a default radius.
import type { Vec2 } from '../../../src/core/flat/types'
import { lineIntersection } from './corners'
import { filletLines } from './filletCorner'
import { addConstraint, anchorPoint, cloneSketch, constraintEntities, entityOf, type Anchor, type Constraint, type Sketch, type SketchLine } from './sketch'
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
  return sketch.entities.flatMap((e): Anchor[] => e.kind !== 'line' ? [] : (['a', 'b'] as const)
    .filter((at) => pathDistance(e[at], path) <= radius).map((at) => ({ entity: e.id, at })))
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

/** Tangent circle has a centre constrained to the angle bisector. Search
 *  only its one remaining scalar, radius, against nearby curved samples. */
function autoRadius(a: Side, b: Side, corner: Vec2, points: readonly Vec2[]): { radius: number; rms: number; points: Vec2[] } | string {
  if (points.length > 12000) return 'Select at most 12,000 reference points for one corner.'
  const cosine = Math.max(-1, Math.min(1, a.direction[0] * b.direction[0] + a.direction[1] * b.direction[1]))
  const half = Math.acos(cosine) / 2, sin = Math.sin(half), tan = Math.tan(half)
  const bx = a.direction[0] + b.direction[0], by = a.direction[1] + b.direction[1], bl = Math.hypot(bx, by)
  if (!(sin > 1e-6) || !(tan > 1e-6) || !(bl > 1e-6)) return 'These lines do not form a usable fillet corner.'
  const reach = Math.min(a.reach, b.reach), maximum = 0.94 * reach * tan
  if (!(maximum > 1e-8) || !Number.isFinite(maximum)) return 'There is no room for a fillet on these lines.'
  const cx = bx / bl / sin, cy = by / bl / sin
  const unique = new Map<string, Vec2>()
  for (const p of points) {
    if (!p.every(Number.isFinite)) continue
    const dx = p[0] - corner[0], dy = p[1] - corner[1]
    const da = Math.abs(dx * a.direction[1] - dy * a.direction[0])
    const db = Math.abs(dx * b.direction[1] - dy * b.direction[0])
    // Straight flank samples do not establish a blend radius. Keep actual
    // curved samples between the two forward rays, near this corner only.
    const inWedge = dx * a.direction[0] + dy * a.direction[1] > 0 && dx * b.direction[0] + dy * b.direction[1] > 0
    if (inWedge && Math.hypot(dx, dy) <= reach && Math.min(da, db) > Math.max(1e-5, reach * 0.001)) unique.set(`${p[0]},${p[1]}`, p)
  }
  const samples = [...unique.values()]
  if (samples.length < 5) return 'Auto Fillet needs at least five curved reference points near this corner. Highlight the rounded section area.'
  const loss = (r: number) => samples.reduce((sum, p) => {
    const error = Math.hypot(p[0] - corner[0] - cx * r, p[1] - corner[1] - cy * r) - r
    return sum + error * error
  }, 0) / samples.length
  // A logarithmic bracket avoids assuming the scan's radius or scale.
  const minimum = maximum * 1e-5
  const radii = Array.from({ length: 65 }, (_, i) => minimum * Math.pow(maximum / minimum, i / 64))
  let best = 0
  for (let i = 1; i < radii.length; i++) if (loss(radii[i]) < loss(radii[best])) best = i
  let lo = radii[Math.max(0, best - 1)], hi = radii[Math.min(64, best + 1)]
  for (let i = 0; i < 65; i++) {
    const l = lo + (hi - lo) / 3, r = hi - (hi - lo) / 3
    if (loss(l) < loss(r)) hi = r; else lo = l
  }
  const radius = (lo + hi) / 2, rms = Math.sqrt(loss(radius))
  const angles = samples.map((p) => Math.atan2(p[1] - corner[1] - cy * radius, p[0] - corner[0] - cx * radius))
  const base = angles[0]
  const relative = angles.map((v) => Math.atan2(Math.sin(v - base), Math.cos(v - base)))
  const span = Math.max(...relative) - Math.min(...relative)
  if (radius >= maximum * 0.995 || span < Math.PI / 12 || rms > Math.max(radius * 0.035, reach * 0.002)) return 'The reference points do not establish a reliable tangent fillet. Highlight only the rounded corner or use Fixed Size Fillet.'
  // All samples must lie on the short fillet side of the tangent circle,
  // towards the original corner, rather than its opposite semicircle.
  if (samples.some((p) => (p[0] - corner[0] - cx * radius) * bx + (p[1] - corner[1] - cy * radius) * by > radius * 0.05)) return 'The selected points lie outside the corner fillet arc.'
  return { radius, rms, points: samples }
}

/** Produces a solved candidate without ever mutating the source sketch. */
export function buildCornerTrim(source: Sketch, ids: readonly number[], options: CornerTrimOptions, points: readonly Vec2[] = [], ends?: readonly Anchor[]): CornerTrimResult {
  const fail = (error: string): CornerTrimResult => ({ ok: false, error })
  if (ids.length !== 2 || new Set(ids).size !== 2) return fail('Paint over one endpoint on each of two lines.')
  if (ends && (ends.length !== 2 || ids.some((id) => ends.filter((p) => p.entity === id && (p.at === 'a' || p.at === 'b')).length !== 1))) return fail('Paint exactly two endpoints, one on each line.')
  const chosen = ids.map((id) => entityOf(source, id))
  if (chosen.some((e) => !e || e.kind !== 'line')) return fail('Corner Trim currently supports two straight lines. Select two lines only.')
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
    let data: Vec2[] | undefined
    radiusMm = options.radiusMm
    if (options.mode === 'autoFillet') {
      const fit = autoRadius(a, b, corner, points)
      if (typeof fit === 'string') return fail(fit)
      radiusMm = fit.radius; rms = fit.rms; usedPoints = fit.points.length; data = fit.points
    }
    if (!(radiusMm > 0) || !Number.isFinite(radiusMm)) return fail('Enter a finite radius above zero.')
    const made = filletLines(sketch, la.id, lb.id, radiusMm, undefined, [a.near, b.near])
    if (typeof made === 'string') return fail(made)
    changedIds.push(made.arc)
    if (!options.addDimension) sketch.constraints = sketch.constraints.filter((c) => c.id !== made.dimension)
    const arc = entityOf(sketch, made.arc)
    if (arc?.kind === 'arc') {
      if (data) arc.points = data.map((p): Vec2 => [...p])
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
