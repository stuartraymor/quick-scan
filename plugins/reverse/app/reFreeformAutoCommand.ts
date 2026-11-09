// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.auto: Auto Freeform, Basic (F6 of
// audit-2026-11-07/FREEFORM_ROADMAP.md). The whole scan becomes one closed
// quad cage at a target number of quads (core/freeform/auto.ts), which is
// snapped to the scan and added as a freeform feature like any other.

import { invalid } from '../../../src/commands/core/common'
import { bool, enumOf, int, obj, str } from '../../../src/commands/schema'
import { round3 } from '../../../src/core/round'
import { type Command } from '../../../src/plugins/api'
import { AUTO_QUADS_MAX, AUTO_QUADS_MIN, AUTO_SYMMETRIES, AUTO_TARGETS, AutoError, type AutoSymmetry, autoCage, mirrorPositions } from '../core/freeform/auto'
import { deviation, snapCage } from '../core/freeform/edit'
import { MAX_STEPS } from '../core/freeform/make'
import { bodiesChanged, bodyRows } from './reCommandAnswers'
import type { FreeformFeature } from '../core/features'
import { change, featureNamed, re, ready } from './reCommandCore'
import { madeOut } from './reFreeformEditCommands'
import { requireFreeName } from './reFeatureCommands'
import { scanPaths } from './reNetworkCommands'

const TOLERANCE_MM = 0.05

export const freeformAuto: Command<{
  algorithm?: 'basic'
  density?: 'low' | 'medium' | 'fine'
  quads?: number
  symmetry?: AutoSymmetry
  name?: string
  steps?: number
  snap?: boolean
  iterations?: number
}> = {
  name: 'auto',
  title: 'Make a freeform cage over the whole scan automatically',
  description: `Auto Freeform, Basic (Freeform ▸ Auto Freeform): the whole scan becomes one closed quad surface of sphere topology at a target number of quads — \`density\` low ${AUTO_TARGETS.low}, medium ${AUTO_TARGETS.medium} (the default) or fine ${AUTO_TARGETS.fine}, as QUICKSURFACE’s Target Quads, or \`quads\` for any number from ${AUTO_QUADS_MIN} to ${AUTO_QUADS_MAX}. The scan is rasterised into cubes sized so that the quads come to the target (within a few per cent), the cubes the outside cannot reach become the solid, the faces between solid and outside are the quads, and their vertices are laid on the scan and then snapped. Most vertices have four edges; the corners of the cubes leave a few per cent with three or five. A hole in the scan smaller than the cubes is spanned. The cage is added as one freeform feature (refined \`steps\` times, taken onto the scan when \`snap\`) — edit, snap, convert or thicken it as any freeform. \`symmetry\` oxy / oyz / oxz (QUICKSURFACE’s Symmetry) makes the cage exactly mirror-symmetric about z = 0, x = 0 or y = 0 — a vertex on the plane lies on it, every other has a partner at its mirror position — and keeps it so through the snap; the scan must cross the plane. The built surface, snapped to the scan afterwards, is symmetric only as far as the scan is. Not done here: the feature-aligned algorithm (its counts at Medium, measured: Low 2079, Balanced 4375, Higher 7759, Highest 11589 quads — give \`quads\` for the same count), feature details, guide curves, “improve holes’ boundaries”, “extract from selected triangles”. Returns the feature, the cage’s counts (quads against the target, vertices with other than four edges, mean edge) and its deviation from the scan before and after the snap.`,
  input: obj(
    {
      algorithm: enumOf(['basic'], 'Basic, the only one here.'),
      density: enumOf(['low', 'medium', 'fine'], `Target quads: low ${AUTO_TARGETS.low}, medium ${AUTO_TARGETS.medium} (the default), fine ${AUTO_TARGETS.fine}.`),
      quads: int(`Target quads, ${AUTO_QUADS_MIN} to ${AUTO_QUADS_MAX}; instead of \`density\`.`, { minimum: AUTO_QUADS_MIN, maximum: AUTO_QUADS_MAX }),
      symmetry: enumOf([...AUTO_SYMMETRIES], 'Make the cage mirror-symmetric about a global plane: oxy (z = 0), oyz (x = 0), oxz (y = 0); none unless given. The scan must cross the plane.'),
      name: str('The feature’s name; “Freeform n” when left out. Unique across sketches and features.', { minLength: 1 }),
      steps: int(`How many times the cage is refined before its faces are made; 2 unless given (1–${MAX_STEPS}).`, { minimum: 1, maximum: MAX_STEPS }),
      snap: bool('Take the refined surface onto the scan when it is built; true unless given.'),
      iterations: int('How many times the cage’s vertices are snapped to the scan, 1–100; 8 unless given.', { minimum: 1, maximum: 100 }),
    },
    [],
  ),
  label: ({ name }) => `auto freeform${typeof name === 'string' ? ` “${name}”` : ''}`,
  run: async ({ density, quads, symmetry = 'none', name, steps = 2, snap = true, iterations = 8 }) => {
    const s = await ready()
    requireFreeName(name)
    if (density !== undefined && quads !== undefined) invalid('Give `density` or `quads`, not both.')
    const target = quads ?? AUTO_TARGETS[density ?? 'medium']
    const { made, cage, was, now, r } = await prepareAutoCage(s, target, symmetry, iterations)
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
        symmetry,
        symmetric: made.mirror ? { vertices: made.mirror.partner.length, onPlane: made.mirror.partner.reduce((n, p, v) => (p === v ? n + 1 : n), 0) } : null,
      },
      snapped: { iterations: r.stats.iterations, tolerance: TOLERANCE_MM, before: show(was), after: show(now) },
      bodies: bodiesChanged(s, before),
    }
  },
}

/** Shared by the command and the temporary UI preview; never changes history. */
export async function prepareAutoCage(s: Awaited<ReturnType<typeof ready>>, target: number, symmetry: AutoSymmetry, iterations = 8) {
  await s.syncScan()
  const paths = scanPaths(s)
  let made
  try {
    made = autoCage(paths, target, 2, 0.5, symmetry)
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
  if (made.mirror) cage = { ...cage, positions: mirrorPositions(cage.positions as Float64Array, made.mirror) }
  const now = deviation(cage, closest, TOLERANCE_MM)
  return { made, cage, was, now, r }
}
