// SPDX-License-Identifier: AGPL-3.0-only
// A freeform cage made a CAD body (F1, Convert to CAD body). The cage's
// blocks (patches.ts) are sampled on the limit surface — or on the scan,
// where the surface was snapped to it — and each grid goes to the kernel as
// one B-spline face, as Fit Surface and the patch network hand theirs over
// (kernel.surfaceThrough: a C2 surface through the grid within a micron).
// The faces are sewn without being unified, each block staying the face it
// came as; a cage that closes gives a solid, an open one a sheet. QUICKSURFACE
// converts with no dialog; so does this, and says what it made.

import type { ReKernel, Shape } from '../kernel'
import { GRID_AREA_SLACK, gridArea } from '../surfaceFit'
import type { PatchGrid } from './patches'

/** What the kernel needs of the patches: their grids and, for the report, the shape of each block. */
export interface PatchSet {
  grids: PatchGrid[]
  closed: boolean
  blocks: { rows: number; cols: number; faces: number[] }[]
}

/** The sewing tolerance, mm: the faces share their edge samples exactly,
 *  so only the kernel's micron lies between two of them. */
const SEW_TOLERANCE = 1e-3
/** The looser tolerances a closed cage is sewn at, in turn, if it will not close at the first: the faces of neighbouring blocks, each a surface through its own samples, lie apart by more than a micron where the cage curves or its blocks meet side to side (the cage of QUICKSURFACE's Auto Freeform, Medium, sews at 0.05 mm and not before). */
const SEW_LOOSER = [1e-2, 5e-2] as const

export interface ConvertReport {
  /** Faces in the body: one a block of the cage. */
  faces: number
  /** Cage quads the faces stand for, and the blocks they were merged into. */
  quads: number
  blocks: number
  /** The body is a closed solid, else a sheet. */
  solid: boolean
  /** The kernel finds the body valid. */
  valid: boolean
  /** mm² and, for a solid, mm³. */
  area: number
  volume: number | null
  /** The largest block, in quads along a side. */
  largestBlock: { rows: number; cols: number }
  /** The grids' samples in all. */
  samples: number
}

/** A grid cut to rows r0..r1 and columns c0..c1 (inclusive): the samples
 *  are the same ones, so two pieces cut apart share the points of the line
 *  they were cut along. */
function piece(g: PatchGrid, r0: number, r1: number, c0: number, c1: number): PatchGrid {
  const rows = r1 - r0 + 1, cols = c1 - c0 + 1
  const points = new Float64Array(rows * cols * 3)
  for (let i = 0; i < rows; i++) points.set(g.points.subarray(((r0 + i) * g.cols + c0) * 3, ((r0 + i) * g.cols + c0 + cols) * 3), i * cols * 3)
  return { points, rows, cols, faces: g.faces }
}

/** The smallest piece a grid is cut to: below it, a surface that does not
 *  follow its samples is the cage's fault, not the grid's size. */
const MIN_PIECE = 5

/** The faces through a grid: one where the kernel's surface through it
 *  follows it — its area within GRID_AREA_SLACK of the grid's own facets —
 *  else the grid cut in two across its longer side, each half tried the same
 *  way (the kernel's surface through a long grid of a strongly curved
 *  surface swings off the samples between them at some sizes and not at
 *  others; two halves of the same samples sit apart from the swing). The
 *  pieces share the line they were cut along, so they sew. */
