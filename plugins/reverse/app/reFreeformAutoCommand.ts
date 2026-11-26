// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.auto: Auto Freeform. The scan becomes a quad cage laid
// along its shape at a target number of quads and fitted to it
// (core/freeform/autoFreeform.ts), added as a freeform feature like any
// other. The work runs in a worker of its own (core/freeform/autoClient.ts):
// the dialog shows its progress and can stop it.

import { invalid } from '../../../src/commands/core/common'
import { arr, bool, enumOf, int, num, obj, str } from '../../../src/commands/schema'
import { measuredDeviationStats } from '../core/freeform/analysisRamp'
import { round3 } from '../../../src/core/round'
import { type Command } from '../../../src/plugins/api'
import { type AutoProgressListener, type AutoRun, startAutoFreeform } from '../core/freeform/autoClient'
import {
  AUTO_ALGORITHMS, AUTO_BUILD_STEPS, AUTO_DETAILS, AUTO_HARD_EDGE_DEG, AUTO_QUADS_MAX, AUTO_QUADS_MIN, AUTO_SYMMETRIES, AUTO_TARGETS, DETAIL_FACTOR,
  type AutoAlgorithm, type AutoDetails, AutoError, type AutoOutcome, type AutoSettings, type AutoSymmetry,
} from '../core/freeform/autoFreeform'
import { boundedBuildSteps, MAX_STEPS } from '../core/freeform/make'
import { bodiesChanged, bodyRows } from './reCommandAnswers'
import type { FreeformFeature } from '../core/features'
import { change, featureNamed, re, ready } from './reCommandCore'
import { madeOut } from './reFreeformEditCommands'
import { requireFreeName } from './reFeatureCommands'
import { useStore } from '../../../src/state/store'
import { CommandError } from '../../../src/commands/types'

/** The tolerance the answer's `within` is counted against, mm. */
const TOLERANCE_MM = 0.05

