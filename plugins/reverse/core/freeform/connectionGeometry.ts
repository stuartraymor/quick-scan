// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../../src/core/types'
import { type Cage, edgeKey, vertexAt } from './cage'

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: Vec3, b: Vec3) => a.reduce((sum, x, k) => sum + x * b[k], 0)
const normal = (p: Vec3[]) => p.slice(1, -1).reduce<Vec3>((sum, _, i) => {
  const n = cross(sub(p[i + 1], p[0]), sub(p[i + 2], p[0]))
  return sum.map((v, k) => v + n[k]) as Vec3
}, [0, 0, 0])

/** How far, as a share of its size, a new quad facing against its neighbour
 *  may stand off the neighbour's plane and still count as folded back on it.
 *  Beyond that it is a surface turned sharply round the shared edge. */
const FOLD_BACK_RISE = .1

/** Validate newly connected faces before committing them. Incidence alone
 * accepts collapsed quads and a coplanar D pull back over its source face.
 * This is a local connection guard, not a global self-intersection test. */
/** `allowConcave`: a new quad may have one corner bent inward (a dart), as
 *  QUICKSURFACE's Close 4-sided hole fills one (paired 2026-11-17: the
 *  concave hole closes with its poles unchanged). It must still split into
 *  two triangles facing its own way across one diagonal: a collapsed or
 *  crossed (bow-tie) quad is refused, as is one folded back over a neighbour. */
export function validateAddedFaces(before: Cage, after: Cage, allowConcave = false): void {
  const refuse = () => { throw new Error('The connection would create a collapsed, folded or overlapping quad.') }
  const existing = new Map<string, number[]>()
  before.faces.forEach((f, fi) => f.forEach((v, k) => {
    const key = edgeKey(v, f[(k + 1) % f.length])
    existing.set(key, [...(existing.get(key) ?? []), fi])
  }))
  for (const face of after.faces.slice(before.faces.length)) {
    const p = face.map(v => vertexAt(after, v))
    if (p.length !== 4 || p.some(v => !v.every(Number.isFinite))) return refuse()
    const size = Math.max(...p.map((v, i) => Math.hypot(...sub(v, p[(i + 1) % p.length]))))
    const n = normal(p), length = Math.hypot(...n), areaEpsilon = size * size * 1e-12
    if (!(length > areaEpsilon)) return refuse()
    // Each corner's bilinear Jacobian must retain the face's orientation.
    // Check all four corners, not only one diagonal's two triangle areas.
    const faces = (i: number) => dot(cross(sub(p[(i + 1) % 4], p[i]), sub(p[(i + 3) % 4], p[i])), n) > areaEpsilon * length
    if (allowConcave) {
      // Concave: the diagonal from the inward corner leaves two triangles
      // that both face the quad's way. A bow-tie has no such diagonal.
      const triangles = (a: number) => [[a, a + 1, a + 2], [a + 2, a + 3, a]].every(([i, j, k]) =>
        dot(cross(sub(p[j % 4], p[i % 4]), sub(p[k % 4], p[i % 4])), n) > areaEpsilon * length)
      if (!(triangles(0) || triangles(1))) return refuse()
    } else for (let i = 0; i < 4; i++) if (!faces(i)) return refuse()
    const neighbours = new Set(face.flatMap((v, k) => existing.get(edgeKey(v, face[(k + 1) % face.length])) ?? []))
    for (const fi of neighbours) {
      // As the neighbour is wound now: joining two parts wound against one
      // another turns one of them, and its old sense would read as a fold.
      const q = (after.faces[fi] ?? before.faces[fi]).map(v => vertexAt(before, v)), oldNormal = normal(q), oldLength = Math.hypot(...oldNormal)
      if (dot(n, oldNormal) >= 0 || oldLength === 0) continue
      const reach = Math.max(size, ...q.map(v => Math.hypot(...sub(v, q[0]))))
      // Facing the other way and lying within a tenth of its size of the
      // neighbour's plane, the new quad is folded back over it. On a curved
      // scan such a pull is never exactly in the plane: held to that, it was
      // let through and left a quad showing its reverse side on its source.
      if ([...p, ...q].every(v => Math.abs(dot(sub(v, q[0]), oldNormal)) <= reach * oldLength * FOLD_BACK_RISE)) return refuse()
    }
  }
}
