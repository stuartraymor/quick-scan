// SPDX-License-Identifier: AGPL-3.0-only
// Independent brush selection and fitting, using the application's measured
// section points and established TLS/circle kernels. No display-only geometry.
import type { Vec2 } from '../../../src/core/flat/types'
import { fitArcPoints, fitCirclePoints, fitLinePoints } from '../../../src/core/flat/fit'
import { addConstraint, addEntity, cloneSketch, nearestOnEntity, renumbered, type ConstraintInput, type EntityInput, type Sketch, type SketchEntity } from './sketch'
import { splineScatter } from './sketchSpline'
import { fitControlSpline } from './controlSpline'
import { fitBrushClosedShape } from './sketchBrushShapes'

export type BrushPrimitive = 'line' | 'arc' | 'circle' | 'curve' | 'rectangle' | 'slot' | 'hexagon'
export interface BrushPoint { key: string; chain: number; index: number; p: Vec2 }
export interface BrushFitOptions { tolerance: number; axisDegrees: number; curvePoints: number }
export type BrushFit = { ok: true; entity: EntityInput; maxDeviation: number; axis?: 'horizontal' | 'vertical'; shapeSketch?: Sketch } | { ok: false; error: string }

export function brushPoints(chains: readonly (readonly Vec2[])[]): BrushPoint[] {
  return chains.flatMap((chain, c) => chain.flatMap((p, i) => p.every(Number.isFinite) ? [{ key: `${c}:${i}`, chain: c, index: i, p: [p[0], p[1]] as Vec2 }] : []))
}

/** Distance to a swept brush, so fast pointer motion leaves no holes. */
export function brushedPoints(points: readonly BrushPoint[], from: Vec2, to: Vec2, radius: number): BrushPoint[] {
  if (!(radius > 0) || ![...from, ...to, radius].every(Number.isFinite)) return []
  const dx = to[0] - from[0], dy = to[1] - from[1], length2 = dx * dx + dy * dy
  return points.filter(({ p }) => {
    const t = length2 > 0 ? Math.max(0, Math.min(1, ((p[0] - from[0]) * dx + (p[1] - from[1]) * dy) / length2)) : 0
    return (p[0] - from[0] - dx * t) ** 2 + (p[1] - from[1] - dy * t) ** 2 <= radius ** 2
  })
}

/**
 * Orthogonal least-squares line with each point weighted by the length of
 * section it stands for: half the distance to each neighbour along its chain
 * that is also highlighted. QUICKSURFACE 8.0.128's Fit Line weighs points
 * this way, measured 2026-11-04 (analysis/fit-accuracy-2026-11-04,
 * make-profile.mjs): on an edge whose one half was sectioned 8× denser and
 * stood 0.03 mm low it lay 0.09 µm from the length-weighted line and 11 µm
 * from the one counting points. A point with no highlighted neighbour counts
 * as the median spacing.
 */
