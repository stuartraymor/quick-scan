// SPDX-License-Identifier: AGPL-3.0-only
// Surfacing → Pipe, as in QUICKSURFACE: a circle of the typed diameter swept
// along a sketch path. The circle is a sketch of its own, square to the path
// where it starts, so the pipe is an ordinary sweep the history can edit.

import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'
import { cross, len, normalize } from '../../../src/core/vec'
import type { SketchFeature } from './features'
import { sweepPath } from './profiles'
import type { Sketch } from './sketch'

export const DEFAULT_PIPE_DIAMETER_MM = 5

/** The sheet a pipe's circle is drawn on: through the path's start, its
 *  normal along the way the path leaves it. A message when the sketch is
 *  no path a sweep can follow. */
export function pipeFrame(path: Pick<SketchFeature, 'frame' | 'sketch' | 'name'>): SectionFrame | string {
  const run = sweepPath(path, path.frame.origin)
  if (typeof run === 'string') return run
  const normal = normalize(run.tangent)
  if (!normal) return `${path.name} has no direction at its start.`
  // Any direction off the normal makes the sheet's u; the path's own
  // sheet normal is the natural one, the world Z when that runs along it.
  const pick: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const seed = len(cross(path.frame.normal, normal)) > 1e-6 ? path.frame.normal : pick
  const basisU = normalize(cross(seed, normal))
  const basisV = basisU && normalize(cross(normal, basisU))
  if (!basisU || !basisV) return `${path.name} has no direction at its start.`
  return { origin: run.start, normal, basisU, basisV }
}

/** The pipe's profile: one circle of the diameter round the sheet's zero. */
export function pipeSketch(diameter: number): Sketch {
  return { entities: [{ id: 1, kind: 'circle', c: [0, 0], r: diameter / 2 }], constraints: [], nextId: 2 }
}

/** The sketches a pipe can run along: those sweepPath reads as one chain. */
export function pipePaths(features: readonly { kind: string }[]): SketchFeature[] {
  return features.filter((f): f is SketchFeature => f.kind === 'sketch' && typeof pipeFrame(f as SketchFeature) !== 'string')
}
