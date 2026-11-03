// SPDX-License-Identifier: AGPL-3.0-only
// Edit Sketch → Display → Curvature, as QUICKSURFACE shows it: a comb along
// each curved piece — a tooth at every sample along the curve's normal, as
// long as the curvature there times `scale`, and a line joining the tips. A
// straight run has no teeth; a tight bend has long ones; a jump in curvature
// shows as a step in the line through the tips.

import type { Vec2 } from '../../../src/core/flat/types'

/** Signed curvature at the middle of three points (1 / radius of the circle
 *  through them; positive turning left), or 0 where they are in line. */
export function curvatureAt(a: Vec2, b: Vec2, c: Vec2): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], bcx = c[0] - b[0], bcy = c[1] - b[1], cax = a[0] - c[0], cay = a[1] - c[1]
  const cross = abx * bcy - aby * bcx
  const den = Math.hypot(abx, aby) * Math.hypot(bcx, bcy) * Math.hypot(cax, cay)
  return den > 1e-18 ? (2 * cross) / den : 0
}

/** The comb of a curve sampled as `poly`: the teeth (from the curve to the
 *  tip) and the segments joining the tips. Teeth point to the curve's
 *  outside — away from the centre of curvature — as they are usually drawn. */
export function curvatureComb(poly: readonly Vec2[], scale: number): { teeth: [Vec2, Vec2][]; envelope: [Vec2, Vec2][] } {
  const teeth: [Vec2, Vec2][] = []
  const tips: Vec2[] = []
  for (let i = 1; i + 1 < poly.length; i++) {
    const [a, b, c] = [poly[i - 1], poly[i], poly[i + 1]]
    const k = curvatureAt(a, b, c)
    const tx = c[0] - a[0], ty = c[1] - a[1]
    const tl = Math.hypot(tx, ty)
    if (!(tl > 0)) continue
    // The left normal; a left turn (k > 0) has its centre on the left, so the
    // tooth goes right — out of the bend — and the other way about.
    const nx = -ty / tl, ny = tx / tl
    const tip: Vec2 = [b[0] - nx * k * scale, b[1] - ny * k * scale]
    teeth.push([b, tip])
    tips.push(tip)
  }
  const envelope: [Vec2, Vec2][] = []
  for (let i = 0; i + 1 < tips.length; i++) envelope.push([tips[i], tips[i + 1]])
  return { teeth, envelope }
}
