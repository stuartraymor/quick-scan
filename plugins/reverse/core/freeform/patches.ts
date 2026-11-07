// SPDX-License-Identifier: AGPL-3.0-only
// A cage cut into patches (F1, Convert to CAD body). QUICKSURFACE merges the
// quads of a Freeform into larger faces — 4408 quads became 104 faces on
// its Auto Freeform body (analysis/freeform-2026-11-07/native-autofreeform-
// cadbody-report.json) — so a converted body is not a face a quad. Here the
// merge is the plain one: the cage's quads are grown into rectangular blocks
// of m × n quads whose inside is regular — every vertex strictly inside has
// four edges, none sharp — and whose sides pass no extraordinary vertex
// (only its four corners may be one), where the limit surface is smooth
// over the whole block and one face holds it; a block ends at a crease, a
// boundary, an extraordinary vertex or a quad already taken.
//
// Each block is then sampled: its lattice of cage vertices is refined
// `steps` times by the same Catmull–Clark step the cage is subdivided by,
// and the lattice's refined vertices taken at their limit positions (or at
// the positions the caller hands back for them — a snapped surface), so a
// block is a (m 2ˢ + 1) × (n 2ˢ + 1) grid the kernel passes a surface
// through. Two blocks that meet along a cage edge take the very same
// vertices along it, in opposite order, so their faces sew.

import { type Cage, edgeKey, topology, type CageTopology } from './cage'
import { limitPositions } from './limit'
import { subdivide, vertexRule } from './subdivide'

/** The most quads a block runs along a side: a longer run is cut, for the
 *  grids it makes stay a size the kernel passes a surface through. */
export const MAX_BLOCK_SIDE = 12

export interface Block {
  /** The cage vertices of the block's lattice, (m + 1) rows × (n + 1)
   *  columns, row-major; row i runs along the block's first side. */
  vertices: number[]
  rows: number
  cols: number
  /** The cage faces the block holds. */
  faces: number[]
}

export interface PatchGrid {
  /** xyz, row-major, rows × cols. */
  points: Float64Array
  rows: number
  cols: number
  /** The cage faces this grid covers. */
  faces: number[]
}

export interface CagePatches {
  /** The quad cage the blocks are of (the input, or the input refined once
   *  where it had faces that were not quads — the limit is the same). */
  cage: Cage
  /** True where every edge of the cage has two faces: the patches close. */
  closed: boolean
  blocks: Block[]
  /** Every block's grid, sampled at `steps` refinements. */
  grids: PatchGrid[]
  steps: number
}

const rotate = (v: number[], rows: number, cols: number): { v: number[]; rows: number; cols: number } => {
  // Rotated a quarter turn: the new row i is the old column (cols-1-i)...
  // chosen so that the old first row becomes the new last column and the
  // cyclic order of every cell is kept.
  const out = new Array<number>(rows * cols)
  const nr = cols, nc = rows
  for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) out[i * nc + j] = v[(rows - 1 - j) * cols + i]
  return { v: out, rows: nr, cols: nc }
}

const faceKey = (verts: number[]): string => [...verts].sort((a, b) => a - b).join(':')

/** The cage's quads grown into rectangular regular blocks, each quad in
 *  exactly one. The cage must be all quads. */