export const freeformAuto: Command<{
  algorithm?: AutoAlgorithm
  density?: 'low' | 'medium' | 'fine'
  quads?: number
  details?: AutoDetails
  symmetry?: AutoSymmetry
  improveHoles?: boolean
  guides?: number[][][]
  selectedOnly?: boolean
  refineTolerance?: number
  hardEdgeAngle?: number
  name?: string
  steps?: number
  snap?: boolean
  resnap?: boolean
}> = {
  name: 'auto',
  title: 'Make a freeform cage over the scan automatically',
  description: `Auto Freeform (Freeform ▸ Auto Freeform): the scan becomes a quad surface laid along its shape and fitted to it. \`algorithm\` is QUICKSURFACE’s: basic — an even field-aligned layout at the target — or feature (the default) — the same layout with \`details\` giving the part’s features more quads than the target (low ×${DETAIL_FACTOR.low}, balanced ×${DETAIL_FACTOR.balanced} — the default — higher ×${DETAIL_FACTOR.higher}, highest ×${DETAIL_FACTOR.highest}, QUICKSURFACE’s own counts on a test part). The target is \`density\` low ${AUTO_TARGETS.low}, medium ${AUTO_TARGETS.medium} (the default) or fine ${AUTO_TARGETS.fine}, or \`quads\` for any number from ${AUTO_QUADS_MIN} to ${AUTO_QUADS_MAX}. Scan edges sharper than \`hardEdgeAngle\` (${AUTO_HARD_EDGE_DEG}° unless given) are kept sharp in the layout, by either algorithm. Closed scans are checked for closure and topology. Coarse features may need a denser layout. Open scan rims guide the layout. Crumbs beside the part (pieces under 2 % of the largest) are left out. \`symmetry\` oxy / oyz / oxz lays out the half of the scan on the positive side of z = 0, x = 0 or y = 0 and mirrors it, so the cage is exactly symmetric and has vertices on the plane; the scan must cross the plane. \`improveHoles\` closes small holes and evens ragged rims before the layout. \`guides\` are curves on the scan (each a list of [x, y, z] points, mm) the quads’ edges are made to follow. \`selectedOnly\` lays the cage over the points marked on the scan alone. \`refineTolerance\` (mm) adds rows of quads where the fitted surface is still further than that from the scan, up to four times the quads. The cage’s vertices are solved by least squares so that its limit surface lies on the scan. It is added as one freeform feature (refined \`steps\` times, taken onto the scan when \`snap\`) — edit, snap, convert or thicken it as any freeform. Returns the feature, the cage’s counts (quads against the target, inner vertices with other than four edges, mean edge, rim edges), the fitted surface’s deviation from the scan and the time each stage took.`,
  input: obj(
    {
      algorithm: enumOf([...AUTO_ALGORITHMS], 'basic, or feature (aligned to the part’s features; the default).'),
      density: enumOf(['low', 'medium', 'fine'], `Target quads: low ${AUTO_TARGETS.low}, medium ${AUTO_TARGETS.medium} (the default), fine ${AUTO_TARGETS.fine}.`),
      quads: int(`Target quads, ${AUTO_QUADS_MIN} to ${AUTO_QUADS_MAX}; instead of \`density\`.`, { minimum: AUTO_QUADS_MIN, maximum: AUTO_QUADS_MAX }),
      details: enumOf([...AUTO_DETAILS], 'Feature Details (feature only): low, balanced (the default), higher or highest.'),
      symmetry: enumOf([...AUTO_SYMMETRIES], 'Make the cage mirror-symmetric about a global plane: oxy (z = 0), oyz (x = 0), oxz (y = 0); none unless given. The scan must cross the plane.'),
      improveHoles: bool('Improve holes’ boundaries: close small holes and even ragged rims before the layout; false unless given.'),
      guides: arr(arr(arr(num('mm'), undefined, { minItems: 3, maxItems: 3 }), undefined, { minItems: 2 }), 'Guide curves on the scan: each a list of [x, y, z] points.'),
      selectedOnly: bool('Extract from the selected (marked) part of the scan only; false unless given.'),
      refineTolerance: num('Refine to tolerance, mm: add quads where the surface is further than this from the scan. Off unless given.', { exclusiveMinimum: 0 }),
      hardEdgeAngle: num(`Hard edge angle, degrees: scan edges sharper than this are kept sharp in the layout; ${AUTO_HARD_EDGE_DEG} unless given.`, { minimum: 5, maximum: 120 }),
      name: str('The feature’s name; “Freeform n” when left out. Unique across sketches and features.', { minLength: 1 }),
      steps: int(`How many times the cage is refined before its faces are made; ${AUTO_BUILD_STEPS} unless given (1–${MAX_STEPS}): at 2 a cage of thousands of quads does not sew into blocks and becomes a face a quad.`, { minimum: 1, maximum: MAX_STEPS }),
      snap: bool('Snap Mode for the freeform (its edits follow the scan); true unless given.'),
      resnap: bool('Also take the built surface onto the scan sample by sample, as a snapped freeform’s is. Slow on a large cage and not needed: the cage is fitted already. false unless given.'),
    },
    [],
  ),
  label: ({ name }) => `auto freeform${typeof name === 'string' ? ` “${name}”` : ''}`,
  run: async ({ algorithm = 'feature', density, quads, details, symmetry = 'none', improveHoles, guides, selectedOnly, refineTolerance, hardEdgeAngle, name, steps, snap = true, resnap = false }) => {
    const s = await ready()
    requireFreeName(name)
    if (density !== undefined && quads !== undefined) invalid('Give `density` or `quads`, not both.')
    const target = quads ?? AUTO_TARGETS[density ?? 'medium']
    const settings: AutoSettings = {
      algorithm, quads: target, details, symmetry, improveHoles, refineTolerance, hardEdgeAngle,
      guides: guides?.map((g) => g.flat()),
      selection: selectedOnly ? selectedTriangles(s) : undefined,
    }
    await s.syncScan()
    const made = await prepareAutoCage(s, settings).result.catch((e) => refuse(e))
    const cage = made.cage
    const before = bodyRows(s)
    const id = await change(() => re().addFreeform({ positions: Array.from(cage.positions), faces: cage.faces, creases: cage.creases, steps: steps ?? boundedBuildSteps(cage.faces.length, AUTO_BUILD_STEPS), snap, autoFreeform: true, ...(resnap ? {} : { fitToScan: false }) }, name))
    const f = featureNamed(id) as FreeformFeature
    return { ...madeOut(f), ...autoAnswer(made), bodies: bodiesChanged(s, before) }
  },
}

