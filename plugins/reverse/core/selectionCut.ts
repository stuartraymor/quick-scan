// SPDX-License-Identifier: AGPL-3.0-only
// Create Sketch → Through selection only, as in QUICKSURFACE: of the cut the
// sketch plane makes through the scan, keep only what crosses the surface
// marked on the part. A section chain that leaves the marked area is split
// there, so the kept pieces stay separate.

import type { EdgeChains } from '../../../src/core/flat/edges'
import type { SectionFrame } from '../../../src/core/section/frame'

export function sectionModeKey(throughSelection: boolean, outline: boolean, minPoints: number): string {
  return (throughSelection ? '|selection' : '') + (outline ? `|outline:${minPoints}` : '')
}

/** The chains of `edges` (sheet coordinates of `frame`) kept where they pass
 *  within `tolMm` of a marked vertex lying within `bandMm` of the plane.
 *  `marked` holds the marked vertices' positions, x,y,z after one another. */
export function edgesThroughSelection(edges: EdgeChains, frame: SectionFrame, marked: Float32Array, tolMm = 1, bandMm = 2): EdgeChains {
  const { origin: o, normal: n, basisU: u, basisV: v } = frame
  // The marked vertices near the plane, in sheet coordinates, hashed on a
  // grid of `tolMm` cells so each chain point checks only its neighbours.
  const cells = new Map<string, number[]>()
  const key = (x: number, y: number) => `${Math.floor(x / tolMm)},${Math.floor(y / tolMm)}`
  for (let i = 0; i + 2 < marked.length; i += 3) {
    const dx = marked[i] - o[0], dy = marked[i + 1] - o[1], dz = marked[i + 2] - o[2]
    if (Math.abs(dx * n[0] + dy * n[1] + dz * n[2]) > bandMm) continue
    const x = dx * u[0] + dy * u[1] + dz * u[2], y = dx * v[0] + dy * v[1] + dz * v[2]
    const k = key(x, y)
    const list = cells.get(k)
    if (list) list.push(x, y)
    else cells.set(k, [x, y])
  }
  const near = (x: number, y: number): boolean => {
    const cx = Math.floor(x / tolMm), cy = Math.floor(y / tolMm)
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const list = cells.get(`${cx + a},${cy + b}`)
        if (!list) continue
        for (let j = 0; j < list.length; j += 2) if (Math.hypot(list[j] - x, list[j + 1] - y) <= tolMm) return true
      }
    return false
  }
  const points: number[] = []
  const offsets: number[] = [0]
  for (let c = 0; c + 1 < edges.offsets.length; c++) {
    let run = 0
    const close = () => {
      if (run >= 2) offsets.push(points.length / 2)
      else points.length -= run * 2
      run = 0
    }
    for (let i = edges.offsets[c]; i < edges.offsets[c + 1]; i++) {
      const x = edges.points[i * 2], y = edges.points[i * 2 + 1]
      if (near(x, y)) {
        points.push(x, y)
        run++
      } else close()
    }
    close()
  }
  return { ...edges, points: Float32Array.from(points), offsets: Uint32Array.from(offsets) }
}

/** The chains of `edges` with at least `minPoints` points — Outline Mesh's
 *  "Ignore small segments of N points". */
export function longChains(edges: EdgeChains, minPoints: number): EdgeChains {
  const points: number[] = []
  const offsets: number[] = [0]
  for (let c = 0; c + 1 < edges.offsets.length; c++) {
    const a = edges.offsets[c], b = edges.offsets[c + 1]
    if (b - a < minPoints) continue
    for (let i = a; i < b; i++) points.push(edges.points[i * 2], edges.points[i * 2 + 1])
    offsets.push(points.length / 2)
  }
  return { ...edges, points: Float32Array.from(points), offsets: Uint32Array.from(offsets) }
}
