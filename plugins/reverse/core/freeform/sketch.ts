// SPDX-License-Identifier: AGPL-3.0-only
// From 3D Sketch (F5 of audit-2026-11-07/FREEFORM_ROADMAP.md): a freeform
// cage laid over each region the sketch's curves close.
//
// QUICKSURFACE's rule, measured on its 8.0.128 (analysis/freeform-2026-11-08):
// a region of n sides is n quads round a centre vertex at Resolution 1 — a
// four-sided region 2 × 2, a five-sided one 5 quads, 11 vertices — and each
// further Resolution cuts every quad 2 × 2. The corners are the sketch's
// nodes exactly. The vertices along a side are not on its curve: they are
// the control points of the boundary's cubic B-spline, set so that the
// surface's limit passes through the curve at equal fractions of its length
// (the native Resolution 1 cage's side-middle vertex stands 8.7 mm outside a
// 100 mm wall, where the curve's middle is on it: 1.5 times the arc's sag
// from the chord, as (c0 + 4m + c1) / 6 = the curve's middle asks) — in x and
// y. In z the vertex keeps the curve's own value (the native centre vertex of
// the arc-sided loop is then 0.01 mm from ours in z, 4.7 mm out with the offset
// in three dimensions). The fractions are by arc length here and by the
// parameter of its own spline in the native, 0.5 – 2 mm apart on this wall. A
// four-sided region's interior is the Coons blend of its four sides' control
// points (the native centre vertex is within 0.14, 1.3 and 0.01 mm of that
// from the native's own sides). The cage is then taken onto the scan by the
// feature's snap, as the native displays it.
//
// Pure: a side is a path by length (`SidePath`); the command reads the sides
// off the network's traces (app/reFreeformSketchCommand.ts).

import { ScanPaths } from '../../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../../src/core/types'
import type { CellSide, GraphCurve, HalfEdge } from '../networkCells'
import type { Cage } from './cage'

/** The most times a region's cage is cut: Resolution 1 is the first cage. */
export const SKETCH_RESOLUTION_MAX = 4

/** What QUICKSURFACE says when the sketch closes no region. */
export const SKETCH_REFUSAL = 'Cannot create freeform surface. Check if the 3d sketch curves overlap and intersect'

export class SketchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SketchError'
  }
}

/** A side of a region as a path, read by the share of its length run. */
export interface SidePath {
  /** The point `s` of the way along, s from 0 to 1. */
  at(s: number): Vec3
}

/** A region as its sides in order round it: side k runs from corner k to corner k + 1. */
export interface SketchCell {
  sides: SidePath[]
}

/** A polyline (x, y, z flat) as a path by length. A polyline of fewer than two points has none. */
export function polylinePath(points: ArrayLike<number>): SidePath {
  const n = Math.floor(points.length / 3)
  if (n < 2) throw new SketchError('A side needs two points at least.')
  const at = new Float64Array(n)
  for (let i = 1; i < n; i++) at[i] = at[i - 1] + Math.hypot(points[i * 3] - points[i * 3 - 3], points[i * 3 + 1] - points[i * 3 - 2], points[i * 3 + 2] - points[i * 3 - 1])
  const total = at[n - 1]
  const point = (i: number): Vec3 => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]]
  return {
    at(s) {
      if (!(total > 0)) return point(0)
      const d = Math.min(1, Math.max(0, s)) * total
      let lo = 0
      let hi = n - 1
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1
        if (at[mid] <= d) lo = mid
        else hi = mid
      }
      const span = at[hi] - at[lo]
      const u = span > 0 ? (d - at[lo]) / span : 0
      const a = point(lo)
      const b = point(hi)
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]
    },
  }
}

/** A cell side's points: its curves' traces end to end, each run the way the side goes. */
export function sidePoints(side: CellSide, curves: ReadonlyMap<number, Pick<GraphCurve, 'trace'>>): Float64Array {
  const out: number[] = []
  for (const e of side.edges as HalfEdge[]) {
    const c = curves.get(e.curve)
    if (!c) throw new SketchError(`A side runs along curve ${e.curve}, which has no trace.`)
    const p = c.trace.points
    const n = p.length / 3
    const skip = out.length > 0 ? 1 : 0
    for (let k = skip; k < n; k++) {
      const i = e.forward ? k : n - 1 - k
      out.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2])
    }
  }
  return Float64Array.from(out)
}

/** The scan as far as the regions reach: their triangles only, so that a cage snapped to it does not jump to another wall of the part — the inner wall of a shell the sketch cuts through, say, which is nearer to a cage that bulges past its curves. */
export function regionScan(scan: ScanPaths, regions: readonly { triangles: Uint32Array }[]): ScanPaths {
  const count = scan.indices.length / 3
  const picked: number[] = []
  for (const r of regions) {
    for (const tri of r.triangles) {
      if (tri >= count) continue
      picked.push(scan.indices[tri * 3], scan.indices[tri * 3 + 1], scan.indices[tri * 3 + 2])
    }
  }
  return new ScanPaths(scan.positions, Uint32Array.from(picked))
}

const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** Vertices welded where two regions share a side: by position to a ten-thousandth of a millimetre. */
class Welder {
  readonly positions: number[] = []
  private readonly index = new Map<string, number>()

  add(p: Vec3): number {
    const key = `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`
    const had = this.index.get(key)
    if (had !== undefined) return had
    const id = this.positions.length / 3
    this.positions.push(p[0], p[1], p[2])
    this.index.set(key, id)
    return id
  }
}

