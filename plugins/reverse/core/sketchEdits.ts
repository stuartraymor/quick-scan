// SPDX-License-Identifier: AGPL-3.0-only
// Independent sketch edits. Inputs are immutable; failed edits return no partial sketch.
import type { Vec2 } from '../../../src/core/flat/types'
import { tangentArc } from './draw'
import { mirrorPoint } from './mirrorRelation'
import { addConstraint, addEntity, arcPoint, cloneSketch, entityOf, patternPieces, removeEntities, type EntityInput, type Sketch, type SketchEntity, type SketchLine } from './sketch'

export type SketchEditResult = { ok: true; sketch: Sketch; ids: number[] } | { ok: false; error: string }
const fail = (error: string): SketchEditResult => ({ ok: false, error })
const good = (sketch: Sketch, ids: number[]): SketchEditResult => ({ ok: true, sketch, ids })
const EPS = 1e-7
const TAU = 2 * Math.PI
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
const norm = (a: Vec2) => Math.hypot(...a)
const near = (a: Vec2, b: Vec2) => norm(sub(a, b)) < EPS
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const mod = (a: number) => ((a % TAU) + TAU) % TAU
const selected = (s: Sketch, ids: readonly number[]) => s.entities.filter(e => ids.includes(e.id))
const lineIntersection = (a: SketchLine, b: SketchLine): Vec2 | null => {
  const u = sub(a.b, a.a), v = sub(b.b, b.a), det = cross(u, v)
  if (Math.abs(det) < EPS * norm(u) * norm(v)) return null
  return lerp(a.a, a.b, cross(sub(b.a, a.a), v) / det)
}
const free = (e: SketchEntity): EntityInput => {
  const { id: _id, fixed: _fixed, projected: _projected, source: _source, ...rest } = e
  const result = JSON.parse(JSON.stringify(rest)) as EntityInput
  if ('points' in result) delete result.points
  if ('scatter' in result) delete result.scatter
  return result
}

export function duplicateSelected(input: Sketch, ids: readonly number[], delta: Vec2 = [10, 0]): SketchEditResult {
  if (!delta.every(Number.isFinite)) return fail('The copy displacement must be finite.')
  if (!selected(input, ids).length) return fail('Select the pieces to duplicate.')
  const sketch = cloneSketch(input)
  return good(sketch, patternPieces(sketch, ids, { kind: 'rectangular', count: 2, step: delta }).flat())
}

/** Copy about exactly one selected construction line. No symmetry is added. */
export function mirrorSelected(input: Sketch, ids: readonly number[]): SketchEditResult {
  const pieces = selected(input, ids)
  const axes = pieces.filter((e): e is SketchLine => e.kind === 'line' && Boolean(e.construction))
  if (axes.length !== 1) return fail('Select the pieces and exactly one construction line to mirror about.')
  const axis = axes[0], d = sub(axis.b, axis.a), length = norm(d)
  if (length < EPS) return fail('The mirror line has no length.')
  const copyIds = pieces.filter(e => e.id !== axis.id).map(e => e.id)
  if (!copyIds.length) return fail('Select at least one piece as well as the construction line.')
  const sketch = cloneSketch(input), oldConstraints = new Set(sketch.constraints.map(c => c.id))
  const made = patternPieces(sketch, copyIds, { kind: 'rectangular', count: 2, step: [0, 0] }).flat()
  const set = new Set(made), arcs = new Set<number>(), phi = Math.atan2(d[1], d[0])
  const reflect = (p: Vec2): Vec2 => mirrorPoint(p, axis.a, [d[0] / length, d[1] / length])
  for (const e of sketch.entities) {
    if (!set.has(e.id)) continue
    if (e.kind === 'line') { e.a = reflect(e.a); e.b = reflect(e.b) }
    else if (e.kind === 'circle') e.c = reflect(e.c)
    else if (e.kind === 'arc') { e.c = reflect(e.c); e.start = mod(2 * phi - e.start - e.sweep); arcs.add(e.id) }
    else if (e.kind === 'point') e.p = reflect(e.p)
    else { e.pts = e.pts.map(reflect); if (e.startDir !== undefined) e.startDir = 2 * phi - e.startDir; if (e.endDir !== undefined) e.endDir = 2 * phi - e.endDir }
  }
  sketch.constraints = sketch.constraints.filter(c => {
    if (oldConstraints.has(c.id)) return true
    // Reflection reverses an arc's positive parameterization: rebind its ends.
    for (const key of ['p', 'q'] as const) {
      const anchor = key in c ? (c as unknown as Record<string, { entity?: number; at?: string }>)[key] : undefined
      if (anchor && anchor.entity !== undefined && arcs.has(anchor.entity)) {
        if (anchor.at === 'a') anchor.at = 'b'; else if (anchor.at === 'b') anchor.at = 'a'
      }
    }
    if (c.kind !== 'horizontal' && c.kind !== 'vertical') return true
    const e = entityOf(sketch, c.entity)
    if (e?.kind !== 'line') return false
    const v = sub(e.b, e.a)
    if (Math.abs(v[1]) < EPS) { c.kind = 'horizontal'; return true }
    if (Math.abs(v[0]) < EPS) { c.kind = 'vertical'; return true }
    return false
  })
  return good(sketch, made)
}

