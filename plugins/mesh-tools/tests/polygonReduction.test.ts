// SPDX-License-Identifier: AGPL-3.0-only
// Polygon Reduction's "Reduce down to": triangles or a percentage of the
// mesh, the one following the other, kept to what the mesh can reach.
import { describe, expect, it } from 'vitest'
import { reductionTarget } from '../ui/PolygonReductionDialog'

describe('Polygon Reduction target', () => {
  it('reads a percentage of the mesh as triangles, as QUICKSURFACE shows 213 448 at 50 % as 106 724', () => {
    expect(reductionTarget(213448, 50, 'percent')).toBe(106724)
  })
  it('holds a typed count between four triangles and the mesh itself', () => {
    expect(reductionTarget(1000, 5000, 'triangles')).toBe(1000)
    expect(reductionTarget(1000, 1, 'triangles')).toBe(4)
  })
})
