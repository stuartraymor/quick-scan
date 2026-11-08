// SPDX-License-Identifier: AGPL-3.0-only
// The freeform cage in the document (F3 of audit-2026-11-07/FREEFORM_ROADMAP.md):
// made, edited with the editor's tools, refined, snapped to a cylinder scan
// and measured, converted (thickened, offset), undone and saved. The scan is
// stood in for by the mesh drawn on, as the network's tests do.
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
/** A cylinder of radius R about the z axis, 80 mm tall, closed round. */
const cylinder = (u: number, v: number): Vec3 => [R * Math.cos(2 * Math.PI * u), R * Math.sin(2 * Math.PI * u), 80 * v]
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

interface Made {
  feature: { id: number; name: string; kind: string; status: string }
  result: { status: string; message?: string }
  body?: { faces: number; solid: boolean; valid: boolean; area: number; volume: number | null; steps: number }
  shell?: { kind: string; solid: boolean; valid: boolean; volume: number | null; side?: string }
  cage: { vertices: number; faces: number; closed: boolean; holes: number[]; creases: number; area: number }
  bodies: { count: number }
}

/** A patch of 20 × 20 mm in the plane x = 45, facing out, 5 mm clear of the cylinder's wall at y = 0. */
const wallPatch = { origin: [45, -10, 30] as Vec3, u: [0, 20, 0] as Vec3, v: [0, 0, 20] as Vec3 }

const cubeObj = (() => {
  const v = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map((p) => `v ${p.map((x) => x * 20).join(' ')}`)
  const f = [[1, 4, 3, 2], [5, 6, 7, 8], [1, 2, 6, 5], [2, 3, 7, 6], [3, 4, 8, 7], [4, 1, 5, 8]].map((q) => `f ${q.join(' ')}`)
  return [...v, ...f].join('\n') + '\n'
})()

const made = (name: string, input: unknown) => run<Made>(`reverse.freeform.${name}`, input)

describe('reverse.freeform.create', () => {
  it('adds a cage to the list and the build makes a sheet of it', async () => {
    const r = await made('create', { rectangle: { ...wallPatch, nu: 2, nv: 2 }, name: 'Wall patch', steps: 3 })
    expect(r.feature).toMatchObject({ kind: 'freeform', name: 'Wall patch', status: 'ok' })
    expect(r.cage).toMatchObject({ vertices: 9, faces: 4, closed: false, holes: [8] })
    expect(r.body).toMatchObject({ solid: false, valid: true, steps: 3 })
    expect(r.bodies.count).toBe(1)
    // The cage’s surface lies a little inside its 20 × 20 mm: a flat patch refined keeps its area.
    expect(r.body!.area).toBeGreaterThan(300)
    expect(r.body!.area).toBeLessThan(420)
    expect(useReverse.getState().features.map((f) => f.kind)).toEqual(['freeform'])
  })

  it('makes a solid of a closed cube cage, then offsets and thickens it as a set of options', async () => {
    const c = await made('create', { obj: cubeObj, steps: 3 })
    expect(c.body).toMatchObject({ solid: true, valid: true })
    const v = c.body!.volume!
    const off = await made('convert', { feature: c.feature.id, offset: { distance: -1 } })
    expect(off.shell).toMatchObject({ kind: 'offset', solid: true, valid: true })
    expect(off.shell!.volume!).toBeLessThan(v)
    const thick = await made('convert', { feature: c.feature.id, thicken: { thickness: 1, side: 'out' } })
    expect(thick.shell).toMatchObject({ kind: 'thicken', solid: true, valid: true })
    const plain = await made('convert', { feature: c.feature.id, plain: true })
    expect(plain.shell).toBeUndefined()
    expect(plain.body!.volume!).toBeCloseTo(v, 3)
    const f = useReverse.getState().features[0]
    expect(f.kind === 'freeform' && f.ask).toBeFalsy()
  })

  it('refuses neither or both of obj and rectangle, a broken cage, and a name already taken', async () => {
    expect((await refused('reverse.freeform.create', {})).message).toMatch(/either obj/)
    expect((await refused('reverse.freeform.create', { obj: cubeObj, rectangle: { ...wallPatch } })).message).toMatch(/either obj/)
    expect((await refused('reverse.freeform.create', { obj: 'v 0 0 0\nv 1 0 0\n' })).message).toMatch(/no faces/)
    await made('create', { rectangle: { ...wallPatch }, name: 'Same' })
    expect((await refused('reverse.freeform.create', { rectangle: { ...wallPatch }, name: 'Same' })).message).toMatch(/already named/)
    expect(useReverse.getState().features).toHaveLength(1)
  })
})