/** The control points of a side's boundary spline: n + 1 points whose cubic B-spline limit (P[i-1] + 4 P[i] + P[i+1]) / 6 is the side's point at i / n of its length, the ends held at the corners. */
export function sideControls(side: SidePath, n: number): Vec3[] {
  const q = Array.from({ length: n + 1 }, (_, i) => side.at(i / n))
  const p = q.map((v) => [...v] as Vec3)
  if (n < 2) return p
  // Thomas' algorithm on the interior rows: P[i-1] + 4 P[i] + P[i+1] = 6 q[i], with P[0] = q[0] and P[n] = q[n].
  const m = n - 1
  const cp = new Float64Array(m)
  const dp = Array.from({ length: m }, () => [0, 0, 0])
  for (let i = 0; i < m; i++) {
    const rhs = [0, 1, 2].map((k) => 6 * q[i + 1][k] - (i === 0 ? q[0][k] : 0) - (i === m - 1 ? q[n][k] : 0))
    const denom = 4 - (i === 0 ? 0 : cp[i - 1])
    cp[i] = 1 / denom
    for (let k = 0; k < 3; k++) dp[i][k] = (rhs[k] - (i === 0 ? 0 : dp[i - 1][k])) / denom
  }
  for (let i = m - 1; i >= 0; i--) {
    for (let k = 0; k < 3; k++) p[i + 1][k] = dp[i][k] - (i === m - 1 ? 0 : cp[i] * p[i + 2][k])
  }
  // QUICKSURFACE does this in the plane of x and y: the vertices stand off the curve there, and keep the curve's own z (measured on its 8.0.128: the side-middle vertex of the two arc sides of the basic_part loop is 0.5 mm from this, 5.6 mm from the three-dimensional rule).
  for (let i = 1; i < n; i++) p[i][2] = q[i][2]
  return p
}

/** The Coons patch of four sides' control points — bottom b, top t (left to right), left l, right r (bottom to top), each m + 1 points — as an m × m grid of quads. */
function coons(w: Welder, faces: number[][], m: number, b: Vec3[], t: Vec3[], l: Vec3[], r: Vec3[]): void {
  const c00 = b[0]
  const c10 = b[m]
  const c01 = t[0]
  const c11 = t[m]
  const grid: number[] = []
  for (let j = 0; j <= m; j++) {
    for (let i = 0; i <= m; i++) {
      const u = i / m
      const v = j / m
      let p: Vec3
      if (j === 0) p = b[i]
      else if (j === m) p = t[i]
      else if (i === 0) p = l[j]
      else if (i === m) p = r[j]
      else p = [0, 1, 2].map((k) => (1 - v) * b[i][k] + v * t[i][k] + (1 - u) * l[j][k] + u * r[j][k] - ((1 - u) * (1 - v) * c00[k] + u * (1 - v) * c10[k] + (1 - u) * v * c01[k] + u * v * c11[k])) as Vec3
      grid.push(w.add(p))
    }
  }
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const q = [grid[j * (m + 1) + i], grid[j * (m + 1) + i + 1], grid[(j + 1) * (m + 1) + i + 1], grid[(j + 1) * (m + 1) + i]]
      // A quad collapsed by a side of no length is no face.
      if (new Set(q).size === 4) faces.push(q)
    }
  }
}

/** The cage of the regions' sketch at `resolution` (1 – SKETCH_RESOLUTION_MAX): one cage, the regions' vertices welded along the sides they share. */
export function sketchCage(cells: readonly SketchCell[], resolution: number): Cage {
  if (!Number.isInteger(resolution) || resolution < 1 || resolution > SKETCH_RESOLUTION_MAX) throw new SketchError(`Resolution ${resolution}: from 1 to ${SKETCH_RESOLUTION_MAX}.`)
  if (cells.length === 0) throw new SketchError(SKETCH_REFUSAL)
  const w = new Welder()
  const faces: number[][] = []
  for (const cell of cells) {
    const sides = cell.sides
    const n = sides.length
    if (n < 3 || n > 6) throw new SketchError(`A region of ${n} sides: three to six are filled.`)
    if (n === 4) {
      // One Coons patch: bottom = side 0 and right = side 1 as they run; top and left run the other way.
      const m = 2 ** resolution
      const ctl = sides.map((s) => sideControls(s, m))
      coons(w, faces, m, ctl[0], [...ctl[2]].reverse(), [...ctl[3]].reverse(), ctl[1])
      continue
    }
    // n sides: n quads, each at a corner, round a centre that stands where the four-sided blend's would.
    const m = 2 ** (resolution - 1)
    const ctl = sides.map((s) => sideControls(s, 2 * m))
    const mids = ctl.map((c) => c[m])
    const corners = ctl.map((c) => c[0])
    const mean = (ps: Vec3[]): Vec3 => [ps.reduce((a, p) => a + p[0], 0) / n, ps.reduce((a, p) => a + p[1], 0) / n, ps.reduce((a, p) => a + p[2], 0) / n]
    const mm = mean(mids)
    const mc = mean(corners)
    const centre: Vec3 = [2 * mm[0] - mc[0], 2 * mm[1] - mc[1], 2 * mm[2] - mc[2]]
    for (let j = 0; j < n; j++) {
      const before = ctl[(j + n - 1) % n]
      const after = ctl[j]
      const midBefore = mids[(j + n - 1) % n]
      const midAfter = mids[j]
      coons(
        w,
        faces,
        m,
        before.slice(m),
        Array.from({ length: m + 1 }, (_, i) => lerp(centre, midAfter, i / m)),
        Array.from({ length: m + 1 }, (_, i) => lerp(midBefore, centre, i / m)),
        after.slice(0, m + 1),
      )
    }
  }
  return { positions: Float64Array.from(w.positions), faces, creases: [] }
}
