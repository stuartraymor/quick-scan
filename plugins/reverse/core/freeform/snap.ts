// SPDX-License-Identifier: AGPL-3.0-only
// A cage's surface snapped to the scan. QUICKSURFACE's Freeform does not
// show the subdivision limit of its cage: measured on its Wrap cage of the
// basic_part wall (analysis/freeform-2026-11-07/wrap-limit.json), the cage
// is a four-sided box round the wall whose Catmull–Clark limit would be a
// rounded square 16 mm inside the wall, while the surface shown lies on
// the wall within ±0.05 mm. So the cage gives the surface its topology and
// parametrisation, and the scan gives it its shape: the refined surface's
// vertices are projected onto the scan (Snap Mode ON — Closest Point, or
// Ray Projection along the surface normal), and a flat quad refined over a
// cylinder wall curves onto it at once, as its editor shows. This module
// does that projection, given the scan's closest-point or ray query.

import type { Vec3 } from '../../../../src/core/types'
import type { LimitMesh } from './limit'

/** Where a point projects onto the scan: null where the scan is out of
 *  `reach`, or the ray misses. */
export type SnapQuery = (p: Vec3, normal: Vec3) => Vec3 | null

export interface SnapResult {
  positions: Float64Array
  /** How far each vertex moved, mm; NaN where it found nothing and stayed. */
  moved: Float64Array
  missed: number
}

/** Every vertex of the limit mesh taken onto the scan by `query`. A vertex
 *  the query answers nothing for stays where it was. */
export function snapMesh(lm: Pick<LimitMesh, 'positions' | 'normals'>, query: SnapQuery): SnapResult {
  const n = lm.positions.length / 3
  const positions = Float64Array.from(lm.positions)
  const moved = new Float64Array(n)
  let missed = 0
  for (let v = 0; v < n; v++) {
    const o = v * 3
    const p: Vec3 = [lm.positions[o], lm.positions[o + 1], lm.positions[o + 2]]
    const nrm: Vec3 = [lm.normals[o], lm.normals[o + 1], lm.normals[o + 2]]
    const q = query(p, nrm)
    if (!q) {
      moved[v] = NaN
      missed++
      continue
    }
    positions[o] = q[0]; positions[o + 1] = q[1]; positions[o + 2] = q[2]
    moved[v] = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
  }
  return { positions, moved, missed }
}

/** The closest-point query of an exact cylinder — for tests and for a
 *  Wrap cage's own axis: the point on the cylinder of axis `s`→`d` (unit)
 *  and radius r nearest p. */
export function cylinderClosest(s: Vec3, d: Vec3, r: number): SnapQuery {
  return (p) => {
    const w = [p[0] - s[0], p[1] - s[1], p[2] - s[2]]
    const t = w[0] * d[0] + w[1] * d[1] + w[2] * d[2]
    const rx = w[0] - t * d[0], ry = w[1] - t * d[1], rz = w[2] - t * d[2]
    const len = Math.hypot(rx, ry, rz)
    if (!(len > 1e-12)) return null
    return [s[0] + t * d[0] + (rx / len) * r, s[1] + t * d[1] + (ry / len) * r, s[2] + t * d[2] + (rz / len) * r]
  }
}
