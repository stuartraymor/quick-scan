// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.extend (Extend Surface, F8 of audit-2026-11-07/FREEFORM_ROADMAP.md)
// in the document: a Fill on a gently curved noisy sheet run on past its
// edges in each type, grown by the offset, the sheet it was made from put out
// of view, thickened into a solid, saved and read back, undone and redone,
// and refused where it is no sheet of one whole patch. The run-on itself is
// compared with QUICKSURFACE's in reExtendSurface.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { refused, run, soupOf, startHeadless, stlBytes, undoLabels, type Headless } from '../../../tests/commandKit'
import { validateFeatureJson } from '../app/projectSection'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
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

interface Extended {
  feature: { id: number; name: string; kind: string; status: string }
  result: { status: string; message?: string }
  extend: { sheet: { id: number; name: string }; offset: number; type: string; sides: string[]; samples: number }
  bodies: unknown
}
interface Described { bodies: { id: number; name: string; volume: number; faces: number; surface?: boolean; closed: boolean; faceList: { area: number }[] }[] }
const describeBody = async (body: string) => (await run<Described>('reverse.body.describe', { body, edges: false })).bodies[0]
const areaOf = (b: Described['bodies'][number]) => b.faceList.reduce((sum, f) => sum + f.area, 0)

const extend = (input: unknown) => run<Extended>('reverse.freeform.extend', input)

const along = (a: Vec3, b: Vec3, n = 5): Vec3[] => Array.from({ length: n }, (_, i) => sheet(a[0] + ((b[0] - a[0]) * i) / (n - 1), a[1] + ((b[1] - a[1]) * i) / (n - 1)) as Vec3)
const uv = (u: number, v: number): Vec3 => [u, v, 0]
const cell = () => [
  { points: along(uv(0.2, 0.2), uv(0.8, 0.2)) },
  { points: along(uv(0.2, 0.8), uv(0.8, 0.8)) },
  { points: along(uv(0.2, 0.2), uv(0.2, 0.8)) },
  { points: along(uv(0.8, 0.2), uv(0.8, 0.8)) },
]
/** The patch: 60 × 48 mm, a Fill of the one-cell network. */
const plate = async () => {
  await run('reverse.network.create', { name: 'Loop', curves: cell(), fill: 'all' })
  await run('reverse.freeform.fill', { network: 'Loop', name: 'Plate' })
  return areaOf(await describeBody('Plate'))
}
const slab = (from: string) => run<{ result?: { status: string; message?: string } }>('reverse.feature.add', { feature: { kind: 'thicken', name: 'Slab', sheet: from, thickness: 2, side: 'out' } })

