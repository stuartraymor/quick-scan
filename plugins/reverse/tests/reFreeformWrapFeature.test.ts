// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.wrap (F4 of audit-2026-11-07/FREEFORM_ROADMAP.md) in the
// document: a region of a cylinder scan wrapped at the three densities, the
// body built from it measured against the cylinder, refusals, undo. The
// scan is stood in for by the mesh drawn on, as reFreeformFeature does.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { refused, run, soupOf, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { validateFeatureJson } from '../app/projectSection'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { gridScan } from './networkMeshes'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

const R = 50
const H = 80
/** A cylinder of radius R about the z axis, H mm tall, closed round. */
const cylinder = (u: number, v: number): Vec3 => [R * Math.cos(2 * Math.PI * u), R * Math.sin(2 * Math.PI * u), H * v]
const scan = gridScan(240, 60, cylinder, { wrap: true, noise: 0.01 })
const scene = { scanPositions: () => scan.positions, scanIndices: () => Uint32Array.from(scan.indices) } as unknown as SceneManager

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: scene }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(soupOf(scan)), name: 'cylinder.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

interface Wrapped {
  feature: { id: number; name: string; kind: string; status: string }
  result: { status: string; message?: string }
  body?: { faces: number; solid: boolean; valid: boolean; area: number; volume: number | null }
  wrap: { density: string; closure: string; around: number; along: number; quads: number; region: number; cylinder: { radius: number; axis: number[]; from: number; to: number }; sweepDeg: number; closed: boolean }
  snapped?: { before: { rms: number; max: number }; after: { rms: number; max: number; points: number } }
  bodies: { count: number }
}

/** The scan vertices between two heights and (for a part turn) inside an arc of degrees from the x axis. */
function region(z0: number, z1: number, arc?: [number, number]): number[] {
  const out: number[] = []
  const p = scan.positions
  for (let i = 0; i < p.length / 3; i++) {
    const z = p[i * 3 + 2]
    if (z < z0 || z > z1) continue
    if (arc) {
      const a = (((Math.atan2(p[i * 3 + 1], p[i * 3]) * 180) / Math.PI) + 360) % 360
      if (a < arc[0] || a > arc[1]) continue
    }
    out.push(i)
  }
  return out
}

const wrap = (input: unknown) => run<Wrapped>('reverse.freeform.wrap', input)

describe('reverse.freeform.wrap', () => {
  it('reads a whole-turn region as a tube and builds a sheet on the cylinder', async () => {
    const r = await wrap({ region: region(7, 73), density: 'medium', name: 'Tube' })
    expect(r.feature).toMatchObject({ kind: 'freeform', name: 'Tube', status: 'ok' })
    expect(r.wrap.closed).toBe(true)
    expect(r.wrap.closure).toBe('whole')
    expect(r.wrap.cylinder.radius).toBeCloseTo(R, 1)
    expect(Math.abs(r.wrap.cylinder.axis[2])).toBeGreaterThan(0.999)
    // 8 round; 65 mm long at R 50: 65 / (2π·50/8) = 1.7 → 2 along.
    expect(r.wrap).toMatchObject({ around: 8, along: 2, quads: 16 })
    expect(r.wrap.cylinder.to - r.wrap.cylinder.from).toBeGreaterThan(63.5)
    expect(r.wrap.cylinder.to - r.wrap.cylinder.from).toBeLessThan(66.5)
    // The built surface is the cylinder: area 2π·R·60 within a percent.
    expect(r.body!.valid).toBe(true)
    expect(r.body!.area).toBeGreaterThan(2 * Math.PI * R * 65.3 * 0.98)
    expect(r.body!.area).toBeLessThan(2 * Math.PI * R * 65.3 * 1.02)
    expect(r.snapped!.after.rms).toBeLessThan(0.05)
    expect(useReverse.getState().features.map((f) => f.kind)).toEqual(['freeform'])
  })

  it('counts quads by density: 4 × 1, 8 × 2, 16 × 3 on the same 65 mm region', async () => {
    const counts: Record<string, [number, number, number]> = {}
    for (const density of ['low', 'medium', 'fine']) {
      const r = await wrap({ region: region(7, 73), density })
      counts[density] = [r.wrap.around, r.wrap.along, r.wrap.quads]
    }
    expect(counts).toEqual({ low: [4, 1, 4], medium: [8, 2, 16], fine: [16, 3, 48] })
  })

  it('wraps a part-turn region with a chord, and with none as an open strip', async () => {
    const arc = region(7, 73, [0, 170])
    const chord = await wrap({ region: arc, density: 'medium' })
    expect(chord.wrap.closed).toBe(false)
    expect(chord.wrap.closure).toBe('chord')
    expect(chord.wrap.sweepDeg).toBeGreaterThan(165)
    expect(chord.wrap.sweepDeg).toBeLessThan(175)
    expect(chord.wrap.quads).toBe(16)
    expect(chord.result.message ?? chord.feature.status).toBe('ok')
    // The snap's reach is kept with the feature, so a rebuild snaps the same part of the scan; it saves and loads.
    const kept = useReverse.getState().features.find((x) => x.id === chord.feature.id)
    expect(kept && kept.kind === 'freeform' && kept.snapRegion?.sweep).toBeCloseTo((chord.wrap.sweepDeg * Math.PI) / 180, 2)
    expect(() => validateFeatureJson(JSON.parse(JSON.stringify(kept)))).not.toThrow()
    expect(() => validateFeatureJson({ ...JSON.parse(JSON.stringify(kept)), snapRegion: { point: [0, 0, 0] } })).toThrow(/snapRegion/)
    // The chord crosses the part: the body is a valid sheet over the wall and the chord.
    expect(chord.body!.valid).toBe(true)
    expect(chord.body!.area).toBeGreaterThan(R * Math.PI * 65.3 * 0.9)
    const strip = await wrap({ region: arc, density: 'medium', closure: 'none' })
    expect(strip.wrap.closure).toBe('none')
    expect(strip.feature.status).toBe('ok')
    // The strip is a sheet over the region: about half the cylinder's area.
    expect(strip.body!.area).toBeGreaterThan(R * Math.PI * 65.3 * 0.9)
    expect(strip.body!.area).toBeLessThan(R * Math.PI * 65.3 * 1.15)
  })

  it('reads the region off a box too', async () => {
    const r = await wrap({ region: { box: { min: [-60, -60, 7], max: [60, 60, 73] } }, density: 'low' })
    expect(r.wrap.cylinder.radius).toBeCloseTo(R, 1)
    expect(r.wrap.quads).toBe(4)
  })

  it('is one undo step', async () => {
    const before = useReverse.getState().past.length
    await wrap({ region: region(7, 73), density: 'low' })
    expect(useReverse.getState().past.length).toBe(before + 1)
    await run('history.undo')
    expect(useReverse.getState().features).toHaveLength(0)
  })

  it('refuses what it cannot wrap, saying why', async () => {
    expect((await refused('reverse.freeform.wrap', { region: [1, 2, 3] })).message).toMatch(/at least/)
    expect((await refused('reverse.freeform.wrap', { region: region(7, 73).map((v) => v + 10_000_000) })).message).toMatch(/not one of the scan/)
    // A region of a single ring has no length to give an axis.
    expect((await refused('reverse.freeform.wrap', { region: region(40, 40.2) })).message).toMatch(/Wrap/)
    expect((await refused('reverse.freeform.wrap', { region: region(7, 73), density: 'ultra' })).message).toBeTruthy()
    expect(useReverse.getState().features).toHaveLength(0)
  })
})
