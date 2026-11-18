// SPDX-License-Identifier: AGPL-3.0-only
// Don't move neighbours with Snap Mode on, against QUICKSURFACE (2026-11-18,
// analysis/freeform-refine-2026-11-18/native): a 5 × 5 sheet of 2.4 mm quads
// 0.5 mm above a flat scan, an inside point dragged in a tilted view with
// Closest Point snapping and the box ticked, saved and read back.
import { expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import type { Cage } from '../core/freeform/cage'
import { cageVertexLimits } from '../core/freeform/limit'
import { moveSurfaceAnchor, snapSurfaceAnchorHeld, snapSurfaceAnchors } from '../viewer/freeformAnchorDrag'
import reference from './fixtures/freeform-held-snap-reference.json'

const picked = 15
function lifted(): Cage {
  const positions: number[] = []
  for (let j = 0; j <= 5; j++) for (let i = 0; i <= 5; i++) positions.push(Math.fround(-6 + i * 2.4), Math.fround(-6 + j * 2.4), 0.5)
  return { positions: Float64Array.from(positions), faces: reference.faces, creases: [] }
}
const onScan = (p: Vec3): Vec3 => [p[0], p[1], 0]
/** The drag's travel in the sheet's plane, fitted from the picked pole. */
const travel: Vec3 = [0.48353, 1.0848, 0]
const worst = (c: Cage) => Math.max(...Array.from(c.positions, (p, k) => Math.abs(p - reference.positions[k])))

it('moves the control points round the picked one as the reference app does', () => {
  const cage = lifted(), rest = cageVertexLimits(cage)
  const snapped = snapSurfaceAnchorHeld(cage, picked, onScan, rest, rest[picked].map((p, k) => p + travel[k]) as Vec3)!
  expect(worst(snapped)).toBeLessThan(.02)
  // The four beside it rise as it drops: 0.217 mm against 1.244 in the reference.
  expect(snapped.positions[14 * 3 + 2] - .5).toBeCloseTo(.217, 1)
  expect(snapped.positions[picked * 3 + 2] - .5).toBeCloseTo(-1.244, 1)
})

it('is nearer the reference than snapping the picked control point alone', () => {
  const cage = lifted()
  const alone = snapSurfaceAnchors(moveSurfaceAnchor(cage, picked, travel, true), [picked], onScan)!
  expect(worst(alone)).toBeGreaterThan(.05)
})

it('leaves a drag that ends on the scan as the plain held drag', () => {
  const cage = lifted(), rest = cageVertexLimits(cage), flat = (p: Vec3): Vec3 => [p[0], p[1], .5]
  const snapped = snapSurfaceAnchorHeld(cage, picked, flat, rest, rest[picked].map((p, k) => p + travel[k]) as Vec3)!
  const plain = moveSurfaceAnchor(cage, picked, travel, true)
  expect(Math.max(...Array.from(snapped.positions, (p, k) => Math.abs(p - plain.positions[k])))).toBeLessThan(1e-9)
})

it('refuses where the scan gives no point', () => {
  const cage = lifted(), rest = cageVertexLimits(cage)
  expect(snapSurfaceAnchorHeld(cage, picked, () => null, rest, rest[picked])).toBeNull()
})