function lineByLength(selected: readonly BrushPoint[], unique: readonly BrushPoint[]): { center: Vec2; dir: Vec2; weights: number[] } {
  const at = new Map(selected.map((p) => [`${p.chain}:${p.index}`, p.p]))
  const gaps: number[] = []
  const halves = selected.map((s) => {
    let sum = 0, sides = 0
    for (const d of [-1, 1]) {
      const q = at.get(`${s.chain}:${s.index + d}`)
      if (q) { const g = Math.hypot(q[0] - s.p[0], q[1] - s.p[1]); sum += g / 2; sides++; if (g > 0) gaps.push(g) }
    }
    return sides ? sum : NaN
  })
  gaps.sort((a, b) => a - b)
  const lone = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1
  // Compute adjacency BEFORE merging coordinates. Repeated section vertices
  // contribute zero-length edges, not artificial gaps or extra median weights.
  const combined = new Map<string, number>()
  selected.forEach((s, i) => {
    const key = `${s.p[0]}:${s.p[1]}`
    combined.set(key, (combined.get(key) ?? 0) + (Number.isFinite(halves[i]) ? halves[i] : lone))
  })
  // A coordinate represented only by zero-length runs is still an isolated
  // sample. Apply the fallback once per coordinate, not per repeated vertex.
  const w = unique.map(s => combined.get(`${s.p[0]}:${s.p[1]}`) || lone)
  const origin = unique[0].p
  let sw = 0, mx = 0, my = 0
  unique.forEach((s, i) => { sw += w[i]; mx += w[i] * (s.p[0] - origin[0]); my += w[i] * (s.p[1] - origin[1]) })
  mx /= sw; my /= sw
  let sxx = 0, sxy = 0, syy = 0
  unique.forEach((s, i) => { const x = s.p[0] - origin[0] - mx, y = s.p[1] - origin[1] - my; sxx += w[i] * x * x; sxy += w[i] * x * y; syy += w[i] * y * y })
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  let dir: Vec2 = [Math.cos(theta), Math.sin(theta)]
  if (dir[0] < 0 || (dir[0] === 0 && dir[1] < 0)) dir = [-dir[0], -dir[1]]
  return { center: [mx + origin[0], my + origin[1]], dir, weights: w }
}

