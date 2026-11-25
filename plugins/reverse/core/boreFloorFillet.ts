// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import { addScaled, dot, len, scale, sub } from '../../../src/core/vec'
import type { LoopPiece, RawEdge, RawFace, ReKernel, Shape, Tracked } from './kernel'
import { sameSurface } from './kernelMath'

const tol = 1e-5

/** Identify the circular floor rail that ends the selected chord on both
 * sides. A round on the exterior of a cylinder has the opposite rail order. */
export function boreFloor(edges: RawEdge[], faces: RawFace[], edge: RawEdge, supports: RawFace[]) {
  for (const floor of supports) {
    const front = supports.find(f => f !== floor)!
    if (Math.abs(dot(front.dir, floor.dir)) > 1e-8) continue
    const rails = edges.filter(e => e.kind === 'circle' && e.center && e.radius && e.faceHashes.includes(floor.hash))
    for (const rail of rails) {
      const foot = faces.find(f => f.kind === 'torus' && rail.faceHashes.includes(f.hash))
      if (!foot) continue
      const section = edges.filter(e => e.faceHashes.includes(front.hash) && e.faceHashes.includes(foot.hash))
      if (!edge.ends.every(p => section.some(e => e.ends.some(q => len(sub(p, q)) < tol)))) continue
      const wallRail = edges.find(e => e.kind === 'circle' && e.radius && e.center && e.faceHashes.includes(foot.hash) &&
        faces.some(f => f.kind === 'cylinder' && e.faceHashes.includes(f.hash) && Math.abs(dot(f.dir, floor.dir)) > 1 - 1e-8))
      if (!wallRail?.radius || !wallRail.center) continue
      const radius = wallRail.radius - rail.radius!
      const delta = sub(wallRail.center, rail.center!)
      if (radius > tol && Math.abs(Math.abs(dot(delta, floor.dir)) - radius) < tol &&
          len(addScaled(delta, floor.dir, -dot(delta, floor.dir))) < tol) {
        return { floor, foot, up: scale(delta, 1 / radius), wall: faces.find(f => f.kind === 'cylinder' && wallRail.faceHashes.includes(f.hash))!,
          center: rail.center!, wallRadius: wallRail.radius, radius }
      }
    }
  }
  return null
}

/** Build the negative of the finished pocket. Rounding its floor-to-wall
 * seam rolls the existing small radius around the new entrance fillet.
 * The two resulting end patches meet the original torus and the new cylinder. */
