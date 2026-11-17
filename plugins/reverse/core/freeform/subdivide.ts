// SPDX-License-Identifier: AGPL-3.0-only
// One Catmull–Clark step on a cage, with sharp creases (DeRose, Kass and
// Truong 1998, infinitely sharp): a boundary edge is a crease, a vertex on
// two creases is moved as a point of a cubic B-spline curve along them, a
// vertex on three or more — or a boundary vertex of one face only — stays
// where it is. Every face comes out a quad; the child edges of a crease
// are creases. Polygons of any size go in.

import { type Cage, type CageTopology, edgeKey, topology, vertexCount } from './cage'

/** How a vertex is moved by the rules: by the smooth mask, along a crease,
 *  or held as a corner. */
export type VertexRule = 'smooth' | 'crease' | 'corner'

/** The rule a vertex falls under: its crease (and boundary) edges counted. */
export function vertexRule(t: CageTopology, v: number): VertexRule {
  let sharp = 0
  for (const e of t.vertexEdges[v]) {
    const edge = t.edges[e]
    if (edge.crease || edge.faces.length < 2) sharp++
  }
  if (sharp >= 3) return 'corner'
  if (sharp === 2) return t.vertexFaces[v].length <= 1 ? 'corner' : 'crease'
  return 'smooth'
}

/** Re-evaluate only masks whose inputs changed. Connectivity is supplied by
 * the edit-session plan; unchanged output coordinates retain their exact bits. */
export function subdivisionPositions(c: Cage, t: CageTopology, previous?: Float64Array, dirty?: ReadonlySet<number>): Float64Array {
  const n = vertexCount(c)
  const p = c.positions
  const nf = c.faces.length
  const ne = t.edges.length
  const out = previous ? previous.slice() : new Float64Array((n + nf + ne) * 3)
  if (out.length !== (n + nf + ne) * 3) throw new Error('Subdivision plan vertex count changed.')
  let changedFaces: Set<number> | undefined, changedEdges: Set<number> | undefined, changedVertices: Set<number> | undefined
  if (previous && dirty) {
    changedFaces = new Set(); changedEdges = new Set(); changedVertices = new Set(dirty)
    for (const v of dirty) {
      for (const f of t.vertexFaces[v]) changedFaces.add(f)
      for (const e of t.vertexEdges[v]) {
        changedEdges.add(e); changedVertices.add(t.edges[e].a); changedVertices.add(t.edges[e].b)
      }
    }
    for (const fi of changedFaces) for (const v of c.faces[fi]) {
      changedVertices.add(v)
      for (const e of t.vertexEdges[v]) if (t.edges[e].faces.includes(fi)) changedEdges.add(e)
    }
  }
  const at = (i: number, k: number) => p[i * 3 + k]

  // Face points: centroids.
  const facePoint = (fi: number) => n + fi
  c.faces.forEach((f, fi) => {
    if (changedFaces && !changedFaces.has(fi)) return
    const o = facePoint(fi) * 3
    out[o] = out[o + 1] = out[o + 2] = 0
    for (const v of f) for (let k = 0; k < 3; k++) out[o + k] += at(v, k) / f.length
  })
  // Edge points.
  const edgePoint = (ei: number) => n + nf + ei
  t.edges.forEach((e, ei) => {
    if (changedEdges && !changedEdges.has(ei)) return
    const o = edgePoint(ei) * 3
    const sharp = e.crease || e.faces.length < 2
    for (let k = 0; k < 3; k++) {
      if (sharp) out[o + k] = (at(e.a, k) + at(e.b, k)) / 2
      else out[o + k] = (at(e.a, k) + at(e.b, k) + out[facePoint(e.faces[0]) * 3 + k] + out[facePoint(e.faces[1]) * 3 + k]) / 4
    }
  })
  // Vertex points.
  for (let v = 0; v < n; v++) {
    if (changedVertices && !changedVertices.has(v)) continue
    const o = v * 3
    const rule = vertexRule(t, v)
    if (rule === 'corner') {
      for (let k = 0; k < 3; k++) out[o + k] = at(v, k)
      continue
    }
    if (rule === 'crease') {
      const ends: number[] = []
      for (const e of t.vertexEdges[v]) {
        const edge = t.edges[e]
        if (edge.crease || edge.faces.length < 2) ends.push(edge.a === v ? edge.b : edge.a)
      }
      for (let k = 0; k < 3; k++) out[o + k] = (at(ends[0], k) + 6 * at(v, k) + at(ends[1], k)) / 8
      continue
    }
    const valence = t.vertexEdges[v].length
    const faces = t.vertexFaces[v]
    for (let k = 0; k < 3; k++) {
      let q = 0, r = 0
      for (const f of faces) q += out[facePoint(f) * 3 + k]
      q /= faces.length
      for (const e of t.vertexEdges[v]) {
        const edge = t.edges[e]
        r += (at(edge.a, k) + at(edge.b, k)) / 2
      }
      r /= valence
      out[o + k] = (q + 2 * r + (valence - 3) * at(v, k)) / valence
    }
  }
  return out
}

export function subdivide(c: Cage, t: CageTopology = topology(c)): Cage {
  const n = vertexCount(c), nf = c.faces.length
  const out = subdivisionPositions(c, t)
  const facePoint = (fi: number) => n + fi
  const edgePoint = (ei: number) => n + nf + ei
  // Faces: one quad per corner of each face.
  const faces: number[][] = []
  c.faces.forEach((f, fi) => {
    const m = f.length
    for (let k = 0; k < m; k++) {
      const v = f[k]
      const prev = f[(k + m - 1) % m], next = f[(k + 1) % m]
      const eIn = t.edgeOf.get(edgeKey(prev, v))!
      const eOut = t.edgeOf.get(edgeKey(v, next))!
      faces.push([v, edgePoint(eOut), facePoint(fi), edgePoint(eIn)])
    }
  })
  // Creases carried: each sharp edge's two halves.
  const creases: [number, number][] = []
  t.edges.forEach((e, ei) => {
    if (e.crease) creases.push([e.a, edgePoint(ei)], [edgePoint(ei), e.b])
  })
  return { positions: out, faces, creases }
}

/** The cage subdivided `steps` times. */
export function subdivided(c: Cage, steps: number): Cage {
  let cage = c
  for (let i = 0; i < steps; i++) cage = subdivide(cage)
  return cage
}
