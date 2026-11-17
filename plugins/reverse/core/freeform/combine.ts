// SPDX-License-Identifier: AGPL-3.0-only
import type { FreeformFeature, FreeformSnapRegion } from '../features'
import { type Cage, edgeKey, topology } from './cage'

/** Object-level Merge collects independently indexed components. Coincident
 * positions deliberately remain separate; contact welding is an editor action. */
export function combineCages(cages: readonly Cage[]): Cage {
  if (cages.length < 2) throw new Error('Select at least two Freeform surfaces to merge.')
  const positions: number[] = [], faces: number[][] = [], creases: [number, number][] = []
  for (const cage of cages) {
    const count = cage.positions.length / 3, offset = positions.length / 3
    if (!Number.isInteger(count) || !count || !cage.faces.length || !cage.positions.every(Number.isFinite)) throw new Error('Every selected Freeform must contain a valid control cage.')
    if (cage.faces.some(f => new Set(f).size !== f.length || f.some(v => !Number.isInteger(v) || v < 0 || v >= count))) throw new Error('A selected Freeform has invalid face references.')
    const top = topology(cage)
    if (cage.creases.some(e => e.length !== 2 || e.some(v => !Number.isInteger(v)) || !top.edgeOf.has(edgeKey(...e)))) throw new Error('A selected Freeform has an invalid crease.')
    const directed = new Set<string>(), distinctFaces = new Set<string>()
    for (const face of cage.faces) {
      const key = [...face].sort((a, b) => a - b).join(':')
      if (distinctFaces.has(key)) throw new Error('A selected Freeform contains duplicate faces.')
      distinctFaces.add(key)
      for (let k = 0; k < face.length; k++) {
        const edge = `${face[k]}>${face[(k + 1) % face.length]}`
        if (directed.has(edge)) throw new Error('A selected Freeform has inconsistent face winding.')
        directed.add(edge)
      }
    }
    // Avoid spread argument limits on large cages.
    for (const value of cage.positions) positions.push(value)
    for (const face of cage.faces) faces.push(face.map(v => v + offset))
    for (const [a, b] of cage.creases) creases.push([a + offset, b + offset])
  }
  return { positions: Float64Array.from(positions), faces, creases }
}

const regionKey = (r: FreeformSnapRegion | undefined) => r === undefined ? ''
  : JSON.stringify([r.point, r.dir, r.radius, r.u, r.v, r.t0, r.t1, r.start, r.sweep, r.margin])

/** Conservative settings compatibility is a Quick Scan design rule. Preserve
 * each source's existing evaluation instead of silently converting or fitting it. */
export function combineFreeforms(features: readonly FreeformFeature[]): FreeformFeature {
  if (features.length < 2) throw new Error('Select at least two Freeform surfaces to merge.')
  if (new Set(features.map(f => f.id)).size !== features.length) throw new Error('Select each Freeform surface only once.')
  const first = features[0]
  for (const f of features) {
    if (f.suppressed) throw new Error('Suppressed Freeform surfaces cannot be merged.')
    if (f.ask || f.fromSketch) throw new Error('Merge requires editable control surfaces without Offset, Thicken or sketch regeneration.')
    if (f.steps !== first.steps || (f.fitToScan !== false) !== (first.fitToScan !== false) || f.snap !== first.snap ||
        f.snapType !== first.snapType || f.refitTolerance !== first.refitTolerance || regionKey(f.snapRegion) !== regionKey(first.snapRegion)) {
      throw new Error('The Freeform surfaces must use the same refinement, surface fitting and mesh snapping settings before Merge.')
    }
  }
  const cage = combineCages(features.map(f => ({ positions: Float64Array.from(f.positions), faces: f.faces, creases: f.creases })))
  return { ...first, positions: Array.from(cage.positions), faces: cage.faces, creases: cage.creases }
}
