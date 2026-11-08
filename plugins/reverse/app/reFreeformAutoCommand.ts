// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.auto: Auto Freeform, Basic (F6 of
// audit-2026-11-07/FREEFORM_ROADMAP.md). The whole scan becomes one closed
// quad cage at a target number of quads (core/freeform/auto.ts), which is
// snapped to the scan and added as a freeform feature like any other.

import { invalid } from '../../../src/commands/core/common'
import { bool, enumOf, int, obj, str } from '../../../src/commands/schema'
import { round3 } from '../../../src/core/round'
import { type Command } from '../../../src/plugins/api'
import { AUTO_QUADS_MAX, AUTO_QUADS_MIN, AUTO_TARGETS, AutoError, autoCage } from '../core/freeform/auto'
import { deviation, snapCage } from '../core/freeform/edit'
import { MAX_STEPS } from '../core/freeform/make'
import { bodiesChanged, bodyRows } from './reCommandAnswers'
import type { FreeformFeature } from '../core/features'
import { change, featureNamed, re, ready, session } from './reCommandCore'
import { madeOut } from './reFreeformEditCommands'
import { requireFreeName } from './reFeatureCommands'
import { scanPaths } from './reNetworkCommands'

const TOLERANCE_MM = 0.05

export const freeformAuto: Command<{
  algorithm?: 'basic'
  density?: 'low' | 'medium' | 'fine'
  quads?: number
  name?: string
  steps?: number
  snap?: boolean
  iterations?: number
}> = {
  name: 'auto',
  title: 'Make a freeform cage over the whole scan automatically',
  description: `Auto Freeform, Basic (Freeform ▸ Auto Freeform): the whole scan becomes one closed quad surface of sphere topology at a target number of quads — \`density\` low ${AUTO_TARGETS.low}, medium ${AUTO_TARGETS.medium} (the default) or fine ${AUTO_TARGETS.fine}, as QUICKSURFACE’s Target Quads, or \`quads\` for any number from ${AUTO_QUADS_MIN} to ${AUTO_QUADS_MAX}. The scan is rasterised into cubes sized so that the quads come to the target (within a few per cent), the cubes the outside cannot reach become the solid, the faces between solid and outside are the quads, and their vertices are laid on the scan and then snapped. Most vertices have four edges; the corners of the cubes leave a few per cent with three or five. A hole in the scan smaller than the cubes is spanned. The cage is added as one freeform feature (refined \`steps\` times, taken onto the scan when \`snap\`) — edit, snap, convert or thicken it as any freeform. Not done here: the feature-aligned algorithm, symmetry, guide curves, “extract from selected triangles”. Returns the feature, the cage’s counts (quads against the target, vertices with other than four edges, mean edge) and its deviation from the scan before and after the snap.`,
  input: obj(
    {
      algorithm: enumOf(['basic'], 'Basic, the only one here.'),
      density: enumOf(['low', 'medium', 'fine'], `Target quads: low ${AUTO_TARGETS.low}, medium ${AUTO_TARGETS.medium} (the default), fine ${AUTO_TARGETS.fine}.`),
      quads: int(`Target quads, ${AUTO_QUADS_MIN} to ${AUTO_QUADS_MAX}; instead of \`density\`.`, { minimum: AUTO_QUADS_MIN, maximum: AUTO_QUADS_MAX }),
      name: str('The feature’s name; “Freeform n” when left out. Unique across sketches and features.', { minLength: 1 }),
      steps: int(`How many times the cage is refined before its faces are made; 2 unless given (1–${MAX_STEPS}).`, { minimum: 1, maximum: MAX_STEPS }),
      snap: bool('Take the refined surface onto the scan when it is built; true unless given.'),
      iterations: int('How many times the cage’s vertices are snapped to the scan, 1–100; 8 unless given.', { minimum: 1, maximum: 100 }),
    },
    [],
  ),
  label: ({ name }) => `auto freeform${typeof name === 'string' ? ` “${name}”` : ''}`,
  run: async ({ density, quads, name, steps = 2, snap = true, iterations = 8 }) => {
    const s = await ready()
    requireFreeName(name)
    if (density !== undefined && quads !== undefined) invalid('Give `density` or `quads`, not both.')
    const target = quads ?? AUTO_TARGETS[density ?? 'medium']
    await s.syncScan()
    const paths = scanPaths(session())
    let made
    try {
      made = autoCage(paths, target)
    } catch (e) {
      if (e instanceof AutoError) return invalid(`Auto Freeform: ${e.message}`)
      throw e
    }
    const closest = (p: [number, number, number]) => {
      const c = paths.closest(p)
      return c ? { point: c.point, distance: c.distance } : null
    }
    let cage = made.cage
    const was = deviation(cage, closest, TOLERANCE_MM)
    const r = snapCage(cage, closest, Math.min(100, Math.max(1, Math.round(iterations))), 0.01)
    cage = r.cage
    const now = deviation(cage, closest, TOLERANCE_MM)
    const show = (d: typeof was) => ({ points: d.points, missed: d.missed, rms: round3(d.rms), max: round3(d.max), within: d.within, fraction: d.points > 0 ? round3(d.within / d.points) : 0 })
    const before = bodyRows(s)
    const id = await change(() => re().addFreeform({ positions: Array.from(cage.positions), faces: cage.faces, creases: cage.creases, steps, snap }, name))
    const f = featureNamed(id) as FreeformFeature
    return {
      ...madeOut(f),
      auto: {
        algorithm: 'basic',
        target: made.target,
        quads: made.quads,
        vertices: cage.positions.length / 3,
        irregular: made.irregular,
        meanEdge: round3(made.edge),
        cell: round3(made.cell),
        closed: made.closed,
      },
      snapped: { iterations: r.stats.iterations, tolerance: TOLERANCE_MM, before: show(was), after: show(now) },
      bodies: bodiesChanged(s, before),
    }
  },
}
