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
 * pole movement. Don't move neighbours corrects the picked point and the
 * points of the quads round it — not the whole cage, whose corrections
 * rippled outward ring by ring (QUICKSURFACE 5 × 5 grid, 2026-11-17: nine
 * poles move, matched to 5.3e-7 mm; the whole-cage solve moved sixteen and
 * was 0.085 mm off). The unchecked gesture corrects only the picked point. */
export function moveSurfaceAnchor(cage: Cage, vertex: number, travel: Vec3, keepNeighbours = true): Cage {
  const goals = cageVertexLimits(cage)
  goals[vertex] = goals[vertex].map((p, k) => p + travel[k]) as Vec3
  const corrected = new Set<number>([vertex])
  if (keepNeighbours) for (const f of cage.faces) if (f.includes(vertex)) for (const v of f) corrected.add(v)
  const result = movePoints(cage, [{ vertex, by: travel }])
  for (let step = 0; step < 5; step++) {
    const current = cageVertexLimits(result)
    result.positions = Float64Array.from(result.positions, (p, k) =>
      corrected.has(Math.floor(k / 3)) ? p + goals[Math.floor(k / 3)][k % 3] - current[Math.floor(k / 3)][k % 3] : p)
  }
  return result
}

/** Snap on release with Don't move neighbours ticked. QUICKSURFACE takes the
 * scan point as the gesture's goal and makes the one five-correction move to
 * it, so the control points round the picked one take up the snap as they do
 * the drag (lifted 5 x 5 sheet, 2026-11-18, analysis/freeform-refine-2026-11-18/
 * native: the four beside it rise 0.217 mm as the picked one drops 1.244; this
 * fits its 36 poles to 0.016 mm). Snapping the picked control point alone, as
 * the unticked gesture does, was 0.077 mm from it and carried the surface
 * round the point along (0.73 mm on a curved scan); holding the ring exactly
 * was 0.098 mm from it. `rest`: the surface points before the drag; `aim`:
 * where the drag asked the picked one to go. */
export function snapSurfaceAnchorHeld(cage: Cage, vertex: number, project: (p: Vec3) => Vec3 | null, rest: readonly Vec3[], aim: Vec3): Cage | null {
  const target = project(aim)
  if (!target || !target.every(Number.isFinite)) return null
  return moveSurfaceAnchor(cage, vertex, target.map((p, k) => p - rest[vertex][k]) as Vec3, true)
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
