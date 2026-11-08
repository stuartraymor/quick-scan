// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.from_sketch: From 3D Sketch (F5 of
// audit-2026-11-07/FREEFORM_ROADMAP.md). The curves of a patch network — Quick
// Scan's 3D sketch: curves drawn on the scan and joined at nodes — close
// regions of three to six sides; a freeform cage is laid over each at the
// Resolution given (core/freeform/sketch.ts), taken onto the scan, and added
// as one freeform feature that remembers its network. The network itself is
// left as it is, to be filled with NURBS patches under its own key
// (reverse.network.*) if wanted. Run again on the freeform after the network’s
// curves are edited, the cage is made anew from them.

import { invalid } from '../../../src/commands/core/common'
import { bool, int, obj, str } from '../../../src/commands/schema'
import { round3 } from '../../../src/core/round'
import type { Vec3 } from '../../../src/core/types'
import { type Command, CommandError } from '../../../src/plugins/api'
import type { FreeformFeature, NetworkFeature } from '../core/features'
import { deviation, snapCage } from '../core/freeform/edit'
import { MAX_STEPS } from '../core/freeform/make'
import { polylinePath, regionScan, SKETCH_REFUSAL, SKETCH_RESOLUTION_MAX, SketchError, sidePoints, sketchCage, type SketchCell } from '../core/freeform/sketch'
import { traceNetwork } from '../core/network'
import { readCells } from '../core/networkCells'
import { bodiesChanged, bodyRows } from './reCommandAnswers'
import { change, featureNamed, type Json, re, ready, type Ref, session } from './reCommandCore'
import { madeOut } from './reFreeformEditCommands'
import { requireFreeName } from './reFeatureCommands'
import { scanPaths } from './reNetworkCommands'
import { featureRef } from './reSchemas'

const TOLERANCE_MM = 0.05
/** How many refused regions an answer lists. */
const REFUSED_SHOWN = 8

const at3 = (p: Vec3): Vec3 => [round3(p[0]), round3(p[1]), round3(p[2])]

function networkOf(ref: Ref): NetworkFeature {
  const f = featureNamed(ref)
  if (f.kind !== 'network') invalid(`${f.name} is a ${f.kind}, not a patch network (the 3D sketch of Quick Scan).`)
  return f as NetworkFeature
}

