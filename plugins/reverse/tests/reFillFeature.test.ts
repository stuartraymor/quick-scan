// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.fill (Fill Surface, F8 of audit-2026-11-07/FREEFORM_ROADMAP.md)
// in the document: a one-cell patch network on a gently curved noisy sheet —
// Quick Scan's 3D sketch — filled with a surface through its four curves,
// built and measured against the sheet, thickened into a solid, saved and
// read back, undone and redone, and refused where the region has not four
// sides. The scan is stood in for by the mesh drawn on, as reNetworkCommands
// does. The patch itself is compared with QUICKSURFACE's in reFillSurface.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { refused, run, soupOf, startHeadless, stlBytes, undoLabels, type Headless } from '../../../tests/commandKit'
import { validateFeatureJson } from '../app/projectSection'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { FILL_SIDES_REFUSAL } from '../core/fill'
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

interface Filled {
  feature: { id: number; name: string; kind: string; status: string }
  result: { status: string; message?: string }
  fill: { network: { id: number; name: string }; cell: number; regions: number; sides: number[]; grid: { rows: number; cols: number }; fromScan: { points: number; mean: number; max: number } | null; takenOntoScan: boolean }
  bodies: unknown
}
interface Described { bodies: { id: number; name: string; volume: number; faces: number; surface?: boolean; closed: boolean; faceList: { area: number }[] }[] }
const describeBody = async (body: string) => (await run<Described>('reverse.body.describe', { body, edges: false })).bodies[0]
const areaOf = (b: Described['bodies'][number]) => b.faceList.reduce((sum, f) => sum + f.area, 0)

const fill = (input: unknown) => run<Filled>('reverse.freeform.fill', input)

const along = (a: Vec3, b: Vec3, n = 5): Vec3[] => Array.from({ length: n }, (_, i) => sheet(a[0] + ((b[0] - a[0]) * i) / (n - 1), a[1] + ((b[1] - a[1]) * i) / (n - 1)) as Vec3)
const uv = (u: number, v: number): Vec3 => [u, v, 0]
/** One cell: two lines along u (v = 0.2, 0.8), two along v (u = 0.2, 0.8), meeting at four corners. */
const cell = () => [
  { points: along(uv(0.2, 0.2), uv(0.8, 0.2)) },
  { points: along(uv(0.2, 0.8), uv(0.8, 0.8)) },
  { points: along(uv(0.2, 0.2), uv(0.2, 0.8)) },
  { points: along(uv(0.8, 0.2), uv(0.8, 0.8)) },
]
/** A 2 × 2 network: four cells. */
const grid4 = () => {
  const L = [0.15, 0.5, 0.85]
  return [...L.map((v) => ({ points: L.map((u) => sheet(u, v)) })), ...L.map((u) => ({ points: L.map((v) => sheet(u, v)) }))]
}

