// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import { dot, len, sub } from '../../../src/core/vec'
import type { RawEdge, RawFace, ReKernel, Shape, Tracked } from './kernel'
import { isTrap } from './kernelOps'
import { containsMidpoint } from './miterChamfer'

const tolerance = 1e-5
const touches = (a: RawEdge, b: RawEdge) => a.ends.some(p => b.ends.some(q => len(sub(p, q)) < tolerance))
const parallel = (a: RawFace, b: RawFace) => Math.abs(dot(a.dir, b.dir)) > 1 - 1e-8

/** Recover a constant round around the U-shaped opening where a cut plane
 * exposes a blind cylindrical pocket. The two sides and floor must be picked.
 * Temporary changes to earlier rounds supply only a local cutting solid. */
export function boreEntranceFillet(k: ReKernel, solid: Shape, hashes: readonly number[], radius: number): Tracked | null {
  if (hashes.length < 3 || hashes.length > 5 || !(radius > 0 && Number.isFinite(radius))) return null
  const owned: Shape[] = []
  const keep = (shape: Shape) => { owned.push(shape); return shape }
  try {
    const edges = k.edges(solid, 1), faces = k.faces(solid)
    const selected = edges.filter(e => hashes.includes(e.hash))
    const lines = selected.filter(e => e.kind === 'line')
    if (selected.length !== hashes.length || lines.length !== 3) return null
    const front = faces.find(f => f.kind === 'plane' && selected.every(e => e.faceHashes.includes(f.hash)))
    if (!front) return null
    const wall = faces.find(f => f.kind === 'cylinder' && lines.filter(e => e.faceHashes.includes(f.hash)).length === 2)
    if (!wall?.radius || !wall.center || Math.abs(dot(front.dir, wall.dir)) > tolerance) return null
    const sides = lines.filter(e => e.faceHashes.includes(wall.hash))
    const base = lines.find(e => !e.faceHashes.includes(wall.hash))!
    const floor = faces.find(f => f.kind === 'plane' && f.hash !== front.hash && base.faceHashes.includes(f.hash))
    if (!floor || !parallel(wall, floor) || sides.some(e => Math.abs(dot(e.dir, wall.dir)) < 1 - 1e-8)) return null

    // Each little bend must connect an upright to the selected bottom line
    // on the same toroidal floor round. Exclude extra picks outside this U.
    const bends = edges.filter(e => e.kind !== 'line' && e.faceHashes.includes(front.hash) && touches(e, base) && sides.some(s => touches(e, s)))
    if (bends.length !== 2 || !sides.every(s => bends.some(b => touches(b, s))) ||
        selected.some(e => e.kind !== 'line' && !bends.includes(e))) return null
    const foot = faces.find(f => f.kind === 'torus' && bends.every(e => e.faceHashes.includes(f.hash)))
    if (!foot) return null
    const rings = edges.filter(e => e.kind === 'circle' && e.faceHashes.includes(foot.hash))
    const wallRing = rings.find(e => e.faceHashes.includes(wall.hash))
    const floorRing = rings.find(e => e.faceHashes.includes(floor.hash))
    if (!wallRing?.radius || !floorRing?.radius || !floorRing.center) return null
    const footRadius = Math.abs(dot(sub(wallRing.mid, floorRing.mid), wall.dir))
    // A blind bore's floor rail is closer to the axis than its wall rail.
    if (footRadius <= tolerance || Math.abs(wallRing.radius - floorRing.radius - footRadius) > tolerance) return null
    const farBends = edges.filter(e => e.kind !== 'line' && e.faceHashes.includes(front.hash) && !bends.includes(e) && sides.some(s => touches(e, s)))
    const lip = faces.find(f => f.kind === 'torus' && sides.every(s => farBends.some(b => touches(b, s) && b.faceHashes.includes(f.hash))))
    const stock = lip ? keep(k.deleteFaces(solid, [lip.hash])) : solid
    if (!k.isClosedSolid(stock)) return null
    const roundU = (body: Shape) => {
      const actual = k.edges(body, 1)
      const matches = lines.map(line => actual.filter(e => containsMidpoint(e, line)))
      if (matches.some(list => list.length !== 1)) return null
      return keep(k.filletTracked(body, matches.map(list => list[0].hash), radius).shape)
    }

    let rounded: Shape | null = null
    if (lip && radius < footRadius - tolerance) {
      try { rounded = roundU(stock) } catch (error) { if (isTrap(error)) throw error }
    }
    if (!rounded || !k.isClosedSolid(rounded)) {
      const priorFoot = k.faces(stock).filter(f => f.kind === 'torus' && len(sub(f.centroid, foot.centroid)) < tolerance)
      if (priorFoot.length !== 1) return null
      const sharp = keep(k.deleteFaces(stock, [priorFoot[0].hash]))
      const large = roundU(sharp)
      if (!large || !k.isClosedSolid(large)) return null
      // The large fillet trims the bore-floor circle at both ends. Use its
      // actual new extent and reapply the original small radius.
      const center = floorRing.center, originalRadius = wall.radius
      const seam = k.edges(large, 1).filter(e => e.kind === 'circle' && e.center && e.radius &&
        Math.abs(e.radius - originalRadius) < tolerance && len(sub(e.center, center)) < tolerance)
      if (seam.length !== 1) return null
      // The rail spacing read back from STEP can differ from an equal
      // requested radius by machine noise at the intersection of the rounds.
      const restoredRadius = Math.abs(footRadius - radius) < 1e-9 ? radius : footRadius
      rounded = keep(k.filletTracked(large, [seam[0].hash], restoredRadius).shape)
    }
    if (!k.isClosedSolid(rounded)) return null
    const tool = keep(k.cut(stock, rounded))
    if (!k.isClosedSolid(tool) || k.solidCount(tool) !== 1) return null
    // The entire chip belongs to the narrow layer next to the cut plane.
    // At equal radii a coincident Boolean can return the stock or its
    // complement and still pass the kernel's closed-solid validity check.
    const planeDepth = (p: Vec3) => Math.abs(dot(sub(p, front.centroid), front.dir))
    const chipEdges = k.edges(tool, 1)
    if (!chipEdges.length || chipEdges.some(e => [e.mid, ...e.ends].some(p => planeDepth(p) > 2 * radius + tolerance))) return null
    const result = k.cutTracked(solid, tool)
    keep(result.shape)
    if (!k.isClosedSolid(result.shape) || k.solidCount(result.shape) !== 1) return null
    const rounds = k.faces(result.shape).filter(f => f.kind === 'cylinder' && f.radius && Math.abs(f.radius - radius) < tolerance)
    if (rounds.filter(f => parallel(f, wall)).length < 2 || !rounds.some(f => Math.abs(dot(f.dir, base.dir)) > 1 - 1e-8)) return null
    const remote = edges.reduce((a, b) => planeDepth(a.mid) > planeDepth(b.mid) ? a : b).mid
    if (planeDepth(remote) > 2 * radius && k.distanceToPoint(result.shape, remote) > tolerance) return null
    const volume = k.volume(solid), removed = volume - k.volume(result.shape), chip = k.volume(tool)
    // The original end round may already occupy part of the chip. Allow
    // integration error in the volumes reported for small curved slivers.
    if (!(removed > 0 && removed <= chip * 1.05 + volume * 1e-6)) return null
    owned.splice(owned.indexOf(result.shape), 1)
    return { ...result, note: 'The bore entrance is rounded across both sides and the floor.' }
  } catch (error) {
    if (isTrap(error)) throw error
    return null
  } finally {
    for (const shape of owned.reverse()) k.release(shape)
  }
}
