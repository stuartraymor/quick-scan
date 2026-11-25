// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import { addScaled, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { BuiltBody, EdgeInfo } from './buildTypes'
import type { LoopPiece, ReKernel, Shape, Tracked } from './kernel'
import { isTrap } from './kernelOps'

/** A convex circular lip can break out into free space along its sweep.
 * A short cylinder ending against the opposite cap trims the chamfer. For
 * a fillet the rolling circle stays tangent to the plane and meets the far lip. */
export function cylindricalRimCut(k: ReKernel, body: Shape, topology: BuiltBody['topology'],
  edge: EdgeInfo, size: number, kind: 'fillet' | 'chamfer'): Tracked | null {
  const center = edge.center, radius = edge.fingerprint.radius
  if (!center || !radius || !edge.quadrants || !(Number.isFinite(size) && size > 0)) return null
  const supports = topology.faces.filter(f => edge.faces.includes(f.hash))
  const cap = supports.find(f => f.fingerprint.kind === 'plane')
  const wall = supports.find(f => f.fingerprint.kind === 'cylinder' && f.fullTurn)
  if (!cap || !wall) return null
  const axial = scale(cap.fingerprint.dir, -1)
  if (Math.abs(dot(axial, edge.fingerprint.dir)) < 1 - 1e-9) return null
  const ends = topology.edges.filter(e => e.hash !== edge.hash && e.faces.includes(wall.hash) && e.fingerprint.kind !== 'line')
  if (ends.length !== 1 || !ends[0].center || !ends[0].quadrants) return null
  const far = ends[0], height = dot(sub(ends[0].center, center), axial)
  const tolerance = 1e-6
  if (height <= tolerance || len(sub(ends[0].center, addScaled(center, axial, height))) > tolerance) return null
  if (size >= height && !topology.faces.some(f => far.faces.includes(f.hash) && f.fingerprint.kind === 'plane' &&
    dot(f.fingerprint.dir, axial) > 1 - 1e-9)) return null

  const owned: Shape[] = []
  const keep = (shape: Shape) => { owned.push(shape); return shape }
  try {
    const start = edge.quadrants[0], radial = normalize(sub(start, center))
    if (!radial) return null
    const plane = keep(k.faceCopy(body, cap.hash))
    const probe = Math.min(radius, height, size) * .005
    const out = k.distanceToPoint(plane, addScaled(start, radial, probe)) < tolerance
    const inside = k.distanceToPoint(plane, addScaled(start, radial, -probe)) < tolerance
    if (out === inside) return null
    const across = scale(radial, out ? 1 : -1)
    const at = (x: number, z: number) => addScaled(addScaled(start, across, x), axial, z)
    if (!k.containsPoint(body, at(probe, probe), probe * .001) ||
        k.containsPoint(body, at(-probe, probe), probe * .001)) return null
    const depth = Math.min(size, height)
    const run = kind === 'fillet' ? Math.sqrt(depth * (2 * size - depth)) : size
    if (!out && run >= radius - tolerance) return null
    // At least part of the contact circle must lie on this bounded cap.
    const contactRadius = radius + (out ? run : -run)
    const rail = keep(k.wire([{ kind: 'circle', center, normal: axial, radius: contactRadius }]))
    if (k.distanceBetween(plane, rail) > tolerance) return null
    const x = (z: number) => kind === 'fillet' ? run - Math.sqrt(z * (2 * size - z)) : run - z
    const end = at(x(depth), depth), foot = at(0, depth), contact = at(run, 0)
    const line = (a: Vec3, b: Vec3): LoopPiece => ({ kind: 'line', a, b })
    const pieces: LoopPiece[] = [line(start, contact), kind === 'fillet'
      ? { kind: 'arc', a: contact, m: at(x(depth / 2), depth / 2), b: end } : line(contact, end)]
    if (len(sub(end, foot)) > tolerance) pieces.push(line(end, foot))
    pieces.push(line(foot, start))
    const section = keep(k.face({ outer: pieces, holes: [] }))
    const tool = keep(k.revolve(section, center, axial, 2 * Math.PI))
    const result = k.cutTracked(body, tool)
    keep(result.shape)
    const removed = k.volume(body) - k.volume(result.shape)
    if (!(removed > 0 && removed <= k.volume(tool) * (1 + 1e-5) + 1e-6) ||
        !k.isClosedSolid(result.shape) || k.solidCount(result.shape) !== 1) return null
    // A boss rising from the selected plane would leave a new flat
    // underside where the cutter stops. That transition needs extending
    // the finish onto the boss, beyond this bounded construction.
    const undersideArea = (shape: Shape) => k.faces(shape).filter(f => f.kind === 'plane' &&
      dot(f.dir, axial) > 1 - 1e-9 && Math.abs(dot(sub(f.centroid, center), axial)) < tolerance)
      .reduce((sum, face) => sum + face.area, 0)
    if (undersideArea(result.shape) - undersideArea(body) > tolerance * Math.max(1, size)) return null
    owned.pop()
    return result
  } catch (error) {
    if (isTrap(error)) throw error
    return null
  } finally { k.release(...owned) }
}
