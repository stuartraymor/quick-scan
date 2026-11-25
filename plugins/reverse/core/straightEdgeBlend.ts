// SPDX-License-Identifier: AGPL-3.0-only
import type { BlendSection } from './blendDrag'
import type { SidedChamfer } from './chamferSides'
import type { Vec3 } from '../../../src/core/types'
import { add, addScaled, dot, len, normalize, scale, sub } from '../../../src/core/vec'
import type { LoopPiece, RawEdge, ReKernel, Shape, Tracked } from './kernel'
import { isTrap } from './kernelOps'
import { boreFloor, finishBoreFloor } from './boreFloorFillet'

/** A straight edge on two planes has a constant normal section. Cutting or
 * filling that section over the picked span avoids the contour solver's
 * implicit propagation through tangent neighbours at the ends. */
export function straightEdgeBlend(k: ReKernel, body: Shape, hash: number, size: number, kind: 'fillet' | 'chamfer', sided?: { want: SidedChamfer; flip: boolean }): (Tracked & { section?: BlendSection }) | null {
  if (!(size > 0 && Number.isFinite(size))) return null
  const owned: Shape[] = []
  const keep = (s: Shape) => { owned.push(s); return s }
  try {
    const bodyEdges = k.edges(body, 1)
    const edge = bodyEdges.find(e => e.hash === hash)
    if (edge?.kind !== 'line' || edge.faceHashes.length !== 2) return null
    const bodyFaces = k.faces(body)
    const faces = bodyFaces.filter(f => edge.faceHashes.includes(f.hash))
    if (faces.length !== 2 || faces.some(f => f.kind !== 'plane')) return null
    const [a, b] = faces.map(f => f.dir)
    const axis = normalize(sub(edge.ends[1], edge.ends[0]))
    if (!axis || Math.abs(dot(a, b)) > 0.9999) return null

    // The normal bisectors sample all four sectors. A convex edge has one
    // material sector, a reentrant edge one empty sector. STEP planes can
    // carry either parameter orientation, independently of their solid.
    const probe = Math.min(0.01, size / 10, edge.length / 100)
    const sectors = [add(a, b), sub(a, b)].flatMap(v => {
      const dir = normalize(v)!
      return [dir, scale(dir, -1)]
    }).map(dir => ({ dir, inside: k.containsPoint(body, addScaled(edge.mid, dir, probe), probe * 0.001) }))
    const count = sectors.filter(s => s.inside).length
    if (count !== 1 && count !== 3) return null
    const remove = count === 1
    const inward = sectors.find(s => s.inside === remove)!.dir
    const n1 = dot(a, inward) > 0 ? scale(a, -1) : a
    const n2 = dot(b, inward) > 0 ? scale(b, -1) : b
    const cos = dot(n1, n2)
    const center = addScaled(edge.mid, inward, size / Math.sqrt((1 + cos) / 2))
    let offsets = [size, size]
    if (sided) {
      const { want, flip } = sided
      const theta = Math.PI - Math.acos(Math.max(-1, Math.min(1, cos)))
      const alpha = want.mode === 'distanceAngle' ? want.angleDeg * Math.PI / 180 : 0
      if (want.mode === 'distanceAngle' && !(alpha > 0 && alpha + theta < Math.PI)) return null
      const far = want.mode === 'twoDistances' ? want.distance2 : size * Math.sin(alpha) / Math.sin(theta + alpha)
      if (!(far > 0 && Number.isFinite(far))) return null
      const firstFace = k.edgeSides(body, [hash])[0]?.faces[flip ? 1 : 0]
      if (firstFace === undefined) return null
      offsets = firstFace === faces[0].hash ? [size, far] : [far, size]
    }
    const tangency = (n: Vec3, other: Vec3, distance: number) => kind === 'fillet'
      ? addScaled(center, n, size)
      : addScaled(edge.mid, normalize(sub(scale(n, cos), other))!, distance)
    const first = tangency(n1, n2, offsets[0]), second = tangency(n2, n1, offsets[1])
    // The two contact rails must land on the trimmed support faces. Ends
    // may run into earlier rounds; the boolean trims the tool there.
    const supports: Shape[] = []
    let clippedRail = false
    for (const [index, contact] of [first, second].entries()) {
      const support = keep(k.faceCopy(body, faces[index].hash))
      supports.push(support)
      if ([-0.3, 0, 0.3].every(f => k.distanceToPoint(support, addScaled(contact, axis, edge.length * f)) <= 1e-5)) continue
      // A recessed face can interrupt one rail. A square end wall at each
      // end bounds the exact prism, including the part of the rim that the
      // nominal section consumes. The other support must carry its rail.
      if (!remove || clippedRail) return null
      if (k.wireCount(support) < 2) {
        // A clipped convex polygon can consume an entire narrow flank. Its
        // continuation must be an oblique planar flank of the same extrusion.
        // Box walls, interrupted ribs and changes of section remain bounded.
        if (kind !== 'chamfer' || sided || !bodyFaces.every(f => {
          const cosine = Math.abs(dot(f.dir, axis))
          if (f.kind === 'cylinder') return cosine > 1 - 1e-9
          if (f.kind !== 'plane') return false
          if (cosine < 1e-9) return true
          return cosine > 1 - 1e-9 && edge.ends.some(p => Math.abs(dot(sub(f.centroid, p), axis)) < 1e-6)
        })) return null
        const direction = normalize(sub(contact, edge.mid))!
        const far = bodyEdges.filter(e => e.hash !== hash && e.kind === 'line' &&
          e.faceHashes.includes(faces[index].hash) && Math.abs(dot(e.dir, axis)) > 1 - 1e-9)
        if (far.length !== 1) return null
        const setback = dot(sub(far[0].mid, edge.mid), direction)
        const flank = bodyFaces.find(f => f.hash !== faces[index].hash && far[0].faceHashes.includes(f.hash))
        if (!(setback > 0 && setback < offsets[index]) || !flank || flank.kind !== 'plane') return null
        const tilt = Math.abs(dot(flank.dir, faces[index].dir))
        if (tilt < 1e-8 || tilt > 1 - 1e-8) return null
      }
      const squareEnds = edge.ends.every(end => bodyEdges.some(e =>
        e.hash !== hash && e.ends.some(p => len(sub(p, end)) < 1e-6) &&
        bodyFaces.some(f => e.faceHashes.includes(f.hash) && f.kind === 'plane' && Math.abs(dot(f.dir, axis)) > 1 - 1e-9)))
      if (!squareEnds) return null
      clippedRail = true
    }
    const boundary: LoopPiece = kind === 'fillet'
      ? { kind: 'arc', a: first, m: addScaled(center, inward, -size), b: second }
      : { kind: 'line', a: first, b: second }
    const face = keep(k.face({ outer: [{ kind: 'line', a: edge.mid, b: first }, boundary, { kind: 'line', a: second, b: edge.mid }], holes: [] }))
    const half = len(sub(edge.ends[1], edge.ends[0])) / 2
    let result: Tracked
    let sectionHalf = half
    if (remove) {
      const middle = boundary.kind === 'arc' ? boundary.m : scale(add(first, second), 0.5)
      const bore = boreFloor(bodyEdges, bodyFaces, edge, faces)
      if (bore) {
        const floorFirst = bore.floor === faces[0]
        const blend = finishBoreFloor(k, body, edge, axis, bore, floorFirst ? n1 : n2, floorFirst ? n2 : n1, kind,
          kind === 'fillet' ? size : len(sub(floorFirst ? first : second, edge.mid)),
          kind === 'fillet' ? size : len(sub(floorFirst ? second : first, edge.mid)), keep)
        if (!blend) return null
        result = blend
        sectionHalf = blend.half
      } else {
        const cut = convexTool(k, body, bodyEdges, edge, axis, face, size, middle, keep, faces.map((f, i) => ({ face: supports[i], normal: f.dir })), clippedRail)
        if (!cut) return null
        result = k.cutTracked(body, cut.tool)
        sectionHalf = cut.half
      }
    } else {
      result = k.fuseTracked(body, keep(k.extrude(face, axis, -half, half)))
    }
    if (!owned.includes(result.shape)) keep(result.shape)
    const solids = k.solids(result.shape)
    solids.forEach(keep)
    if (solids.length !== 1 || !k.isClosedSolid(result.shape)) return null
    const change = k.volume(body) - k.volume(result.shape)
    if ((remove ? change : -change) <= 0) return null
    owned.splice(owned.indexOf(result.shape), 1)
    const section: BlendSection | undefined = !sided ? {
      kind, mid: edge.mid, axis, half: sectionHalf, size, convex: remove,
      center: sub(center, edge.mid), first: sub(first, edge.mid), second: sub(second, edge.mid),
    } : undefined
    return { ...result, section, note: remove ? `The ${kind} is trimmed to the adjoining faces.` : `The ${kind} ends at the selected edge's endpoints.` }
  } catch (error) {
    if (isTrap(error)) throw error
    return null
  } finally {
    for (const shape of owned.reverse()) k.release(shape)
  }
}

