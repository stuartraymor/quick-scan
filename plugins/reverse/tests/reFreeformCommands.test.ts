// SPDX-License-Identifier: AGPL-3.0-only
// The freeform cage commands (F0): a box cage read over a noisy cylinder
// scan, its refined surface snapped onto the scan and measured — the cage
// far off the wall, the snapped surface on it within the noise — a
// QUICKSURFACE export read as it was written, a cage written and read
// back, and a broken OBJ refused by name. The scan stood in for by the
// mesh drawn on, as the network's tests do.
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { listCommands } from '../../../src/commands/registry'
import { SCHEMA_BUDGET, schemaWeight } from '../../../src/commands/schema'
import type { Vec3 } from '../../../src/core/types'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { refused, run, soupOf, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { parseQuadObj, writeQuadObj } from '../core/freeform/cageIO'
import plugin from '../plugin'
import { gridScan } from './networkMeshes'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 120_000 })

const NOISE = 0.01
const R = 50
/** A cylinder of radius R about the z axis, 80 mm tall, closed round. */
const cylinder = (u: number, v: number): Vec3 => [R * Math.cos(2 * Math.PI * u), R * Math.sin(2 * Math.PI * u), 80 * v]
const scan = gridScan(240, 60, cylinder, { wrap: true, noise: NOISE })
const scene = { scanPositions: () => scan.positions, scanIndices: () => Uint32Array.from(scan.indices) } as unknown as SceneManager

/** A four-sided box cage round the cylinder, as QUICKSURFACE's Wrap makes one, 10 mm clear of it. */
const box = (() => {
  const a = R + 10
  const lines: string[] = []
  for (const z of [5, 75]) for (const [x, y] of [[a, a], [-a, a], [-a, -a], [a, -a]]) lines.push(`v ${x} ${y} ${z}`)
  for (let i = 0; i < 4; i++) lines.push(`f ${i + 1} ${((i + 1) % 4) + 1} ${((i + 1) % 4) + 5} ${i + 5}`)
  return lines.join('\n') + '\n'
})()

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

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

interface Read {
  vertices: number
  faces: number
  quads: number
  edges: number
  boundaryEdges: number
  closed: boolean
  valences: number[]
  area: number
  steps: number
  limit: { vertices: number; faces: number; area: number }
  offScan?: { n: number; rms: number; p95: number; max: number }
  snapped?: { moved: { rms: number; max: number }; missed: number; area: number }
}

describe('reverse.freeform.cage_read', () => {
  it('reads a box cage and snaps its refined surface onto the cylinder scan', async () => {
    const r = await run<Read>('reverse.freeform.cage_read', { obj: box, snap: true })
    expect(r).toMatchObject({ vertices: 8, faces: 4, quads: 4, edges: 12, boundaryEdges: 8, closed: false, valences: [3], steps: 3 })
    expect(r.limit.faces).toBe(4 * 64)
    // The subdivision limit of a square ring is a rounded square well off the cylinder…
    expect(r.offScan!.rms).toBeGreaterThan(5)
    // …and snapping takes every vertex onto the scan; the moves are the offsets, none lost.
    expect(r.snapped!.missed).toBe(0)
    expect(r.snapped!.moved.max).toBeLessThan(40)
    expect(r.snapped!.moved.rms).toBeCloseTo(r.offScan!.rms, 0)
    // The snapped surface's area is that of the wall it covers: 2πR × 70 within the cage's reach, less the ends' pull-in.
    expect(r.snapped!.area).toBeGreaterThan(2 * Math.PI * R * 70 * 0.9)
    expect(r.snapped!.area).toBeLessThan(2 * Math.PI * R * 70 * 1.05)
  })
  it('reads QUICKSURFACE’s export as written', async () => {
    const r = await run<Read>('reverse.freeform.cage_read', { obj: fixture('native-freeforms-quads.obj'), steps: 1 })
    expect(r).toMatchObject({ vertices: 12, faces: 6, quads: 6, closed: false, steps: 1 })
    expect(r.limit.faces).toBe(24)
  })
  it('refuses what is not a cage, by name', async () => {
    expect((await refused('reverse.freeform.cage_read', { obj: 'v 0 0 0\nv 1 0 0\n' })).message).toMatch(/no faces/)
    expect((await refused('reverse.freeform.cage_read', { obj: 'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nv 1 1 1\nf 1 2 3\nf 1 2 4\nf 1 2 5\n' })).message).toMatch(/three faces/)
  })
})

describe('reverse.freeform.cage_write', () => {
  it('writes a cage back, refined where asked, that reads as the same cage', async () => {
    const same = await run<{ vertices: number; faces: number; obj: string }>('reverse.freeform.cage_write', { obj: box })
    expect(same).toMatchObject({ vertices: 8, faces: 4 })
    const back = parseQuadObj(same.obj)
    expect(back.faces).toEqual(parseQuadObj(box).faces)
    expect(Array.from(back.positions)).toEqual(Array.from(parseQuadObj(box).positions))
    const fine = await run<{ vertices: number; faces: number; obj: string }>('reverse.freeform.cage_write', { obj: box, steps: 2 })
    // One step: 8 + 4 face + 12 edge points, 16 quads with 40 edges; two: 24 + 16 + 40.
    expect(fine).toMatchObject({ vertices: 80, faces: 64 })
    const again = parseQuadObj(fine.obj)
    expect(writeQuadObj(again, 'Quick Scan freeform cage, refined 2×')).toBe(fine.obj)
    expect(again.faces).toHaveLength(64)
  })
  it('keeps every command’s schema within the budget', () => {
    for (const name of ['reverse.freeform.cage_read', 'reverse.freeform.cage_write']) {
      const c = listCommands().find((x) => x.name === name)
      expect(c, name).toBeDefined()
      const w = schemaWeight(c!.input)
      expect(w.bytes, name).toBeLessThanOrEqual(SCHEMA_BUDGET.bytes)
      expect(w.depth, name).toBeLessThanOrEqual(SCHEMA_BUDGET.depth)
    }
  })
})
