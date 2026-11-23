// SPDX-License-Identifier: AGPL-3.0-only
// Randomised stress test of Auto Fillet and Fixed Size Fillet between a line
// and an arc and between two arcs. Each case is built from its answer: a
// round of known radius, and two carriers (lines, or circles inside or
// outside which the round sits) tangent to it at random points. The section
// runs along one carrier, round the fillet and along the other, sampled as
// coarsely or finely as a mesh is, with or without noise. The sketch pieces
// lie on the carriers and stop anywhere: far short of the corner, at it, or
// past it. Each is swept as a user sweeps, and the result is checked
// against the round it was built from.
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { anchorPoint, entityOf, type SketchArc } from '../core/sketch'
import { sweepCornerTrim, type CornerTrimOptions } from '../core/sketchCornerTrim'
import { SweepArea } from '../core/cornerSweep'

import { dist, makeCase } from './cornerCaseGenerator'

describe('Auto Fillet between lines and arcs: randomised corners', () => {
  // Async, yielding now and then: a long synchronous run blocks the worker and
  // vitest's progress messages time out under a loaded full run.
  it('300 corners, swept two ways, Auto and Fixed', async () => {
    const rows: { id: string; ok: boolean; problem?: string }[] = []
    let built = 0
    for (let seed = 1; built < 300 && seed < 2000; seed++) {
      const c = makeCase(seed)
      const g = c.build()
      if (!g) continue
      built++
      if (built % 10 === 0) await new Promise((r) => setTimeout(r, 0))
      const sweeps: Record<string, Vec2[]> = { stroke: [g.nears[0], g.corner, g.nears[1]], wide: [g.nears[0], [g.corner[0] + 0.2, g.corner[1] + 0.2], g.corner, g.nears[1]] }
      // Over the two ends only: the corner point painted or not decides, as between lines.
      const ends: Vec2[] = [g.nears[0], g.nears[1]]
      if (new SweepArea({ path: ends, radius: 0.3 }).distance(g.corner) > 0) {
        const { result } = sweepCornerTrim(g.s, { path: ends, radius: 0.3 }, { mode: 'autoFillet', radiusMm: 1, addDimension: true }, [], [g.chain])
        const filleted = result.ok && result.sketch.entities.some((e) => e.kind === 'arc' && !g.ids.includes(e.id))
        rows.push({ id: `${c.id} endsOnly auto`, ok: result.ok && !filleted && result.unswept === true, problem: result.ok ? (filleted ? 'filleted without the corner point' : result.unswept ? undefined : 'not marked unswept') : `refused: ${result.error}` })
      }
      for (const [how, path] of Object.entries(sweeps)) {
        for (const mode of ['auto', 'fixed'] as const) {
          const options: CornerTrimOptions = mode === 'auto' ? { mode: 'autoFillet', radiusMm: 1, addDimension: true } : { mode: 'fixedFillet', radiusMm: c.r, addDimension: true }
          const row = { id: `${c.id} ${how} ${mode}`, ok: true as boolean, problem: undefined as string | undefined }
          const { result } = sweepCornerTrim(g.s, { path, radius: 0.3 }, options, [], [g.chain])
          if (!result.ok) { row.ok = false; row.problem = `refused: ${result.error}` }
          else {
            const arc = result.sketch.entities.find((e): e is SketchArc => e.kind === 'arc' && !g.ids.includes(e.id))
            if (!arc) { row.ok = false; row.problem = `no fillet (${result.shape ?? 'sharp'})` }
            else {
              const tol = mode === 'fixed' ? 1e-9 : c.noise ? 0.04 * c.r + 4 * c.noise : 2e-3 * c.r + 1e-4
              if (Math.abs(arc.r - c.r) > tol) { row.ok = false; row.problem = `radius ${arc.r.toFixed(4)} vs ${c.r.toFixed(4)}` }
              for (const f of result.farAnchors) if (dist(anchorPoint(entityOf(result.sketch, f.anchor.entity)!, f.anchor.at), f.to) > 1e-6) { row.ok = false; row.problem = 'far end moved' }
              const ends = [anchorPoint(arc, 'a'), anchorPoint(arc, 'b')]
              for (const id of g.ids) { const e = entityOf(result.sketch, id)!; if (!(['a', 'b'] as const).some((k) => ends.some((q) => dist(anchorPoint(e, k), q) < 1e-6))) { row.ok = false; row.problem = 'gap at a tangent point' } }
            }
          }
          rows.push(row)
        }
      }
    }
    const bad = rows.filter((r) => !r.ok)
    console.log(`Curve fillet stress: ${rows.length} cases on ${built} corners, ${bad.length} failed`)
    for (const r of bad.slice(0, 30)) console.log(' ✗', r.id, '—', r.problem)
    expect(built).toBeGreaterThanOrEqual(300)
    expect(bad.map((r) => `${r.id}: ${r.problem}`)).toEqual([])
  }, 300_000)
})
