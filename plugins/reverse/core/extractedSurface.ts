// SPDX-License-Identifier: AGPL-3.0-only
import { autoConstrainFit, constrainedDirection, withDirection, type ConstraintId, type ConstraintRef } from '../../../src/core/elements/constrain'
import { fitPlaneOnSelection } from '../../../src/core/fit/fitPlaneFromSeed'
import { fitSelectedCylinder } from '../../../src/core/fit/fitCylinderFromSeed'
import { orthoBasis } from '../../../src/core/fit/linalg'
import type { CylinderFit, PlaneFit } from '../../../src/core/types'
import { dot } from '../../../src/core/vec'
import type { ConstrainMode, ConstrainRef, FoundRelation } from './autoConstrain'

/** The CAD dialog also offers prior CAD surfaces as references. Only their
 * analytic carrier is used by the shared measurement constraint routines. */
function neighbour(ref: ConstrainRef, id: number): ConstraintRef {
  if (ref.measured) return { id, name: ref.name, fit: ref.measured }
  const base = { center: ref.origin, sigma: 0, usedPoints: 0, regionSize: 0 }
  if (ref.kind === 'axis') return { id, name: ref.name, fit: { ...base, kind: 'cylinder', axis: ref.dir, radius: 0, length: 0, coverage: 0 } }
  const [basisU, basisV] = orthoBasis(ref.normal)
  return { id, name: ref.name, fit: { ...base, kind: 'plane', normal: ref.normal, basisU, basisV, extentU: 0, extentV: 0 } }
}

export function extractedSurface(shape: 'plane' | 'cylinder', positions: Float32Array, normals: Float32Array,
  ids: Uint32Array, refs: readonly ConstrainRef[], mode: ConstrainMode, tolerances?: { tiltDeg: number; coincidenceMm: number }) {
  const graph = { positions, normals }
  const free = shape === 'plane' ? fitPlaneOnSelection(graph, ids, { sigma: 0 }) : fitSelectedCylinder(graph, ids, 0)
  const index = free.used ?? ids
  const neighbours = refs.map((ref, i) => neighbour(ref, i))
  let held: PlaneFit | CylinderFit = free
  let ref: ConstrainRef | undefined, relation: FoundRelation['relation'] = 'along'
  if (mode.mode === 'auto') {
    const auto = autoConstrainFit(free, positions, index, neighbours.filter(n => !refs[n.id].key.startsWith('datum:')), tolerances)
    if (auto.fit.kind === 'plane' || auto.fit.kind === 'cylinder') held = auto.fit
    if (auto.choice) {
      const [how, key] = auto.choice.id.split('-')
      ref = key.startsWith('el') ? refs[Number(key.slice(2))] : refs.find(r => r.key === 'datum:' + (key === 'oxz' ? 'zx' : key.slice(1)))
      if (ref) {
        relation = ((how === 'parallel') === ((shape === 'plane') === (ref.kind === 'plane'))) ? 'along' : 'across'
        if (auto.notes.length > 1) relation = 'on'
      }
    }
  } else if (mode.mode === 'force') {
    const i = refs.findIndex(r => r.key === mode.ref)
    if (i < 0) throw new Error('The fit constraint reference is missing.')
    ref = refs[i]
    relation = mode.relation
    const parallel = (relation !== 'across') === ((shape === 'plane') === (ref.kind === 'plane'))
    const id: ConstraintId = `${parallel ? 'parallel' : 'perpendicular'}-el${i}`
    const dir = constrainedDirection(free, id, neighbours)
    const lock = relation === 'on' && dir ? (shape === 'plane' ? { offset: dot(dir, ref.origin) } : { through: ref.origin }) : undefined
    const fit = dir && withDirection(free, positions, index, dir, lock)
    if (!fit || (fit.kind !== 'plane' && fit.kind !== 'cylinder')) throw new Error('The selected points cannot satisfy the fit constraint.')
    held = fit
  }
  const relations: FoundRelation[] = []
  if (ref) {
    const dir = free.kind === 'plane' ? free.normal : free.axis
    const c = Math.min(1, Math.abs(dot(dir, ref.kind === 'plane' ? ref.normal : ref.dir)))
    relations.push({ relation, ref: ref.key, refKind: ref.kind, name: ref.name, tiltDeg: (relation === 'across' ? Math.asin(c) : Math.acos(c))*180/Math.PI })
  }
  return { held, rms: held.sigma, rmsFree: free.sigma, max: Math.max(Math.abs(held.residualMin ?? 0), Math.abs(held.residualMax ?? 0)), relations }
}
