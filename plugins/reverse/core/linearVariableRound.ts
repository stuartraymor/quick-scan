// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import { add, addScaled, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { LoopPiece, Profile, ReKernel, Shape, Tracked } from './kernel'
import { validLaw, type RadiusPoint } from './roundInputs'

/** A ruled loft of circular normal sections gives exactly linear radii along a
 * straight crease. Each interval's two planar contact strips must lie entirely
 * on the original trimmed support faces, including any holes in those faces. */
export function linearVariableRound(k: ReKernel, stock: Shape, hash: number, ends: [number, number], points: RadiusPoint[] = []): Tracked {
  if (!validLaw(ends, points)) throw new Error('Enter positive radii and increasing station positions.')
  const allEdges = k.edges(stock, 1)
  const edge = allEdges.find(e => e.hash === hash)
  const faces = k.faces(stock)
  const sides = faces.filter(f => edge?.faceHashes.includes(f.hash))
  if (!edge || edge.kind !== 'line' || sides.length !== 2 || sides.some(f => f.kind !== 'plane'))
    throw new Error('A linear radius transition needs a straight edge between two planar faces. Select Smooth for curved supports.')
  const axis = normalize(sub(edge.ends[1], edge.ends[0]))
  const [a, b] = sides.map(f => f.dir)
  if (!axis || Math.abs(dot(a, b)) > 0.9999) throw new Error('The two support planes must meet at a distinct corner.')
  const law = [{ position: 0, radius: ends[0] }, ...points, { position: 1, radius: ends[1] }]
  const probe = Math.min(0.01, edge.length / 100, ...law.map(p => p.radius / 10))
  const sectors = [add(a, b), sub(a, b)].flatMap(v => {
    const direction = normalize(v)!
    return [direction, scale(direction, -1)]
  }).map(direction => ({ direction, inside: k.containsPoint(stock, addScaled(edge.mid, direction, probe), probe * 0.001) }))
  const material = sectors.filter(s => s.inside).length
  if (material !== 1 && material !== 3) throw new Error('The solid has no unambiguous material side at this edge.')
  const remove = material === 1
  const inward = sectors.find(s => s.inside === remove)!.direction
  const normals = [a, b].map(n => dot(n, inward) > 0 ? scale(n, -1) : n)
  const divisor = Math.sqrt((1 + dot(normals[0], normals[1])) / 2)
  const capTolerance = Math.max(1e-7, edge.length * 1e-9)
  for (const end of edge.ends) {
    const cap = allEdges.some(e => e.hash !== hash && e.ends.some(p => len(sub(p, end)) <= capTolerance) &&
      faces.some(f => e.faceHashes.includes(f.hash) && f.kind === 'plane' && Math.abs(dot(f.dir, axis)) > 1 - 1e-9))
    if (!cap) throw new Error('Linear transition currently requires a perpendicular end face at both ends of the selected edge.')
  }

  const owned: Shape[] = []
  const keep = (shape: Shape) => { owned.push(shape); return shape }
  const line = (a: Vec3, b: Vec3): LoopPiece => ({ kind: 'line', a, b })
  try {
    const stations = law.map(({ position, radius }) => {
      const corner = addScaled(edge.ends[0], axis, position * edge.length)
      const center = addScaled(corner, inward, radius / divisor)
      const contacts = normals.map(n => addScaled(center, n, radius))
      const arc: LoopPiece = { kind: 'arc', a: contacts[0], m: addScaled(center, inward, -radius), b: contacts[1] }
      const profile: Profile = { outer: [line(corner, arc.a), arc, line(arc.b, corner)], holes: [] }
      return { corner, contacts, profile }
    })
    for (const [index, side] of sides.entries()) {
      const support = keep(k.faceCopy(stock, side.hash))
      for (let j = 1; j < stations.length; j++) {
        const first = stations[j - 1], last = stations[j]
        const vertices = [first.corner, first.contacts[index], last.contacts[index], last.corner]
        const strip = keep(k.face({ outer: vertices.map((p, i) => line(p, vertices[(i + 1) % 4])), holes: [] }))
        const overlap = keep(k.common(strip, support))
        const area = k.surfaceArea(strip)
        if (!(area > 0 && Math.abs(k.surfaceArea(overlap) - area) <= area * 1e-6))
          throw new Error('The linear fillet extends beyond a trimmed support face. Reduce the radius at the adjacent stations.')
      }
    }
    const tool = keep(k.loft(stations.map(s => s.profile), true))
    const result = remove ? k.cutTracked(stock, tool) : k.fuseTracked(stock, tool)
    keep(result.shape)
    const volume = k.volume(tool)
    const change = (k.volume(stock) - k.volume(result.shape)) * (remove ? 1 : -1)
    if (!(change > 0 && Math.abs(change - volume) <= volume * 1e-4 && k.solidCount(result.shape) === 1 && k.isClosedSolid(result.shape)))
      throw new Error('The linear fillet intersects other geometry or would leave an invalid solid.')
    owned.pop()
    return result
  } finally { k.release(...owned) }
}