/** Positive distance is left of a line's direction, inward on CCW round pieces.
 * Connected line corners use intersections. Curved joins and spline offsets are rejected. */
export function offsetSelected(input: Sketch, ids: readonly number[], distance: number): SketchEditResult {
  if (!Number.isFinite(distance) || Math.abs(distance) < EPS) return fail('Enter a finite nonzero offset.')
  const pieces = selected(input, ids)
  if (!pieces.length) return fail('Select the pieces to offset.')
  if (pieces.some(e => e.kind !== 'line' && e.kind !== 'arc' && e.kind !== 'circle')) return fail('Offset currently supports lines, arcs and circles; select those pieces only.')
  const sketch = cloneSketch(input), copies = new Map<number, SketchEntity>(), made: number[] = []
  for (const e of pieces) {
    const copy = free(e)
    if (copy.kind === 'line') {
      const d = sub(copy.b, copy.a), len = norm(d)
      if (len < EPS) return fail('A selected line has no length.')
      const shift: Vec2 = [-d[1] * distance / len, d[0] * distance / len]
      copy.a = [copy.a[0] + shift[0], copy.a[1] + shift[1]]; copy.b = [copy.b[0] + shift[0], copy.b[1] + shift[1]]
    } else if (copy.kind === 'circle' || copy.kind === 'arc') {
      copy.r -= distance
      if (copy.r <= EPS) return fail('The offset would reduce a radius to zero or below.')
    }
    const id = addEntity(sketch, copy)
    made.push(id); copies.set(e.id, entityOf(sketch, id)!)
  }
  const joins: { p: { entity: number; at: 'a' | 'b' }; q: { entity: number; at: 'a' | 'b' } }[] = []
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    const a = pieces[i], b = pieces[j]
    if (a.kind !== 'line' || b.kind !== 'line') continue
    const ca = copies.get(a.id) as SketchLine, cb = copies.get(b.id) as SketchLine
    for (const at of ['a', 'b'] as const) for (const bt of ['a', 'b'] as const) if (near(a[at], b[bt])) {
      const p = lineIntersection(ca, cb)
      if (!p) {
        if (!near(ca[at], cb[bt])) return fail('Connected parallel lines must run in the same direction to offset together.')
      } else {
        if (norm(sub(p, a[at])) > Math.abs(distance) * 1000) return fail('The offset makes an excessively long corner; reduce the offset or edit that corner first.')
        ca[at] = p; cb[bt] = [...p]
      }
      joins.push({ p: { entity: ca.id, at }, q: { entity: cb.id, at: bt } })
    }
  }
  // Mixed joins require a real curve-intersection policy; do not claim to have joined them.
  for (const a of pieces) for (const b of pieces) {
    if (a.id >= b.id || (a.kind === 'line' && b.kind === 'line') || a.kind === 'circle' || b.kind === 'circle') continue
    const ends = (e: SketchEntity): Vec2[] => e.kind === 'line' ? [e.a, e.b] : e.kind === 'arc' ? [arcPoint(e, e.start), arcPoint(e, e.start + e.sweep)] : []
    if (ends(a).some(p => ends(b).some(q => near(p, q)))) return fail('Joined arc offsets are not supported yet. Offset a single arc or a line-only profile.')
  }
  for (const e of pieces) {
    if (e.kind !== 'line') continue
    const copy = copies.get(e.id) as SketchLine
    if (dot(sub(e.b, e.a), sub(copy.b, copy.a)) <= EPS) return fail('The offset collapses or reverses an edge. Reduce the distance.')
  }
  const shiftedLines = [...copies.values()].filter((e): e is SketchLine => e.kind === 'line')
  for (let i = 0; i < shiftedLines.length; i++) for (let j = i + 1; j < shiftedLines.length; j++) {
    const a = shiftedLines[i], b = shiftedLines[j], p = lineIntersection(a, b)
    if (!p || near(p, a.a) || near(p, a.b) || near(p, b.a) || near(p, b.b)) continue
    const ta = dot(sub(p, a.a), sub(a.b, a.a)) / dot(sub(a.b, a.a), sub(a.b, a.a))
    const tb = dot(sub(p, b.a), sub(b.b, b.a)) / dot(sub(b.b, b.a), sub(b.b, b.a))
    if (ta > EPS && ta < 1 - EPS && tb > EPS && tb < 1 - EPS) return fail('The offset intersects itself. Reduce the distance or offset pieces separately.')
  }
  for (const pair of joins) addConstraint(sketch, { kind: 'coincident', ...pair })
  return good(sketch, made)
}

