// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import type { Cage } from '../core/freeform/cage'
import { movePoints } from '../core/freeform/edit'
import { cageVertexLimits } from '../core/freeform/limit'

/** Convert requested limit-surface anchor travel into control-pole travel.
 * The response includes the editor's optional neighbour falloff. It is
 * assembled once at pointer-down, rather than during every preview frame. */
export function surfaceAnchorDrag(cage: Cage, vertices: number[], radius = 0): ((travel: Vec3[]) => Vec3[]) | null {
  if (!vertices.length || vertices.length > 64) return null
  const n = vertices.length
  const base = cageVertexLimits(cage)
  const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let col = 0; col < n; col++) {
    const unit = movePoints(cage, vertices.map((vertex, i) => ({ vertex, by: [i === col ? 1 : 0, 0, 0] as Vec3 })), radius)
    const response = cageVertexLimits(unit)
    for (let row = 0; row < n; row++) matrix[row][col] = response[vertices[row]][0] - base[vertices[row]][0]
  }
  const inverse = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => Number(i === j))])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) if (Math.abs(inverse[row][col]) > Math.abs(inverse[pivot][col])) pivot = row
    if (Math.abs(inverse[pivot][col]) < 1e-10) return null
    ;[inverse[col], inverse[pivot]] = [inverse[pivot], inverse[col]]
    const scale = inverse[col][col]
    for (let j = 0; j < 2 * n; j++) inverse[col][j] /= scale
    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = inverse[row][col]
      for (let j = 0; j < 2 * n; j++) inverse[row][j] -= factor * inverse[col][j]
    }
  }
  return (travel) => vertices.map((_, row) => [0, 1, 2].map(axis =>
    travel.reduce((sum, delta, col) => sum + inverse[row][n + col] * delta[axis], 0)
  ) as Vec3)
}
