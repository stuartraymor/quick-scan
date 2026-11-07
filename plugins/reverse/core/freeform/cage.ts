// SPDX-License-Identifier: AGPL-3.0-only
// A freeform cage: the control polygon of a subdivision surface — vertices,
// polygon faces (quads as a rule; any polygon is carried), and the edges
// marked as creases. QUICKSURFACE's Freeform is such a cage snapped to the
// scan (audit-2026-11-07/FREEFORM_AUDIT.md); this is the representation
// its editor, Wrap, Auto Freeform and Convert all stand on. The topology
// here is worked out from the faces alone, so a cage read from a quad OBJ
// is complete as read.

import type { Vec3 } from '../../../../src/core/types'

export interface Cage {
  /** xyz, flat. */
  positions: Float64Array
  /** Each face's vertex indices, in order round the face. */
  faces: number[][]
  /** Edges marked sharp, as [a, b] vertex pairs (either order). */
  creases: [number, number][]
}

export interface CageEdge {
  a: number
  b: number
  /** The faces either side; one on a boundary. */
  faces: number[]
  crease: boolean
}

export interface CageTopology {
  edges: CageEdge[]
  /** For each vertex, the edges at it and the faces round it. */
  vertexEdges: number[][]
  vertexFaces: number[][]
  /** Edge index by `a:b` with a < b. */
  edgeOf: Map<string, number>
  /** Whether every edge has two faces. */
  closed: boolean
}

export const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`)

export function vertexCount(c: Cage): number {
  return c.positions.length / 3
}

export function vertexAt(c: Cage, i: number): Vec3 {
  return [c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2]]
}

/** The cage's edges, each face's and each vertex's, from the faces. A face
 *  naming a vertex past the end, or an edge with more than two faces, is a
 *  broken cage and refused. */
export function topology(c: Cage): CageTopology {
  const n = vertexCount(c)
  const edges: CageEdge[] = []
  const edgeOf = new Map<string, number>()
  const vertexEdges: number[][] = Array.from({ length: n }, () => [])
  const vertexFaces: number[][] = Array.from({ length: n }, () => [])
  const sharp = new Set(c.creases.map(([a, b]) => edgeKey(a, b)))
  c.faces.forEach((face, fi) => {
    if (face.length < 3) throw new Error(`Face ${fi} has ${face.length} vertices; a cage face has three at least.`)
    for (let k = 0; k < face.length; k++) {
      const a = face[k], b = face[(k + 1) % face.length]
      if (!(a >= 0 && a < n && b >= 0 && b < n)) throw new Error(`Face ${fi} names vertex ${Math.max(a, b)} of ${n}.`)
      if (a === b) throw new Error(`Face ${fi} repeats vertex ${a}.`)
      vertexFaces[a].push(fi)
      const key = edgeKey(a, b)
      let e = edgeOf.get(key)
      if (e === undefined) {
        e = edges.length
        edgeOf.set(key, e)
        edges.push({ a: Math.min(a, b), b: Math.max(a, b), faces: [], crease: sharp.has(key) })
        vertexEdges[a].push(e)
        vertexEdges[b].push(e)
      }
      const edge = edges[e]
      if (edge.faces.length === 2) throw new Error(`Edge ${a}–${b} has three faces; the cage is not a surface.`)
      edge.faces.push(fi)
    }
  })
  return { edges, vertexEdges, vertexFaces, edgeOf, closed: edges.every((e) => e.faces.length === 2) }
}

/** How many faces are quads, triangles and larger polygons. */
export function faceKinds(c: Cage): { quads: number; triangles: number; ngons: number } {
  let quads = 0, triangles = 0, ngons = 0
  for (const f of c.faces) {
    if (f.length === 4) quads++
    else if (f.length === 3) triangles++
    else ngons++
  }
  return { quads, triangles, ngons }
}

export function bounds(c: Cage): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < c.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    const v = c.positions[i + k]
    if (v < min[k]) min[k] = v
    if (v > max[k]) max[k] = v
  }
  return { min, max }
}

/** The faces' area as flat polygons (each fanned from its first vertex). */
export function faceArea(c: Cage): number {
  let area = 0
  const p = c.positions
  for (const f of c.faces) {
    const a = f[0] * 3
    for (let k = 1; k + 1 < f.length; k++) {
      const b = f[k] * 3, d = f[k + 1] * 3
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
      const vx = p[d] - p[a], vy = p[d + 1] - p[a + 1], vz = p[d + 2] - p[a + 2]
      area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2
    }
  }
  return area
}

/** The cage's vertices and faces as a triangle mesh (quads split on their
 *  shorter diagonal, polygons fanned), for display and nearest-point work. */
export function triangles(c: Cage): Uint32Array {
  const out: number[] = []
  const p = c.positions
  const d2 = (i: number, j: number) => { const a = i * 3, b = j * 3; return (p[a] - p[b]) ** 2 + (p[a + 1] - p[b + 1]) ** 2 + (p[a + 2] - p[b + 2]) ** 2 }
  for (const f of c.faces) {
    if (f.length === 4 && d2(f[0], f[2]) > d2(f[1], f[3])) out.push(f[1], f[2], f[3], f[1], f[3], f[0])
    else for (let k = 1; k + 1 < f.length; k++) out.push(f[0], f[k], f[k + 1])
  }
  return Uint32Array.from(out)
}
