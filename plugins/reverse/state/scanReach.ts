// SPDX-License-Identifier: AGPL-3.0-only
// How far the scan reaches past a plane along its normal — the depth an
// extrude opens on, as QUICKSURFACE's does. The plugin's hook gives it the
// scan once the viewport is up; without one, null.

import type { Vec3 } from '../../../src/core/types'

let positions: (() => Float32Array | null) | null = null

export function setScanPositions(get: (() => Float32Array | null) | null): void {
  positions = get
}

/** The furthest any scan point lies on the normal's side of the plane, mm;
 *  null with no scan, or none on that side. */
export function scanReach(origin: readonly number[], normal: readonly number[], p: Float32Array | null = positions?.() ?? null): number | null {
  if (!p || p.length < 3) return null
  const [ox, oy, oz] = origin as Vec3, [nx, ny, nz] = normal as Vec3
  let far = -Infinity
  for (let i = 0; i + 2 < p.length; i += 3) {
    const d = (p[i] - ox) * nx + (p[i + 1] - oy) * ny + (p[i + 2] - oz) * nz
    if (d > far) far = d
  }
  return far > 0 ? far : null
}