function convexTool(k: ReKernel, body: Shape, bodyEdges: RawEdge[], edge: RawEdge, axis: Vec3, face: Shape, size: number, middle: Vec3, keep: (shape: Shape) => Shape,
  supports: { face: Shape; normal: Vec3 }[] = [], squareEnds = false) {
  const half = len(sub(edge.ends[1], edge.ends[0])) / 2
  // The ends of the sharp edge are not planes bounding the finished
  // bevel. A sloping wall or earlier round can cross a contact rail
  // beyond either end. Let the existing body trim the section there.
  const box = k.bounds(body)
  const reach = len(sub(box.max, box.min)) + size
  // A distinct collinear span limits the tool. A sub-tolerance vertex sliver
  // between different supports (for example where two rounds meet) does not.
  const stopAt = (end: Vec3) => bodyEdges.some(other => other.hash !== edge.hash && other.kind === 'line' &&
    (other.length > 1e-5 || other.faceHashes.every(h => edge.faceHashes.includes(h))) &&
    Math.abs(dot(other.dir, axis)) > 1 - 1e-9 && other.ends.some(p => len(sub(p, end)) < 1e-6))
  let tool = keep(k.extrude(face, axis, squareEnds || stopAt(edge.ends[0]) ? -half : -reach, squareEnds || stopAt(edge.ends[1]) ? half : reach))
  const overlap = keep(k.common(body, tool))
  const pieces = k.solids(overlap)
  pieces.forEach(keep)
  // A remote arm may cross the extended section. Only remove the
  // connected chip that contains material just inside the picked edge.
  const sample = scale(add(edge.mid, middle), 0.5)
  const local = pieces.filter(piece => k.containsPoint(piece, sample, 1e-7))
  if (local.length !== 1) return null
  // A connected chip can run straight under a pocket wall. Its planar
  // sides must have been exposed on the two selected support faces.
  const sides = k.faces(local[0]).filter(f => f.kind === 'plane')
  const boundary = supports.length ? k.edges(local[0], 1) : []
  for (const support of supports) {
    const coplanar = sides.filter(f => Math.abs(dot(f.dir, support.normal)) > 1 - 1e-9 &&
      Math.abs(dot(sub(f.centroid, edge.mid), support.normal)) < 1e-6)
    for (const f of coplanar) {
      if (boundary.some(e => e.faceHashes.includes(f.hash) && [e.mid, ...e.ends].some(p => k.distanceToPoint(support.face, p) > 1e-5))) return null
    }
  }
  if (pieces.length > 1) tool = local[0]
  const chip = k.bounds(local[0])
  const chipCenter = scale(add(chip.min, chip.max), 0.5)
  const chipHalf = scale(sub(chip.max, chip.min), 0.5)
  const axialRadius = chipHalf[0] * Math.abs(axis[0]) + chipHalf[1] * Math.abs(axis[1]) + chipHalf[2] * Math.abs(axis[2])
  return { tool, half: Math.max(half, Math.abs(dot(sub(chipCenter, edge.mid), axis)) + axialRadius) }
}