export function findBlocks(c: Cage, t: CageTopology = topology(c), maxSide = MAX_BLOCK_SIDE): Block[] {
  const faceOfCorners = new Map<string, number>()
  c.faces.forEach((f, fi) => faceOfCorners.set(faceKey(f), fi))
  const taken = new Uint8Array(c.faces.length)
  const regular = new Map<number, boolean>()
  const isRegular = (v: number): boolean => {
    let r = regular.get(v)
    if (r === undefined) {
      r = t.vertexFaces[v].length === 4 && t.vertexEdges[v].length === 4 && vertexRule(t, v) === 'smooth'
      regular.set(v, r)
    }
    return r
  }
  /** A vertex a block may run past on its side: not extraordinary — four
   *  edges and none sharp, or on a boundary with one face either side of
   *  its inner edge, or on a crease with four faces. Only the block's four
   *  corners may be extraordinary: the limit is smooth over the closure of
   *  the block everywhere else, and the surface through its samples with it. */
  const onSide = (v: number): boolean => {
    let sharp = 0
    for (const e of t.vertexEdges[v]) {
      const edge = t.edges[e]
      if (edge.crease || edge.faces.length < 2) sharp++
    }
    const faces = t.vertexFaces[v].length
    const edges = t.vertexEdges[v].length
    if (sharp === 0) return faces === 4 && edges === 4
    if (sharp === 2) return (faces === 2 && edges === 3) || (faces === 4 && edges === 4)
    return false
  }
  const edgeIsSharp = (a: number, b: number): boolean => {
    const e = t.edges[t.edgeOf.get(edgeKey(a, b))!]
    return e.crease || e.faces.length < 2
  }
  const cellFace = (g: number[], cols: number, i: number, j: number): number => faceOfCorners.get(faceKey([g[i * cols + j], g[(i + 1) * cols + j], g[(i + 1) * cols + j + 1], g[i * cols + j + 1]])) ?? -1

  /** The block's lattice grown by one column of quads past its last row,
   *  or null where it cannot be. */
  const extend = (g: number[], rows: number, cols: number): { v: number[]; rows: number } | null => {
    const m = rows - 1, n = cols - 1
    if (m >= maxSide) return null
    const next = new Array<number>(cols)
    for (let j = 0; j < n; j++) {
      const a = g[m * cols + j], b = g[m * cols + j + 1]
      if (edgeIsSharp(a, b)) return null
      const e = t.edges[t.edgeOf.get(edgeKey(a, b))!]
      const mine = cellFace(g, cols, m - 1, j)
      const other = e.faces.find((f) => f !== mine)
      if (other === undefined || taken[other]) return null
      const f = c.faces[other]
      if (f.length !== 4) return null
      // The neighbour runs the shared edge the other way: b, then a.
      const at = f.indexOf(b)
      if (f[(at + 1) % 4] !== a) return null
      const x = f[(at + 2) % 4], y = f[(at + 3) % 4]
      if (j === 0) next[0] = x
      else if (next[j] !== x) return null
      next[j + 1] = y
    }
    // Every vertex of the new row is new to the block, and the vertices the
    // old last row now has a quad either side of are regular.
    const used = new Set(g)
    for (const v of next) {
      if (used.has(v)) return null
      used.add(v)
    }
    if (used.size !== g.length + cols) return null
    for (let j = 1; j < n; j++) if (!isRegular(g[m * cols + j])) return null
    // Past this row the old row's ends, and the new row between its ends,
    // run along the block's sides.
    if (!onSide(g[m * cols]) || !onSide(g[m * cols + n])) return null
    for (let j = 1; j < n; j++) if (!onSide(next[j])) return null
    // The seams between the new quads run from the old last row: not sharp.
    for (let j = 1; j < n; j++) if (edgeIsSharp(g[m * cols + j], next[j])) return null
    return { v: [...g, ...next], rows: rows + 1 }
  }

  const blocks: Block[] = []
  for (let seed = 0; seed < c.faces.length; seed++) {
    if (taken[seed]) continue
    const f = c.faces[seed]
    if (f.length !== 4) throw new Error('The block finder needs a quad cage; subdivide once first.')
    // Row i along f[0] → f[1], column j along f[0] → f[3].
    let g = [f[0], f[3], f[1], f[2]]
    let rows = 2, cols = 2
    let idle = 0
    while (idle < 4) {
      const grown = extend(g, rows, cols)
      if (grown) {
        g = grown.v
        rows = grown.rows
        idle = 0
        continue
      }
      idle++
      const r = rotate(g, rows, cols)
      g = r.v
      rows = r.rows
      cols = r.cols
    }
    const faces: number[] = []
    for (let i = 0; i + 1 < rows; i++) for (let j = 0; j + 1 < cols; j++) {
      const fi = cellFace(g, cols, i, j)
      if (fi < 0) throw new Error(`Block at face ${seed} is not a lattice of the cage at ${i},${j} (${rows}x${cols}).`)
      faces.push(fi)
      taken[fi] = 1
    }
    blocks.push({ vertices: g, rows, cols, faces })
  }
  return blocks
}

