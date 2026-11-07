// SPDX-License-Identifier: AGPL-3.0-only
// The line on a marked edge: the one the points lie least far from in total
// (orthogonal distances summed, not squared), with used-point clipping. No
// seeded search or surface-boundary inference.
//
// QUICKSURFACE 8.0.128's Line fits this way, measured 2026-11-04 on known-truth
// strips (analysis/fit-accuracy-2026-11-04): on a folded ridge its line lies
// 0.152 mm below the crest where a least-squares line lies 0.284 mm below,
// and the summed-distance line matches it to 0.01 µm (a densely meshed strip
// to 0.04 µm). Summing distances lets a marked edge's crest hold the line
// rather than the faces either side outvoting it.
import type { FitSettings, LineFit, MeshGraph, Vec3 } from '../types'
import { centroidOf, symmetricEigen3 } from './linalg'
import { clippedRefit } from './clip'
import { requireSelection } from './selection'
import { FitError } from './errors'

interface Line { center: Vec3; dir: Vec3 }

/** Weighted orthogonal least-squares line: weighted centroid and the longest
 *  axis of the weighted scatter. Unweighted when `w` is absent. */
function lineTLS(positions: Float32Array, ids: Uint32Array, w?: Float64Array): Line | null {
  let center: Vec3
  if (w) {
    let sw = 0, cx = 0, cy = 0, cz = 0
    for (let k = 0; k < ids.length; k++) {
      const p = ids[k] * 3, wk = w[k]
      sw += wk; cx += wk * positions[p]; cy += wk * positions[p + 1]; cz += wk * positions[p + 2]
    }
    if (!(sw > 0)) return null
    center = [cx / sw, cy / sw, cz / sw]
  } else center = centroidOf(positions, ids)
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0
  for (let k = 0; k < ids.length; k++) {
    const p = ids[k] * 3, wk = w ? w[k] : 1
    const x = positions[p] - center[0], y = positions[p + 1] - center[1], z = positions[p + 2] - center[2]
    xx += wk * x * x; xy += wk * x * y; xz += wk * x * z; yy += wk * y * y; yz += wk * y * z; zz += wk * z * z
  }
  const { values, vectors } = symmetricEigen3([xx, xy, xz, xy, yy, yz, xz, yz, zz])
  // A point or an isotropic cloud has no unique longest direction.
  if (!(values[2] > 0) || values[2] - values[1] <= values[2] * 1e-10) return null
  const dir = vectors[2]
  const major = Math.abs(dir[0]) >= Math.abs(dir[1]) && Math.abs(dir[0]) >= Math.abs(dir[2]) ? 0 : Math.abs(dir[1]) >= Math.abs(dir[2]) ? 1 : 2
  if (dir[major] < 0) for (let k = 0; k < 3; k++) dir[k] = -dir[k]
  return { center, dir }
}

/** Weights below this distance, mm, are held at it: a point on the line
 *  would otherwise take all the weight. */
const L1_FLOOR = 1e-9
const L1_ROUNDS = 300

/** The line the points lie least far from in total: iteratively reweighted
 *  least squares from the least-squares line, each point weighted by one over
 *  its distance, until the line stops moving. */
function lineL1(positions: Float32Array, ids: Uint32Array): Line | null {
  let line = lineTLS(positions, ids)
  if (!line) return null
  const w = new Float64Array(ids.length)
  for (let round = 0; round < L1_ROUNDS; round++) {
    for (let k = 0; k < ids.length; k++) {
      const p = ids[k] * 3
      w[k] = 1 / Math.max(residual(line, positions[p], positions[p + 1], positions[p + 2]), L1_FLOOR)
    }
    const next = lineTLS(positions, ids, w)
    if (!next) return line
    const moved = Math.hypot(next.center[0] - line.center[0], next.center[1] - line.center[1], next.center[2] - line.center[2])
    const turned = 1 - Math.abs(next.dir[0] * line.dir[0] + next.dir[1] * line.dir[1] + next.dir[2] * line.dir[2])
    line = next
    if (moved < 1e-12 && turned < 1e-15) break
  }
  return line
}

function residual(line: Line, x: number, y: number, z: number): number {
  const dx = x - line.center[0], dy = y - line.center[1], dz = z - line.center[2]
  const [a, b, c] = line.dir
  return Math.hypot(dy * c - dz * b, dz * a - dx * c, dx * b - dy * a)
}

export function fitLineOnSelection(graph: MeshGraph, selection: Uint32Array, settings: FitSettings): LineFit & { region: Uint32Array; used?: Uint32Array } {
  requireSelection(selection, 'edge')
  const result = clippedRefit(graph.positions, selection, settings.sigma, ids => lineL1(graph.positions, ids), residual, true)
  if (!result) throw new FitError('The marked points do not define a unique line — select a longer, narrower edge.')
  const { center, dir } = result.model
  let lo = Infinity, hi = -Infinity
  for (const id of result.used) {
    const p = id * 3
    const t = (graph.positions[p] - center[0]) * dir[0] + (graph.positions[p + 1] - center[1]) * dir[1] + (graph.positions[p + 2] - center[2]) * dir[2]
    lo = Math.min(lo, t)
    hi = Math.max(hi, t)
  }
  if (!(hi > lo)) throw new FitError('The marked edge has no measurable length.')
  const mid = (lo + hi) / 2
  return { kind: 'line', center: [center[0] + mid * dir[0], center[1] + mid * dir[1], center[2] + mid * dir[2]], dir, length: hi - lo,
    sigma: result.sigma, usedPoints: result.used.length, regionSize: selection.length, region: selection, used: result.used }
}