/** Endpoint-wise centre line, matching the nearer pairing of the two lines. */
export function middleLineSelected(input: Sketch, ids: readonly number[]): SketchEditResult {
  const pieces = selected(input, ids)
  if (pieces.length !== 2 || pieces.some(e => e.kind !== 'line')) return fail('Select exactly two lines to create their middle line.')
  const [a, b] = pieces as SketchLine[]
  const straight = norm(sub(a.a, b.a)) + norm(sub(a.b, b.b)) <= norm(sub(a.a, b.b)) + norm(sub(a.b, b.a))
  const p = lerp(a.a, straight ? b.a : b.b, .5), q = lerp(a.b, straight ? b.b : b.a, .5)
  if (near(p, q)) return fail('The selected lines do not define a nonzero middle line.')
  const sketch = cloneSketch(input)
  return good(sketch, [addEntity(sketch, { kind: 'line', a: p, b: q })])
}

type Curve = Extract<SketchEntity, { kind: 'line' | 'arc' | 'circle' }>
function parameter(e: Curve, p: Vec2): number | null {
  if (e.kind === 'line') {
    const d = sub(e.b, e.a), t = dot(sub(p, e.a), d) / dot(d, d)
    return Number.isFinite(t) && t >= -EPS && t <= 1 + EPS ? Math.max(0, Math.min(1, t)) : null
  }
  const theta = mod(Math.atan2(p[1] - e.c[1], p[0] - e.c[0]) - (e.kind === 'arc' ? e.start : 0))
  if (e.kind === 'circle') return theta / TAU
  return theta <= e.sweep + EPS ? Math.min(1, theta / e.sweep) : null
}
function intersections(a: Curve, b: Curve): Vec2[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const p = lineIntersection(a, b)
    return p && parameter(a, p) !== null && parameter(b, p) !== null ? [p] : []
  }
  if (a.kind !== 'line' && b.kind === 'line') return intersections(b, a)
  let points: Vec2[] = []
  if (a.kind === 'line' && b.kind !== 'line') {
    const d = sub(a.b, a.a), f = sub(a.a, b.c), aa = dot(d, d), bb = 2 * dot(f, d), cc = dot(f, f) - b.r * b.r
    const disc = bb * bb - 4 * aa * cc
    if (aa < EPS || disc <= EPS) return [] // a tangent does not cut a region
    points = [(-bb - Math.sqrt(disc)) / (2 * aa), (-bb + Math.sqrt(disc)) / (2 * aa)].map(t => lerp(a.a, a.b, t))
  } else if (a.kind !== 'line' && b.kind !== 'line') {
    const d = sub(b.c, a.c), len = norm(d)
    if (len < EPS || len >= a.r + b.r - EPS || len <= Math.abs(a.r - b.r) + EPS) return []
    const x = (a.r * a.r - b.r * b.r + len * len) / (2 * len), h = Math.sqrt(Math.max(0, a.r * a.r - x * x))
    const mid: Vec2 = [a.c[0] + d[0] * x / len, a.c[1] + d[1] * x / len]
    points = [[mid[0] - d[1] * h / len, mid[1] + d[0] * h / len], [mid[0] + d[1] * h / len, mid[1] - d[0] * h / len]]
  }
  return points.filter(p => parameter(a, p) !== null && parameter(b, p) !== null)
}

