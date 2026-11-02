// SPDX-License-Identifier: AGPL-3.0-only
// Orthogonal least-squares line on a marked edge, using the shared eigensolver
// and used-point clipping. No seeded search or surface-boundary inference.
import type { FitSettings, LineFit, MeshGraph, Vec3 } from '../types'
import { centroidOf, symmetricEigen3 } from './linalg'
import { clippedRefit } from './clip'
import { requireSelection } from './selection'
import { FitError } from './errors'

interface Line { center: Vec3; dir: Vec3 }

function lineTLS(positions: Float32Array, ids: Uint32Array): Line | null {
  const center = centroidOf(positions, ids)
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0
  for (const id of ids) {
    const p = id * 3
    const x = positions[p] - center[0], y = positions[p + 1] - center[1], z = positions[p + 2] - center[2]
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z
  }
  const { values, vectors } = symmetricEigen3([xx, xy, xz, xy, yy, yz, xz, yz, zz])
  // A point or an isotropic cloud has no unique longest direction.
  if (!(values[2] > 0) || values[2] - values[1] <= values[2] * 1e-10) return null
  const dir = vectors[2]
  const major = Math.abs(dir[0]) >= Math.abs(dir[1]) && Math.abs(dir[0]) >= Math.abs(dir[2]) ? 0 : Math.abs(dir[1]) >= Math.abs(dir[2]) ? 1 : 2
  if (dir[major] < 0) for (let k = 0; k < 3; k++) dir[k] = -dir[k]
  return { center, dir }
}

function residual(line: Line, x: number, y: number, z: number): number {
  const dx = x - line.center[0], dy = y - line.center[1], dz = z - line.center[2]
  const [a, b, c] = line.dir
  return Math.hypot(dy * c - dz * b, dz * a - dx * c, dx * b - dy * a)
}

export function fitLineOnSelection(graph: MeshGraph, selection: Uint32Array, settings: FitSettings): LineFit & { region: Uint32Array } {
  requireSelection(selection, 'edge')
  const result = clippedRefit(graph.positions, selection, settings.sigma, ids => lineTLS(graph.positions, ids), residual)
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
    sigma: result.sigma, usedPoints: result.used.length, regionSize: selection.length, region: selection }
}
