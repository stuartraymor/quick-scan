// SPDX-License-Identifier: AGPL-3.0-only
// Bounded independent contour fitting for closed primitives. Optimization
// seeds use a bounded sample; acceptance and assigned soft data use every
// highlighted point, and require evidence on every side of the contour.
import type { Vec2 } from '../../../src/core/flat/types'
import { addConstraint, addEntity, addPolygon, emptySketch, nearestOnEntity, type Sketch, type SketchEntity } from './sketch'

export type BrushClosedShape = 'rectangle' | 'slot' | 'hexagon'
interface ShapeFit { sketch: Sketch; maxDeviation: number }
const tau = Math.PI * 2

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], ll = dx * dx + dy * dy
  const t = ll > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ll)) : 0
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t)
}

/** Params are centre x/y, angle, half-width (slot centre half-distance or
 *  hexagon circumradius), half-height (slot radius). */
function residual(kind: BrushClosedShape, p: Vec2, q: readonly number[]): number {
  const c = Math.cos(q[2]), s = Math.sin(q[2]), x = (p[0] - q[0]) * c + (p[1] - q[1]) * s, y = -(p[0] - q[0]) * s + (p[1] - q[1]) * c
  if (kind === 'slot') return Math.abs(Math.hypot(Math.max(0, Math.abs(x) - q[3]), y) - q[4])
  if (kind === 'rectangle') {
    const dx = Math.abs(x) - q[3], dy = Math.abs(y) - q[4]
    return Math.abs(Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0))
  }
  let dist = Infinity
  for (let i = 0; i < 6; i++) dist = Math.min(dist, distanceToSegment([x, y], [q[3] * Math.cos(i * tau / 6), q[3] * Math.sin(i * tau / 6)], [q[3] * Math.cos((i + 1) * tau / 6), q[3] * Math.sin((i + 1) * tau / 6)]))
  return dist
}

