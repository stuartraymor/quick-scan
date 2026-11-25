// SPDX-License-Identifier: AGPL-3.0-only
import { addScaled, dot, len, normalize, sub } from '../../../src/core/vec'
import type { BuiltBody, EdgeInfo } from './buildTypes'
import type { ReKernel, Shape, Tracked } from './kernel'
import { isTrap } from './kernelOps'

/** Equal setbacks on a cone and a perpendicular ledge lie in a meridian
 * plane. Revolving that section also handles a reentrant shoulder. */
export function conicalRimChamfer(k: ReKernel, body: Shape, topology: BuiltBody['topology'], rim: EdgeInfo, distance: number): Tracked | null {
  const center = rim.center, radius = rim.fingerprint.radius, axis = rim.fingerprint.dir
  if (!center || !radius || !rim.quadrants || !(Number.isFinite(distance) && distance > 0)) return null
  const supports = topology.faces.filter(f => rim.faces.includes(f.hash))
  const cone = supports.find(f => f.fingerprint.kind === 'cone' && f.fullTurn)
  const plane = supports.find(f => f.fingerprint.kind === 'plane')
  if (!cone || !plane || Math.abs(dot(plane.fingerprint.dir, axis)) < 1 - 1e-9) return null
  const circles = topology.edges.filter(e => e.hash !== rim.hash && e.faces.includes(cone.hash) && e.fingerprint.kind !== 'line')
  if (circles.length !== 1) return null
  const far = circles[0], farRadius = far.fingerprint.radius
  if (!far.center || !farRadius || !far.quadrants) return null
  const height = dot(sub(far.center, center), axis)
  if (len(sub(far.center, addScaled(center, axis, height))) > 1e-6) return null
  const slant = Math.hypot(height, farRadius - radius)
  if (distance >= slant || Math.abs(height) < 1e-6) return null

  const owned: Shape[] = []
  const keep = (s: Shape) => { owned.push(s); return s }
  try {
    const start = rim.quadrants[0]
    const radial = normalize(sub(start, center))
    if (!radial) return null
    const flatFace = keep(k.faceCopy(body, plane.hash))
    const probe = Math.min(distance, radius) * .01
    const out = k.distanceToPoint(flatFace, addScaled(start, radial, probe)) < 1e-6
    const inside = k.distanceToPoint(flatFace, addScaled(start, radial, -probe)) < 1e-6
    if (out === inside) return null
    const flatRadius = radius + (out ? distance : -distance)
    if (flatRadius <= 0) return null
    const onFlat = addScaled(center, radial, flatRadius)
    const coneRadius = radius + (farRadius - radius) * distance / slant
    const onCone = addScaled(addScaled(center, radial, coneRadius), axis, height * distance / slant)
    const section = keep(k.face({ outer: [
      { kind: 'line', a: start, b: onFlat }, { kind: 'line', a: onFlat, b: onCone }, { kind: 'line', a: onCone, b: start },
    ], holes: [] }))
    let tool = keep(k.revolve(section, center, axis, 2 * Math.PI))
    // Holes crossing the new rail must continue through an added bevel.
    // Limit this construction to boundaries whose continuation is known.
    const low = Math.min(radius, flatRadius, coneRadius), high = Math.max(radius, flatRadius, coneRadius)
    const normal = plane.fingerprint.dir
    for (const e of topology.edges.filter(e => e.hash !== rim.hash && e.faces.includes(plane.hash))) {
      const r = e.fingerprint.radius
      if (!e.center || !e.quadrants || !r) return null
      const separation = len(sub(e.center, center))
      if (Math.abs(separation - r) >= high - 1e-7 || separation + r <= low + 1e-7) continue
      const wall = topology.faces.find(f => e.faces.includes(f.hash) && f.fingerprint.kind === 'cylinder' && f.fullTurn)
      if (!wall || Math.abs(dot(wall.fingerprint.dir, axis)) < 1 - 1e-9) return null
      // On the stock side of the ledge, verify that this circle bounds a bore.
      const direction = normalize(sub(e.quadrants[0], e.center))
      if (!direction) return null
      const atWall = addScaled(e.quadrants[0], normal, -probe)
      if (!k.containsPoint(body, addScaled(atWall, direction, probe), probe * .001) ||
          k.containsPoint(body, addScaled(atWall, direction, -probe), probe * .001)) return null
      // Continue the existing bore's seam through the bevel. An arbitrary
      // cylinder seam can leave an invalid join on a rotated workpiece.
      const reach = distance + probe
      const seam = e.quadrants[0]
      const corners = [addScaled(e.center, axis, -reach), addScaled(seam, axis, -reach),
        addScaled(seam, axis, reach), addScaled(e.center, axis, reach)]
      const meridian = keep(k.face({ outer: corners.map((a, i) =>
        ({ kind: 'line', a, b: corners[(i + 1) % corners.length] })), holes: [] }))
      const bore = keep(k.revolve(meridian, e.center, axis, 2 * Math.PI))
      tool = keep(k.cut(tool, bore))
    }
    const interior = addScaled(addScaled(start, sub(onCone, start), .25), sub(onFlat, start), .25)
    const remove = k.containsPoint(body, interior, 1e-7)
    const result = remove ? k.cutTracked(body, tool) : k.fuseTracked(body, tool)
    keep(result.shape)
    const delta = (k.volume(result.shape) - k.volume(body)) * (remove ? -1 : 1)
    const expected = k.volume(tool)
    if (!k.isClosedSolid(result.shape) || k.solidCount(result.shape) !== 1 || delta <= 0 ||
        Math.abs(delta - expected) > Math.max(1e-6, expected * 1e-5)) return null
    owned.pop()
    return result
  } catch (error) {
    if (isTrap(error)) throw error
    return null
  } finally { k.release(...owned) }
}