export function fitBrushPrimitive(kind: BrushPrimitive, selected: readonly BrushPoint[], options: BrushFitOptions): BrushFit {
  if (!(options.tolerance > 0) || !Number.isFinite(options.tolerance)) return { ok: false, error: 'Target tolerance must be greater than zero.' }
  const identities = [...new Map(selected.map((p) => [`${p.chain}:${p.index}`, p])).values()]
  const unique = [...new Map(identities.map((p) => [`${p.p[0]}:${p.p[1]}`, p])).values()]
  const points = unique.map((p) => p.p)
  const min = kind === 'line' ? 2 : kind === 'curve' ? 4 : 3
  if (points.length < min) return { ok: false, error: `Highlight at least ${min} distinct section points to fit ${kind === 'curve' ? 'a curve' : `a ${kind}`}.` }
  if (points.some((p) => !p.every(Number.isFinite))) return { ok: false, error: 'The selected points contain invalid coordinates.' }
  if (kind === 'rectangle' || kind === 'slot' || kind === 'hexagon') {
    const fit = fitBrushClosedShape(kind, points, options.tolerance)
    if (typeof fit === 'string') return { ok: false, error: fit }
    const { id: _id, ...entity } = fit.sketch.entities.find((e) => !e.construction)!
    return { ok: true, entity, shapeSketch: fit.sketch, maxDeviation: fit.maxDeviation }
  }
  let entity: EntityInput
  let axis: 'horizontal' | 'vertical' | undefined
  try {
    if (kind === 'line') {
      fitLinePoints(points) // its checks and messages for degenerate points
      const fit = lineByLength(identities, unique)
      const angle = Math.atan2(fit.dir[1], fit.dir[0])
      const limit = Math.max(0, Math.min(45, options.axisDegrees)) * Math.PI / 180
      let dir = fit.dir
      if (limit > 0 && Math.abs(Math.sin(angle)) < Math.sin(limit)) { dir = [1, 0]; axis = 'horizontal' }
      else if (limit > 0 && Math.abs(Math.cos(angle)) < Math.sin(limit)) { dir = [0, 1]; axis = 'vertical' }
      // Snapped or not, the line runs through the points' weighted centre.
      const projections = points.map((p) => (p[0] - fit.center[0]) * dir[0] + (p[1] - fit.center[1]) * dir[1])
      const lo = Math.min(...projections), hi = Math.max(...projections)
      // Scatter describes this final carrier, including an inferred H/V hold.
      // Using the free TLS direction understates its residual after snapping.
      const sumSquared = points.reduce((sum, p) => sum + (-(p[0] - fit.center[0]) * dir[1] + (p[1] - fit.center[1]) * dir[0]) ** 2, 0)
      entity = { kind: 'line', a: [fit.center[0] + lo * dir[0], fit.center[1] + lo * dir[1]], b: [fit.center[0] + hi * dir[0], fit.center[1] + hi * dir[1]], points: points.map((p) => [...p]), pointWeights: fit.weights, scatter: Math.max(Math.sqrt(sumSquared / points.length), 0.001) }
    } else if (kind === 'curve') {
      if (new Set(identities.map((p) => p.chain)).size !== 1) return { ok: false, error: 'Fit Curve needs one connected section chain. Highlight one contour at a time.' }
      const orderedPoints = [...identities].sort((a, b) => a.index - b.index)
      if (orderedPoints.some((p, i) => i > 0 && p.index > orderedPoints[i - 1].index + 1)) return { ok: false, error: 'Fit Curve needs a continuous highlighted run. Fill the gaps between the selected points.' }
      // Zero-length edges are continuous. Collapse only adjacent duplicates
      // after checking the original indices; retain nonadjacent revisits.
      const ordered = orderedPoints.filter((p, i) => !i || p.p[0] !== orderedPoints[i - 1].p[0] || p.p[1] !== orderedPoints[i - 1].p[1]).map((p) => p.p)
      const count = Math.max(4, Math.min(64, Math.round(options.curvePoints)))
      const curve = fitControlSpline(ordered, count)
      const data = ordered.map((p): Vec2 => [...p])
      entity = { kind: 'spline', ...curve, points: data, scatter: Math.max(splineScatter({ ...curve, points: data }), 0.001) }
    } else {
      const fit = kind === 'arc' ? fitArcPoints(points) : fitCirclePoints(points)
      entity = kind === 'arc' && fit.kind === 'arc'
        ? { kind: 'arc', c: fit.center, r: fit.radius, start: fit.start, sweep: fit.sweep, points: points.map((p) => [...p]), scatter: Math.max(fit.sigma, 0.001) }
        : { kind: 'circle', c: fit.center, r: fit.radius, points: points.map((p) => [...p]), scatter: Math.max(fit.sigma, 0.001) }
    }
    const candidate = { ...entity, id: 0 } as SketchEntity
    let maxDeviation = 0
    for (const p of points) maxDeviation = Math.max(maxDeviation, nearestOnEntity(candidate, p).dist)
    // As in QUICKSURFACE, the target tolerance governs Fit Curve only: a line,
    // arc or circle is the best fit to the points, however far they stray —
    // the panel says by how much.
    if (!Number.isFinite(maxDeviation)) return { ok: false, error: `The highlighted points do not define this ${kind}.` }
    // units-ok: kernel/API diagnostic reports model-space millimetres explicitly.
  if (kind === 'curve' && maxDeviation > options.tolerance) return { ok: false, error: `The curve misses the highlighted points by ${maxDeviation.toFixed(3)} mm; target tolerance is ${options.tolerance} mm.` }
    return { ok: true, entity, maxDeviation, ...(axis ? { axis } : {}) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'The highlighted points do not define this primitive.' }
  }
}

/** Copy before mutation. Invalid fits never enter history or alter a draft. */
export function sketchWithBrushFit(sketch: Sketch, fit: BrushFit): Sketch | null {
  if (!fit.ok) return null
  const next = cloneSketch(sketch)
  if (fit.shapeSketch) {
    const ids = new Map<number, number>()
    for (const { id, ...entity } of fit.shapeSketch.entities) ids.set(id, addEntity(next, entity))
    for (const { id: _id, ...constraint } of fit.shapeSketch.constraints) addConstraint(next, renumbered(constraint as ConstraintInput, (id) => ids.get(id)!))
    return next
  }
  const id = addEntity(next, fit.entity)
  if (fit.axis) addConstraint(next, { kind: fit.axis, entity: id, inferred: true })
  return next
}
