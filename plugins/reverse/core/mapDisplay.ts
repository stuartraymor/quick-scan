// SPDX-License-Identifier: AGPL-3.0-only
// How the live map is drawn, as against what it reads.
//
// A scan vertex's reading carries the scanner's noise: on a flat face that
// sits within the range, neighbouring vertices a tenth of a millimetre apart
// read a few hundredths up and down, and the ramp turns that into blotches
// — the face looks patchy where the fit is in fact even. The drawn map takes
// each reading with its neighbours' that read nearly the same (an edge-
// stopping average over the mesh's own edges, a couple of passes), so the
// colour follows the fit rather than the noise. A neighbour that reads
// differently by more than a fraction of the range is not averaged in, so
// a real step — an edge the ghost misses, a face set at the wrong height —
// stays as sharp as it was read. Nothing counted changes: the box's
// figures and every decision are made on the readings themselves.

import type { SparseField } from './liveMap'

/** The scan's vertex neighbours, compressed: `start[v]..start[v + 1]` index
 *  `list`. Built once per scan. */
export interface Neighbours {
  start: Uint32Array
  list: Uint32Array
}

export function vertexNeighbours(indices: Uint32Array, vertexCount: number): Neighbours {
  const degree = new Uint32Array(vertexCount + 1)
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2]
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue
    degree[a + 1] += 2
    degree[b + 1] += 2
    degree[c + 1] += 2
  }
  for (let v = 0; v < vertexCount; v++) degree[v + 1] += degree[v]
  const list = new Uint32Array(degree[vertexCount])
  const fill = degree.slice(0, vertexCount)
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t], b = indices[t + 1], c = indices[t + 2]
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue
    list[fill[a]++] = b
    list[fill[a]++] = c
    list[fill[b]++] = a
    list[fill[b]++] = c
    list[fill[c]++] = a
    list[fill[c]++] = b
  }
  // Each edge is listed once per triangle it borders; the doubles only
  // weigh an edge twice, the same for every edge of a closed surface.
  return { start: degree, list }
}

/** How close a neighbour's reading has to be to be averaged in, as a share
 *  of the range: a step bigger than this is drawn as read. */
export const DISPLAY_STEP_SHARE = 0.5
/** How many passes the average makes — about two rings of neighbours. */
export const DISPLAY_PASSES = 2

/**
 * The readings as the map draws them: each averaged with the neighbours
 * read within DISPLAY_STEP_SHARE of the range of it, DISPLAY_PASSES times.
 * `slot` is scratch the length of the scan, all −1 on the way in and on the
 * way out. A reading with no neighbour read is drawn as read.
 */
export function displayValues(field: SparseField, adj: Neighbours, range: number, slot: Int32Array, passes = DISPLAY_PASSES): Float32Array {
  const { subset } = field
  const n = subset.length
  let cur = Float32Array.from(field.values)
  if (n === 0 || passes <= 0 || !(range > 0)) return cur
  for (let i = 0; i < n; i++) if (subset[i] < slot.length) slot[subset[i]] = i
  const step = DISPLAY_STEP_SHARE * range
  let next = new Float32Array(n)
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      const v = subset[i]
      const own = cur[i]
      let sum = own
      let weight = 1
      if (v + 1 < adj.start.length) {
        for (let k = adj.start[v]; k < adj.start[v + 1]; k++) {
          const j = slot[adj.list[k]]
          if (j < 0) continue
          const other = cur[j]
          const gap = Math.abs(other - own)
          if (gap > step) continue
          // Nearer readings count for more, so a slope stays a slope.
          const w = 1 - gap / step
          sum += w * other
          weight += w
        }
      }
      next[i] = sum / weight
    }
    const t = cur
    cur = next
    next = t
  }
  for (let i = 0; i < n; i++) if (subset[i] < slot.length) slot[subset[i]] = -1
  return cur
}
