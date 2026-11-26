// SPDX-License-Identifier: AGPL-3.0-only
// A freeform cage made a body inside the build (F3): what the commands'
// Convert does through the worker (app/reFreeformCommands.ts), done where
// the kernel is — the cage refined and, where asked, taken onto the scan;
// its blocks made B-spline faces and sewn (convert.ts); and, where asked,
// thickened or offset (shell.ts). A cage refined too little for its
// curvature gives faces that swing off their samples, which the kernel
// says; refined once more, they follow, up to MAX_STEPS.

import type { FreeformAsk } from '../features'
import type { ReKernel, Shape } from '../kernel'
import { type Cage, topology } from './cage'
import { type ConvertReport, type PatchSet, patchesBody } from './convert'
import { displacedAlongNormals, vertexNormals } from './limit'
import { type CagePatches, cagePatches, MAX_BLOCK_SIDE } from './patches'
import { type FreeformOp, reach, type ShellReport, freeformShell } from './shell'
import { snapMesh, type SnapQuery } from './snap'
import { smoothSnappedSheet, type SmoothSnapReference } from './smoothSnap'

/** The most a cage is refined before its faces are made. */
export const MAX_STEPS = 4
/** The most refined quads sampled: a cage's faces × 4^steps. */
export const MAX_SAMPLED_QUADS = 600_000

/** Default CAD sampling for a fitted cage. Each dyadic level quadruples its face count. */
export function boundedBuildSteps(quads: number, requested: number): number {
  let steps = requested
  while (steps > 1 && quads * 4 ** steps > MAX_SAMPLED_QUADS) steps--
  return steps
}

/** The refinement a control surface with an irregular point is sampled at,
 *  and the most refined quads that is done for: a larger cage keeps the
 *  refinement it asked for. */
const IRREGULAR_STEPS = 4
const IRREGULAR_SAMPLED_QUADS = 160_000

/** A point the limit surface is not bicubic round: inside the cage with
 *  other than four faces, or on its boundary with more than two (a notch, or
 *  quads joined to a T). A creased cage is left to the refinement it asked. */
function hasIrregularPoint(cage: Cage): boolean {
  if (cage.creases.length > 0 || cage.faces.some((f) => f.length !== 4)) return false
  const t = topology(cage)
  return t.vertexFaces.some((faces, v) => {
    if (faces.length === 0) return false
    const boundary = t.vertexEdges[v].some((e) => t.edges[e].faces.length < 2)
    return boundary ? faces.length > 2 : faces.length !== 4
  })
}

/** What a freeform step reports. */
export interface FreeformReport {
  convert: ConvertReport
  shell?: ShellReport
  steps: number
  missed?: number
}

export interface FreeformMade {
  shape: Shape
  report: ConvertReport
  shell?: ShellReport
  /** The refinement the faces needed. */
  steps: number
  closed: boolean
  /** Snapped to the scan: how many surface points found no scan point. */
  missed?: number
}

const patchSet = (p: CagePatches): PatchSet => ({ grids: p.grids, closed: p.closed, blocks: p.blocks.map((b) => ({ rows: b.rows, cols: b.cols, faces: b.faces })) })

/** Grid perimeter segments that do not have a shared sample edge. */
function expectedBoundary(patches: CagePatches): number {
  const edges = new Map<string, { length: number; uses: number }>()
  for (const { points, rows, cols } of patches.grids) {
    const add = (a: number, b: number) => {
      const p = points.subarray(3 * a, 3 * a + 3)
      const q = points.subarray(3 * b, 3 * b + 3)
      const key = [p.join(','), q.join(',')].sort().join('|')
      const previous = edges.get(key)
      if (previous) previous.uses++
      else edges.set(key, { length: Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), uses: 1 })
    }
    for (let col = 0; col < cols - 1; col++) {
      add(col, col + 1)
      const bottom = (rows - 1) * cols + col
      add(bottom, bottom + 1)
    }
    for (let row = 0; row < rows - 1; row++) {
      const left = row * cols
      add(left, left + cols)
      add(left + cols - 1, left + 2 * cols - 1)
    }
  }
  let length = 0
  for (const edge of edges.values()) if (edge.uses === 1) length += edge.length
  return length
}

/** The cage as a body of the kernel, thickened or offset by `ask`. The
 *  shape is the caller's. `closest` takes a point onto the scan (null:
 *  out of reach) and is wanted where `snap`. */