/** Remove only the clicked span between existing intersections. Target constraints
 * are discarded because they no longer describe its new endpoints/length. */
export function trimAt(input: Sketch, entityId: number, point: Vec2): SketchEditResult {
  const e = entityOf(input, entityId)
  if (!e || (e.kind !== 'line' && e.kind !== 'arc' && e.kind !== 'circle')) return fail('Trim supports a line, arc or circle at an intersection.')
  if (e.projected) return fail('Projected geometry must be detached before trimming.')
  if (!point.every(Number.isFinite)) return fail('The trim point must be finite.')
  const t = parameter(e, point)
  if (t === null) return fail('Click on the span to trim.')
  const cuts = input.entities.flatMap(other => other.id !== e.id && (other.kind === 'line' || other.kind === 'arc' || other.kind === 'circle') ? intersections(e, other).map(p => parameter(e, p)!) : [])
    .filter(x => e.kind === 'circle' || (x > EPS && x < 1 - EPS)).sort((a, b) => a - b).filter((x, i, a) => !i || Math.abs(x - a[i - 1]) > EPS)
  if (!cuts.length || (e.kind === 'circle' && cuts.length < 2)) return fail('The selected span needs intersections with other sketch pieces.')
  const sketch = cloneSketch(input)
  removeEntities(sketch, [e.id])
  const spans: [number, number][] = []
  if (e.kind === 'circle') {
    const lower = [...cuts].reverse().find(x => x < t - EPS) ?? cuts[cuts.length - 1] - 1
    const upper = cuts.find(x => x > t + EPS) ?? cuts[0] + 1
    if (cuts.some(x => Math.abs(x - t) < EPS)) return fail('Click inside the span, away from an intersection.')
    spans.push([upper, lower + 1])
  } else {
    const limits = [0, ...cuts, 1], i = limits.findIndex((x, i) => i < limits.length - 1 && t >= x && t <= limits[i + 1])
    if (i < 0 || cuts.some(x => Math.abs(x - t) < EPS)) return fail('Click inside the span, away from an intersection.')
    if (limits[i] > EPS) spans.push([0, limits[i]])
    if (limits[i + 1] < 1 - EPS) spans.push([limits[i + 1], 1])
  }
  const made = spans.filter(([a, b]) => b - a > EPS).map(([a, b]) => addEntity(sketch, e.kind === 'line'
    ? { kind: 'line', a: lerp(e.a, e.b, a), b: lerp(e.a, e.b, b), ...(e.construction ? { construction: true } : {}) }
    : { kind: 'arc', c: [...e.c], r: e.r, start: mod((e.kind === 'arc' ? e.start : 0) + a * (e.kind === 'arc' ? e.sweep : TAU)), sweep: (b - a) * (e.kind === 'arc' ? e.sweep : TAU), ...(e.construction ? { construction: true } : {}) }))
  return good(sketch, made)
}

