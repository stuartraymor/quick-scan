// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../../src/core/types'
import { add, cross, dot, normalize, sub } from '../../../../src/core/vec'
import type { ReKernel, Shape } from '../kernel'
import type { SurfaceAxis } from '../surfaceStep'
import { edgeKey, topology, vertexAt, type Cage } from './cage'
import { cagePatches, type PatchGrid } from './patches'
import { snapRayReach } from './snap'

export interface SmoothSnapReference {
  tolerance?: number
  closest(point: Vec3): Vec3 | null
  projectAlong(point: Vec3, axis: Vec3, reach: number): Vec3 | null
}

const CHORD = .001
const FIT_TOLERANCE = .01
const CONTROL_PITCH = .08
const FINE_CONTROL_PITCH = .04
const MAX_CONTROL_POLES = 100_000

function within(k: ReKernel, shape: Shape, reference: SmoothSnapReference, tolerance: number): boolean {
  const { positions, indices, faults } = k.mesh(shape, CHORD)
  if (!indices.length || faults) return false
  const test = (p: Vec3) => {
    const q = reference.closest(p)
    return !!q && Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) <= tolerance
  }
  const point = (at: number): Vec3 => [positions[3 * at], positions[3 * at + 1], positions[3 * at + 2]]
  for (let i = 0; i < positions.length / 3; i++) if (!test(point(i))) return false
  const sample = (a: Vec3, b: Vec3, c?: Vec3): Vec3 => {
    const divisor = c ? 3 : 2
    return [(a[0] + b[0] + (c?.[0] ?? 0)) / divisor,
      (a[1] + b[1] + (c?.[1] ?? 0)) / divisor,
      (a[2] + b[2] + (c?.[2] ?? 0)) / divisor]
  }
  for (let i = 0; i < indices.length; i += 3) {
    const a = point(indices[i]), b = point(indices[i + 1]), c = point(indices[i + 2])
    if (!test(sample(a, b)) || !test(sample(b, c)) || !test(sample(c, a)) || !test(sample(a, b, c))) return false
  }
  return true
}

function space(spans: number): { axis: SurfaceAxis; sites: number[] } {
  const degree = 3, count = spans + degree
  const knots = Array.from({ length: spans + 1 }, (_, i) => i / spans)
  const mults = knots.map((_, i) => i === 0 || i === spans ? degree + 1 : 1)
  const full = knots.flatMap((k, i) => Array<number>(mults[i]).fill(k))
  const sites = Array.from({ length: count }, (_, i) => (full[i + 1] + full[i + 2] + full[i + 3]) / 3)
  return { axis: { degree, count, knots, mults }, sites }
}

function chart(grid: PatchGrid, u: number, v: number): Vec3 {
  const row = u * (grid.rows - 1), col = v * (grid.cols - 1)
  const r = Math.min(Math.floor(row), grid.rows - 2), c = Math.min(Math.floor(col), grid.cols - 2)
  const a = 3 * (r * grid.cols + c), b = a + 3 * grid.cols
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const p = grid.points
  return [0, 1, 2].map(i => lerp(
    lerp(p[a + i], p[b + i], row - r),
    lerp(p[a + i + 3], p[b + i + 3], row - r), col - c,
  )) as Vec3
}

function lengthAlong(grid: PatchGrid, axis: number, at: number): number {
  const path = (t: number) => axis === 0 ? chart(grid, t, at) : chart(grid, at, t)
  let last = path(0), length = 0
  for (let i = 1; i <= 8; i++) {
    const p = path(i / 8)
    length += Math.hypot(...sub(p, last))
    last = p
  }
  return length
}

/** Refit a bounded, open quad cage in a common projection chart. Uniform
 * cubic bases reproduce flat spans and round the scan's triangle hinges
 * locally. Identical knots and projected poles on shared edges sew the
 * independently fitted quadrants. */
export function smoothSnappedSheet(k: ReKernel, cage: Cage, original: Shape, reference: SmoothSnapReference): Shape | null {
  const axis = refitDirection(cage)
  if (!axis) return null
  const top = topology(cage)
  const tolerance = reference.tolerance ?? FIT_TOLERANCE
  try {
    if (tolerance <= CHORD || within(k, original, reference, tolerance)) return null
    const patch = cagePatches(cage, 3, undefined, 1)
    const reach = snapRayReach(cage) * .35
    const fit = fitChart(k, patch, top, reference, axis, reach, tolerance, CONTROL_PITCH)
    return fit ?? (reference.tolerance === undefined ? null
      : fitChart(k, patch, top, reference, axis, reach, tolerance, FINE_CONTROL_PITCH))
  } catch {
    // A folded chart or unavailable measurement leaves the existing body intact.
    return null
  }
}