export function finishBoreFloor(k: ReKernel, body: Shape, edge: RawEdge, axis: Vec3,
  bore: NonNullable<ReturnType<typeof boreFloor>>, up: Vec3, out: Vec3, kind: 'fillet' | 'chamfer',
  floorSetback: number, frontSetback: number, keep: (s: Shape) => Shape): (Tracked & { half: number }) | null {
  const margin = 4 * (Math.max(floorSetback, frontSetback) + bore.radius)
  const reach = 2 * bore.wallRadius + margin
  const at = (y: number, z: number) => addScaled(addScaled(edge.mid, out, y), up, z)
  const line = (a: Vec3, b: Vec3): LoopPiece => ({ kind: 'line', a, b })
  const inside = at(-reach, 0), start = at(-floorSetback, 0), end = at(0, -frontSetback)
  const diagonal = floorSetback * (1 / Math.SQRT2 - 1)
  const lower = at(0, -margin), far = at(reach, -margin), top = at(reach, margin), back = at(-reach, margin)
  // Continue a bevel past the open front so its two elliptical end rails
  // cross that plane naturally. The round has a vertical tangent there.
  const runout = Math.min(reach / 2, floorSetback * (margin / frontSetback - 1))
  const beyond = at(runout, -frontSetback * (1 + runout / floorSetback))
  const entrance: LoopPiece[] = kind === 'fillet'
    ? [{ kind: 'arc', a: start, m: at(diagonal, diagonal), b: end }, line(end, lower), line(lower, far)]
    : [line(start, beyond), line(beyond, far)]
  const profile = keep(k.face({ outer: [line(inside, start), ...entrance, line(far, top), line(top, back), line(back, inside)], holes: [] }))
  const section = keep(k.extrude(profile, axis, -reach, reach))
  let cylinder: Shape
  if (kind === 'fillet') {
    const disk = keep(k.face({ outer: [{ kind: 'circle', center: bore.center, normal: up, radius: bore.wallRadius }], holes: [] }))
    cylinder = keep(k.extrude(disk, up, -2 * margin, 2 * margin))
  } else {
    // Keep the seam away from the two ellipse ends while rounding the bevel.
    const lo = addScaled(bore.center, up, -2 * margin), hi = addScaled(bore.center, up, 2 * margin)
    const a = addScaled(lo, out, bore.wallRadius), b = addScaled(hi, out, bore.wallRadius)
    const meridian = keep(k.face({ outer: [line(lo, a), line(a, b), line(b, hi), line(hi, lo)], holes: [] }))
    cylinder = keep(k.revolve(meridian, bore.center, up, 2 * Math.PI))
  }
  const pocket = keep(k.common(cylinder, section))
  const edges = k.edges(pocket, 1)
  const rim = edges.filter(e => e.kind === 'circle' && e.center && len(sub(e.center, bore.center)) < tol &&
    Math.abs((e.radius ?? 0) - bore.wallRadius) < tol)
  if (!rim.length) return null
  if (kind === 'chamfer') {
    const wall = k.faces(pocket).find(f => f.kind === 'cylinder' && Math.abs((f.radius ?? 0) - bore.wallRadius) < tol)
    if (!wall) return null
    const onRamp = (p: Vec3) => {
      const v = sub(p, edge.mid)
      return Math.abs(dot(v, up) + frontSetback * (1 + dot(v, out) / floorSetback)) < tol
    }
    const rails = edges.filter(e => e.faceHashes.includes(wall.hash) && [e.mid, ...e.ends].every(onRamp))
    if (!rails.length) return null
    rim.push(...rails)
  }
  const tool = keep(k.filletTracked(pocket, rim.map(e => e.hash), bore.radius).shape)
  if (kind === 'chamfer') {
    // Recut a short filled section of the pocket. A direct subtraction
    // leaves coincident faces on the old floor round at small setbacks.
    const overlap = Math.min(bore.radius, floorSetback, frontSetback) / 4
    const disk = keep(k.face({ outer: [{ kind: 'circle', center: bore.center, normal: up, radius: bore.wallRadius + overlap }], holes: [] }))
    const plug = keep(k.extrude(disk, up, -overlap, bore.radius + frontSetback))
    const halfSpace = keep(k.halfSpace(edge.mid, scale(out, -1)))
    const filled = keep(k.fuse(body, keep(k.common(plug, halfSpace))))
    if (!k.isClosedSolid(filled) || k.solidCount(filled) !== 1) return null
    const made = keep(k.cut(filled, tool))
    const size = Math.max(floorSetback, frontSetback)
    k.mesh(made, Math.max(.001, Math.min(bore.radius, size) / 8))
    if (!k.isClosedSolid(made) || k.solidCount(made) !== 1 || k.volume(made) >= k.volume(body)) return null
    const near = (p: Vec3) => {
      const v = sub(p, edge.mid), station = dot(v, axis)
      return len(addScaled(v, axis, -Math.max(-edge.length / 2, Math.min(edge.length / 2, station)))) <= 3 * size + 2 * bore.radius
    }
    const after = k.faces(made), original = k.faces(body)
    const history = new Map<number, number[]>(), matched = new Set<number>()
    const parent = new Map(after.map(n => [n.hash, original.find(f => f.hash === n.hash) ?? sameSurface(n, original)]))
    const beforeEdges = k.edges(body, 1), afterEdges = k.edges(made, 1)
    const remote = (es: RawEdge[], hash: number) => es.filter(e => e.faceHashes.includes(hash)).flatMap(e => [e.mid, ...e.ends]).filter(p => !near(p))
    for (const f of original) {
      // The periodic bore wall can be split between several trimmed faces
      // by the recut. Track and measure their union against the old wall.
      const next = after.filter(n => parent.get(n.hash)?.hash === f.hash)
      if (!next.length || next.some(n => matched.has(n.hash))) return null
      next.forEach(n => matched.add(n.hash))
      if (next.length === 1 && next[0].hash === f.hash) continue
      history.set(f.hash, next.map(n => n.hash))
      const oldFace = keep(k.faceCopy(body, f.hash)), newFaces = next.map(n => keep(k.faceCopy(made, n.hash)))
      if (remote(beforeEdges, f.hash).some(p => newFaces.every(face => k.distanceToPoint(face, p) > tol)) ||
          next.some(n => remote(afterEdges, n.hash).some(p => k.distanceToPoint(oldFace, p) > tol))) return null
    }
    const added = afterEdges.filter(e => e.faceHashes.some(h => !matched.has(h)))
    if (!added.length || added.some(e => ![e.mid, ...e.ends].every(near))) return null
    // A single new planar face must join both requested contact rails.
    const bevel = after.find(f => f.kind === 'plane' && !matched.has(f.hash) &&
      Math.abs(dot(sub(start, f.centroid), f.dir)) < tol && Math.abs(dot(sub(end, f.centroid), f.dir)) < tol)
    if (!bevel) return null
    const surface = keep(k.faceCopy(made, bevel.hash))
    if ([start, end].some(p => k.distanceToPoint(surface, p) > tol)) return null
    return { shape: made, history, half: Math.max(edge.length / 2, ...added.flatMap(e => e.ends.map(p => Math.abs(dot(sub(p, edge.mid), axis))))) }
  }
  const overlap = keep(k.common(body, tool)), pieces = k.solids(overlap)
  pieces.forEach(keep)
  const sample = at(-floorSetback / 8, -frontSetback / 8)
  const local = pieces.filter(s => k.containsPoint(s, sample, tol / 10))
  if (local.length !== 1) return null

  // The virtual pocket also occupies empty space above the floor. Only
  // transfer the chip at this edge, including the two small end patches.
  const boundary = k.edges(local[0], 1)
  if (!boundary.length || boundary.some(e => [e.mid, ...e.ends].some(p => {
    const v = sub(p, edge.mid), y = dot(v, out), z = dot(v, up)
    return y > tol || y < -floorSetback - 2 * bore.radius - tol || z < -frontSetback - tol || z > bore.radius + tol
  }))) return null
  const half = Math.max(edge.length / 2, ...boundary.flatMap(e => e.ends.map(p => Math.abs(dot(sub(p, edge.mid), axis)))))
  const cut = k.cutTracked(body, pieces.length === 1 ? tool : local[0])
  keep(cut.shape)
  return { ...cut, half }
}
