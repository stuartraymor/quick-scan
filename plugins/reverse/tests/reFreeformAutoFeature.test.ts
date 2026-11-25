// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.auto in the document: a closed sphere scan made a quad
// cage at Low/Medium/Fine-style targets by either algorithm, fitted, built
// into a body, undone, and refused where the input is wrong.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { refused, run, soupOf, startHeadless, stlBytes, undoLabels, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { AUTO_TARGETS, DETAIL_FACTOR } from '../core/freeform/autoFreeform'
import { ReClient } from '../core/reClient'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { sphereScan } from './networkMeshes'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 300_000 })

const mesh = sphereScan(30, 0.01, 5)
const scene = { scanPositions: () => mesh.positions, scanIndices: () => Uint32Array.from(mesh.indices) } as unknown as SceneManager

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: scene }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(soupOf(mesh)), name: 'sphere.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

interface Made {
  feature: { id: number; name: string; kind: string; status: string }
  result: { status: string; message?: string }
  body?: { faces: number; solid: boolean; valid: boolean; area: number; volume?: number }
  auto: { algorithm: string; target: number; quads: number; vertices: number; irregular: number; meanEdge: number; closed: boolean; boundaryEdges: number; pieces: number; refined: number; symmetry: string; symmetric: { vertices: number; onPlane: number } | null }
  bodies: { count: number; changed?: { id: number }[] }
  fitted: { iterations: number; tolerance: number; rms: number; max: number; points: number; within: number; fraction: number }
  ms: Record<string, number>
}
const auto = (input: unknown) => run<Made>('reverse.freeform.auto', input)

describe('reverse.freeform.auto', () => {
  it('lays a closed cage over the scan at the density asked, fitted to it, one undo step', async () => {
    const r = await auto({ algorithm: 'basic', quads: 300, name: 'Auto' })
    expect(r.feature).toMatchObject({ kind: 'freeform', name: 'Auto', status: 'ok' })
    expect(r.auto).toMatchObject({ algorithm: 'basic', target: 300, closed: true, boundaryEdges: 0, pieces: 1, refined: 0 })
    expect(Math.abs(r.auto.quads - 300) / 300).toBeLessThan(0.1)
    // A closed quad surface of sphere topology: V − E + F = 2 with E = 2F.
    expect(r.auto.vertices).toBe(r.auto.quads + 2)
    // The fitted surface lies on the scan: a sphere of radius 30 with a hundredth of noise.
    expect(r.fitted.rms).toBeLessThan(0.08)
    expect(r.fitted.max).toBeLessThan(0.6)
    expect(r.fitted.fraction).toBeGreaterThan(0.5)
    expect(Object.keys(r.ms)).toEqual(['prepare', 'layout', 'fit', 'refine', 'measure'])
    // The body built from it is a valid solid about the sphere's volume (4/3 π 30³ ≈ 113 097; the cage is a little inside).
    expect(r.result.status, r.result.message).toBe('ok')
    expect(r.body!.valid).toBe(true)
    expect(r.body!.solid).toBe(true)
    expect(r.body!.area).toBeGreaterThan(4 * Math.PI * 900 * 0.9)
    expect(r.body!.area).toBeLessThan(4 * Math.PI * 900 * 1.1)
    expect(undoLabels().at(-1)).toBe('Agent: auto freeform “Auto”')
    // Convert to CAD: the STEP file is read back and is a valid solid.
    const step = await run<{ verify: { ok: boolean } }>('reverse.export.step', { bodies: [r.bodies.changed![0].id], verify: true })
    expect(step.verify.ok).toBe(true)
    expect(useReverse.getState().features.filter((f) => f.kind === 'freeform')).toHaveLength(1)
  })

  it('takes Low as QUICKSURFACE’s 1000 (Medium 2000 and Fine 4000 are the same table; the body build of a cage that size takes tens of seconds, so they are checked in the core tests)', async () => {
    expect(AUTO_TARGETS).toEqual({ low: 1000, medium: 2000, fine: 4000 })
    const low = await auto({ algorithm: 'basic', density: 'low', steps: 1, snap: false })
    expect(low.auto.target).toBe(1000)
    expect(Math.abs(low.auto.quads - 1000) / 1000).toBeLessThan(0.05)
  })

  it('Feature aligned is the default, and gives more quads than the target by Feature Details; Refine to tolerance adds more', async () => {
    const r = await auto({ quads: 200, steps: 1, snap: false })
    expect(r.auto.algorithm).toBe('feature')
    expect(Math.abs(r.auto.quads - 200 * DETAIL_FACTOR.balanced) / (200 * DETAIL_FACTOR.balanced)).toBeLessThan(0.12)
    const low = await auto({ quads: 200, details: 'low', steps: 1, snap: false })
    expect(low.auto.quads).toBeLessThan(r.auto.quads)
    const refined = await auto({ algorithm: 'basic', quads: 200, refineTolerance: 0.005, steps: 1, snap: false })
    expect(refined.auto.refined).toBeGreaterThan(0)
    expect(refined.auto.quads).toBeGreaterThan(230)
  })

  it('symmetry makes the stored cage exactly mirror-symmetric after the fit, and says so', async () => {
    const r = await auto({ algorithm: 'basic', quads: 300, symmetry: 'oyz', steps: 1, snap: false, name: 'Mirrored' })
    expect(r.auto).toMatchObject({ symmetry: 'oyz', closed: true })
    expect(r.auto.symmetric!.onPlane).toBeGreaterThan(4)
    const f = useReverse.getState().features.find((x) => x.kind === 'freeform' && x.name === 'Mirrored') as unknown as { positions: number[] }
    const pts: number[][] = []
    for (let i = 0; i + 2 < f.positions.length; i += 3) pts.push([f.positions[i], f.positions[i + 1], f.positions[i + 2]])
    expect(pts).toHaveLength(r.auto.vertices)
    for (const p of pts) {
      const m = [-p[0], p[1], p[2]]
      const near = Math.min(...pts.map((q) => Math.hypot(q[0] - m[0], q[1] - m[1], q[2] - m[2])))
      expect(near).toBeLessThan(1e-6)
    }
    expect((await refused('reverse.freeform.auto', { quads: 300, symmetry: 'bogus' })).message).toBeTruthy()
  })

  it('refuses a target out of range, density together with quads, and a name taken', async () => {
    expect((await refused('reverse.freeform.auto', { quads: 10 })).message).toBeTruthy()
    expect((await refused('reverse.freeform.auto', { quads: 1_000_000 })).message).toBeTruthy()
    expect((await refused('reverse.freeform.auto', { density: 'low', quads: 500 })).message).toMatch(/density.*quads/)
    await auto({ algorithm: 'basic', quads: 300, name: 'Once' })
    expect((await refused('reverse.freeform.auto', { quads: 300, name: 'Once' })).message).toBeTruthy()
    expect(useReverse.getState().features.filter((f) => f.kind === 'freeform')).toHaveLength(1)
    // Nothing is selected on the scan: selectedOnly has nothing to extract from.
    expect((await refused('reverse.freeform.auto', { quads: 300, selectedOnly: true })).message).toMatch(/selected/)
  })
})