describe('reverse.freeform.fill', () => {
  it('fills a four-sided region with a sheet through its curves, not taken onto the scan', async () => {
    await run('reverse.network.create', { name: 'Loop', curves: cell(), fill: 'all' })
    const r = await fill({ network: 'Loop', name: 'Plate' })
    expect(r.feature).toMatchObject({ kind: 'fill', name: 'Plate', status: 'ok' })
    expect(r.result.status, r.result.message).toBe('ok')
    expect(r.fill).toMatchObject({ network: { name: 'Loop' }, cell: 0, regions: 1, takenOntoScan: false, grid: { rows: 41, cols: 41 } })
    expect(r.fill.sides).toHaveLength(4)
    // The curves are 60 and 48 mm across (the sheet bows a little): the sides read about that.
    expect(Math.min(...r.fill.sides)).toBeGreaterThan(47)
    expect(Math.max(...r.fill.sides)).toBeLessThan(65)
    // A gentle sheet: the blend of the curves lies on it to a fraction of a millimetre, as it was not snapped to it.
    expect(r.fill.fromScan!.max).toBeLessThan(0.5)
    const body = await describeBody('Plate')
    expect(body.surface).toBe(true)
    expect(body.faces).toBe(1)
    expect(areaOf(body)).toBeGreaterThan(60 * 48 * 0.97)
    expect(areaOf(body)).toBeLessThan(60 * 48 * 1.06)
    expect(undoLabels().at(-1)).toBe('Agent: fill surface “Plate”')
    // The network is as it was.
    expect(useReverse.getState().features.map((f) => f.kind)).toEqual(['network', 'fill'])
  })

  it('is one undo step, comes back redone, and is saved and read back', async () => {
    await run('reverse.network.create', { name: 'Loop', curves: cell(), fill: 'all' })
    const r = await fill({ network: 'Loop', name: 'Plate' })
    const before = areaOf(await describeBody('Plate'))
    await run('history.undo')
    expect(useReverse.getState().features.some((f) => f.kind === 'fill')).toBe(false)
    await run('history.redo')
    expect(areaOf(await describeBody('Plate'))).toBeCloseTo(before, 6)
    const kept = useReverse.getState().features.find((f) => f.id === r.feature.id)
    expect(kept?.kind).toBe('fill')
    const json = JSON.parse(JSON.stringify(kept))
    expect(() => validateFeatureJson(json)).not.toThrow()
    expect(() => validateFeatureJson({ ...json, rows: 3 })).toThrow(/fill/)
    expect(() => validateFeatureJson({ ...json, points: json.points.slice(3) })).toThrow(/fill/)
    expect(() => validateFeatureJson({ ...json, points: json.points.map((x: number, i: number) => (i === 7 ? null : x)) })).toThrow(/fill/)
  })

  it('makes a sheet the Thicken takes: a solid of the right volume', async () => {
    await run('reverse.network.create', { name: 'Loop', curves: cell(), fill: 'all' })
    await fill({ network: 'Loop', name: 'Plate' })
    const area = areaOf(await describeBody('Plate'))
    const out = await run<{ result?: { status: string; message?: string } }>('reverse.feature.add', { feature: { kind: 'thicken', name: 'Slab', sheet: 'Plate', thickness: 2, side: 'out' } })
    expect(out.result?.status, out.result?.message).toBe('ok')
    const slab = await describeBody('Slab')
    expect(slab.surface).toBeFalsy()
    expect(slab.volume).toBeGreaterThan(area * 2 * 0.97)
    expect(slab.volume).toBeLessThan(area * 2 * 1.03)
  })

  it('takes a cell by number where the network closes several, and says how many', async () => {
    await run('reverse.network.create', { name: 'Hood', curves: grid4(), fill: 'all' })
    expect((await refused('reverse.freeform.fill', { network: 'Hood' })).message).toMatch(/closes 4 regions: give `cell`/)
    expect((await refused('reverse.freeform.fill', { network: 'Hood', cell: 9 })).message).toMatch(/no region 9/)
    const r = await fill({ network: 'Hood', cell: 2, name: 'Quarter' })
    expect(r.fill).toMatchObject({ cell: 2, regions: 4 })
    const body = await describeBody('Quarter')
    // A quarter of the 70 × 56 mm patch.
    expect(areaOf(body)).toBeGreaterThan(35 * 28 * 0.95)
    expect(areaOf(body)).toBeLessThan(35 * 28 * 1.1)
  })

  it('refuses what is not a four-sided region of a patch network', async () => {
    const triangle: Vec3[][] = [along(uv(0.2, 0.2), uv(0.8, 0.2)), along(uv(0.8, 0.2), uv(0.5, 0.8)), along(uv(0.5, 0.8), uv(0.2, 0.2))]
    await run('reverse.network.create', { name: 'Tri', curves: triangle.map((points) => ({ points })), fill: 'all' })
    const three = await refused('reverse.freeform.fill', { network: 'Tri' })
    expect(three.message).toContain(FILL_SIDES_REFUSAL.slice(0, 40))
    await run('reverse.freeform.create', { obj: ['v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0', 'f 1 2 3 4'].join(String.fromCharCode(10)), name: 'Plain' })
    expect((await refused('reverse.freeform.fill', { network: 'Plain' })).message).toMatch(/not a patch network/)
    expect((await refused('reverse.freeform.fill', { network: 'Nothing' })).message).toBeTruthy()
    expect((await refused('reverse.freeform.fill', { network: 'Tri', samples: 3 })).message).toBeTruthy()
    expect(useReverse.getState().features.filter((f) => f.kind === 'fill')).toHaveLength(0)
  })
})
