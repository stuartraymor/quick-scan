// SPDX-License-Identifier: AGPL-3.0-only
// A freeform cage made a body inside the build (F3): what the commands'
// Convert does through the worker (app/reFreeformCommands.ts), done where
// the kernel is — the cage refined and, where asked, taken onto the scan;
// its blocks made B-spline faces and sewn (convert.ts); and, where asked,
// thickened or offset (shell.ts). A cage refined too little for its
// curvature gives faces that swing off their samples, which the kernel
// says; refined once more, they follow, up to MAX_STEPS.

import type { Vec3 } from '../../../../src/core/types'
import type { FreeformAsk } from '../features'
import type { ReKernel, Shape } from '../kernel'
import type { Cage } from './cage'
import { type ConvertReport, type PatchSet, patchesBody } from './convert'
import { displacedAlongNormals } from './limit'
import { type CagePatches, cagePatches } from './patches'
import { type FreeformOp, reach, type ShellReport, freeformShell } from './shell'
import { snapMesh } from './snap'

/** The most a cage is refined before its faces are made. */
export const MAX_STEPS = 4
/** The most refined quads sampled: a cage's faces × 4^steps. */
export const MAX_SAMPLED_QUADS = 600_000

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

/** The cage as a body of the kernel, thickened or offset by `ask`. The
 *  shape is the caller's. `closest` takes a point onto the scan (null:
 *  out of reach) and is wanted where `snap`. */
export function freeformBody(k: ReKernel, cage: Cage, opts: { steps: number; snap: boolean; closest?: (p: Vec3) => Vec3 | null; ask?: FreeformAsk }): FreeformMade {
  const { snap, closest, ask } = opts
  if (snap && !closest) throw new Error('The surface is to be taken onto the scan, and the scan is not here.')
  let missed: number | undefined
  const patchesAt = (n: number, shift = 0): CagePatches =>
    cagePatches(cage, n, (fine, limit) => {
      let positions = limit
      if (snap && closest) {
        const r = snapMesh({ positions: limit, normals: new Float64Array(limit.length) }, (p) => closest(p))
        missed = r.missed
        positions = r.positions
      }
      return shift === 0 ? positions : displacedAlongNormals(positions, fine.faces, shift)
    })
  let used = Math.max(1, Math.min(MAX_STEPS, Math.round(opts.steps)))
  for (;;) {
    if (cage.faces.length * 4 ** used > MAX_SAMPLED_QUADS) throw new Error(`The cage has ${cage.faces.length} faces; refined ${used} times it is more than ${MAX_SAMPLED_QUADS} quads to sample.`)
    let made: ReturnType<typeof patchesBody> | undefined
    try {
      const patches = patchesAt(used)
      made = patchesBody(k, patchSet(patches))
      const closed = patches.closed
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