export function freeformBody(k: ReKernel, cage: Cage, opts: { steps: number; snap: boolean; closest?: SnapQuery; ray?: boolean; ask?: FreeformAsk; smoothReference?: SmoothSnapReference }): FreeformMade {
  const { snap, closest, ask } = opts
  if (snap && !closest) throw new Error('The surface is to be taken onto the scan, and the scan is not here.')
  let missed: number | undefined
  const patchesAt = (n: number, shift = 0, maxSide = MAX_BLOCK_SIDE): CagePatches =>
    cagePatches(cage, n, (fine, limit) => {
      let positions = limit
      if (snap && closest) {
        const r = snapMesh({ positions: limit, normals: opts.ray ? vertexNormals(limit, fine.faces) : new Float64Array(limit.length) }, closest)
        missed = r.missed
        positions = r.positions
      }
      return shift === 0 ? positions : displacedAlongNormals(positions, fine.faces, shift)
    }, maxSide, !snap && !ask && shift === 0)
  let used = Math.max(1, Math.min(MAX_STEPS, Math.round(opts.steps)))
  // A control surface is made the surface the editor shows. Where the cage
  // is regular that surface is a bicubic one and a face through a few
  // samples of it is it. Round an irregular point — quads joined to a T, a
  // notch, a pole with three or five quads — it is not, and at two
  // refinements the faces stood 0.38 mm off the surface edited and measured
  // (joined 10-quad sheet, 2026-11-18) and would not sew; at four, 0.007 mm.
  // A thickened or offset cage keeps its own refinement: its walls are
  // sampled to match, and were proved at that.
  if (!snap && !ask && used < IRREGULAR_STEPS && cage.faces.length * 4 ** IRREGULAR_STEPS <= IRREGULAR_SAMPLED_QUADS && hasIrregularPoint(cage)) used = IRREGULAR_STEPS
  for (;;) {
    if (cage.faces.length * 4 ** used > MAX_SAMPLED_QUADS) throw new Error(`The cage has ${cage.faces.length} faces; refined ${used} times it is more than ${MAX_SAMPLED_QUADS} quads to sample.`)
    let made: ReturnType<typeof patchesBody> | undefined
    try {
      let patches = patchesAt(used)
      // Refined no further, a piece that will not follow is cut to its cells.
      const last = used >= MAX_STEPS || cage.faces.length * 4 ** (used + 1) > MAX_SAMPLED_QUADS
      // Global refinement can collapse projected samples. Split a poorly fitting
      // snapped grid locally while retaining the requested sample resolution.
      // An open control surface is one sheet: its faces sew along every
      // edge two blocks share, leaving only the cage's own boundary open.
      made = patchesBody(k, { ...patchSet(patches), subdivisionParameters: !snap && !ask }, snap || last, false, !snap && !patches.closed ? expectedBoundary(patches) * 1.03 + .05 : undefined)
      // Independently interpolated CAD faces can leave open edges along
      // what should be shared by adjacent grids. A bounded fallback uses
      // the same straight boundary on both sides of every sample cell.
      if (snap && !patches.closed && made.report.faces > 1 &&
          patches.grids.reduce((sum, g) => sum + (g.rows - 1) * (g.cols - 1), 0) <= 2048) {
        const perimeter = expectedBoundary(patches)
        const limit = perimeter * 1.03 + .05
        if (k.openEdgeLength(made.shape, true) > limit) {
          let alternative: ReturnType<typeof patchesBody> | undefined
          try {
            alternative = patchesBody(k, patchSet(patches), true, true)
            if (alternative.report.valid && k.openEdgeLength(alternative.shape, true) <= limit) {
              k.release(made.shape)
              made = alternative
              alternative = undefined
            }
          } catch {
            // Preserve the original build if the alternate fit fails.
          } finally {
            if (alternative) k.release(alternative.shape)
          }
        }
      }
      // A closed cage that would not sew shut in blocks: each quad its own face, the neighbours meeting edge to edge, none side to side.
      if (patches.closed && !made.report.solid) {
        const each = patchesAt(used, 0, 1)
        const again = patchesBody(k, { ...patchSet(each), subdivisionParameters: !snap && !ask }, snap || last)
        if (again.report.solid) {
          k.release(made.shape)
          patches = each
          made = again
        } else k.release(again.shape)
      }
      const closed = patches.closed
      if (snap && !ask && !closed && opts.smoothReference) {
        const precise = smoothSnappedSheet(k, cage, made.shape, opts.smoothReference)
        if (precise !== null) {
          let area: number
          try { area = k.surfaceArea(precise) }
          catch (error) { k.release(precise); throw error }
          k.release(made.shape)
          made = { shape: precise, report: { ...made.report, valid: true, faces: cage.faces.length,
            blocks: cage.faces.length, largestBlock: { rows: 1, cols: 1 }, area } }
        }
      }
      const base = { report: made.report, steps: used, closed, ...(missed !== undefined ? { missed } : {}) }
      if (!ask) return { shape: made.shape, ...base }
      let op: FreeformOp
      if (ask.kind === 'offset') op = { kind: 'offset', distance: ask.distance, patches: patchSet(patchesAt(used, ask.distance)) }
      else {
        op = { ...ask }
        if (closed) {
          const [outer, inner] = reach(ask.thickness, ask.side)
          op.walls = { ...(outer !== 0 ? { outer: patchSet(patchesAt(used, outer)) } : {}), ...(inner !== 0 ? { inner: patchSet(patchesAt(used, inner)) } : {}) }
        }
      }
      const r = freeformShell(k, made.shape, made.report.solid, op)
      k.release(made.shape)
      made = undefined
      return { shape: r.shape, ...base, shell: r.report }
    } catch (e) {
      if (made) k.release(made.shape)
      const more = /does not follow/.test((e as Error).message) && used < MAX_STEPS
      if (!more) throw e
      used++
    }
  }
}
