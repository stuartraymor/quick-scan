// SPDX-License-Identifier: AGPL-3.0-only
import { ScanPaths } from '../../../../src/core/geometry/scanPath'
import type { WorkMesh } from './autoPrepare'

export interface ScanCoverage {
  samples: number
  within: number
  rms: number
  max: number
  tolerance: number
}

/** Deterministic probes distributed by triangle area, in the selected scan's frame.
 * The same probes compare competing fits even when their vertex counts differ. */
export function coverageProbes(scan: WorkMesh, count = 2048): Float32Array {
  const p = scan.positions, idx = scan.indices
  const area = new Float64Array(idx.length / 3)
  let total = 0
  for (let i = 0; i < area.length; i++) {
    const a = 3*idx[3*i], b = 3*idx[3*i+1], c = 3*idx[3*i+2]
    const ux = p[b]-p[a], uy = p[b+1]-p[a+1], uz = p[b+2]-p[a+2]
    const vx = p[c]-p[a], vy = p[c+1]-p[a+1], vz = p[c+2]-p[a+2]
    total += Math.hypot(uy*vz-uz*vy, uz*vx-ux*vz, ux*vy-uy*vx)
    area[i] = total
  }
  if (!(total > 0)) throw new Error('Scan coverage needs a surface with positive area.')
  const probes = new Float32Array(count*3)
  let tri = 0
  for (let i = 0; i < count; i++) {
    const cut = (i+.5)*total/count
    while (tri+1 < area.length && area[tri] < cut) tri++
    // A low-discrepancy sequence and the square-root map sample triangle interiors uniformly.
    const radius = Math.sqrt(((i+.5)*0.7548776662466927) % 1)
    const v = radius * (((i+.5)*0.5698402909980532) % 1)
    const a = 3*idx[3*tri], b = 3*idx[3*tri+1], c = 3*idx[3*tri+2]
    for (let k=0;k<3;k++) probes[3*i+k] = (1-radius)*p[a+k] + (radius-v)*p[b+k] + v*p[c+k]
  }
  return probes
}

/** Scan-to-evaluated-mesh distances, including points over missing reconstructed regions. */
export function scanCoverage(probes: Float32Array, surface: WorkMesh, tolerance: number): ScanCoverage {
  const map = new ScanPaths(surface.positions, surface.indices)
  let max = 0, sum = 0, within = 0
  for (let i=0;i<probes.length;i+=3) {
    const hit = map.closest([probes[i], probes[i+1], probes[i+2]])
    if (!hit) throw new Error('The reconstruction has no surface for a coverage measurement.')
    max = Math.max(max, hit.distance)
    sum += hit.distance*hit.distance
    if (hit.distance <= tolerance) within++
  }
  const samples = probes.length/3
  return { samples, within, tolerance, max, rms: Math.sqrt(sum/samples) }
}
