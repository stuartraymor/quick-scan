// SPDX-License-Identifier: AGPL-3.0-only
// A chamfer by two distances, or by a distance and an angle, put to the
// kernel's one such chamfer: a distance on each edge's first face — the
// first of the solid's faces, in the kernel's order, that the edge bounds —
// and the angle to that face. Which face that is the operator has no say
// in, so what is asked of it is worked out from the chamfer wanted on the
// reference face and the angle the two faces meet at.

import type { Vec3 } from '../../../src/core/types'
import { dot } from '../../../src/core/vec'

/** The chamfer as the feature asks for it, on each edge's reference face:
 *  two distances, the first on that face — or a distance on it and the
 *  angle the chamfer makes with it, degrees. */
export type SidedChamfer = { mode: 'twoDistances'; distance: number; distance2: number } | { mode: 'distanceAngle'; distance: number; angleDeg: number }

/** What the kernel is asked at one edge: the distance on its first face,
 *  and the chamfer's angle to that face, degrees. */
export interface AngledAsk {
  distance: number
  angleDeg: number
}

const DEG = 180 / Math.PI

/**
 * The angle at an edge between its two faces, as a chamfer's cross-section
 * sees it: between the lines the faces leave the edge along, square to it —
 * 90° at a block's edge, 120° at a hexagon's. Read off the faces' outward
 * normals there, it is the half turn less the angle between them, for an
 * edge into the body and one out of it alike.
 */
export function faceAngle(normals: readonly [Vec3, Vec3]): number {
  const c = Math.max(-1, Math.min(1, dot(normals[0], normals[1])))
  return Math.PI - Math.acos(c)
}

/**
 * What the kernel is asked at an edge for the chamfer wanted there:
 * measured from the edge's first face — the reference face itself when
 * `refIsFirst`, else the other — at the angle the faces meet at. The
 * triangle the chamfer cuts off has the faces' angle at the edge and its
 * two setbacks along the faces, so the one face's setback and angle follow
 * from the other's by the sines. A chamfer the kernel cannot be asked for
 * from that face — its angle there not under 90° — is a sentence saying so.
 */
export function angledAsk(want: SidedChamfer, refIsFirst: boolean, normals: readonly [Vec3, Vec3], scale = 1): AngledAsk | string {
  const phi = faceAngle(normals)
  if (!(phi > 1e-3 && phi < Math.PI - 1e-3)) return 'the faces at the edge run on into each other — there is no corner to chamfer.'
  let distance: number
  let angle: number
  if (want.mode === 'twoDistances') {
    const [a, b] = refIsFirst ? [want.distance, want.distance2] : [want.distance2, want.distance]
    distance = a * scale
    angle = Math.atan2(b * Math.sin(phi), a - b * Math.cos(phi))
  } else {
    const theta = want.angleDeg / DEG
    const far = Math.PI - phi - theta
    if (!(far > 1e-6)) return `at ${Math.round(want.angleDeg * 10) / 10}° the chamfer does not reach the other face, which meets this one at ${Math.round(phi * DEG * 10) / 10}°.`
    if (refIsFirst) {
      distance = want.distance * scale
      angle = theta
    } else {
      // The setback on the other face, and the chamfer's angle to it: what
      // is left of the half turn.
      distance = (want.distance * scale * Math.sin(theta)) / Math.sin(phi + theta)
      angle = far
    }
  }
  const angleDeg = angle * DEG
  if (!(angleDeg > 1e-6 && angleDeg < 90 - 1e-6)) return `the kernel measures this edge's chamfer from its other face, where it would stand at ${Math.round(angleDeg * 10) / 10}° — under 90° is all it takes there; flip the chamfer, or swap the distances.`
  return { distance, angleDeg }
}

/**
 * The reference face of each edge, by the face hashes the edges have on
 * either side (the kernel's first face first): the face most of the edges
 * share — a rim's top, a bore's end — or, where the two count the same,
 * the first; flipped, the other one.
 */
export function referenceFaces(sides: readonly (readonly [number, number])[], flip: boolean): number[] {
  const count = new Map<number, number>()
  for (const s of sides) for (const f of new Set(s)) count.set(f, (count.get(f) ?? 0) + 1)
  return sides.map(([a, b]) => {
    const ref = (count.get(b) ?? 0) > (count.get(a) ?? 0) ? b : a
    return flip ? (ref === a ? b : a) : ref
  })
}

/** The seed edge's reference face uses the same contour vote and face order as
 * the exact chamfer. Topology adjacency can arrive in a different order.
 * A seam or a missing pick has no unambiguous reference to show. */
export function firstChamferReference(topology: { faces: readonly { hash: number }[]; edges: readonly { hash: number; faces: number[] }[] },
  selection: readonly number[], flip: boolean): number | undefined {
  const ordinal = new Map(topology.faces.map((face, index) => [face.hash, index]))
  const edges = new Map(topology.edges.map(edge => [edge.hash, edge.faces]))
  const supports: [number, number][] = []
  for (const hash of selection) {
    const adjacent = [...new Set(edges.get(hash))]
    if (adjacent.length !== 2) return
    const [a, b] = adjacent
    const i = ordinal.get(a), j = ordinal.get(b)
    if (i === undefined || j === undefined) return
    supports.push(i < j ? [a,b] : [b,a])
  }
  return referenceFaces(supports, flip)[0]
}
