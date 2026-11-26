// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import { addScaled, cross, dot, len, normalize, sub } from '../../../src/core/vec'
import type { RawEdge, ReKernel, Shape, Tracked } from './kernel'
import { rectangleLoop } from './loops'
import { isTrap } from './kernelOps'

const joinTolerance = 1e-5
const near = (a: Vec3, b: Vec3) => len(sub(a, b)) < joinTolerance

/** Construct an end-limited equal-distance miter across a small convex round.
 * The selected edges must be two perpendicular lines joined by the short round,
 * on one planar face. Sharpen only a temporary copy of that corner. Its exact
 * chamfer supplies the cutting tool. The original blend survives outside it. */
export function miterChamfer(k: ReKernel, solid: Shape, hashes: readonly number[], size: number): Tracked | null {
  if (hashes.length !== 3 || size <= 0) return null
  const owned: Shape[] = []
  const keep = (shape: Shape) => { owned.push(shape); return shape }
  try {
    const selected = k.edges(solid, 1).filter(e => hashes.includes(e.hash))
    const lines = selected.filter(e => e.kind === 'line')
    const bend = selected.find(e => e.kind !== 'line')
    if (lines.length !== 2 || !bend || lines.some(e => e.length <= size)) return null
    const shared = bend.faceHashes.find(f => lines.every(e => e.faceHashes.includes(f)))
    if (shared === undefined || !k.faces(solid).some(f => f.hash === shared && f.kind === 'plane')) return null
    const arms = lines.map(line => {
      const tip = line.ends.findIndex(p => bend.ends.some(q => near(p, q)))
      if (tip < 0) return null
      const start = line.ends[1 - tip], end = line.ends[tip]
      const direction = normalize(sub(end, start))
      const joint = bend.ends.findIndex(p => near(p, end))
      if (!direction || joint < 0 || Math.abs(dot(direction, bend.endTangents[joint])) < 0.9999) return null
      return { start, end, direction }
    })
    const [a, b] = arms
    if (!a || !b || near(a.end, b.end) || Math.abs(dot(a.direction, b.direction)) > 1e-7) return null
    const origin = addScaled(a.start, b.direction, dot(sub(b.start, a.start), b.direction))
    const pad = 4 * size
    const width = dot(sub(b.end, origin), a.direction)
    const height = dot(sub(a.end, origin), b.direction)
    if (width <= 0 || height <= 0) return null
    const base = keep(k.face({ outer: rectangleLoop(origin, a.direction, b.direction, width + pad, height + pad), holes: [] }))
    const bounds = keep(k.extrude(base, cross(a.direction, b.direction), -pad, pad))
    const piece = keep(k.common(solid, bounds))
    const corner = k.edges(piece, 1).find(e => near(e.mid, bend.mid) && Math.abs(e.length - bend.length) < joinTolerance)
    if (!corner) return null
    const roundFaces = k.faces(piece).filter(f => corner.faceHashes.includes(f.hash) && (f.kind === 'torus' || f.kind === 'cylinder'))
    if (roundFaces.length !== 1) return null
    // On a small setback the bevel follows the existing round. Isolating
    // this corner gives the native builder real stopping faces on both arms.
    let cutter: Shape | undefined
    if (size <= bend.length) {
      const local = k.edges(piece, 1)
      const picks = selected.map(p => local.filter(e => near(e.mid, p.mid) && Math.abs(e.length-p.length) < joinTolerance))
      if (picks.every(matches => matches.length === 1)) {
        try {
          const finished = keep(k.chamferTracked(piece, picks.map(([e]) => e.hash), size).shape)
          const chip = keep(k.cut(piece, finished))
          if (k.isClosedSolid(chip)) cutter = chip
        } catch (error) {
          if (isTrap(error)) throw error
        }
      }
    }
    const followedRound = cutter !== undefined
    if (cutter === undefined) {
      const sharp = keep(k.deleteFaces(piece, [roundFaces[0].hash]))
      if (!k.isClosedSolid(sharp) || k.volume(sharp) <= k.volume(piece)) return null
      const edges = k.edges(sharp, 1)
      const extended = lines.map(line => edges.filter(e => containsMidpoint(e, line)))
      if (extended.some(matches => matches.length !== 1)) return null
      if (!extended[0][0].ends.some(p => extended[1][0].ends.some(q => near(p, q)))) return null
      const finished = keep(k.chamferTracked(sharp, extended.map(([e]) => e.hash), size).shape)
      cutter = keep(k.cut(sharp, finished))
    }
    if (!k.isClosedSolid(cutter)) return null
    const result = k.cutTracked(solid, cutter)
    keep(result.shape)
    const solids = k.solids(result.shape)
    solids.forEach(keep)
    if (solids.length !== 1 || !k.isClosedSolid(result.shape) || k.volume(result.shape) >= k.volume(solid)) return null
    if (selected.some(e => k.distanceToPoint(result.shape, e.mid) <= joinTolerance)) return null
    owned.splice(owned.indexOf(result.shape), 1)
    return { ...result, note: followedRound ? 'The chamfer follows the selected corner round.' : 'The two chamfer faces meet in a miter across the selected corner round.' }
  } catch (error) {
    if (isTrap(error)) throw error
    return null
  } finally {
    for (const shape of owned.reverse()) k.release(shape)
  }
}

export function containsMidpoint(candidate: RawEdge, original: RawEdge): boolean {
  if (candidate.kind !== 'line' || Math.abs(dot(candidate.dir, original.dir)) < 1 - 1e-8) return false
  const offset = sub(original.mid, candidate.mid)
  return len(cross(offset, candidate.dir)) < joinTolerance && Math.abs(dot(offset, candidate.dir)) < candidate.length / 2
}
