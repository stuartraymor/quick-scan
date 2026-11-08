// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.from_sketch (F5 of audit-2026-11-07/FREEFORM_ROADMAP.md) in
// the document: a 2 × 2 patch network on a gently curved noisy sheet — Quick
// Scan's 3D sketch — made a freeform cage at Resolution 1 and 2, built and
// measured against the sheet, made anew after a curve is taken out, refused
// where the curves close nothing, undone. The scan is stood in for by the
// mesh drawn on, as reNetworkCommands does.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { refused, run, soupOf, startHeadless, stlBytes, undoLabels, type Headless } from '../../../tests/commandKit'
import { validateFeatureJson } from '../app/projectSection'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { SKETCH_REFUSAL } from '../core/freeform/sketch'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { gridScan } from './networkMeshes'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 300_000 })

const sheet = (u: number, v: number): Vec3 => [100 * u, 80 * v, 3 * Math.sin(2 * u) * Math.cos(v)]
const mesh = gridScan(120, 96, sheet, { noise: 0.01 })
const scene = { scanPositions: () => mesh.positions, scanIndices: () => Uint32Array.from(mesh.indices) } as unknown as SceneManager

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: scene }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(soupOf(mesh)), name: 'sheet.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

interface Sketched {
  feature: { id: number; name: string; kind: string; status: string }
  result: { status: string; message?: string }
  body?: { faces: number; solid: boolean; valid: boolean; area: number }
  sketch: { network: { id: number; name: string }; resolution: number; regions: number; quads: number; vertices: number; rebuilt: boolean; refusedCount?: number; refused?: { message: string }[] }
  snapped?: { before: { rms: number; max: number }; after: { rms: number; max: number; points: number; within: number } }
}

const U = [0.15, 0.5, 0.85]
const V = [0.15, 0.5, 0.85]
/** A 2 × 2 grid as an agent writes it: the three lines along u, then the three along v. */
const grid = () => [...V.map((v) => ({ points: U.map((u) => sheet(u, v)) })), ...U.map((u) => ({ points: V.map((v) => sheet(u, v)) }))]
const sketch = (input: unknown) => run<Sketched>('reverse.freeform.from_sketch', input)

describe('reverse.freeform.from_sketch', () => {
  it('lays a cage over every region a 2 × 2 network closes, welded along the curves they share', async () => {
    await run('reverse.network.create', { name: 'Hood', curves: grid(), fill: 'all' })
    const r = await sketch({ network: 'Hood', name: 'Sketched' })
    expect(r.feature).toMatchObject({ kind: 'freeform', name: 'Sketched', status: 'ok' })
    expect(r.sketch).toMatchObject({ network: { name: 'Hood' }, resolution: 1, regions: 4, quads: 16, vertices: 25, rebuilt: false })
    // Taken onto the scan: the snap brought the cage's points to within the scan's noise.
    expect(r.snapped!.after.rms).toBeLessThan(0.05)
    expect(r.snapped!.after.max).toBeLessThan(r.snapped!.before.max)
    // The body: one sheet over the 70 × 56 mm patch, a little more for the curve.
    expect(r.result.status, r.result.message).toBe('ok')
    expect(r.body!.valid).toBe(true)
    expect(r.body!.area).toBeGreaterThan(70 * 56 * 0.97)
    expect(r.body!.area).toBeLessThan(70 * 56 * 1.06)
    expect(undoLabels().at(-1)).toBe('Agent: freeform cage from 3D sketch “Sketched”')
    // It remembers its network and Resolution, and saves and loads with them.
    const kept = useReverse.getState().features.find((x) => x.id === r.feature.id)
    expect(kept && kept.kind === 'freeform' && kept.fromSketch).toEqual({ network: r.sketch.network.id, resolution: 1 })
    expect(() => validateFeatureJson(JSON.parse(JSON.stringify(kept)))).not.toThrow()
    expect(() => validateFeatureJson({ ...JSON.parse(JSON.stringify(kept)), fromSketch: { network: 1, resolution: 9 } })).toThrow(/fromSketch/)
    // The network is as it was: still there, still its own feature.
    expect(useReverse.getState().features.map((f) => f.kind)).toEqual(['network', 'freeform'])
  })

  it('cuts each quad 2 × 2 at each Resolution', async () => {
    await run('reverse.network.create', { name: 'Hood', curves: grid(), fill: 'all' })
    const two = await sketch({ network: 'Hood', resolution: 2 })
    expect(two.sketch).toMatchObject({ resolution: 2, regions: 4, quads: 64, vertices: 81 })
    expect(two.result.status).toBe('ok')
    const three = await sketch({ network: 'Hood', resolution: 3 })
    expect(three.sketch).toMatchObject({ quads: 256, vertices: 289 })
  })

  it('makes the cage anew from the curves after one is taken out, in one undo step', async () => {
    const made = await run<{ curves: number[][] }>('reverse.network.create', { name: 'Hood', curves: grid(), fill: 'all' })
    const first = await sketch({ network: 'Hood', name: 'Sketched' })
    expect(first.sketch.quads).toBe(16)
    // A boundary curve taken out opens its region: three remain.
    await run('reverse.network.edit', { feature: 'Hood', remove: { curves: [made.curves[0][0]] } })
    const steps = undoLabels().length
    const again = await sketch({ feature: 'Sketched' })
    expect(again.feature).toMatchObject({ id: first.feature.id, name: 'Sketched' })
    expect(again.sketch).toMatchObject({ rebuilt: true, regions: 3, quads: 12, resolution: 1, refusedCount: 1 })
    expect(again.sketch.refused![0].message).toMatch(/not closed|open|no curves/)
    expect(undoLabels().length).toBe(steps + 1)
    expect(undoLabels().at(-1)).toBe('Agent: rebuild freeform cage from its sketch')
    expect(useReverse.getState().features.filter((f) => f.kind === 'freeform')).toHaveLength(1)
  })

  it('refuses a sketch that closes no region in QUICKSURFACE’s words, and what is not a network', async () => {
    const made = await run<{ curves: number[][] }>('reverse.network.create', { name: 'Hood', curves: grid(), fill: 'all' })
    // The outer curves taken out: the two lines through the middle close nothing.
    const outer = [0, 2, 3, 5].flatMap((i) => made.curves[i])
    await run('reverse.network.edit', { feature: 'Hood', remove: { curves: outer } })
    const none = await refused('reverse.freeform.from_sketch', { network: 'Hood' })
    expect(none.message).toContain(SKETCH_REFUSAL)
    expect(useReverse.getState().features.filter((f) => f.kind === 'freeform')).toHaveLength(0)

    await run('reverse.freeform.create', { obj: ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'f 1 2 3 4'].join(String.fromCharCode(10)), name: 'Plain' })
    expect((await refused('reverse.freeform.from_sketch', { network: 'Plain' })).message).toMatch(/not a patch network/)
    expect((await refused('reverse.freeform.from_sketch', { feature: 'Plain' })).message).toMatch(/not made from a sketch/)
    expect((await refused('reverse.freeform.from_sketch', {})).message).toMatch(/Name the patch network/)
    expect((await refused('reverse.freeform.from_sketch', { network: 'Hood', resolution: 5 })).message).toBeTruthy()
    expect((await refused('reverse.freeform.from_sketch', { network: 'Nothing' })).message).toBeTruthy()
  })
})
