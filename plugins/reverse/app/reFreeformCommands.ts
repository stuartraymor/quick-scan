// SPDX-License-Identifier: AGPL-3.0-only
// The freeform cage through the commands (F0): a quad OBJ — QUICKSURFACE's
// "Freeform surfaces as quads" export, or one of our own — read into a
// cage, its surface refined and, with a scan open, snapped to it and
// measured; and written back out, refined or not. Stateless: the cage
// lives in the document from F3 on (FREEFORM_ROADMAP.md).

import { invalid } from '../../../src/commands/core/common'
import { bool, int, obj, str } from '../../../src/commands/schema'
import { round3 } from '../../../src/core/round'
import type { Vec3 } from '../../../src/core/types'
import type { Command } from '../../../src/plugins/api'
import { bounds, type Cage, type CageTopology, faceArea, faceKinds, topology, vertexCount } from '../core/freeform/cage'
import { parseQuadObj, writeQuadObj } from '../core/freeform/cageIO'
import { DEFAULT_LIMIT_STEPS, limitMesh } from '../core/freeform/limit'
import { snapMesh } from '../core/freeform/snap'
import { subdivided } from '../core/freeform/subdivide'
import { session } from './reCommandCore'
import { scanPaths } from './reNetworkCommands'

const MAX_STEPS = 5
/** How far a surface vertex may be taken onto the scan: the cage's longest side. */
const stats = (a: number[]) => {
  const n = a.length
  if (n === 0) return { n: 0 }
  const abs = a.map(Math.abs).sort((x, y) => x - y)
  return { n, rms: round3(Math.sqrt(a.reduce((s, x) => s + x * x, 0) / n)), p95: round3(abs[Math.floor(0.95 * (n - 1))]), max: round3(abs[n - 1]) }
}

const objIn = str('The cage as a quad OBJ: v lines and f lines (any polygon, quads as a rule); "# crease a b" lines (1-based) mark creases.')

function read(objText: string): { cage: Cage; t: CageTopology } {
  const cage = ((): Cage => {
    try {
      return parseQuadObj(objText)
    } catch (e) {
      return invalid(`The OBJ could not be read as a cage: ${(e as Error).message}`) as never
    }
  })()
  const t = ((): CageTopology => {
    try {
      return topology(cage)
    } catch (e) {
      return invalid(`The cage is broken: ${(e as Error).message}`) as never
    }
  })()
  return { cage, t }
}

export const cageRead: Command<{ obj: string; steps?: number; snap?: boolean }> = {
  name: 'cage_read',
  title: 'Read a freeform cage',
  description:
    'A freeform cage — a quad OBJ as QUICKSURFACE exports its Freeform surfaces, or as reverse.freeform.cage_write writes one — read and measured: vertices, faces (quads, triangles, larger polygons), edges, boundary edges, creases, closed (every edge between two faces), valences, bounds and the faces’ flat area; its surface refined `steps` times (3 unless given, 1–5) with the subdivision limit masks — limit: vertices, faces, area; and, with a scan open and snap true, that surface snapped onto the scan (each vertex to the scan’s nearest point, as the Freeform’s Snap Mode does): snapped: how far the vertices moved (rms, p95, max, mm), how many found no scan, and offScan — how far the unsnapped surface lay off the scan. Changes nothing.',
  input: obj({ obj: objIn, steps: int('How many times the cage is refined before the limit masks; 3 unless given.', { minimum: 1, maximum: MAX_STEPS }), snap: bool('Snap the refined surface onto the open scan and measure it.') }, ['obj']),
  readOnly: true,
  run: async ({ obj: objText, steps = DEFAULT_LIMIT_STEPS, snap = false }) => {
    const { cage, t } = read(objText)
    const valences = [...new Set(t.vertexEdges.map((e) => e.length))].sort((a, b) => a - b)
    const lm = limitMesh(cage, steps)
    const limit = { vertices: lm.positions.length / 3, faces: lm.faces.length, area: round3(faceArea({ positions: lm.positions, faces: lm.faces, creases: [] })) }
    const b = bounds(cage)
    const out: Record<string, unknown> = {
      vertices: vertexCount(cage),
      faces: cage.faces.length,
      ...faceKinds(cage),
      edges: t.edges.length,
      boundaryEdges: t.edges.filter((e) => e.faces.length < 2).length,
      creases: cage.creases.length,
      closed: t.closed,
      valences,
      bounds: { min: b.min.map(round3), max: b.max.map(round3) },
      area: round3(faceArea(cage)),
      steps,
      limit,
    }
    if (snap) {
      const paths = scanPaths(session())
      const off: number[] = []
      const snapped = snapMesh(lm, (p: Vec3) => {
        const c = paths.closest(p)
        if (!c) return null
        off.push(c.distance)
        return c.point
      })
      const moved = Array.from(snapped.moved).filter((m) => Number.isFinite(m))
      out.offScan = stats(off)
      out.snapped = { moved: stats(moved), missed: snapped.missed, area: round3(faceArea({ positions: snapped.positions, faces: lm.faces, creases: [] })) }
    }
    return out
  },
}

export const cageWrite: Command<{ obj: string; steps?: number }> = {
  name: 'cage_write',
  title: 'Write a freeform cage',
  description:
    'A freeform cage read from a quad OBJ and written back as one — every vertex at full precision, faces whole, creases as "# crease a b" lines — refined `steps` times first where given (0 unless given: the cage as it is). What QUICKSURFACE loads with From quad OBJ. Changes nothing.',
  input: obj({ obj: objIn, steps: int('How many Catmull–Clark steps before writing; 0 unless given.', { minimum: 0, maximum: MAX_STEPS }) }, ['obj']),
  readOnly: true,
  run: async ({ obj: objText, steps = 0 }) => {
    const { cage } = read(objText)
    const fine = subdivided(cage, steps)
    return { vertices: vertexCount(fine), faces: fine.faces.length, creases: fine.creases.length, obj: writeQuadObj(fine, steps > 0 ? `Quick Scan freeform cage, refined ${steps}×` : 'Quick Scan freeform cage') }
  },
}