describe('reverse.freeform.edit', () => {
  it('applies the tools in order as one undo step and builds the result', async () => {
    const c = await made('create', { rectangle: { ...wallPatch, nu: 2, nv: 2 } })
    const before = useReverse.getState().past.length
    const r = await made('edit', {
      feature: c.feature.id,
      ops: [
        { op: 'split', a: 0, b: 1 },
        { op: 'move', moves: [{ vertex: 4, by: [1, 0, 0] }], radius: 15 },
        { op: 'crease', edges: [[0, 3]] },
        { op: 'extrapolate', a: 0, b: 9 },
      ],
    })
    expect(r.cage.faces).toBe(4 + 2 + 1)
    expect(r.cage.creases).toBe(1)
    expect(r.result.status).toBe('ok')
    expect(useReverse.getState().past.length).toBe(before + 1)
    // Undo takes all four back.
    await run('history.undo')
    const f = useReverse.getState().features[0]
    expect(f.kind === 'freeform' && f.faces.length).toBe(4)
  })

  it('refuses the whole list when one is refused, saying which, and changes nothing', async () => {
    const c = await made('create', { rectangle: { ...wallPatch } })
    const m = await refused('reverse.freeform.edit', { feature: c.feature.id, ops: [{ op: 'move', moves: [{ vertex: 0, by: [1, 0, 0] }] }, { op: 'delete', faces: [99] }] })
    expect(m.message).toMatch(/Edit 2 \(delete\).*no face 99/)
    expect((await refused('reverse.freeform.edit', { feature: c.feature.id, ops: [{ op: 'sculpt' }] })).message).toMatch(/no op “sculpt”/)
    expect((await refused('reverse.freeform.edit', { feature: c.feature.id, ops: [{ op: 'split', a: 0, b: 8 }] })).message).toMatch(/Edit 1 \(split\).*not an edge/)
    const f = useReverse.getState().features[0]
    expect(f.kind === 'freeform' && f.positions[0]).toBe(45)
    expect((await refused('reverse.freeform.edit', { feature: 'nothing here', ops: [{ op: 'smooth' }] })).message).toMatch(/no feature “nothing here”/)
  })

  it('refuses a feature that is not a freeform cage', async () => {
    await run('reverse.sketch.edit', {}).catch(() => undefined)
    const c = await made('create', { rectangle: { ...wallPatch } })
    expect(c.feature.kind).toBe('freeform')
    // A rectangle added, a closed hole made of it: bridging the wrong faces says so.
    expect((await refused('reverse.freeform.edit', { feature: c.feature.id, ops: [{ op: 'bridge', faces: [0, 0] }] })).message).toMatch(/different/)
  })
})