function refuse(e: unknown): never {
  if (e instanceof AutoError) return invalid(`Auto Freeform: ${e.message}`)
  throw e
}

/** The outcome as the command answers it. */
export function autoAnswer(made: AutoOutcome) {
  const d = made.deviation
  const signed = measuredDeviationStats(made.surface.signed, d.tolerance)
  return {
    auto: {
      algorithm: made.algorithm,
      target: made.target,
      quads: made.quads,
      vertices: made.vertices,
      irregular: made.irregular,
      meanEdge: round3(made.edge),
      closed: made.closed,
      boundaryEdges: made.boundaryEdges,
      creases: made.creases,
      pieces: made.pieces,
      piecesKept: made.piecesKept,
      refined: made.refined,
      topologyResolutionRaised: made.topologyResolutionRaised,
      symmetry: made.symmetry,
      symmetric: made.mirror ? { vertices: made.mirror.partner.length, onPlane: made.mirror.onPlane } : null,
    },
    coverage: made.coverage,
    faults: made.faults,
    fitted: { signedScanFromSurface: signed && { min: signed.min, max: signed.max, mean: signed.mean }, iterations: made.fit.iterations, tolerance: d.tolerance, points: d.points, missed: d.missed, rms: round3(d.rms), max: round3(d.max), within: d.within, fraction: d.points > 0 ? round3(d.within / d.points) : 0 },
    ms: Object.fromEntries(Object.entries(made.ms).map(([k, v]) => [k, Math.round(v)])),
  }
}

/** The scan as the viewport holds it: its vertices and triangles, read without building anything on this thread. */
function scanArrays(s: Awaited<ReturnType<typeof ready>>): { positions: Float32Array; indices: Uint32Array } {
  if (!useStore.getState().fileName) throw new CommandError('no_scan', 'Auto Freeform is made of a scan, and none is open.')
  const scene = s.sceneRef.current
  const positions = scene?.scanPositions() ?? null
  const indices = scene?.scanIndices(true) ?? null
  if (!scene || !positions || !indices) throw new CommandError('unavailable', 'Auto Freeform is made of the scan as the viewport holds it — this needs the page with the scan shown.')
  return { positions: positions instanceof Float32Array ? positions : Float32Array.from(positions), indices }
}

/** The triangles of the scan all of whose corners are marked (the painted selection); refused when nothing is. */
export function selectedTriangles(s: Awaited<ReturnType<typeof ready>>): Uint32Array {
  // The marking is the viewport's, over the scan as it holds it.
  const marked = s.sceneRef.current?.paintedVertices?.()
  if (!marked || marked.length === 0) return invalid('Auto Freeform: nothing is selected on the scan to extract from.')
  const { positions, indices: idx } = scanArrays(s)
  const on = new Uint8Array(positions.length / 3)
  for (const v of marked) if (v < on.length) on[v] = 1
  const out: number[] = []
  for (let t = 0; t + 2 < idx.length; t += 3) if (on[idx[t]] && on[idx[t + 1]] && on[idx[t + 2]]) out.push(t / 3)
  if (out.length === 0) return invalid('Auto Freeform: the selection holds no whole triangle of the scan.')
  return Uint32Array.from(out)
}

/** Auto Freeform started on the session's scan; shared by the command and the dialog's preview. Never changes history. */
export function prepareAutoCage(s: Awaited<ReturnType<typeof ready>>, settings: AutoSettings, onProgress?: AutoProgressListener): AutoRun {
  return startAutoFreeform(scanArrays(s), { tolerance: TOLERANCE_MM, ...settings }, onProgress)
}
