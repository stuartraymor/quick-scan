// SPDX-License-Identifier: AGPL-3.0-only
import type { OcctLike, XYZ } from './occtTypes'
import { asSolid, loneSolid } from './kernelOps'
import { orientedChain, validLaw, type RadiusPoint } from './roundInputs'

function distance(a: XYZ, b: XYZ): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

/** Place the station at a fraction of edge length, including on splines with nonuniform knots. */
function parameterAt(o: OcctLike, edge: number, first: number, last: number, t: number): number {
  if (t === 0 || t === 1 || ['line', 'circle'].includes(o.curveType(edge).toLowerCase())) return first + (last - first) * t
  const wanted = o.curveLength(edge) * t
  let lo = first, hi = last
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    const [a, b] = o.curveSplit(edge, mid)
    try {
      if (o.curveLength(a) < wanted) lo = mid
      else hi = mid
    } finally { o.release(a); o.release(b) }
  }
  return (lo + hi) / 2
}

/** Split only the selected topological edge at its stations. Fillet the resulting tangent
 * segments together, naming their radii in the direction of each segment's own curve. */
export function stationFillet(o: OcctLike, solid: number, picked: number[], ends: [number, number], points: RadiusPoint[]) {
  if (!validLaw(ends, points)) throw new Error('Use increasing positions between 0 and 100% and positive finite radii.')
  const remaining = picked.map(edge => {
    const { first, last } = o.curveParameters(edge)
    return { edge, first, last, from: o.curvePointAtParam(edge, first), to: o.curvePointAtParam(edge, last), length: o.curveLength(edge), reverse: false }
  })
  const total = remaining.reduce((s, edge) => s + edge.length, 0)
  const tol = Math.max(1e-7, total * 1e-8)
  const path = orientedChain(remaining, distance, tol)
  const start = path[0], end = path[path.length - 1]
  if (distance(start.reverse ? start.to : start.from, end.reverse ? end.from : end.to) < tol && Math.abs(ends[0] - ends[1]) > 1e-7)
    throw new Error('A closed edge needs matching radii at 0% and 100%.')
  const law = [{ position: 0, radius: ends[0] }, ...points, { position: 1, radius: ends[1] }]
  const radiusAt = (t: number) => {
    const j = law.findIndex((p, i) => i > 0 && p.position >= t - 1e-10)
    const a = law[j - 1], b = law[j]
    const u = (t - a.position) / (b.position - a.position)
    return a.radius + (b.radius - a.radius) * u
  }
  const owned: number[] = []
  try {
    const intervals: { a: XYZ; b: XYZ; mid: XYZ; r1: number; r2: number }[] = []
    let length = 0
    for (const edge of path) {
      const lo = length / total, hi = (length + edge.length) / total
      const positions = [lo, ...points.map(p => p.position).filter(t => t > lo + 1e-9 && t < hi - 1e-9), hi]
      const parameters = positions.map((t, i) => {
        const u = i === 0 ? 0 : i === positions.length - 1 ? 1 : (t - lo) / (hi - lo)
        return parameterAt(o, edge.edge, edge.first, edge.last, edge.reverse ? 1 - u : u)
      })
      const locations = parameters.map(u => o.curvePointAtParam(edge.edge, u))
      for (const p of locations.slice(1, -1)) owned.push(o.makeVertex(p.x, p.y, p.z))
      for (let i = 1; i < positions.length; i++)
        intervals.push({ a: locations[i - 1], b: locations[i], mid: o.curvePointAtParam(edge.edge, (parameters[i - 1] + parameters[i]) / 2), r1: radiusAt(positions[i - 1]), r2: radiusAt(positions[i]) })
      length += edge.length
    }
    const split = owned.length ? loneSolid(o, o.split(solid, owned)) : solid
    if (split !== solid) owned.push(split)
    const edges = o.getSubShapes(split, 'edge')
    owned.push(...edges)
    const available = new Set(edges)
    const selected: number[] = []
    const laws: { start: number; end: number }[] = []
    for (const { a, b, mid, r1, r2 } of intervals) {
      let matched = false
      for (const h of available) {
        const range = o.curveParameters(h)
        if (distance(mid, o.curvePointAtParam(h, (range.first + range.last) / 2)) > tol) continue
        const start = o.curvePointAtParam(h, range.first), end = o.curvePointAtParam(h, range.last)
        const forward = distance(start, a) < tol && distance(end, b) < tol
        if (!forward && !(distance(start, b) < tol && distance(end, a) < tol)) continue
        selected.push(h)
        laws.push(forward ? { start: r1, end: r2 } : { start: r2, end: r1 })
        available.delete(h)
        matched = true
        break
      }
      if (!matched) throw new Error('Could not divide the selected edge at these positions.')
    }
    return asSolid(o, o.fillet(split, selected, laws))
  } finally { for (const h of owned) o.release(h) }
}
