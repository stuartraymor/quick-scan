// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import type { BuiltBody, EdgeInfo } from './buildTypes'
import { addScaled, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { LoopPiece, ReKernel, Shape, Tracked } from './kernel'
import { isTrap } from './kernelOps'

/** At an annular shoulder the far cylindrical wall can trim a blend which
 * consumes the whole planar ledge. The nominal radius or bevel stays exact. */
export function shoulderBlend(k: ReKernel, body: Shape, topology: BuiltBody['topology'], pick: EdgeInfo, size: number, kind: 'fillet' | 'chamfer'): Tracked | null {
  if (!(size > 0 && Number.isFinite(size))) return null
  const tol = 1e-5, owned: Shape[] = []
  const keep = (s: Shape) => { owned.push(s); return s }
  try {
    const rim = pick.fingerprint, center = pick.center
    if (!pick.quadrants || !center || !rim.radius) return null
    const supports = topology.faces.filter(f => pick.faces.includes(f.hash))
    const ledge = supports.find(f => f.fingerprint.kind === 'plane')
    const wall = supports.find(f => f.fingerprint.kind === 'cylinder' && f.fullTurn)
    if (!ledge || !wall || Math.abs(dot(ledge.fingerprint.dir, rim.dir)) < 1 - 1e-8) return null
    const others = topology.edges.filter(e => e.hash !== pick.hash && e.faces.includes(ledge.hash))
    if (others.length !== 1) return null
    const far = others[0]
    const farRadius = far.fingerprint.radius
    if (!far.quadrants || !far.center || !farRadius || len(sub(center, far.center)) > tol) return null
    const width = Math.abs(farRadius - rim.radius)
    if (width > size + tol || width <= tol) return null
    const limit = topology.faces.find(f => far.faces.includes(f.hash) && f.fingerprint.kind === 'cylinder' && f.fullTurn)
    if (!limit || Math.abs(dot(limit.fingerprint.dir, wall.fingerprint.dir)) < 1 - 1e-8) return null
    // Align the revolved tool with the wall's existing periodic seam.
    const start = pick.quadrants[0]
    const radial = normalize(sub(start, center))
    if (!radial) return null
    const across = scale(radial, Math.sign(farRadius - rim.radius))
    const axial = scale(rim.dir, Math.sign(dot(sub(wall.fingerprint.centroid, center), rim.dir)))
    const at = (x: number, z: number) => addScaled(addScaled(start, across, x), axial, z)
    const run = Math.min(width, size)
    // The circle stays tangent to the wall and passes through the far lip.
    // A bevel maintains its nominal setback and intersects the far cylinder.
    const rise = kind === 'fillet' ? Math.sqrt(run * (2 * size - run)) : size
    const wallContact = at(0, rise)
    if (k.distanceToPoint(keep(k.faceCopy(body, wall.hash)), wallContact) > tol) return null
    const height = (x: number) => kind === 'chamfer' ? size - x : rise - Math.sqrt(x * (2 * size - x))
    const end = at(run, height(run)), foot = at(run, 0)
    const line = (a: Vec3, b: Vec3): LoopPiece => ({ kind: 'line', a, b })
    const boundary: LoopPiece[] = [line(start, wallContact), kind === 'fillet'
      ? { kind: 'arc', a: wallContact, m: at(run / 2, height(run / 2)), b: end }
      : line(wallContact, end)]
    if (len(sub(end, foot)) > 1e-7) boundary.push(line(end, foot))
    boundary.push(line(foot, start))
    const section = keep(k.face({ outer: boundary, holes: [] }))
    const tool = keep(k.revolve(section, center, axial, 2 * Math.PI))
    const probe = Math.min(width, size) * .01
    const remove = k.containsPoint(body, at(probe, probe), probe * .001)
    const result = remove ? k.cutTracked(body, tool) : k.fuseTracked(body, tool)
    keep(result.shape)
    // A partial overlap means another feature occupied the swept section.
    // A valid shoulder either adds or removes the complete local section.
    const expected = k.volume(tool), delta = k.volume(result.shape) - k.volume(body)
    if (!k.isClosedSolid(result.shape) || k.solidCount(result.shape) !== 1 ||
        Math.abs((remove ? -delta : delta) - expected) > Math.max(1e-6, expected * 1e-5)) return null
    owned.pop()
    return result
  } catch (error) {
    if (isTrap(error)) throw error
    return null
  } finally { k.release(...owned) }
}
