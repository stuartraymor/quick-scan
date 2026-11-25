// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import { addScaled, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { LoopPiece, ReKernel, Shape, Tracked } from './kernel'
import { isTrap } from './kernelOps'

/** Equal setbacks at the square lip of a semicircular turned groove.
 * Revolve its normal section so both contact rails stay circular. */
export function grooveChamfer(k: ReKernel, body: Shape, hash: number, distance: number): Tracked | null {
  if (!(distance > 0 && Number.isFinite(distance))) return null
  const tol = 1e-5
  const owned: Shape[] = []
  const keep = (s: Shape) => { owned.push(s); return s }
  try {
    const edges = k.edges(body, 1)
    const lip = edges.find(e => e.hash === hash)
    if (!lip?.center || !lip.radius || !lip.quadrants) return null
    const supports = k.faces(body).filter(f => lip.faceHashes.includes(f.hash))
    const groove = supports.find(f => f.kind === 'torus' && f.fullTurn)
    const wall = supports.find(f => f.kind === 'cylinder' && f.fullTurn)
    if (!groove || !wall || Math.abs(dot(wall.dir, lip.dir)) < 1 - 1e-8) return null
    const seam = edges.find(e => e.kind === 'circle' && e.faceHashes.includes(groove.hash) &&
      e.center && e.radius && Math.abs(dot(e.dir, lip.dir)) < 1e-8 &&
      Math.abs(e.length - Math.PI * e.radius) < tol)
    if (!seam?.center || !seam.radius) return null
    const r = seam.radius, fromCenter = sub(lip.center, seam.center)
    const axial = dot(fromCenter, lip.dir)
    if (Math.abs(Math.abs(axial) - r) > tol ||
        Math.abs(len(addScaled(fromCenter, lip.dir, -axial)) - lip.radius) > tol) return null
    const up = scale(lip.dir, Math.sign(axial))
    const away = normalize(sub(seam.mid, seam.center))
    if (!away || Math.abs(dot(away, up)) > 1e-8) return null
    const at = (x: number, z: number) => addScaled(addScaled(seam.center!, away, x), up, z)

    // The nominal bevel crosses the groove circle where x + z = r + d.
    // Beyond tangency that line misses the support. The limiting construction
    // joins the contact points of a rolling circle of the requested size.
    const sum = r + distance
    const discriminant = 2 * r * r - sum * sum
    const rollHeight = Math.sqrt(r * (r + 2 * distance))
    const x = discriminant >= 0 ? (sum - Math.sqrt(discriminant)) / 2 : r * distance / sum
    const wallZ = discriminant >= 0 ? sum : rollHeight
    const grooveZ = Math.sqrt(Math.max(0, r * r - x * x))
    const a = at(0, wallZ), b = at(x, grooveZ), c = at(0, grooveZ)
    const wallFace = keep(k.faceCopy(body, wall.hash)), grooveFace = keep(k.faceCopy(body, groove.hash))
    if (k.distanceToPoint(wallFace, a) > tol || k.distanceToPoint(grooveFace, b) > tol) return null
    const line = (a: Vec3, b: Vec3): LoopPiece => ({ kind: 'line', a, b })
    const section = keep(k.face({ outer: [line(a,b),line(b,c),line(c,a)], holes: [] }))
    const tool = keep(k.revolve(section, lip.center, up, 2 * Math.PI))
    const result = k.cutTracked(body, tool)
    keep(result.shape)
    if (!k.isClosedSolid(result.shape) || k.solidCount(result.shape) !== 1 ||
        !(k.volume(result.shape) < k.volume(body))) return null
    // An interruption elsewhere around the circumference can leave a partial
    // bevel, even when the section fits at the seam. Require the full frustum.
    const radiusAtB = len(sub(b, addScaled(lip.center, up, grooveZ - r)))
    const bevelArea = Math.PI * (lip.radius + radiusAtB) * len(sub(a, b))
    if (!k.faces(result.shape).some(f => f.kind === 'cone' &&
      Math.abs(f.area - bevelArea) < Math.max(1e-6, bevelArea * 1e-7))) return null
    owned.pop()
    return result
  } catch (error) {
    if (isTrap(error)) throw error
    return null
  } finally { k.release(...owned) }
}
