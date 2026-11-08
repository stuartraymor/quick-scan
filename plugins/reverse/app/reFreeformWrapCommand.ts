// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.wrap: Wrap Surface (F4 of audit-2026-11-07/FREEFORM_ROADMAP.md).
// A region of the scan — the wall the Magic Wand took — is read as a cylinder
// and a ring of quads is laid over it at Low, Medium or Fine density
// (core/freeform/wrap.ts); the cage's vertices are snapped to the scan and
// the cage becomes a freeform feature, built and snapped like any other.

import { invalid } from '../../../src/commands/core/common'
import { arr, bool, enumOf, int, num, obj, oneOf, str, vec3 } from '../../../src/commands/schema'
import { round3 } from '../../../src/core/round'
import type { Vec3 } from '../../../src/core/types'
import { type Command, CommandError } from '../../../src/plugins/api'
import { type FreeformFeature, SURFACE_MIN_REGION } from '../core/features'
import { deviation, snapCage } from '../core/freeform/edit'
import { MAX_STEPS } from '../core/freeform/make'
import { fitWrap, regionClosest, scanVertexNormals, settleWrap, snapRegionOf, WrapError, type WrapClosure, type WrapDensity, wrapCage } from '../core/freeform/wrap'
import { bodiesChanged, bodyRows } from './reCommandAnswers'
import { madeOut } from './reFreeformEditCommands'
import { change, featureNamed, type Json, re, ready, session } from './reCommandCore'
import { requireFreeName } from './reFeatureCommands'
import { scanPaths } from './reNetworkCommands'
import { regionOf, SURFACE_REGION_LIMIT, SURFACE_REGION_MAX } from './reSurfaceRegion'

const TOLERANCE_MM = 0.05
const DENSITIES = ['low', 'medium', 'fine'] as const
const CLOSURES = ['chord', 'none'] as const

type RegionIn = number[] | { marked?: boolean; box?: { min: Vec3; max: Vec3 }; normal?: { dir: Vec3; withinDeg?: number }; exclude?: { min: Vec3; max: Vec3 }[]; limit?: number }

const boxIn = obj({ min: vec3('The lowest corner, mm.'), max: vec3('The highest corner, mm.') }, ['min', 'max'], 'A box in the frame the part is measured in now.')

const regionSchema = oneOf(
  [
    arr(int('', { minimum: 0 }), 'The scan’s vertices, by number.', { minItems: SURFACE_MIN_REGION }),
    obj({ marked: bool('true: the points scan.query { mark: true }, element.fit { mark: true } or scan.segment { mark } left marked.') }, ['marked']),
    obj(
      {
        box: boxIn,
        normal: obj({ dir: vec3('Any length.'), withinDeg: num('30 by default.', { exclusiveMinimum: 0, maximum: 180 }) }, ['dir'], 'Only the vertices facing this way.'),
        exclude: arr(boxIn, 'Boxes whose vertices are left out.'),
        limit: int(`At most this many, spread evenly; ${SURFACE_REGION_LIMIT} by default.`, { minimum: SURFACE_MIN_REGION, maximum: SURFACE_REGION_MAX }),
      },
      ['box'],
    ),
  ],
  'The region of the scan to wrap: its vertices by number (as the Magic Wand takes them); { marked: true }; or { box, normal?, exclude?, limit? }.',
)

