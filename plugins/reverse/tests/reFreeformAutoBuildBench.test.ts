// SPDX-License-Identifier: AGPL-3.0-only
// How long the CAD body of an Auto Freeform cage takes to build, measured: a
// cage and its scan given as OBJ files by AUTO_BENCH_CAGE and AUTO_BENCH_SCAN.
// Skipped where they are not given; it asserts nothing but that a body is made.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import type { Cage } from '../core/freeform/cage'
import { freeformBody } from '../core/freeform/make'
import { cagePatches } from '../core/freeform/patches'
import { ReKernel } from '../core/kernel'

vi.setConfig({ testTimeout: 3_600_000 })
const CAGE = process.env.AUTO_BENCH_CAGE
const SCAN = process.env.AUTO_BENCH_SCAN

function readObj(file: string) {
  const pos: number[] = []
  const faces: number[][] = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('v ')) { const p = line.trim().split(/\s+/); pos.push(+p[1], +p[2], +p[3]) }
    else if (line.startsWith('f ')) faces.push(line.trim().split(/\s+/).slice(1).map((s) => parseInt(s, 10) - 1))
  }
  return { pos, faces }
}

describe.skipIf(!CAGE || !SCAN)('Auto Freeform cage to CAD body, timed', () => {
  it('builds with and without the snap', async () => {
    const c = readObj(CAGE!)
    const s = readObj(SCAN!)
    const cage: Cage = { positions: Float64Array.from(c.pos), faces: c.faces, creases: [] }
    const paths = new ScanPaths(Float32Array.from(s.pos), Uint32Array.from(s.faces.flat()))
    const closest = (p: [number, number, number]) => { const q = paths.closest(p); return q ? { point: q.point, distance: q.distance } : null }
    const k = await ReKernel.load()
    let t = performance.now()
    const patches = cagePatches(cage, 2, (_fine, limit) => limit)
    const sizes = patches.blocks.map((b) => b.faces.length).sort((a, b) => b - a)
    console.info(`cagePatches(2): ${(performance.now() - t).toFixed(0)} ms, ${patches.blocks.length} blocks for ${cage.faces.length} quads; largest ${sizes.slice(0, 5).join(', ')}; single-quad blocks ${sizes.filter((n) => n === 1).length}`)
    for (const snap of (process.env.AUTO_BENCH_MODES ?? 'false,true').split(',').map((m) => m === 'true')) {
      t = performance.now()
      const made = freeformBody(k, cage, { steps: Number(process.env.AUTO_BENCH_STEPS ?? 2), snap, closest: closest as never })
      console.info(`freeformBody snap=${snap}: ${((performance.now() - t) / 1000).toFixed(1)} s, steps ${made.steps}, ${made.report.faces} faces, valid ${made.report.valid}, solid ${made.report.solid}, blocks ${made.report.blocks}, samples ${made.report.samples}`)
      expect(made.report.faces).toBeGreaterThan(0)
      k.release(made.shape)
    }
  })
})
