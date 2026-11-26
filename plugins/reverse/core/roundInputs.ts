// SPDX-License-Identifier: AGPL-3.0-only
export interface RadiusPoint {
  position: number
  radius: number
}

export const roundRoles = ['left', 'center', 'right'] as const
export type RoundRole = typeof roundRoles[number]
export type RoundGroups<T> = Record<RoundRole, T[]>

export function mapRoundGroups<A, B>(groups: RoundGroups<A>, map: (face: A) => B): RoundGroups<B> {
  return { left: groups.left.map(map), center: groups.center.map(map), right: groups.right.map(map) }
}

export function emptyRoundGroups<T>(): RoundGroups<T> {
  return { left: [], center: [], right: [] }
}

export function validLaw(ends: [number, number], points: readonly RadiusPoint[] = []): boolean {
  return ends.every(r => Number.isFinite(r) && r > 0) && points.every((p, i) =>
    Number.isFinite(p.radius) && p.radius > 0 && p.position > (i ? points[i - 1].position : 0) && p.position < 1)
}

/** Keep the seed direction, extending first from its end, then from its start. */
export function orientedChain<P, E extends { from: P; to: P }>(
  segments: readonly E[], distance: (a: P, b: P) => number, tol: number,
): (E & { reverse: boolean })[] {
  if (!segments.length) return []
  const remaining = segments.map(segment => ({ ...segment, reverse: false }))
  const path = [remaining.shift()!]
  // Follow the seed in its parameter direction. At an open end collect the
  // rest of the chain backwards from its other end.
  for (const append of [true, false]) {
    while (remaining.length) {
      const tip = append ? path[path.length - 1] : path[0]
      const at = append !== tip.reverse ? tip.to : tip.from
      const index = remaining.findIndex(e => distance(at, e.from) < tol || distance(at, e.to) < tol)
      if (index < 0) break
      const [edge] = remaining.splice(index, 1)
      edge.reverse = append ? distance(at, edge.to) < tol : distance(at, edge.from) < tol
      if (append) path.push(edge)
      else path.unshift(edge)
    }
  }
  if (remaining.length) throw new Error('Select a single continuous chain for these control points.')
  return path
}
