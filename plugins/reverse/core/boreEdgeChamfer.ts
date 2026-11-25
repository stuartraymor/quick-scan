// SPDX-License-Identifier: AGPL-3.0-only
import { cross, dot, len, sub } from '../../../src/core/vec'
import type { RawEdge, ReKernel, Shape, Tracked } from './kernel'
import { meshDeflection } from './buildTypes'
import { sameSurface } from './kernelMath'
import { isTrap } from './kernelOps'
import { containsMidpoint } from './miterChamfer'
import { boreFloor } from './boreFloorFillet'
import { pocketFloorChamfer } from './pocketFloorChamfer'

const tol = 1e-5
const touches = (a: RawEdge, b: RawEdge) => a.ends.some(p => b.ends.some(q => len(sub(p, q)) < tol))

/** A planar section of a rounded bore can feed the contour solver through
 * the lip into the rest of the part. Bevel the explicit spans before
 * reapplying the two circular edge rounds at their original radii. */
export function boreEdgeChamfer(k: ReKernel, body: Shape, hashes: readonly number[], distance: number): Tracked | null {
  if (!hashes.length || hashes.length > 5 || !(distance > 0 && Number.isFinite(distance))) return null
  const owned: Shape[] = []
  const keep = (shape: Shape) => { owned.push(shape); return shape }
  try {
    const edges = k.edges(body, 1), faces = k.faces(body)
    const picked = edges.filter(e => hashes.includes(e.hash))
    const lines = picked.filter(e => e.kind === 'line')
    if (picked.length !== hashes.length || !lines.length || lines.length > 3) return null
    if (picked.length === 1) {
      const edge = lines[0], supports = faces.filter(f => edge.faceHashes.includes(f.hash))
      if (supports.length === 2 && supports.every(f => f.kind === 'plane')) {
        const bore = boreFloor(edges, faces, edge, supports)
        if (bore) {
          const result = pocketFloorChamfer(k, body, edge, supports.find(f => f !== bore.floor)!, bore, distance)
          if (result) return result
        }
      }
    }
    for (const front of faces.filter(f => f.kind === 'plane' && picked.every(e => e.faceHashes.includes(f.hash)))) {
      const bends = edges.filter(e => e.kind !== 'line' && e.faceHashes.includes(front.hash) && lines.some(line => touches(line, e)))
      if (!bends.length || picked.some(e => e.kind !== 'line' && !bends.includes(e))) continue
      const ringFaces = faces.filter(f => f.kind === 'torus' && Math.abs(dot(f.dir, front.dir)) < tol && bends.some(e => e.faceHashes.includes(f.hash)))
      if (!ringFaces.length || ringFaces.length > 2) continue
      const rings = ringFaces.map(round => {
        const rails = edges.filter(e => e.kind === 'circle' && e.center && e.radius && e.faceHashes.includes(round.hash))
        const flat = rails.find(e => faces.some(f => f.kind === 'plane' && Math.abs(dot(f.dir, round.dir)) > 1-tol && e.faceHashes.includes(f.hash)))
        const side = rails.find(e => faces.some(f => f.kind === 'cylinder' && Math.abs(dot(f.dir, round.dir)) > 1-tol && e.faceHashes.includes(f.hash)))
        if (!flat?.center || !flat.radius || !side?.radius) return null
        const radius = Math.abs(dot(sub(flat.mid, side.mid), round.dir))
        if (radius <= tol || Math.abs(Math.abs(flat.radius-side.radius)-radius) > tol) return null
        return { round, center: flat.center, wallRadius: side.radius, radius, floor: flat.radius < side.radius, rails: [side,flat] }
      })
      if (rings.some(r => !r)) continue
      const corners = rings.filter(r => r !== null).sort((a,b) => Number(b.floor)-Number(a.floor))
      // Every picked span must belong to the same cut plane and one of the
      // measured supports. An edge from a separate pocket is ambiguous.
      const side = corners[0].rails[0]
      const wall = faces.find(f => f.kind === 'cylinder' && side.faceHashes.includes(f.hash))
      if (!wall || corners.some(c => !c.rails[0].faceHashes.includes(wall.hash))) continue
      const supports = new Set([wall.hash, ...corners.filter(c => c.floor).flatMap(c => c.rails[1].faceHashes.filter(h => h !== c.round.hash))])
      if (lines.some(e => !e.faceHashes.some(h => supports.has(h))) || picked.some(e => e.kind !== 'line' && !corners.some(c => e.faceHashes.includes(c.round.hash) && lines.filter(l => touches(l,e)).length === 2))) continue

      const sharp = keep(k.deleteFaces(body, corners.map(c => c.round.hash)))
      if (!k.isClosedSolid(sharp)) return null
      const extended = k.edges(sharp,1)
      const targets = lines.map(e => extended.filter(candidate => containsMidpoint(candidate,e)))
      if (targets.some(list => list.length !== 1)) return null
      let made = keep(k.chamferTracked(sharp, targets.map(([e]) => e.hash), distance).shape)
      for (const corner of corners) {
        const seam = k.edges(made,1).filter(e => e.kind === 'circle' && e.center && e.radius &&
          len(sub(e.center,corner.center)) < tol && Math.abs(e.radius-corner.wallRadius) < tol)
        // The periodic seam can split a single circular rail into two arcs.
        // Only accept connected pieces on the original bore axis.
        if (!seam.length || (seam.length !== 1 && !(seam.length === 2 && touches(seam[0], seam[1])))) return null
        made = keep(k.filletTracked(made, seam.map(e => e.hash), corner.radius).shape)
      }
      if (!k.isClosedSolid(made) || k.solidCount(made) !== 1) return null
      // Transfer only the local chip to preserve the input solid and its
      // face history, including all unpicked walls and earlier features.
      const chip = keep(k.cut(body,made))
      if (!k.isClosedSolid(chip)) return null
      // A restored quarter-round can move the transition around both rails
      // by its full diameter at an oblique section of the bore.
      const reach = 3*distance + 2*Math.max(...corners.map(c => c.radius))
      const nearSelection = (p: RawEdge['mid']) => lines.some(e => {
        const v = sub(p,e.mid), axial = dot(v,e.dir), over = Math.max(0,Math.abs(axial)-e.length/2)
        return Math.max(0,dot(v,v)-axial*axial) + over*over <= reach*reach
      })
      if (k.edges(chip,1).some(e => ![e.mid,...e.ends].every(nearSelection))) return null
      const result = k.cutTracked(body,chip)
      keep(result.shape)
      const bounds = k.bounds(body)
      const deflection = meshDeflection(len(sub(bounds.max, bounds.min)))
      const ready = (shape: Shape) => {
        k.mesh(shape, deflection)
        return k.isClosedSolid(shape) && k.solidCount(shape) === 1 &&
          lines.every(e => !k.containsPoint(shape, e.mid, tol) && k.distanceToPoint(shape, e.mid) > tol)
      }
      const note = 'The selected bore edges are chamfered with the original end rounds restored.'
      if (ready(result.shape)) {
        owned.splice(owned.indexOf(result.shape), 1)
        return { ...result, note }
      }

      // Near a periodic seam, subtracting a chip twice can produce edges
      // that fail validity only after tessellation. The body from the
      // original bevel and both restored rounds is an independent result.
      if (!ready(made) || !(k.volume(made) < k.volume(body))) return null
      const after = k.faces(made), boundary = k.edges(made, 1)
      const history = new Map<number, number[]>(), matched = new Set<number>()
      for (const face of faces) {
        const same = after.find(f => f.hash === face.hash) ?? sameSurface(face, after)
        if (!same || matched.has(same.hash)) return null
        matched.add(same.hash)
        if (same.hash !== face.hash) history.set(face.hash, [same.hash])
      }
      // Each new face must lie within the local cut. Each selected span
      // must have a bevel rail at the requested setback on the front plane.
      const newEdges = boundary.filter(e => e.faceHashes.some(h => !matched.has(h)))
      if (!newEdges.length || newEdges.some(e => ![e.mid,...e.ends].every(nearSelection))) return null
      const matchesSetback = (line: RawEdge, rail: RawEdge) => {
        // A straight intersection on a periodic face can be represented as
        // a spline. Check its measured length and endpoints geometrically.
        const [a, b] = rail.ends, chord = sub(b, a)
        if (rail.length < tol || Math.abs(rail.length-len(chord)) > tol || len(cross(chord,line.dir)) > tol) return false
        if (dot(sub(a,line.mid),line.dir)*dot(sub(b,line.mid),line.dir) > 0) return false
        return [a,rail.mid,b].every(p => Math.abs(dot(sub(p,front.centroid),front.dir)) < tol &&
          Math.abs(len(cross(sub(p,line.mid),line.dir))-distance) < tol)
      }
      if (!lines.every(line => newEdges.some(rail => matchesSetback(line,rail)))) return null
      // Verify the original boundary away from this operation against the
      // mapped faces, including the remote portions of the rail and floor.
      const copies = new Map<number, Shape>()
      for (const e of edges) {
        const remote = [e.mid,...e.ends].filter(p => !nearSelection(p))
        if (!remote.length) continue
        for (const oldHash of e.faceHashes) {
          const hash = history.get(oldHash)?.[0] ?? oldHash
          if (!copies.has(hash)) copies.set(hash, keep(k.faceCopy(made, hash)))
          if (remote.some(p => k.distanceToPoint(copies.get(hash)!, p) > tol)) return null
        }
      }
      owned.splice(owned.indexOf(made), 1)
      return { shape: made, history, note }
    }
    return null
  } catch (error) {
    if (isTrap(error)) throw error
    return null
  } finally {
    owned.reverse().forEach(s => k.release(s))
  }
}
