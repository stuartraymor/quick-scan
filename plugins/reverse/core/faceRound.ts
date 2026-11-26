// SPDX-License-Identifier: AGPL-3.0-only
import { cross, dot, len, normalize, sub } from '../../../src/core/vec'
import type { ReKernel, Shape, Tracked } from './kernel'
import { roundRoles, type RoundGroups } from './roundInputs'

/** A constant-width full round between side supports. The existing full-width fillet builder resolves the vanishing center strip. */
export function faceRound(k: ReKernel, solid: Shape, groups: RoundGroups<number>, tangent: boolean): Tracked {
  const faces = k.faces(solid)
  const edges = k.edges(solid, 0.1)
  const byHash = new Map(faces.map(f => [f.hash, f]))
  const picks = { left: new Set(groups.left), center: new Set(groups.center), right: new Set(groups.right) }
  if (tangent) {
    const smooth = k.edgeSides(solid, edges.map(e => e.hash)).filter(s => s && Math.abs(dot(s.normals[0], s.normals[1])) > 1 - 1e-9)
    for (const role of roundRoles) {
      const set = picks[role]
      let count
      do {
        count = set.size
        for (const s of smooth) if (s && s.faces.some(h => set.has(h))) s.faces.forEach(h => set.add(h))
      } while (set.size !== count)
    }
  }
  const all = roundRoles.flatMap(role => [...picks[role]])
  if (roundRoles.some(role => !picks[role].size) || new Set(all).size !== all.length) throw new Error('Pick separate left side, center and right side faces.')
  const sides = [...picks.left, ...picks.right].map(h => byHash.get(h)!)
  const left = byHash.get(groups.left[0])!, right = byHash.get(groups.right[0])!
  const rolling = () => {
    if (roundRoles.some(role => picks[role].size !== 1)) throw new Error('Select one continuous face for each side and the center of the varying-width strip.')
    const center = groups.center[0]
    const boundary = edges.filter(e => e.faceHashes.includes(center))
    const sideRails = [left, right].map(side => boundary.filter(e => e.faceHashes.includes(side.hash)))
    const caps = boundary.filter(e => !sideRails.some(rail => rail.includes(e))).map(e => e.faceHashes.find(h => h !== center))
    if (boundary.length !== 4 || sideRails.some(rail => rail.length !== 1) || caps.length !== 2 || caps.some(h => h === undefined || byHash.get(h)?.kind !== 'plane'))
      throw new Error('The varying-width strip needs two continuous side edges and two planar ends.')
    return k.rollingFaceRound(solid, [left.hash, center, right.hash], sideRails.map(rail => rail[0].hash), caps as number[])
  }
  let radius: number
  if (sides.every(f => f.kind === 'cylinder' && f.center && f.radius && Math.abs(dot(f.dir, left.dir)) > 1 - 1e-8)) {
    if (sides.some(f => len(cross(sub(f.center!, left.center!), left.dir)) > 1e-6))
      return rolling()
    for (const role of ['left', 'right'] as const) {
      const first = role === 'left' ? left : right
      if ([...picks[role]].some(h => Math.abs(byHash.get(h)!.radius! - first.radius!) > 1e-6))
        throw new Error('Each side group must lie on a single cylinder.')
    }
    radius = Math.abs(left.radius! - right.radius!) / 2
  } else if (sides.every(f => f.kind === 'plane')) {
    for (const role of ['left', 'right'] as const) {
      const first = role === 'left' ? left : right
      if ([...picks[role]].some(h => {
        const f = byHash.get(h)!
        return dot(first.dir, f.dir) < 1 - 1e-8 || Math.abs(dot(sub(f.centroid, first.centroid), first.dir)) > 1e-6
      })) throw new Error('Faces within each side group must be coplanar.')
    }
    if (dot(left.dir, right.dir) < -1 + 1e-8) {
      radius = Math.abs(dot(sub(right.centroid, left.centroid), left.dir)) / 2
    } else {
      // On a prismatic wedge, the two tangent setbacks on the center
      // face must sum to the distance between its side edges.
      const center = byHash.get(groups.center[0])!
      const axis = normalize(cross(left.dir, right.dir))
      if (center.kind !== 'plane' || !axis || Math.abs(dot(axis, center.dir)) > 1e-7 ||
          [...picks.center].some(h => dot(byHash.get(h)!.dir, center.dir) < 1 - 1e-8))
        return rolling()
      const across = normalize(cross(axis, center.dir))!
      const location = (f: typeof center) => dot(sub(f.centroid, center.centroid), f.dir) / dot(across, f.dir)
      const setback = (f: typeof center) => Math.tan(Math.acos(Math.max(-1, Math.min(1, dot(f.dir, center.dir)))) / 2)
      radius = Math.abs(location(right) - location(left)) / (setback(left) + setback(right))
    }
  } else return rolling()
  if (!Number.isFinite(radius) || radius < 1e-7) throw new Error('The side faces must enclose a positive width.')
  const rails: number[] = []
  for (const role of ['left', 'right'] as const) {
    const boundary = edges.filter(e => e.faceHashes.some(h => picks.center.has(h)) && e.faceHashes.some(h => picks[role].has(h)))
    if (!boundary.length || [...picks[role]].some(h => !boundary.some(e => e.faceHashes.includes(h)))) throw new Error(`The ${role} side must share an edge with the center.`)
    rails.push(...boundary.map(e => e.hash))
  }
  const railSet = new Set(rails)
  if ([...picks.center].some(h => !edges.some(e => railSet.has(e.hash) && e.faceHashes.includes(h))))
    throw new Error('Each center face must touch a selected side.')
  const result = k.filletTracked(solid, rails, radius)
  // A kernel may accept a partial round. A surviving patch on the
  // selected center support means it did not consume the strip.
  const after = k.faces(result.shape)
  const leftover = [...picks.center].some(h => {
    const before = byHash.get(h)!
    const descendants = result.history.get(h) ?? [h]
    return after.some(f => descendants.includes(f.hash) && f.kind === before.kind && f.area > 1e-6 * before.area &&
      (f.hash === h || (f.kind === 'plane' && Math.abs(dot(before.dir, f.dir)) > 1 - 1e-8 &&
        Math.abs(dot(sub(f.centroid, before.centroid), before.dir)) < 1e-6)))
  })
  if (!k.isClosedSolid(result.shape) || leftover) {
    k.release(result.shape)
    throw new Error('The round could not close the selected strip.')
  }
  return result
}