/** The lattice of a block carried through one refinement of the cage it
 *  is a lattice of: `fine` is the cage `coarse` subdivided once, so a
 *  cage vertex keeps its index, a face's point is at nv + face and an
 *  edge's at nv + nf + edge. */
function refineLattice(g: number[], rows: number, cols: number, coarse: Cage, t: CageTopology, faceOfCorners: Map<string, number>): { v: number[]; rows: number; cols: number } {
  const nv = coarse.positions.length / 3
  const nf = coarse.faces.length
  const nr = 2 * rows - 1, nc = 2 * cols - 1
  const out = new Array<number>(nr * nc)
  const edgePoint = (a: number, b: number) => nv + nf + t.edgeOf.get(edgeKey(a, b))!
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const here = g[i * cols + j]
    out[2 * i * nc + 2 * j] = here
    if (i + 1 < rows) out[(2 * i + 1) * nc + 2 * j] = edgePoint(here, g[(i + 1) * cols + j])
    if (j + 1 < cols) out[2 * i * nc + 2 * j + 1] = edgePoint(here, g[i * cols + j + 1])
    if (i + 1 < rows && j + 1 < cols) {
      const fi = faceOfCorners.get(faceKey([here, g[(i + 1) * cols + j], g[(i + 1) * cols + j + 1], g[i * cols + j + 1]]))
      if (fi === undefined) throw new Error('A block names a quad the cage does not have.')
      out[(2 * i + 1) * nc + 2 * j + 1] = nv + fi
    }
  }
  return { v: out, rows: nr, cols: nc }
}

/** The cage as quads: itself where it is all quads, else refined once. */
export function asQuadCage(c: Cage): Cage {
  return c.faces.every((f) => f.length === 4) ? c : subdivide(c)
}

/** The cage's patches: its blocks, each sampled on the limit surface after
 *  `steps` refinements (the positions of the refined cage's vertices may be
 *  swapped for others — `positions` — a snapped surface's). */
export function cagePatches(cage: Cage, steps: number, positions?: (fine: Cage, limit: Float64Array) => Float64Array): CagePatches {
  if (!(steps >= 1 && steps <= 5)) throw new Error('Steps run from 1 to 5.')
  const quad = asQuadCage(cage)
  const t0 = topology(quad)
  const blocks = findBlocks(quad, t0)
  // The cages at every level, the topology of each but the last.
  const levels: Cage[] = [quad]
  for (let s = 0; s < steps; s++) levels.push(subdivide(levels[s]))
  const fine = levels[steps]
  const limit = limitPositions(fine)
  const pos = positions ? positions(fine, limit) : limit
  const tops = levels.slice(0, steps).map((l) => topology(l))
  const corners = levels.slice(0, steps).map((l) => {
    const m = new Map<string, number>()
    l.faces.forEach((f, fi) => m.set(faceKey(f), fi))
    return m
  })
  const grids: PatchGrid[] = blocks.map((b) => {
    let lattice = { v: b.vertices, rows: b.rows, cols: b.cols }
    for (let s = 0; s < steps; s++) lattice = refineLattice(lattice.v, lattice.rows, lattice.cols, levels[s], tops[s], corners[s])
    const points = new Float64Array(lattice.rows * lattice.cols * 3)
    lattice.v.forEach((v, k) => {
      points[k * 3] = pos[v * 3]
      points[k * 3 + 1] = pos[v * 3 + 1]
      points[k * 3 + 2] = pos[v * 3 + 2]
    })
    return { points, rows: lattice.rows, cols: lattice.cols, faces: b.faces }
  })
  return { cage: quad, closed: t0.closed, blocks, grids, steps }
}
