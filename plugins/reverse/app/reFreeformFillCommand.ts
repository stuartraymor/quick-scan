// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.fill: Fill Surface (F8 of audit-2026-11-07/FREEFORM_ROADMAP.md),
// the part QUICKSURFACE 8.0.128 does with its defaults: a four-sided region of
// a patch network — the curves of the 3D sketch — is filled with a surface
// through its boundary alone (core/fill.ts), every edge Contact. The surface
// is not taken onto the scan: measured on the native one, it lies up to
// 7.7 mm off it inside the loop. The grid it is made through is kept in the
// feature, so it rebuilds without the sketch or the scan.

import { invalid } from '../../../src/commands/core/common'
import { int, obj, str } from '../../../src/commands/schema'
import { round3 } from '../../../src/core/round'
import type { Vec3 } from '../../../src/core/types'
import { type Command } from '../../../src/plugins/api'
import type { NetworkFeature } from '../core/features'
import { FILL_SAMPLES, FILL_SAMPLES_MAX, FILL_SAMPLES_MIN, fillGrid } from '../core/fill'
import { polylinePath, SketchError, sidePoints } from '../core/freeform/sketch'
import { traceNetwork } from '../core/network'
import { readCells } from '../core/networkCells'
import { bodiesChanged, bodyRows } from './reCommandAnswers'
import { change, featureNamed, type Json, re, ready, type Ref, session } from './reCommandCore'
import { requireFreeName } from './reFeatureCommands'
import { scanPaths } from './reNetworkCommands'
import { featureBrief, resultOut } from './reReadout'
import { featureRef } from './reSchemas'

/** How many of the region's sides' lengths and refusals an answer lists. */
const REFUSED_SHOWN = 8