export function fitBrushClosedShape(kind: BrushClosedShape, input: readonly Vec2[], tolerance: number): ShapeFit | string {
  if (input.length < (kind === 'hexagon' ? 18 : 12)) return 'Highlight the complete contour, including every side, to fit this shape.'
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of input) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
  const size = Math.max(maxX - minX, maxY - minY), origin: Vec2 = [(minX + maxX) / 2, (minY + maxY) / 2]
  if (!(size > 1e-9)) return 'The highlighted points do not span a closed shape.'
  const points: Vec2[] = input.map((p) => [(p[0] - origin[0]) / size, (p[1] - origin[1]) / size])
  const step = Math.max(1, Math.ceil(points.length / 384)), sample = points.filter((_, i) => i % step === 0)
  const loss = (q: number[]) => {
    if (!(q[3] > 1e-6) || (kind !== 'hexagon' && !(q[4] > 1e-6))) return Infinity
    let sum = 0
    for (const p of sample) sum += residual(kind, p, q) ** 2
    return sum / sample.length
  }
  let best: number[] = [], bestLoss = Infinity
  const span = kind === 'hexagon' ? Math.PI / 3 : kind === 'rectangle' ? Math.PI / 2 : Math.PI
  for (let seed = 0; seed < 24; seed++) {
    const a = span * seed / 24, c = Math.cos(a), s = Math.sin(a)
    let loX = Infinity, hiX = -Infinity, loY = Infinity, hiY = -Infinity
    for (const [px, py] of sample) { const x = px * c + py * s, y = -px * s + py * c; loX = Math.min(loX, x); hiX = Math.max(hiX, x); loY = Math.min(loY, y); hiY = Math.max(hiY, y) }
    const cx = (hiX + loX) / 2, cy = (hiY + loY) / 2, hw = (hiX - loX) / 2, hh = (hiY - loY) / 2
    const q = [cx * c - cy * s, cx * s + cy * c, a, kind === 'slot' ? Math.max(1e-4, hw - hh) : hw, hh]
    const steps = [0.04, 0.04, span / 32, 0.04, 0.04]
    let value = loss(q)
    for (let level = 0; level < 20; level++) {
      let moved = false
      for (let j = 0; j < (kind === 'hexagon' ? 4 : 5); j++) {
        const saved = q[j]
        let winner = saved
        for (const sign of [-1, 1]) { q[j] = saved + sign * steps[j]; const next = loss(q); if (next < value) { value = next; winner = q[j]; moved = true } }
        q[j] = winner
      }
      if (!moved) for (let j = 0; j < steps.length; j++) steps[j] *= 0.5
    }
    if (value < bestLoss) { bestLoss = value; best = [...q] }
  }
  if (!best.length) return 'The highlighted points do not define this shape.'
  // Refine the best basin to a much tighter scale than the UI tolerance.
  const q = best, steps = [0.001, 0.001, 0.003, 0.001, 0.001]
  let value = loss(q)
  for (let level = 0; level < 65; level++) {
    let moved = false
    for (let j = 0; j < (kind === 'hexagon' ? 4 : 5); j++) {
      const saved = q[j]; let winner = saved
      for (const sign of [-1, 1]) { q[j] = saved + sign * steps[j]; const next = loss(q); if (next < value) { value = next; winner = q[j]; moved = true } }
      q[j] = winner
    }
    if (!moved) for (let j = 0; j < steps.length; j++) steps[j] *= 0.5
  }
  let maxDeviation = 0
  for (const p of points) maxDeviation = Math.max(maxDeviation, residual(kind, p, q) * size)
  // The best rectangle, slot or hexagon, however far the points stray — the
  // target tolerance is Fit Curve's only, as in QUICKSURFACE.
  if (!Number.isFinite(maxDeviation)) return `The highlighted points do not define this ${kind}.`
  const center: Vec2 = [origin[0] + q[0] * size, origin[1] + q[1] * size], angle = q[2], c = Math.cos(angle), s = Math.sin(angle)
  const place = (x: number, y: number): Vec2 => [center[0] + size * (x * c - y * s), center[1] + size * (x * s + y * c)]
  const sketch = emptySketch()
  let ids: number[]
  if (kind === 'rectangle') {
    const corners = [[-q[3], -q[4]], [q[3], -q[4]], [q[3], q[4]], [-q[3], q[4]]].map(([x, y]) => place(x, y))
    ids = corners.map((a, i) => addEntity(sketch, { kind: 'line', a, b: corners[(i + 1) % 4] }))
    for (let i = 0; i < 4; i++) addConstraint(sketch, { kind: 'coincident', p: { entity: ids[i], at: 'b' }, q: { entity: ids[(i + 1) % 4], at: 'a' } })
    addConstraint(sketch, { kind: 'parallel', a: ids[0], b: ids[2] }); addConstraint(sketch, { kind: 'parallel', a: ids[1], b: ids[3] }); addConstraint(sketch, { kind: 'perpendicular', a: ids[0], b: ids[1] })
  } else if (kind === 'hexagon') {
    const made = addPolygon(sketch, center, place(q[3], 0), 6, 'inscribed')
    if (!made) return 'The highlighted points do not define a hexagon.'
    ids = made.lines
  } else {
    const h = q[3], r = q[4], radius = r * size
    const left = addEntity(sketch, { kind: 'line', a: place(-h, r), b: place(h, r) })
    const rightEnd = addEntity(sketch, { kind: 'arc', c: place(h, 0), r: radius, start: angle - Math.PI / 2, sweep: Math.PI })
    const right = addEntity(sketch, { kind: 'line', a: place(h, -r), b: place(-h, -r) })
    const leftEnd = addEntity(sketch, { kind: 'arc', c: place(-h, 0), r: radius, start: angle + Math.PI / 2, sweep: Math.PI })
    ids = [left, rightEnd, right, leftEnd]
    for (const [a, at, b, bt] of [[left, 'b', rightEnd, 'b'], [rightEnd, 'a', right, 'a'], [right, 'b', leftEnd, 'b'], [leftEnd, 'a', left, 'a']] as const) addConstraint(sketch, { kind: 'coincident', p: { entity: a, at }, q: { entity: b, at: bt } })
    for (const [a, b] of [[left, rightEnd], [right, rightEnd], [right, leftEnd], [left, leftEnd]]) addConstraint(sketch, { kind: 'tangent', a, b })
    addConstraint(sketch, { kind: 'equal', a: rightEnd, b: leftEnd })
  }
  const measured = sketch.entities.filter((e) => ids.includes(e.id))
  const assigned = new Map<number, Vec2[]>(measured.map((e) => [e.id, []]))
  for (const p of input) {
    let nearest: SketchEntity | undefined, distance = Infinity
    for (const e of measured) { const d = nearestOnEntity(e, p).dist; if (d < distance) { nearest = e; distance = d } }
    if (nearest) assigned.get(nearest.id)!.push([p[0], p[1]])
  }
  // A rectangle brushed on three sides, as QUICKSURFACE takes it: the side
  // left out closes the shape where the points end (the fit's extent holds
  // it there). Every other shape, and a rectangle with two sides missing,
  // needs every side.
  const bare = measured.filter((e) => assigned.get(e.id)!.length < 2).length
  if (bare > (kind === 'rectangle' ? 1 : 0)) return 'Highlight the complete contour, including both ends and every side.'
  for (const e of measured) if (e.kind !== 'point') { e.points = assigned.get(e.id)!; e.scatter = Math.max(0.001, tolerance / 3) }
  return { sketch, maxDeviation }
}