export const freeformWrap: Command<{
  region: RegionIn
  density?: WrapDensity
  closure?: WrapClosure
  axis?: { dir: Vec3; radius?: number }
  name?: string
  steps?: number
  snap?: boolean
  iterations?: number
}> = {
  name: 'wrap',
  title: 'Wrap a freeform cage round a region of the scan',
  description:
    'Wrap Surface (Freeform ▸ Wrap): a region of the scan — the wall the Magic Wand took — is read as a cylinder (its axis from the surface normals, its radius from a circle fit across it, its extent along and round the axis), and a ring of quads is laid over it: 4, 8 or 16 quads round a full turn at Low, Medium or Fine, as many along as keep them about square. A region that goes all the way round gives a closed tube with two open ends; a part of a turn gives a ring closed with a chord across the part (closure "chord", QUICKSURFACE’s) or an open strip (closure "none"). The cage is set out so its limit lands on the wall, its vertices over the region are snapped to the scan, and it is added as a freeform feature that is refined `steps` times and, with snap (true unless given), taken onto the scan as QUICKSURFACE’s Snap Mode does. One undo step. Edit it with reverse.freeform.edit, thicken or offset it with reverse.freeform.convert. Returns the feature and its result, the fit (radius, axis, extent, sweep), the cage’s counts and its deviation from the scan before and after.',
  input: obj(
    {
      region: regionSchema,
      density: enumOf([...DENSITIES], 'Low (4 quads round), Medium (8) or Fine (16); Medium unless given.'),
      closure: enumOf([...CLOSURES], '"chord" closes a part-turn ring across the part, as QUICKSURFACE does; "none" leaves an open strip. chord unless given. A whole turn is always a tube.'),
      axis: obj({ dir: vec3('The axis direction, any length.'), radius: num('mm; fitted unless given.', { exclusiveMinimum: 0 }) }, ['dir'], 'Where the region’s own axis is wrong: a direction (and radius) to wrap round instead.'),
      name: str('The feature’s name; “Freeform n” when left out. Unique across sketches and features.', { minLength: 1 }),
      steps: int(`How many times the cage is refined before its faces are made; 2 unless given (1–${MAX_STEPS}).`, { minimum: 1, maximum: MAX_STEPS }),
      snap: bool('Take the refined surface onto the scan when it is built; true unless given.'),
      iterations: int('How many times the cage’s vertices are snapped to the scan, 1–100; 8 unless given.', { minimum: 1, maximum: 100 }),
    },
    ['region'],
  ),
  label: ({ name }) => `wrap freeform cage${typeof name === 'string' ? ` “${name}”` : ''}`,
  run: async ({ region, density = 'medium', closure = 'chord', axis, name, steps = 2, snap = true, iterations = 8 }) => {
    requireFreeName(name)
    const s = await ready()
    // The region: the vertices given, or read off the scan.
    let vertices: number[]
    if (Array.isArray(region)) {
      if (region.length < SURFACE_MIN_REGION) return invalid(`region: ${region.length} scan points — a wrap needs ${SURFACE_MIN_REGION} at least.`)
      vertices = region
    } else {
      vertices = await regionOf(region)
    }
    await s.syncScan()
    const scene = s.sceneRef.current
    const positions = scene?.scanPositions() ?? null
    const indices = scene?.scanIndices() ?? null
    if (!scene || !positions || !indices) throw new CommandError('unavailable', 'A wrap reads the scan as the viewport holds it — this needs the ScanRuler page with the scan shown.')
    const count = positions.length / 3
    if (vertices.some((v) => !Number.isInteger(v) || v < 0 || v >= count)) return invalid(`region: a vertex is not one of the scan’s ${count}.`)

    let wrap
    try {
      const normals = scanVertexNormals(positions, indices)
      const fit = fitWrap(positions, vertices, normals, axis)
      wrap = wrapCage(fit, density, closure)
    } catch (e) {
      if (e instanceof WrapError) return invalid(`Wrap: ${e.message}`)
      throw e
    }

    // The cage snapped over the region only: the chord closing the ring runs through the part and holds.
    const closest = regionClosest(wrap.fit, density, (() => {
      const paths = scanPaths(session())
      return (p: Vec3) => {
        const c = paths.closest(p)
        return c ? { point: c.point, distance: c.distance } : null
      }
    })())
    // Settled on the fitted cylinder first (the ring's limit falls inside it at the arc's ends), then taken onto the scan.
    let cage = settleWrap(wrap, density)
    const was = deviation(cage, closest, TOLERANCE_MM)
    let snapped: Json | null = null
    if (was.points > 0) {
      const r = snapCage(cage, closest, iterations, 0.01)
      cage = r.cage
      const now = deviation(cage, closest, TOLERANCE_MM)
      const show = (d: typeof was) => ({ points: d.points, missed: d.missed, rms: round3(d.rms), max: round3(d.max), within: d.within, fraction: d.points > 0 ? round3(d.within / d.points) : 0 })
      snapped = { iterations: r.stats.iterations, tolerance: TOLERANCE_MM, before: show(was), after: show(now) }
    }

    const before = bodyRows(s)
    const snapRegion = snapRegionOf(wrap.fit, density)
    const id = await change(() => re().addFreeform({ positions: Array.from(cage.positions), faces: cage.faces, creases: cage.creases, steps, snap, ...(snapRegion ? { snapRegion } : {}) }, name))
    const f = featureNamed(id) as FreeformFeature
    const f2 = wrap.fit
    return {
      ...madeOut(f),
      wrap: {
        density,
        closure: wrap.closure,
        around: wrap.around,
        along: wrap.along,
        quads: cage.faces.length,
        region: vertices.length,
        cylinder: { radius: round3(f2.axis.r), axis: [f2.axis.ax, f2.axis.ay, f2.axis.az].map(round3), point: [f2.axis.px, f2.axis.py, f2.axis.pz].map(round3), from: round3(f2.t0), to: round3(f2.t1) },
        sweepDeg: f2.closed ? 360 : round3((f2.sweep * 180) / Math.PI),
        closed: f2.closed,
      },
      ...(snapped ? { snapped } : {}),
      bodies: bodiesChanged(s, before),
    }
  },
}
