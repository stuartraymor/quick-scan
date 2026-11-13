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
  // Both ends included, the rest evenly between: 10 sections are a cut on the
  // lower plane, one on the upper and eight between (the user's choice,
  // 2026-11-13, as Geomagic Design X stacks a mesh sketch).
  return Array.from({ length: count }, (_, i) => extent.min + (extent.max - extent.min) * i / (count - 1))
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

/** The polylines kept inside a rectangle of the plane (u0..u1 × v0..v1): each
 *  cut where it crosses a side, the pieces inside kept — Stacked sections'
 *  box isolating part of the scan. */
export function clipChainsToRect(chains: readonly (readonly Vec2[])[], rect: { u0: number; u1: number; v0: number; v1: number }): Vec2[][] {
  const u0 = Math.min(rect.u0, rect.u1), u1 = Math.max(rect.u0, rect.u1), v0 = Math.min(rect.v0, rect.v1), v1 = Math.max(rect.v0, rect.v1)
  const inside = (p: Vec2) => p[0] >= u0 && p[0] <= u1 && p[1] >= v0 && p[1] <= v1
  // Where the segment a→b leaves (or enters) the box: the parameter of the
  // first side crossed, by Liang–Barsky.
  const cross = (a: Vec2, b: Vec2): Vec2 => {
    const dx = b[0] - a[0], dy = b[1] - a[1]
    let t = 1
    for (const [d, lo, hi, c] of [[dx, u0, u1, a[0]], [dy, v0, v1, a[1]]] as const) {
      if (d > 0) t = Math.min(t, (hi - c) / d)
      if (d < 0) t = Math.min(t, (lo - c) / d)
    }
    t = Math.max(0, Math.min(1, t))
    return [a[0] + dx * t, a[1] + dy * t]
  }
  const out: Vec2[][] = []
  for (const chain of chains) {
    let run: Vec2[] = []
    for (let i = 0; i < chain.length; i++) {
      const p = chain[i], prev = i > 0 ? chain[i - 1] : null
      if (inside(p)) {
        if (prev && !inside(prev) && run.length === 0) run.push(cross(p, prev))
        run.push([p[0], p[1]])
      } else if (prev && inside(prev)) {
        run.push(cross(prev, p))
        if (run.length >= 2) out.push(run)
        run = []
      }
    }
    if (run.length >= 2) out.push(run)
  }
  return out
}
