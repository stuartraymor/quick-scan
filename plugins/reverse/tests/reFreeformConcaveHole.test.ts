// SPDX-License-Identifier: AGPL-3.0-only
// Close 4-sided hole on a hole with one corner bent inward (a dart). Quick
// Scan greyed the command out — its connection guard refused any concave new
// quad — where QUICKSURFACE Pro 8.0.128 closes it: on 2026-11-17 the four
// selected hole edges of analysis/side-joins-2026-11-17/reference/
// concave-hole-input.qsf enabled the command, which added the quad [5,6,10,9]
// and moved no pole (concave-hole-closed.qsf). A crossed (bow-tie) or
// collapsed quad is still refused.
import { describe, expect, it } from 'vitest'
import { type Cage, edgeKey, topology } from '../core/freeform/cage'
import { closeHole, extrapolateEdges } from '../core/freeform/edit'
import { editorActions } from '../core/freeform/editor'

/** QUICKSURFACE's input cage: 3 × 3 quads with the centre missing, hole corner 5 pushed in. */
const nativeInput = (): Cage => ({
  positions: Float64Array.from([-6,-6,0,-2,-6,0,2,-6,0,6,-6,0,-6,-2,0,0.4,0.4,0,2,-2,0,6,-2,0,-6,2,0,-2,2,0,2,2,0,6,2,0,-6,6,0,-2,6,0,2,6,0,6,6,0].map(Math.fround)),
  faces: [[0,1,5,4],[1,2,6,5],[2,3,7,6],[4,5,9,8],[6,7,11,10],[8,9,13,12],[9,10,14,13],[10,11,15,14]],
  creases: [],
})
const hole = [5, 6, 10, 9]

describe('closing a concave four-sided hole as QUICKSURFACE does', () => {
  it('offers Close 4-sided hole for the hole\'s four edges and for its four corners', () => {
    const c = nativeInput(), t = topology(c)
    const edges = hole.map((v, i) => t.edgeOf.get(edgeKey(v, hole[(i + 1) % 4]))!)
    expect(editorActions(c, edges.map((index) => ({ kind: 'edge' as const, index }))).close_hole).toBe(true)
    expect(editorActions(c, hole.map((index) => ({ kind: 'vertex' as const, index }))).close_hole).toBe(true)
  })

  it('adds QUICKSURFACE\'s quad and moves no pole', () => {
    const c = nativeInput(), out = closeHole(c, hole)
    expect(out.faces).toEqual([...c.faces, [5, 6, 10, 9]])
    expect(Array.from(out.positions)).toEqual(Array.from(c.positions))
  })

  it('still refuses a crossed (bow-tie) or collapsed hole', () => {
    // Corner 5 dragged across the hole to beyond corner 10: the quad crosses itself.
    const crossed = nativeInput(); crossed.positions.set([3, 3, 0], 5 * 3)
    expect(() => closeHole(crossed, hole)).toThrow(/collapsed, folded or overlapping/)
    // Corner 5 on corner 10: no area.
    const collapsed = nativeInput(); collapsed.positions.set([2, 2, 0], 5 * 3)
    expect(() => closeHole(collapsed, hole)).toThrow()
  })

  it('keeps refusing a concave quad made by a D pull, where the strict guard still applies', () => {
    // Extending the left boundary edge inward over the strip would fold; concavity is allowed only for hole closing.
    const c = nativeInput(), t = topology(c), edge = t.edgeOf.get(edgeKey(0, 4))!
    expect(() => extrapolateEdges(c, [edge], [6, 0, 0])).toThrow()
  })
})
