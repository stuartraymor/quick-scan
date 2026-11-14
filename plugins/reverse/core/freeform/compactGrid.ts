// SPDX-License-Identifier: AGPL-3.0-only
import type { PatchGrid } from './patches'

/** Closest-point snapping can collapse entire adjacent sample strips onto
 * the same scan vertex. Remove only exactly repeated strips: every distinct
 * sample and boundary point stays unchanged, without invented separation. */
export function compactRepeatedGrid(grid: PatchGrid): PatchGrid {
  const { points, rows, cols } = grid
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 2 || cols < 2 || points.length !== rows * cols * 3 || !points.every(Number.isFinite)) throw new Error('The freeform sample grid is malformed or nonfinite.')
  const equal = (a: number, b: number) => points[a * 3] === points[b * 3] && points[a * 3 + 1] === points[b * 3 + 1] && points[a * 3 + 2] === points[b * 3 + 2]
  const keepRows = [0], keepCols = [0]
  for (let r = 1; r < rows; r++) {
    const before = keepRows[keepRows.length - 1]
    if (!Array.from({ length: cols }, (_, c) => c).every(c => equal(r * cols + c, before * cols + c))) keepRows.push(r)
  }
  for (let c = 1; c < cols; c++) {
    const before = keepCols[keepCols.length - 1]
    if (!keepRows.every(r => equal(r * cols + c, r * cols + before))) keepCols.push(c)
  }
  if (keepRows.length < 2 || keepCols.length < 2) throw new Error('The snapped freeform sample grid collapses to a curve or point; it cannot make a surface.')
  if (keepRows.length === rows && keepCols.length === cols) return grid
  const compact = new Float64Array(keepRows.length * keepCols.length * 3)
  let n = 0
  for (const r of keepRows) for (const c of keepCols) {
    compact.set(points.subarray((r * cols + c) * 3, (r * cols + c + 1) * 3), n)
    n += 3
  }
  return { ...grid, points: compact, rows: keepRows.length, cols: keepCols.length }
}
