// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import type { Cage } from '../core/freeform/cage'
import { movePoints } from '../core/freeform/edit'
import { cageVertexLimits } from '../core/freeform/limit'

/** Project the points the user edits when Control Net is off. A pole placed
 * on the scan does not put its limit point there. Solve the local limit
 * response at release; never fit the intervening surface or query on move. */
export function snapSurfaceAnchors(cage: Cage, vertices: number[], project: (p: Vec3) => Vec3 | null): Cage | null {
  const ids = [...new Set(vertices)]
  const anchors = cageVertexLimits(cage)
  const targets = ids.map(v => project(anchors[v]))
  if (targets.some(p => !p || !p.every(Number.isFinite))) return null
  const solve = surfaceAnchorDrag(cage, ids)
  if (solve) {
    const travel = solve(ids.map((v, i) => targets[i]!.map((p, k) => p - anchors[v][k]) as Vec3))
    return movePoints(cage, ids.map((vertex, i) => ({vertex, by: travel[i]})))
  }
  // Large selections use the sparse limit response instead of a dense inverse.
  let current = cage
  for (let step = 0; step < 32; step++) {
    const points = cageVertexLimits(current)
    const travel = ids.map((v, i) => targets[i]!.map((p, k) => p - points[v][k]) as Vec3)
    if (travel.every(p => Math.hypot(...p) < 1e-8)) break
    current = movePoints(current, ids.map((vertex, i) => ({vertex, by: travel[i]})))
  }
  return current
}

/** Native direct evaluated-point drags use five corrections after the initial
 * pole movement. Don't move neighbours preserves all other surface anchors;
 * the unchecked snapped gesture corrects only the selected anchor. */
export function moveSurfaceAnchor(cage: Cage, vertex: number, travel: Vec3, keepNeighbours = true): Cage {
  const goals = cageVertexLimits(cage)
  goals[vertex] = goals[vertex].map((p, k) => p + travel[k]) as Vec3
  const result = movePoints(cage, [{ vertex, by: travel }])
  for (let step = 0; step < 5; step++) {
    const current = cageVertexLimits(result)
    result.positions = Float64Array.from(result.positions, (p, k) =>
      keepNeighbours || Math.floor(k / 3) === vertex ? p + goals[Math.floor(k / 3)][k % 3] - current[Math.floor(k / 3)][k % 3] : p)
  }
  return result
}

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
