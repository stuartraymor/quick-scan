// SPDX-License-Identifier: AGPL-3.0-only
// QUICKSURFACE's Auto Freeform cages on basic_part, as its project holds
// them (QUICKSCAN_FIXTURES/qsf/native-preserved.qsf, a user's model): two of
// them, open, end in a tiny corner quad where the limit surface's edge hooks
// back on itself within a millimetre. No smooth face follows that quad's
// samples at any size, and refined once more the cage is over the sampling
// cap — so before 0.0.206 the body was refused ("does not follow … refined
// 4 times it is more than 600000 quads"). Refined no further, such a piece
// is now cut to its cells, each a bilinear face that cannot swing off its
// samples; the body is made, valid, and covers what its neighbours do.
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fixture } from '../../../tests/fixtures'
import { readQsfContainer } from '../core/qsfContainer'
import { decodeQsfSurface } from '../core/qsfSurface'
import { freeformBody } from '../core/freeform/make'
import { patchesBody } from '../core/freeform/convert'
import { cagePatches } from '../core/freeform/patches'
import { ReKernel } from '../core/kernel'

vi.setConfig({ testTimeout: 600_000 })
const model = fixture('qsf/native-preserved.qsf')

describe.skipIf(!model.exists)('an open cage with a folded corner quad', () => {
  let k: ReKernel
  const cages = new Map<string, { positions: Float64Array; faces: number[][]; creases: [number, number][] }>()
  beforeAll(async () => {
    k = await ReKernel.load()
    for (const r of readQsfContainer(new Uint8Array(readFileSync(model.path))).records.filter(x => x.type === 7)) {
      const c = decodeQsfSurface(r.bytes)
      cages.set(c.name, { positions: Float64Array.from(c.vertices), faces: c.quads.map(q => [...q]), creases: [] })
    }
  })

  // The closed Auto Freeform(1) of the same part, built the same way,
  // covers 109,658.6 mm² (0.0.206); each cage is built in a test of its own,
  // so no one test holds the worker for long.
  const CLOSED_AREA = 109_658.6
  for (const name of ['Auto Freeform', 'Auto Freeform(3)']) {
    it(`${name} is made a valid body where it was refused, covering what the closed one does`, () => {
      const made = freeformBody(k, cages.get(name)!, { steps: 3, snap: false })
      expect(made.steps).toBe(3)
      expect(made.report.valid).toBe(true)
      expect(Math.abs(made.report.area / CLOSED_AREA - 1)).toBeLessThan(0.01)
      k.release(made.shape)
    })
  }

  it('only the corner quads need cells, and only when asked: without, the same blocks are refused', () => {
    const cage = cages.get('Auto Freeform(3)')!
    const valence = new Map<number, number>()
    for (const f of cage.faces) for (const v of f) valence.set(v, (valence.get(v) ?? 0) + 1)
    // A quad with two corners of the cage on it (vertices no other quad has).
    const corner = new Set(cage.faces.flatMap((f, i) => (f.filter(v => valence.get(v) === 1).length >= 2 ? [i] : [])))
    const p = cagePatches(cage, 3)
    const picked = p.grids.flatMap((g, i) => (p.blocks[i].faces.some(fi => corner.has(fi)) ? [{ g, b: p.blocks[i] }] : []))
    expect(picked.length).toBeGreaterThan(0)
    const set = { grids: picked.map(x => x.g), closed: false, blocks: picked.map(x => ({ rows: x.b.rows, cols: x.b.cols, faces: x.b.faces })) }
    expect(() => patchesBody(k, set)).toThrow(/does not follow/)
    const made = patchesBody(k, set, true)
    expect(made.report.valid).toBe(true)
    expect(made.report.faces).toBeGreaterThan(picked.length)
    k.release(made.shape)
  })
})
