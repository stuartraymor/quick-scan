// SPDX-License-Identifier: AGPL-3.0-only
// The limit surface of a cage, sampled: the cage subdivided a few times —
// after one step every face is a quad, so every vertex has n edge
// neighbours and n diagonal neighbours — and each vertex then pushed to
// its limit position by the Catmull–Clark limit masks (Halstead, Kass and
// DeRose 1993): a smooth vertex of valence n to (n² v + 4 Σ edge
// neighbours + Σ diagonal neighbours) / (n (n + 5)); a crease vertex to
// (e₁ + 4 v + e₂) / 6, the limit of the cubic B-spline along the crease; a
// corner stays. The result is a quad mesh on the limit surface, dense
// enough at three steps (64 quads a cage quad) for deviation to a scan and
// for the grids Convert sends to the kernel. Exact evaluation at
// arbitrary (u, v) (Stam 1998) is not needed for either and is left out.

import type { Vec3 } from '../../../../src/core/types'
import { type Cage, edgeKey, topology, vertexCount } from './cage'
import { subdivided, vertexRule } from './subdivide'

export interface LimitMesh {
  positions: Float64Array
  /** Quads, 4 indices each. */
  faces: number[][]
  /** Per vertex, the unit normal of the limit surface, from the quads round it. */
  normals: Float64Array
  /** Which cage vertex each of the first `cageVertices` limit vertices came from (the rest are new). */
  cageVertices: number
}

export const DEFAULT_LIMIT_STEPS = 3

/** Every vertex of a quad cage pushed to its limit position. The cage must
 *  be all quads (a subdivided cage is). */
export function limitPositions(c: Cage): Float64Array {
  const t = topology(c)
  const n = vertexCount(c)
  const p = c.positions
  const out = new Float64Array(n * 3)
  for (let v = 0; v < n; v++) {
    const o = v * 3
    const rule = vertexRule(t, v)
    if (rule === 'corner') {
      out[o] = p[o]; out[o + 1] = p[o + 1]; out[o + 2] = p[o + 2]
      continue
    }
    if (rule === 'crease') {
      const ends: number[] = []
      for (const e of t.vertexEdges[v]) {
        const edge = t.edges[e]
        if (edge.crease || edge.faces.length < 2) ends.push(edge.a === v ? edge.b : edge.a)
      }
      for (let k = 0; k < 3; k++) out[o + k] = (p[ends[0] * 3 + k] + 4 * p[o + k] + p[ends[1] * 3 + k]) / 6
      continue
    }
    const valence = t.vertexEdges[v].length
    let ex = 0, ey = 0, ez = 0, dx = 0, dy = 0, dz = 0
    for (const e of t.vertexEdges[v]) {
      const edge = t.edges[e]
      const w = (edge.a === v ? edge.b : edge.a) * 3
      ex += p[w]; ey += p[w + 1]; ez += p[w + 2]
    }
    for (const fi of t.vertexFaces[v]) {
      const f = c.faces[fi]
      if (f.length !== 4) throw new Error('The limit masks need a quad cage; subdivide once first.')
      const d = f[(f.indexOf(v) + 2) % 4] * 3
      dx += p[d]; dy += p[d + 1]; dz += p[d + 2]
    }
    const den = valence * (valence + 5)
    out[o] = (valence * valence * p[o] + 4 * ex + dx) / den
    out[o + 1] = (valence * valence * p[o + 1] + 4 * ey + dy) / den
    out[o + 2] = (valence * valence * p[o + 2] + 4 * ez + dz) / den
  }
  return out
}

/** The unit normal at each vertex of a mesh: its faces' Newell normals added up. */
export function vertexNormals(positions: Float64Array, faces: number[][]): Float64Array {
  const n = positions.length / 3
  const out = new Float64Array(n * 3)
  for (const f of faces) {
    // Newell's normal of the polygon, added to each of its vertices.
    let nx = 0, ny = 0, nz = 0
    for (let k = 0; k < f.length; k++) {
      const a = f[k] * 3, b = f[(k + 1) % f.length] * 3
      nx += (positions[a + 1] - positions[b + 1]) * (positions[a + 2] + positions[b + 2])
      ny += (positions[a + 2] - positions[b + 2]) * (positions[a] + positions[b])
      nz += (positions[a] - positions[b]) * (positions[a + 1] + positions[b + 1])
    }
    for (const v of f) { out[v * 3] += nx; out[v * 3 + 1] += ny; out[v * 3 + 2] += nz }
  }
  for (let v = 0; v < n; v++) {
    const l = Math.hypot(out[v * 3], out[v * 3 + 1], out[v * 3 + 2])
    if (l > 0) { out[v * 3] /= l; out[v * 3 + 1] /= l; out[v * 3 + 2] /= l }
  }
  return out
}

/** The mesh's vertices moved `distance` along their normals (negative
 *  against): a surface offset, sampled where the mesh is. The normal of a
 *  vertex off the surface by its tilt only moves the offset along the
 *  surface, not off the distance. */
export function displacedAlongNormals(positions: Float64Array, faces: number[][], distance: number): Float64Array {
  const n = vertexNormals(positions, faces)
  const out = new Float64Array(positions.length)
  for (let i = 0; i < positions.length; i++) out[i] = positions[i] + n[i] * distance
  return out
}

/** The limit surface sampled as a quad mesh: `steps` subdivisions, then
 *  the limit masks. The cage's own vertices keep their indices, so limit
 *  vertex i < cage vertex count is the limit of cage vertex i. */
export function limitMesh(c: Cage, steps = DEFAULT_LIMIT_STEPS): LimitMesh {
  const fine = subdivided(c, Math.max(1, steps))
  const positions = limitPositions(fine)
  return { positions, faces: fine.faces, normals: vertexNormals(positions, fine.faces), cageVertices: vertexCount(c) }
}

/** The limit positions of the cage's own vertices, in order. */
export function cageVertexLimits(c: Cage): Vec3[] {
  const fine = subdivided(c, 1)
  const lp = limitPositions(fine)
  const n = vertexCount(c)
  const out: Vec3[] = []
  for (let v = 0; v < n; v++) out.push([lp[v * 3], lp[v * 3 + 1], lp[v * 3 + 2]])
  return out
}

/** The vertices of a limit mesh that lie on crease or boundary curves of
 *  the cage: the limit of a crease is the cubic B-spline through its
 *  control vertices. Keyed by the fine cage's edges. */
export function creaseEdgeKeys(c: Cage): Set<string> {
  return new Set(c.creases.map(([a, b]) => edgeKey(a, b)))
}
