// SPDX-License-Identifier: AGPL-3.0-only
import { addScaled, dot, len, scale, sub } from '../../../src/core/vec'
import type { RawEdge, RawFace, ReKernel, Shape, Tracked } from './kernel'
import type { boreFloor } from './boreFloorFillet'
import { meshDeflection } from './buildTypes'
import { isTrap } from './kernelOps'

/** On a rounded pocket floor the chamfer ends run from the rolling contact on
 * the torus to its contact on the front plane. A straight ruling joins them.
 * The input wall trims that ruled surface as the round runs out. */
export function pocketFloorChamfer(k: ReKernel, body: Shape, edge: RawEdge, front: RawFace,
  bore: NonNullable<ReturnType<typeof boreFloor>>, distance: number): Tracked | null {
  const owned: Shape[] = [], keep = (s: Shape) => { owned.push(s); return s }
  try {
    const { center, up, radius, floor, foot, wall } = bore
    const major = bore.wallRadius - radius, normal = front.dir
    const probe = Math.min(radius, distance, edge.length) * .05
    const below = addScaled(edge.mid, up, -probe)
    const plus = k.containsPoint(body, addScaled(below, normal, probe), probe * .001)
    const minus = k.containsPoint(body, addScaled(below, normal, -probe), probe * .001)
    if (plus === minus) return null
    const out = plus ? scale(normal, -1) : normal
    const offset = dot(sub(edge.mid, center), out)
    const chordHalf = Math.sqrt(major * major - offset * offset)
    if (!Number.isFinite(chordHalf) || Math.abs(2 * chordHalf - edge.length) > 1e-4 ||
        Math.abs(dot(sub(edge.mid, center), edge.dir)) > 1e-5) return null
    const y = offset - distance
    if (Math.abs(y) >= major) return null
    const sections = []
    for (let i = 0; i <= 32; i++) {
      const theta = Math.PI * i / 32, sin = Math.sin(theta), cos = Math.cos(theta)
      const centerRadius = major + (radius + distance) * sin
      const contactRadius = major + radius * sin
      const x = Math.sqrt(centerRadius * centerRadius - y * y)
      const ruling = (sign: number, t: number) => {
        const radial = addScaled(scale(edge.dir, sign * x), out, y)
        const round = addScaled(addScaled(center, radial, contactRadius / centerRadius), up, radius * (1 - cos))
        const plane = addScaled(addScaled(addScaled(center, edge.dir, sign * x), out, offset), up, radius - (radius + distance) * cos)
        return addScaled(round, sub(plane, round), t)
      }
      // Overlap the cutting volume across both trimming faces. The finished
      // surface stays on the same ruling all the way through each boundary.
      const p = [ruling(-1, -.03), ruling(1, -.03), ruling(1, 1.03), ruling(-1, 1.03)]
      sections.push({ outer: p.map((a, j) => ({ kind: 'line' as const, a, b: p[(j + 1) % 4] })), holes: [] })
    }
    const tool = keep(k.loft(sections, false))
    const result = k.cutTracked(body, tool)
    keep(result.shape)
    const bounds = k.bounds(body)
    k.mesh(result.shape, meshDeflection(len(sub(bounds.max, bounds.min))))
    if (!k.isClosedSolid(result.shape) || k.solidCount(result.shape) !== 1 || k.containsPoint(result.shape, edge.mid, 1e-7)) return null
    const after = k.faces(result.shape), allowed = new Set([front.hash, floor.hash, foot.hash, wall.hash])
    for (const f of k.faces(body)) {
      if (allowed.has(f.hash) || after.some(a => a.hash === f.hash)) continue
      if (!after.some(a => a.kind === f.kind && Math.abs(a.area - f.area) < 1e-5 && len(sub(a.centroid, f.centroid)) < 1e-5)) return null
    }
    const railLength = 2 * Math.sqrt(major * major - y * y)
    const rails = k.edges(result.shape, 1).filter(e => e.kind === 'line' &&
      Math.abs(e.length - railLength) < 1e-4 && Math.abs(dot(e.dir, edge.dir)) > 1 - 1e-8)
    const frontRail = addScaled(edge.mid, up, -distance), floorRail = addScaled(edge.mid, out, -distance)
    if (![frontRail, floorRail].every(p => rails.some(e => len(sub(e.mid, p)) < 1e-4))) return null
    owned.pop()
    return { ...result, note: 'The selected bore edge is chamfered with its original end rounds restored.' }
  } catch (error) {
    if (isTrap(error)) throw error
    return null
  } finally { k.release(...owned) }
}