function facesThrough(k: ReKernel, g: PatchGrid, out: Shape[], index: number, cells: boolean, last = false): void {
  // A cell of four samples is its bilinear face: it cannot swing off them.
  if (last && g.rows === 2 && g.cols === 2) {
    out.push(k.surfaceThrough(g.points, 2, 2))
    return
  }
  const face = k.surfaceThrough(g.points, g.rows, g.cols)
  const off = k.surfaceArea(face) / Math.max(gridArea(g), 1e-12)
  if (!(off > GRID_AREA_SLACK)) {
    out.push(face)
    return
  }
  k.release(face)
  // Below the smallest piece, the cage's own shape is at fault — a corner
  // of an open cage where the limit surface's edge hooks back on itself
  // within a millimetre (QUICKSURFACE's Auto Freeform on basic_part: a
  // quad with two corners of the cage on it, its samples' edge rising
  // 0.5 mm and back). The piece is cut on, to its cells if need be: faces
  // that follow the samples where one smooth face through them cannot.
  const small = (g.rows >= g.cols ? g.rows : g.cols) < 2 * MIN_PIECE - 1
  // Cells only when the cage cannot be refined further (cells): refined,
  // its pieces are smooth faces again.
  if (small && !last && !cells) throw new Error(`The kernel's surface through block ${index} of the cage does not follow it: ${off > 100 ? `${Math.round(off)} times` : `${Math.round((off - 1) * 100)} % more than`} its area, down to a piece of ${g.rows} × ${g.cols} samples. Refine the cage more (steps) or move its points.`)
  const alongRows = small || last ? (g.rows >= g.cols ? g.rows > 2 : g.cols <= 2) : g.rows >= g.cols
  const n = alongRows ? g.rows : g.cols
  if (n < 3) throw new Error(`The kernel's surface through block ${index} of the cage does not follow it: ${off > 100 ? `${Math.round(off)} times` : `${Math.round((off - 1) * 100)} % more than`} its area, down to a piece of ${g.rows} × ${g.cols} samples. Refine the cage more (steps) or move its points.`)
  const deeper = last || small
  const cut = Math.floor((n - 1) / 2)
  if (alongRows) {
    facesThrough(k, piece(g, 0, cut, 0, g.cols - 1), out, index, cells, deeper)
    facesThrough(k, piece(g, cut, g.rows - 1, 0, g.cols - 1), out, index, cells, deeper)
  } else {
    facesThrough(k, piece(g, 0, g.rows - 1, 0, cut), out, index, cells, deeper)
    facesThrough(k, piece(g, 0, g.rows - 1, cut, g.cols - 1), out, index, cells, deeper)
  }
}

/** The body made of a cage's patches, or why not. The shape is the
 *  caller's to release. */
/** `cells`: a piece that will not follow its samples at the smallest size
 *  is cut to its cells rather than refused — for a cage that cannot be
 *  refined further. */
export function patchesBody(k: ReKernel, patches: PatchSet, cells = false): { shape: Shape; report: ConvertReport } {
  const faces: Shape[] = []
  try {
    for (const [index, grid] of patches.grids.entries()) facesThrough(k, grid, faces, index, cells)
    if (faces.length === 0) throw new Error('The cage has no faces to convert.')
    let shape = faces.length === 1 ? k.copy(faces[0]) : k.sewPatches(faces, SEW_TOLERANCE, patches.closed)
    if (patches.closed && faces.length > 1 && !k.isClosedSolid(shape)) {
      k.release(shape)
      let closed: Shape | null = null
      for (const tolerance of SEW_LOOSER) {
        const tried = k.sewPatches(faces, tolerance, true)
        if (k.isClosedSolid(tried)) {
          closed = tried
          break
        }
        k.release(tried)
      }
      shape = closed ?? k.sewPatches(faces, SEW_TOLERANCE, false)
    }
    const solid = patches.closed && k.isClosedSolid(shape)
    const largest = patches.blocks.reduce((m, b) => (b.faces.length > m.rows * m.cols ? { rows: b.rows - 1, cols: b.cols - 1 } : m), { rows: 0, cols: 0 })
    const report: ConvertReport = {
      faces: k.faceCount(shape),
      quads: patches.blocks.reduce((n, b) => n + b.faces.length, 0),
      blocks: patches.blocks.length,
      solid,
      valid: k.isValid(shape),
      area: k.surfaceArea(shape),
      volume: solid ? k.volume(shape) : null,
      largestBlock: largest,
      samples: patches.grids.reduce((n: number, g: PatchGrid) => n + g.rows * g.cols, 0),
    }
    return { shape, report }
  } finally {
    k.release(...faces)
  }
}
