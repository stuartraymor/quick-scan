// SPDX-License-Identifier: AGPL-3.0-only
// Joining two strips side to side as QUICKSURFACE does (fixtures/freeform-
// side-seam.json, saved by QUICKSURFACE Pro 8.0.128 on 2026-11-17). A whole
// two-edge side dragged onto the other strip welds only its top end; the
// remaining seam points are then dropped one by one on their partners until
// the seam is closed. With Control Net OFF each weld keeps the dropped point's
// surface position where it was dropped, the other surface points where they
// were: setting the hit as the control pole alone left the surface 0.97 mm off.
import { describe, expect, it } from 'vitest'
import fixture from './fixtures/freeform-side-seam.json'
import { type Cage, topology } from '../core/freeform/cage'
import { cageVertexLimits } from '../core/freeform/limit'
import { fitMergedContact, mergeBoundaryPoint } from '../core/freeform/merge'
import { moveSurfaceAnchor } from '../viewer/freeformAnchorDrag'
import type { Vec3 } from '../../../src/core/types'

const cageOf = (c: { positions: number[]; faces: number[][] }): Cage => ({ positions: Float64Array.from(c.positions), faces: c.faces.map((f) => [...f]), creases: [] })
const plane = (p: Vec3): Vec3 => [p[0], p[1], 0]

/** A Control Net OFF seam point dropped on its partner's surface point. */
function weld(input: Cage, from: number, to: number): Cage {
  const anchors = cageVertexLimits(input)
  const moved = moveSurfaceAnchor(input, from, anchors[to].map((v, k) => v - anchors[from][k]) as Vec3, true)
  const merged = mergeBoundaryPoint(moved, from, to, 'surface-point')
  return fitMergedContact(merged.cage, [merged.vertex], false, plane, { vertex: merged.vertex, position: plane(anchors[to]) })
}

const maxDiff = (a: Float64Array, b: number[]) => Math.max(...Array.from(a, (v, i) => Math.abs(v - b[i])))

describe('a side seam closed point by point, as QUICKSURFACE closes it', () => {
  it('welds the middle seam point to the native poles and faces', () => {
    const out = weld(cageOf(fixture.sideHeld), 9, 7)
    expect(out.faces).toEqual(fixture.middleWelded.faces)
    expect(maxDiff(out.positions, fixture.middleWelded.positions)).toBeLessThan(1e-6)
  })

  it('keeps the welded point on the surface where it was dropped', () => {
    const before = cageOf(fixture.sideHeld), target = cageVertexLimits(before)[7]
    const out = weld(before, 9, 7), after = cageVertexLimits(out)
    expect(Math.hypot(...after[7].map((v, k) => v - target[k]))).toBeLessThan(0.02)
  })

  it('closes the seam with the native faces and no open seam edges', () => {
    const out = weld(cageOf(fixture.middleWelded), 4, 3)
    expect(out.faces).toEqual(fixture.bottomWelded.faces)
    // Every pole as QUICKSURFACE saved it, the earlier weld's point within the
    // drop-placement difference of the paired gesture.
    expect(maxDiff(out.positions, fixture.bottomWelded.positions)).toBeLessThan(0.05)
    const open = topology(out).edges.filter((e) => e.faces.length === 1).length
    expect(open).toBe(topology(cageOf(fixture.bottomWelded)).edges.filter((e) => e.faces.length === 1).length)
    // Two quads by two: the outer rim only.
    expect(open).toBe(8)
  })
})