export const freeformFill: Command<{ network: Ref; cell?: number; name?: string; samples?: number }> = {
  name: 'fill',
  title: 'Fill a four-sided region of a 3D sketch with a surface',
  description: `Fill Surface (Freeform ▸ Fill Surface) with QUICKSURFACE’s defaults: a region of a patch network — Quick Scan’s 3D sketch — that four curves close is filled with a surface through those curves alone, every edge Contact (position only). Measured on QUICKSURFACE 8.0.128’s own, that surface is the blend of its four boundary curves (a Coons patch) and is NOT taken onto the scan: it lies up to several mm off the scan inside the loop and bows with the wall as the boundary does, not flat. Here it is the same blend with the curves’ parameter by length, a B-spline face through a \`samples\` × \`samples\` grid (${FILL_SAMPLES} by default, ${FILL_SAMPLES_MIN}–${FILL_SAMPLES_MAX}), kept in the feature so it rebuilds without the scan; on the one loop compared it lay within 0.26 mm of the native surface (0.14 mm mean), all of it the curves’ parameter. \`cell\` is the region’s number among those the network closes (the filled cells first, then every other closed region, the order reverse.freeform.from_sketch reads them in); it may be left out where the network closes exactly one. A region of three, five or six sides is refused here (Freeform ▸ From 3D Sketch lays a cage over those). Not done: Tangent and Curvature continuity, internal curves, “on scan data”, Planar Surface mode, Expand by. The surface is a sheet body of its own — thicken it, trim with it or use it as any sheet. Returns the feature, its body, the sides’ lengths and the surface’s distance from the scan.`,
  input: obj(
    {
      network: featureRef('patch network'),
      cell: int('The region’s number among the regions the network closes, from 0; the only one when the network closes exactly one.', { minimum: 0 }),
      name: str('The feature’s name; “Fill surface n” when left out. Unique across sketches and features.', { minLength: 1 }),
      samples: int(`Grid points along a side of the surface’s grid, ${FILL_SAMPLES_MIN}–${FILL_SAMPLES_MAX}; ${FILL_SAMPLES} unless given.`, { minimum: FILL_SAMPLES_MIN, maximum: FILL_SAMPLES_MAX }),
    },
    ['network'],
  ),
  label: ({ name }) => `fill surface${typeof name === 'string' ? ` “${name}”` : ''}`,
  run: async ({ network, cell, name, samples = FILL_SAMPLES }) => {
    const s = await ready()
    requireFreeName(name)
    const net = featureNamed(network)
    if (net.kind !== 'network') invalid(`${net.name} is a ${net.kind}, not a patch network (the 3D sketch of Quick Scan).`)
    const network_ = net as NetworkFeature
    await s.syncScan()
    const paths = scanPaths(session())
    const traced = traceNetwork(paths, network_.nodes, network_.curves)
    const seeds = network_.cells.map((c) => c.seed)
    const cornersOf = network_.cells.map((c) => (c.corners && c.corners.length >= 3 ? new Set(c.corners) : undefined))
    const first = readCells(paths, traced.nodes, traced.curves, seeds, cornersOf)
    const read = first.unfilled.length > 0 ? readCells(paths, traced.nodes, traced.curves, [...seeds, ...first.unfilled.map((u) => u.seed)], [...cornersOf, ...first.unfilled.map(() => undefined)]) : first
    const curves = new Map(traced.curves.map((c) => [c.id, c]))
    const regions = read.cells
    const refused = regions.flatMap((c, i) => (c.status === 'refused' ? [{ cell: i, message: c.message }] : []))
    if (regions.length === 0) invalid(`${net.name} closes no region: nothing to fill${traced.lost.length > 0 ? ` (curve${traced.lost.length === 1 ? '' : 's'} ${traced.lost.join(', ')} found no path along the scan)` : ''}.`)
    let at = cell
    if (at === undefined) {
      if (regions.length !== 1) invalid(`${net.name} closes ${regions.length} regions: give \`cell\`, from 0 to ${regions.length - 1}.`)
      at = 0
    }
    const region = regions[at]
    if (!region) return invalid(`There is no region ${at}: ${net.name} closes ${regions.length}, numbered from 0.`)
    if (region.status === 'refused') return invalid(`Region ${at} cannot be read: ${region.message}${refused.length > 1 ? ` (${refused.length} of ${regions.length} regions refused)` : ''}.`)
    let grid
    let lengths: number[]
    try {
      const traces = region.sides.map((side) => sidePoints(side, curves))
      lengths = traces.map((t) => {
        let sum = 0
        for (let i = 3; i + 2 < t.length; i += 3) sum += Math.hypot(t[i] - t[i - 3], t[i + 1] - t[i - 2], t[i + 2] - t[i - 1])
        return round3(sum)
      })
      grid = fillGrid(traces.map((t) => polylinePath(t)), samples)
    } catch (e) {
      if (e instanceof SketchError) return invalid(`Fill Surface: ${e.message}`)
      throw e
    }

    // How far the filled surface lies from the scan: its grid points to the nearest scan point.
    let sum = 0
    let max = 0
    let n = 0
    for (let k = 0; k + 2 < grid.points.length; k += 3) {
      const c = paths.closest([grid.points[k], grid.points[k + 1], grid.points[k + 2]] as Vec3)
      if (!c) continue
      sum += c.distance
      max = Math.max(max, c.distance)
      n++
    }
    const before = bodyRows(s)
    const id = await change(() => re().addFill({ points: Array.from(grid.points), rows: grid.rows, cols: grid.cols }, name))
    const f = featureNamed(id)
    const r = re().results[id]
    const out: Json = {
      feature: featureBrief(f, false),
      result: resultOut(r),
      fill: {
        network: { id: net.id, name: net.name },
        cell: at,
        regions: regions.length,
        sides: lengths,
        grid: { rows: grid.rows, cols: grid.cols },
        fromScan: n > 0 ? { points: n, mean: round3(sum / n), max: round3(max) } : null,
        takenOntoScan: false,
        ...(refused.length > 0 ? { refused: refused.slice(0, REFUSED_SHOWN), refusedCount: refused.length } : {}),
      },
      bodies: bodiesChanged(s, before),
    }
    return out
  },
}