export function slotSketch(input: Sketch, from: Vec2, to: Vec2, width: number): SketchEditResult {
  const d = sub(to, from), length = norm(d), r = width / 2
  if (![...from, ...to, width].every(Number.isFinite) || length < EPS || r <= EPS) return fail('A slot needs two different centres and a positive width.')
  const n: Vec2 = [-d[1] / length, d[0] / length], phi = Math.atan2(n[1], n[0])
  const offset = (p: Vec2, side: number): Vec2 => [p[0] + n[0] * r * side, p[1] + n[1] * r * side]
  const sketch = cloneSketch(input)
  const l = addEntity(sketch, { kind: 'line', a: offset(from, 1), b: offset(to, 1) })
  const end = addEntity(sketch, { kind: 'arc', c: [...to], r, start: phi + Math.PI, sweep: Math.PI })
  const right = addEntity(sketch, { kind: 'line', a: offset(to, -1), b: offset(from, -1) })
  const start = addEntity(sketch, { kind: 'arc', c: [...from], r, start: phi, sweep: Math.PI })
  for (const [a, at, b, bt] of [[l, 'b', end, 'b'], [end, 'a', right, 'a'], [right, 'b', start, 'b'], [start, 'a', l, 'a']] as const) addConstraint(sketch, { kind: 'coincident', p: { entity: a, at }, q: { entity: b, at: bt } })
  for (const [a, b] of [[l, end], [right, end], [right, start], [l, start]]) addConstraint(sketch, { kind: 'tangent', a, b })
  addConstraint(sketch, { kind: 'equal', a: end, b: start })
  return good(sketch, [l, end, right, start])
}


/** Arc leaving a selected line end tangent to that line, with an optional joined end. */
export function tangentArcSketch(input: Sketch, lineId: number, at: 'a' | 'b', point: Vec2, end?: { entity: number; at: 'a' | 'b' }): SketchEditResult {
  const line = entityOf(input, lineId)
  if (line?.kind !== 'line') return fail('Start a tangent arc at a line endpoint.')
  const d = sub(line.b, line.a), length = norm(d)
  if (length < EPS || !point.every(Number.isFinite)) return fail('The tangent line must have a length and the endpoint must be finite.')
  const start = line[at], sign = at === 'b' ? 1 : -1
  const shape = tangentArc(start, [sign * d[0] / length, sign * d[1] / length], point)
  if (!shape) return fail('Move the endpoint away from the straight tangent direction to form an arc.')
  if (end && end.entity === lineId) return fail('The second endpoint must belong to a different piece.')
  const endpoint = end ? entityOf(input, end.entity) : null
  if (end && (!endpoint || endpoint.kind !== 'line' || !near(endpoint[end.at], point))) return fail('The endpoint reference no longer matches the picked line end.')
  const sketch = cloneSketch(input), { startsAtP, ...arc } = shape
  const id = addEntity(sketch, { kind: 'arc', ...arc })
  addConstraint(sketch, { kind: 'coincident', p: { entity: id, at: startsAtP ? 'a' : 'b' }, q: { entity: lineId, at } })
  addConstraint(sketch, { kind: 'tangent', a: id, b: lineId })
  if (end) addConstraint(sketch, { kind: 'coincident', p: { entity: id, at: startsAtP ? 'b' : 'a' }, q: end })
  return good(sketch, [id])
}
