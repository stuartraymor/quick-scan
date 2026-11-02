// SPDX-License-Identifier: AGPL-3.0-only
// Documented linear stacked sections: real parallel cuts projected onto one
// reference plane. No fitting, entities or feature commits happen here.
import type { Vec2 } from '../../../src/core/flat/types'
import type { EdgeChains } from '../../../src/core/flat/edges'
import type { Vec3 } from '../../../src/core/types'
import type { SectionFrame } from '../../../src/core/section/frame'
import { projectCut, type SectionCut } from '../../../src/core/section/slice'
import { chainsOfEdges } from './segment'

export const REFERENCE_POINT_LIMIT = 1_000_000
export interface StackExtent { min: number; max: number }
export interface SectionSource {
  bounds(): Promise<{ min: Vec3; max: Vec3 }>
  section(origin: Vec3, normal: Vec3, minLength: number): Promise<SectionCut>
}
export class ReferenceCancelled extends Error { constructor() { super('Reference collection cancelled.'); this.name = 'ReferenceCancelled' } }

/** Distances along the selected plane normal, measured from its origin,
 *  bounded by the worker's actual scan box rather than a guessed sphere. */
export function stackExtentOf(bounds: { min: Vec3; max: Vec3 }, frame: SectionFrame): StackExtent {
  const length = Math.hypot(...frame.normal)
  if (!(length > 0) || ![...bounds.min, ...bounds.max, ...frame.origin, length].every(Number.isFinite)) throw new Error('The section frame or scan bounds are invalid.')
  let min = Infinity, max = -Infinity
  for (let corner = 0; corner < 8; corner++) {
    let distance = 0
    for (let k = 0; k < 3; k++) distance += (((corner & (1 << k)) ? bounds.max[k] : bounds.min[k]) - frame.origin[k]) * frame.normal[k] / length
    min = Math.min(min, distance); max = Math.max(max, distance)
  }
  if (!(max > min)) throw new Error('The scan has no extent along this plane normal.')
  return { min, max }
}

export function stackDistances(extent: StackExtent, count: number): number[] {
  if (!Number.isInteger(count) || count < 2 || count > 200) throw new Error('Sections must be a whole number from 2 to 200.')
  if (![extent.min, extent.max].every(Number.isFinite) || !(extent.max > extent.min)) throw new Error('The upper stack extent must be greater than the lower extent.')
  // Cell centres avoid coincident boundary faces and include equal volumes
  // at either end. Exact QS end-plane policy is not established.
  return Array.from({ length: count }, (_, i) => extent.min + (extent.max - extent.min) * (i + 0.5) / count)
}

export async function collectExtrudedReference(source: SectionSource, frame: SectionFrame, count: number, options: { extent?: StackExtent; isCurrent?: () => boolean; onProgress?: (done: number, total: number) => void } = {}): Promise<{ chains: Vec2[][]; extent: StackExtent; sections: number; points: number }> {
  const current = () => { if (options.isCurrent && !options.isCurrent()) throw new ReferenceCancelled() }
  current()
  if (![...frame.origin, ...frame.normal, ...frame.basisU, ...frame.basisV].every(Number.isFinite) || !(Math.hypot(...frame.normal) > 0)) throw new Error('The reference section frame is invalid.')
  const extent = options.extent ?? stackExtentOf(await source.bounds(), frame)
  current()
  const distances = stackDistances(extent, count), chains: Vec2[][] = []
  let points = 0
  const length = Math.hypot(...frame.normal), n = frame.normal.map((v) => v / length) as Vec3
  for (let i = 0; i < distances.length; i++) {
    current()
    const origin = frame.origin.map((v, k) => v + n[k] * distances[i]) as Vec3
    const cut = await source.section(origin, n, 0)
    current()
    // Every parallel cut uses the SAME frame: height is discarded, the
    // in-plane coordinates remain in the one sketch's coordinate system.
    const projected = chainsOfEdges(projectCut(cut, frame))
    points += projected.reduce((sum, chain) => sum + chain.length, 0)
    if (points > REFERENCE_POINT_LIMIT) throw new Error(`The stacked reference exceeds ${REFERENCE_POINT_LIMIT.toLocaleString()} points. Reduce the section count or extent.`)
    chains.push(...projected)
    options.onProgress?.(i + 1, distances.length)
  }
  return { chains, extent, sections: distances.length, points }
}

export function referenceEdges(chains: readonly (readonly Vec2[])[]): EdgeChains {
  const total = chains.reduce((sum, chain) => sum + chain.length, 0)
  const points = new Float32Array(total * 2), offsets = new Uint32Array(chains.length + 1)
  let index = 0
  chains.forEach((chain, i) => { offsets[i] = index; for (const p of chain) { points[index * 2] = p[0]; points[index * 2 + 1] = p[1]; index++ } })
  offsets[chains.length] = index
  return { points, offsets }
}

/** A 3D preview of the projected cloud, on the single reference plane. */
export function referenceCut(chains: readonly (readonly Vec2[])[], frame: SectionFrame): SectionCut {
  const edges = referenceEdges(chains), points = new Float32Array(edges.points.length / 2 * 3)
  for (let i = 0; i < edges.points.length / 2; i++) for (let k = 0; k < 3; k++) points[i * 3 + k] = frame.origin[k] + edges.points[i * 2] * frame.basisU[k] + edges.points[i * 2 + 1] * frame.basisV[k]
  return { points, offsets: edges.offsets }
}
