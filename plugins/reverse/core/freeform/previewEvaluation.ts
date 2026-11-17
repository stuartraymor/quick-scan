// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../../src/core/types'
import { type Cage, edgeKey, topology } from './cage'
import { subdivide, subdivisionPositions } from './subdivide'
import { limitPositions } from './limit'

/** Include winding, creases and unused poles: equal face counts alone do not
 * identify connectivity after joining, repair, hiding or Undo. */
export const previewTopologyKey = (c: Cage, steps: number): string =>
  JSON.stringify([steps, c.positions.length, c.faces, c.creases])

const changedVertices = (a: Float64Array, b?: Float64Array): Set<number> => {
  const changed = new Set<number>()
  for (let i = 0; i < a.length; i += 3)
    if (!b || a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) changed.add(i / 3)
  return changed
}

/** Fixed-connectivity edit plan. Numeric masks are the same as subdivision
 * and cageVertexLimits; only their local dependency sets are re-evaluated.
 * It owns snapshots, so caller mutation and drag cancellation are safe. */
export function previewEvaluation(cage: Cage, steps: number) {
  const key = previewTopologyKey(cage, steps)
  let template: Cage = { positions: new Float64Array(cage.positions.length), faces: cage.faces.map(f => f.slice()), creases: cage.creases.map(e => [...e]) }
  let owners = template.faces.map((_, i) => i)
  let paths = topology(template).edges.map(e => [e.a, e.b])
  const levels: { cage: Cage; top: ReturnType<typeof topology>; value?: Float64Array }[] = []
  // One extra subdivision gives exactly the existing cageVertexLimits masks,
  // including original non-quads and extraordinary/creased boundary vertices.
  let faces = template.faces, count = template.positions.length / 3
  for (let step = 0; step <= steps; step++) {
    const top = topology(template)
    levels.push({ cage: template, top })
    if (step < steps) {
      const offset = template.positions.length / 3 + template.faces.length
      paths = paths.map(path => path.flatMap((v, i) => i === path.length - 1 ? [v] : [v, offset + top.edgeOf.get(edgeKey(v, path[i + 1]))!]))
      owners = template.faces.flatMap((face, i) => face.map(() => owners[i]))
    } else { faces = template.faces; count = template.positions.length / 3 }
    template = subdivide(template, top)
  }
  const limitTopology = topology(template)
  let previousInput: Float64Array | undefined, previousLimit: Float64Array | undefined
  let points: Vec3[] = []
  return {
    key, faces, owners, paths,
    evaluate(positions: Float64Array) {
      if (positions.length !== cage.positions.length) throw new Error('Preview plan vertex count changed.')
      let dirty = changedVertices(positions, previousInput), value = positions
      previousInput = positions.slice()
      for (const level of levels) {
        const next = subdivisionPositions({ ...level.cage, positions: value }, level.top, level.value, dirty)
        dirty = changedVertices(next, level.value)
        level.value = value = next
      }
      const limit = limitPositions({ ...template, positions: value }, limitTopology, previousLimit, dirty)
      const changed = changedVertices(limit.subarray(0, count * 3), previousLimit?.subarray(0, count * 3))
      const nextPoints = points.slice()
      for (const i of changed) nextPoints[i] = [limit[i * 3], limit[i * 3 + 1], limit[i * 3 + 2]]
      previousLimit = limit; points = nextPoints
      return { points, changed }
    },
  }
}