describe('reverse.freeform.extend', () => {
  it('runs a patch on past all its edges, puts the sheet it was made from out of view, and says what it did', async () => {
    const area = await plate()
    const r = await extend({ sheet: 'Plate', offset: 6, name: 'Longer' })
    expect(r.feature).toMatchObject({ kind: 'extend', name: 'Longer', status: 'ok' })
    expect(r.result.status, r.result.message).toBe('ok')
    expect(r.extend).toMatchObject({ offset: 6, type: 'natural', sides: ['u0', 'u1', 'v0', 'v1'], samples: 41 })
    const body = await describeBody('Longer')
    expect(body.surface).toBe(true)
    expect(body.faces).toBe(1)
    // 60 × 48 → about 72 × 60 (the sheet bows a little, so the sides read a little more).
    expect(areaOf(body)).toBeGreaterThan(area * 1.3)
    expect(areaOf(body)).toBeGreaterThan(72 * 60 * 0.97)
    expect(areaOf(body)).toBeLessThan(72 * 60 * 1.06)
    expect(undoLabels().at(-1)).toBe('Agent: extend surface “Longer”')
    expect(useReverse.getState().features.map((f) => f.kind)).toEqual(['network', 'fill', 'extend'])
    // The Plate is put out of view, as the native one is replaced.
    expect(useReverse.getState().hiddenBodies.length).toBeGreaterThan(0)
  })

  it('runs only the sides named, in each type', async () => {
    const area = await plate()
    for (const type of ['natural', 'soft', 'linear']) {
      const r = await extend({ sheet: 'Plate', offset: 6, type, sides: ['u1'], name: `One ${type}` })
      expect(r.extend).toMatchObject({ type, sides: ['u1'] })
      const a = areaOf(await describeBody(`One ${type}`))
      // One end run on by 6 mm: about a tenth (of 60 mm) or an eighth (of 48 mm) more.
      expect(a).toBeGreaterThan(area * 1.07)
      expect(a).toBeLessThan(area * 1.14)
    }
  })

  it('is one undo step, comes back redone, and is saved and read back', async () => {
    await plate()
    const r = await extend({ sheet: 'Plate', offset: 6, name: 'Longer' })
    const before = areaOf(await describeBody('Longer'))
    await run('history.undo')
    expect(useReverse.getState().features.some((f) => f.kind === 'extend')).toBe(false)
    await run('history.redo')
    expect(areaOf(await describeBody('Longer'))).toBeCloseTo(before, 6)
    const kept = useReverse.getState().features.find((f) => f.id === r.feature.id)
    expect(kept?.kind).toBe('extend')
    const json = JSON.parse(JSON.stringify(kept))
    expect(() => validateFeatureJson(json)).not.toThrow()
    expect(() => validateFeatureJson({ ...json, offset: 0 })).toThrow(/extend/)
    expect(() => validateFeatureJson({ ...json, type: 'wavy' })).toThrow(/extend/)
    expect(() => validateFeatureJson({ ...json, sides: [] })).toThrow(/extend/)
    expect(() => validateFeatureJson({ ...json, sides: ['u0', 'u0'] })).toThrow(/extend/)
    expect(() => validateFeatureJson({ ...json, samples: 3 })).toThrow(/extend/)
    expect(() => validateFeatureJson({ ...json, sheet: 1.5 })).toThrow(/extend/)
  })

  it('makes a sheet the Thicken takes: a solid of the right volume', async () => {
    await plate()
    await extend({ sheet: 'Plate', offset: 6, name: 'Longer' })
    const area = areaOf(await describeBody('Longer'))
    const out = await slab('Longer')
    expect(out.result?.status, out.result?.message).toBe('ok')
    const solid = await describeBody('Slab')
    expect(solid.surface).toBeFalsy()
    expect(solid.volume).toBeGreaterThan(area * 2 * 0.97)
    expect(solid.volume).toBeLessThan(area * 2 * 1.03)
  })

  it('can be run on again: an extension of an extension', async () => {
    const area = await plate()
    await extend({ sheet: 'Plate', offset: 4, name: 'First' })
    await extend({ sheet: 'First', offset: 4, name: 'Second' })
    const a = areaOf(await describeBody('Second'))
    // 60 × 48 → about 68 × 56 → 76 × 64.
    expect(a).toBeGreaterThan(area * 1.6)
    expect(a).toBeLessThan(area * 1.75)
  })

  it('refuses what is no sheet of one whole patch, or an extension that cannot be made', async () => {
    await plate()
    await extend({ sheet: 'Plate', offset: 6, name: 'Longer' })
    await slab('Longer')
    expect((await refused('reverse.freeform.extend', { sheet: 'Slab', offset: 3 })).message).toMatch(/solid/)
    expect((await refused('reverse.freeform.extend', { sheet: 'Nothing', offset: 3 })).message).toBeTruthy()
    expect((await refused('reverse.freeform.extend', { sheet: 'Plate', offset: 0 })).message).toBeTruthy()
    expect((await refused('reverse.freeform.extend', { sheet: 'Plate', offset: -2 })).message).toBeTruthy()
    expect((await refused('reverse.freeform.extend', { sheet: 'Plate', offset: 3, type: 'wavy' })).message).toBeTruthy()
    expect((await refused('reverse.freeform.extend', { sheet: 'Plate', offset: 3, sides: [] })).message).toBeTruthy()
    expect((await refused('reverse.freeform.extend', { sheet: 'Plate', offset: 3, sides: ['top'] })).message).toBeTruthy()
    expect((await refused('reverse.freeform.extend', { sheet: 'Plate', offset: 3, samples: 3 })).message).toBeTruthy()
    // Over half the sheet: the build refuses, and the feature says why.
    const far = await extend({ sheet: 'Plate', offset: 40, name: 'Far' })
    expect(far.result.status).not.toBe('ok')
    expect(far.result.message).toBeTruthy()
    expect(useReverse.getState().features.filter((f) => f.kind === 'extend')).toHaveLength(2)
  })
})