export function refitDirection(cage: Cage): Vec3 | null {
  if (cage.faces.length > 32 || cage.creases.length || cage.faces.some(face => face.length !== 4)) return null
  if (topology(cage).closed) return null
  const normals = cage.faces.map(face => {
    const [a, b, c, d] = face.map(i => vertexAt(cage, i))
    return add(cross(sub(b, a), sub(c, a)), cross(sub(c, a), sub(d, a)))
  })
  const axis = normalize(normals.reduce(add, [0, 0, 0] as Vec3))
  return axis && normals.every(n => dot(n, axis) > 1e-9) ? axis : null
}

/** A drag on a refitted sheet must preserve the orientation at every
 * corner in the source projection. An inward pull can pass a total-area
 * check while overlapping the face it came from. */
export function preservesRefitOrientation(cage: Cage, axis: Vec3): boolean {
  return cage.faces.every(face => face.length === 4 && face.every((v, i) => {
    const p = vertexAt(cage, v)
    const next = sub(vertexAt(cage, face[(i + 1) % 4]), p)
    const previous = sub(vertexAt(cage, face[(i + 3) % 4]), p)
    return dot(cross(next, previous), axis) > 1e-9
  }))
}

function fitChart(k: ReKernel, { blocks, grids }: ReturnType<typeof cagePatches>, top: ReturnType<typeof topology>,
  reference: SmoothSnapReference, axis: Vec3, reach: number, tolerance: number, pitch: number): Shape | null {
  const faces: Shape[] = []
  let sewn: Shape | undefined
  try {
    const counts = grids.map(grid => [0, 1].map(direction =>
      Math.max(2, Math.ceil(Math.max(...[0, .5, 1].map(t => lengthAlong(grid, direction, t))) / pitch))))
    const edges = new Map<string, [number, number][]>()
    blocks.forEach(({ vertices: [a, b, c, d] }, i) => {
      for (const [j, k, axis] of [[a, c, 0], [b, d, 0], [a, b, 1], [c, d, 1]]) {
        const key = edgeKey(j, k)
        const list = edges.get(key) ?? []
        list.push([i, axis])
        edges.set(key, list)
      }
    })
    let changed = true
    while (changed) {
      changed = false
      for (const owners of edges.values()) {
        const count = Math.max(...owners.map(([i, a]) => counts[i][a]))
        for (const [i, a] of owners) if (counts[i][a] < count) { counts[i][a] = count; changed = true }
      }
    }
    if (counts.some(c => c.some(n => n > 256)) ||
        counts.reduce((sum, [u, v]) => sum + (u + 3) * (v + 3), 0) > MAX_CONTROL_POLES) return null
    for (const [i, grid] of grids.entries()) {
      const u = space(counts[i][0]), v = space(counts[i][1])
      const poles: Vec3[] = []
      for (const a of u.sites) for (const b of v.sites) {
        const p = chart(grid, a, b)
        const nearest = reference.closest(p)
        const q = reference.projectAlong(p, axis, reach)
        if (!q || !nearest || Math.hypot(...sub(q, p)) > 2 * Math.hypot(...sub(nearest, p)) + .25) return null
        poles.push(q)
      }
      faces.push(k.surfaceFromControlNet({ u: u.axis, v: v.axis, poles }))
    }
    sewn = k.sewPatches(faces, .001, false)
    if (!k.isValid(sewn) || k.faceCount(sewn) !== faces.length) return null
    const { boundary, shared, nonManifold } = k.edgeUses(sewn)
    if (nonManifold || boundary !== top.edges.filter(e => e.faces.length === 1).length ||
        shared !== top.edges.filter(e => e.faces.length === 2).length ||
        !within(k, sewn, reference, tolerance - CHORD)) return null
    const result = sewn
    sewn = undefined
    return result
  } catch {
    // A folded chart, missing ray, or unsewn fit cannot replace the existing body.
    return null
  } finally {
    if (sewn !== undefined) k.release(sewn)
    k.release(...faces)
  }
}