describe('move_points and refine', () => {
  it('drags a point with a falloff, and refines without changing the surface', async () => {
    const c = await made('create', { rectangle: { ...wallPatch, nu: 4, nv: 4 }, steps: 2 })
    const moved = await made('move_points', { feature: c.feature.id, moves: [{ vertex: 12, by: [3, 0, 0] }], radius: 12, strength: 0.5 })
    expect(moved.cage.faces).toBe(16)
    const read = await run<{ points: number[][] }>('reverse.freeform.read', { feature: c.feature.id, vertices: true })
    expect(read.points[12][0]).toBeCloseTo(48, 2)
    expect(read.points[13][0]).toBeGreaterThan(45)
    expect(read.points[13][0]).toBeLessThan(48)
    const area = moved.body!.area
    const finer = await made('refine', { feature: c.feature.id })
    expect(finer.cage.faces).toBe(64)
    expect(finer.body!.area).toBeCloseTo(area, 0)
  })
})

describe('reverse.freeform.snap', () => {
  it('takes a 4 × 4 patch 5 mm off the cylinder onto it, within the tolerance of the deviation display', async () => {
    const c = await made('create', { rectangle: { ...wallPatch, nu: 4, nv: 4 }, steps: 2 })
    const before = await run<{ deviation: { rms: number; max: number; fraction: number } }>('reverse.freeform.read', { feature: c.feature.id, deviation: true })
    expect(before.deviation.rms).toBeGreaterThan(3)
    const r = await run<Made & { snapped: { before: { rms: number }; after: { rms: number; max: number; fraction: number; within: number; points: number }; tolerance: number; legend: number } }>('reverse.freeform.snap', { feature: c.feature.id, iterations: 30 })
    expect(r.snapped.tolerance).toBe(0.05)
    expect(r.snapped.legend).toBe(0.25)
    expect(r.snapped.after.rms).toBeLessThan(0.05)
    expect(r.snapped.after.max).toBeLessThan(0.25)
    expect(r.snapped.after.fraction).toBeGreaterThan(0.8)
    expect(r.result.status).toBe('ok')
    // Read back, the deviation is what snap said.
    const after = await run<{ deviation: { rms: number } }>('reverse.freeform.read', { feature: c.feature.id, deviation: true })
    expect(after.deviation.rms).toBeCloseTo(r.snapped.after.rms, 2)
  })

  it('builds the cage snapped onto the scan when the feature says snap: the sheet lies on the wall', async () => {
    const c = await made('create', { rectangle: { ...wallPatch, nu: 2, nv: 2 }, steps: 3, snap: true })
    expect(c.result.status).toBe('ok')
    // The 20 mm plane 5 mm inside the wall projected radially onto it spreads to about 22 × 20 mm: ≈ 440 mm².
    expect(c.body!.area).toBeGreaterThan(400)
    expect(c.body!.area).toBeLessThan(460)
  })
})

describe('the saved project', () => {
  const good = { kind: 'freeform', name: 'F', positions: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], faces: [[0, 1, 2, 3]], creases: [[0, 1]], steps: 2, snap: false }
  it('accepts a cage and refuses the ones that would read past their points', () => {
    expect(() => validateFeatureJson(good)).not.toThrow()
    expect(() => validateFeatureJson({ ...good, ask: { kind: 'offset', distance: 1 } })).not.toThrow()
    expect(() => validateFeatureJson({ ...good, faces: [[0, 1, 2, 9]] })).toThrow(/freeform.face/)
    expect(() => validateFeatureJson({ ...good, faces: [[0, 1]] })).toThrow(/freeform.face/)
    expect(() => validateFeatureJson({ ...good, creases: [[0, 7]] })).toThrow(/freeform.crease/)
    expect(() => validateFeatureJson({ ...good, positions: [0, 0, 0, 1] })).toThrow(/freeform.positions/)
    expect(() => validateFeatureJson({ ...good, positions: [0, 0, Number.NaN] })).toThrow(/freeform.positions/)
    expect(() => validateFeatureJson({ ...good, steps: 9 })).toThrow(/freeform.steps/)
    expect(() => validateFeatureJson({ ...good, ask: { kind: 'thicken', thickness: 1, side: 'sideways', direction: 'auto' } })).toThrow(/freeform.ask/)
  })
})