/** An axial line on an outer cylinder and a plane has an exact rolling-circle
 * section. Use it only to recover a failed single-edge constant-radius solve. */
export function cylinderEdgeFillet(k: ReKernel, body: Shape, hash: number, size: number): Tracked | null {
  const owned: Shape[] = []
  const keep = (s: Shape) => { owned.push(s); return s }
  try {
    const edges = k.edges(body, 1)
    const edge = edges.find(e => e.hash === hash)
    if (!edge || edge.kind !== 'line' || edge.faceHashes.length !== 2 || !(size > 0 && Number.isFinite(size))) return null
    const faces = k.faces(body).filter(f => edge.faceHashes.includes(f.hash))
    const plane = faces.find(f => f.kind === 'plane'), wall = faces.find(f => f.kind === 'cylinder')
    if (!plane || !wall?.center || !wall.radius || size >= wall.radius) return null
    const axis = normalize(sub(edge.ends[1], edge.ends[0]))
    if (!axis || Math.abs(dot(axis, wall.dir)) < 1 - 1e-9 || Math.abs(dot(axis, plane.dir)) > 1e-9) return null

    const origin = addScaled(wall.center, axis, dot(sub(edge.mid, wall.center), axis))
    const radial = sub(edge.mid, origin)
    const along = normalize(addScaled(radial, plane.dir, -dot(radial, plane.dir)))
    if (!along) return null
    const probe = Math.min(.01, size / 10, edge.length / 100)
    const onPlane = addScaled(edge.mid, along, -4 * probe)
    const inside = (p: Vec3) => k.containsPoint(body, p, probe * .001)
    const positive = inside(addScaled(onPlane, plane.dir, probe)), negative = inside(addScaled(onPlane, plane.dir, -probe))
    if (positive === negative) return null
    const normal = positive ? scale(plane.dir, -1) : plane.dir
    const offset = dot(radial, normal) - size
    const span2 = (wall.radius - size) ** 2 - offset ** 2
    if (span2 <= 0) return null
    const center = addScaled(addScaled(origin, normal, offset), along, Math.sqrt(span2))
    const wallNormal = normalize(sub(center, origin))!
    const onFlat = addScaled(center, normal, size), onWall = addScaled(origin, wallNormal, wall.radius)
    if (!inside(addScaled(onWall, wallNormal, -probe)) || inside(addScaled(onWall, wallNormal, probe))) return null
    for (const [support, contact] of [[plane, onFlat], [wall, onWall]] as const) {
      const face = keep(k.faceCopy(body, support.hash))
      for (const fraction of [-.3, 0, .3]) {
        if (k.distanceToPoint(face, addScaled(contact, axis, fraction * edge.length)) > 1e-5) return null
      }
    }
    const middle = addScaled(center, normalize(add(wallNormal, normal))!, size)
    const wallMiddle = addScaled(origin, normalize(add(scale(radial, 1 / wall.radius), wallNormal))!, wall.radius)
    const profile = keep(k.face({ outer: [
      { kind: 'line', a: edge.mid, b: onFlat },
      { kind: 'arc', a: onFlat, m: middle, b: onWall },
      { kind: 'arc', a: onWall, m: wallMiddle, b: edge.mid },
    ], holes: [] }))
    const cutter = convexTool(k, body, edges, edge, axis, profile, size, middle, keep)
    if (!cutter) return null
    const result = k.cutTracked(body, cutter.tool)
    keep(result.shape)
    if (!k.isClosedSolid(result.shape) || k.solidCount(result.shape) !== 1 || !(k.volume(result.shape) < k.volume(body))) return null
    owned.splice(owned.indexOf(result.shape), 1)
    return { ...result, note: 'The fillet is tangent to the plane and cylinder and trimmed to the adjoining faces.' }
  } catch (error) {
    if (isTrap(error)) throw error
    return null
  } finally {
    for (const shape of owned.reverse()) k.release(shape)
  }
}