export const freeformFromSketch: Command<{
  network?: Ref
  feature?: Ref
  resolution?: number
  name?: string
  steps?: number
  snap?: boolean
  iterations?: number
}> = {
  name: 'from_sketch',
  title: 'Make a freeform cage from the curves of a 3D sketch',
  description: `From 3D Sketch (Freeform ▸ From 3D Sketch): the curves of a patch network — Quick Scan’s 3D sketch, curves drawn on the scan and joined at nodes — close regions of three to six sides, and a freeform cage is laid over each. At Resolution 1 a region of n sides is n quads round a centre vertex (a four-sided one 2 × 2, 4 quads and 9 vertices; a five-sided one 5 quads and 11); each Resolution after cuts every quad 2 × 2 (4, 16, 64, 256 quads for a four-sided region). The corners are the sketch’s nodes exactly, the vertices along a side lie at equal fractions of its length, a four-sided region’s interior is the blend of its four sides, and regions that share a curve share its vertices. The cage is then snapped to the scan and added as one freeform feature (refined \`steps\` times, taken onto the scan when \`snap\`), remembering its network and Resolution: give \`feature\` (a freeform made by this command) after the network’s curves were edited, and its cage is rebuilt from them in one undo step, its name, steps and snap kept. The regions are the network’s filled cells and every other closed region of three to six sides; a sketch that closes none is refused with QUICKSURFACE’s “${SKETCH_REFUSAL}”, with what each curve end and region lacks. The network is left as it is: fill it with NURBS patches through reverse.network.edit. Resolution 1 to ${SKETCH_RESOLUTION_MAX}. Returns the feature and its result, the cage’s counts, the regions refused, and the cage’s deviation from the scan before and after the snap.`,
  input: obj(
    {
      network: featureRef('patch network'),
      feature: featureRef('freeform made from a sketch'),
      resolution: int(`How many times each region’s cage is cut: 1 (the default) to ${SKETCH_RESOLUTION_MAX}.`, { minimum: 1, maximum: SKETCH_RESOLUTION_MAX }),
      name: str('The feature’s name; “Freeform n” when left out. Unique across sketches and features.', { minLength: 1 }),
      steps: int(`How many times the cage is refined before its faces are made; 2 unless given (1–${MAX_STEPS}).`, { minimum: 1, maximum: MAX_STEPS }),
      snap: bool('Take the refined surface onto the scan when it is built; true unless given.'),
      iterations: int('How many times the cage’s vertices are snapped to the scan, 1–100; 8 unless given.', { minimum: 1, maximum: 100 }),
    },
    [],
  ),
  label: ({ name, feature }) => (feature !== undefined ? 'rebuild freeform cage from its sketch' : `freeform cage from 3D sketch${typeof name === 'string' ? ` “${name}”` : ''}`),
  run: async ({ network, feature, resolution, name, steps = 2, snap = true, iterations = 8 }) => {
    const s = await ready()
    // Rebuilding: the freeform made earlier, and the network and Resolution it remembers.
    let old: FreeformFeature | null = null
    if (feature !== undefined) {
      const f = featureNamed(feature)
      if (f.kind !== 'freeform') invalid(`${f.name} is a ${f.kind}, not a freeform.`)
      old = f as FreeformFeature
      if (!old.fromSketch && network === undefined) invalid(`${old.name} was not made from a sketch: name the \`network\` to make its cage from.`)
    } else {
      requireFreeName(name)
      if (network === undefined) invalid('Name the patch network (the 3D sketch) to make the cage from: `network`.')
    }
    const net = network !== undefined ? networkOf(network) : networkOf(old?.fromSketch?.network as number)
    const level = resolution ?? old?.fromSketch?.resolution ?? 1
    if (!Number.isInteger(level) || level < 1 || level > SKETCH_RESOLUTION_MAX) invalid(`resolution: from 1 to ${SKETCH_RESOLUTION_MAX}.`)

    await s.syncScan()
    const paths = scanPaths(session())
    // The network read as the build reads it; the regions filled, and then every other the curves close.
    const traced = traceNetwork(paths, net.nodes, net.curves)
    const seeds = net.cells.map((c) => c.seed)
    const cornersOf = net.cells.map((c) => (c.corners && c.corners.length >= 3 ? new Set(c.corners) : undefined))
    const first = readCells(paths, traced.nodes, traced.curves, seeds, cornersOf)
    const cells = first.unfilled.length > 0 ? readCells(paths, traced.nodes, traced.curves, [...seeds, ...first.unfilled.map((u) => u.seed)], [...cornersOf, ...first.unfilled.map(() => undefined)]) : first
    const curves = new Map(traced.curves.map((c) => [c.id, c]))
    const regions: SketchCell[] = []
    const covered: { triangles: Uint32Array }[] = []
    const refused: { message: string; at?: Vec3 }[] = []
    for (const c of cells.cells) {
      if (c.status === 'refused') {
        refused.push({ message: c.message, ...(c.at ? { at: c.at } : {}) })
        continue
      }
      try {
        regions.push({ sides: c.sides.map((side) => polylinePath(sidePoints(side, curves))) })
        covered.push(c)
      } catch (e) {
        if (e instanceof SketchError) refused.push({ message: e.message })
        else throw e
      }
    }
    if (traced.lost.length > 0) refused.push({ message: `curve${traced.lost.length === 1 ? '' : 's'} ${traced.lost.join(', ')} found no path along the scan` })
    if (regions.length === 0) {
      const why = refused.slice(0, REFUSED_SHOWN).map((r) => r.message)
      return invalid(`${SKETCH_REFUSAL}${why.length > 0 ? ` — ${[...new Set(why)].join('; ')}` : ''}.`)
    }

    let cage
    try {
      cage = sketchCage(regions, level)
    } catch (e) {
      if (e instanceof SketchError) return invalid(`From 3D Sketch: ${e.message}`)
      throw e
    }

    // The cage's vertices taken onto the scan as far as the regions reach — not onto another wall of the part that a cage bulging past its curves lies nearer to.
    const reach = regionScan(paths, covered)
    const closest = (p: Vec3) => {
      const c = reach.closest(p)
      return c ? { point: c.point, distance: c.distance } : null
    }
    const was = deviation(cage, closest, TOLERANCE_MM)
    let snapped: Json | null = null
    if (was.points > 0) {
      const r = snapCage(cage, closest, Math.min(100, Math.max(1, Math.round(iterations))), 0.01)
      cage = r.cage
      const now = deviation(cage, closest, TOLERANCE_MM)
      const show = (d: typeof was) => ({ points: d.points, missed: d.missed, rms: round3(d.rms), max: round3(d.max), within: d.within, fraction: d.points > 0 ? round3(d.within / d.points) : 0 })
      snapped = { iterations: r.stats.iterations, tolerance: TOLERANCE_MM, before: show(was), after: show(now) }
    }

    const before = bodyRows(s)
    const data = { positions: Array.from(cage.positions), faces: cage.faces, creases: cage.creases, fromSketch: { network: net.id, resolution: level } }
    let id: number
    if (old) {
      const oldId = old.id
      id = await change(() => {
        if (!re().updateFreeform(oldId, data)) throw new CommandError('not_found', `There is no freeform ${oldId}.`)
        return oldId
      })
    } else {
      id = await change(() => re().addFreeform({ ...data, steps, snap }, name))
    }
    const f = featureNamed(id) as FreeformFeature
    return {
      ...madeOut(f),
      sketch: {
        network: { id: net.id, name: net.name },
        resolution: level,
        regions: regions.length,
        quads: cage.faces.length,
        vertices: cage.positions.length / 3,
        rebuilt: old !== null,
        ...(refused.length > 0 ? { refused: refused.slice(0, REFUSED_SHOWN).map((r) => ({ message: r.message, ...(r.at ? { at: at3(r.at) } : {}) })), refusedCount: refused.length } : {}),
      },
      ...(snapped ? { snapped } : {}),
      bodies: bodiesChanged(s, before),
    }
  },
}
