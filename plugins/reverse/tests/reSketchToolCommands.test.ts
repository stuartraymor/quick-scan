// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul Batch 4: the sketch's tools for an agent — mirror,
// pattern, spline refinement, select and analyse — run headless against a
// 40 mm box scan, through the same geometry the panel uses.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { boxMesh } from '../../../tests/helpers'
import { refused, run, startHeadless, stlBytes, undoLabels, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'
import { useReverse } from '../state/reStore'
import type { Sketch, SketchSpline } from '../core/sketch'
import plugin from '../plugin'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 180_000 })

type Vec2 = [number, number]
interface Made { made?: number[]; note?: string; deviation?: number; solve?: { ok: boolean } }
interface Piece { id: number; kind: string; length?: number; construction?: boolean; curvature?: { k?: number; radius?: number; kMax?: number; minRadius?: number; at?: Vec2 }; deviation?: { min: number; max: number; mean: number; within: number; outside?: { from: Vec2; to: Vec2; max: number }[] } | null }
interface Analysed { tolerance: number; pieces: Piece[]; deviation?: { within: number; max: number; failing: number[] }; deviationNote?: string; regions: number; closed: boolean; looseEnds?: { piece: number; at: string; p: Vec2 }[] }

let headless: Headless
let session: ReverseSession
const stops: (() => void)[] = []

beforeAll(async () => {
  plugin.install?.()
  headless = await startHeadless()
  session = createReverseSession({ sceneRef: { current: null }, kernel: () => new ReClient(localKernel()) })
  stops.push(installReverseSession(session), session.watch())
  await run('scan.open', { bytes: stlBytes(boxMesh(40, 40)), name: 'box.stl', discard: true })
}, 120_000)
afterAll(() => {
  for (const stop of stops) stop()
  headless.stop()
})
beforeEach(resetReverse)

const stored = (): Sketch => {
  const f = useReverse.getState().features.find((x) => x.kind === 'sketch' && x.name === 'Plate')
  if (!f || f.kind !== 'sketch') throw new Error('no sketch Plate')
  return f.sketch
}
const piece = (id: number) => stored().entities.find((e) => e.id === id)!
const near = (p: Vec2, q: Vec2, t = 1e-9) => Math.hypot(p[0] - q[0], p[1] - q[1]) < t
const plate = (entities: unknown[], constraints: unknown[] = []) =>
  run('reverse.feature.add', { feature: { kind: 'sketch', name: 'Plate', plane: { kind: 'world', axis: 'z' }, sketch: { entities, constraints } } })

describe('reverse.sketch.mirror', () => {
  it('reflects exactly about a sheet axis, a picked line or two points, as one undo step', async () => {
    await plate([
      { id: 1, kind: 'line', a: [10, 5], b: [20, 5] },
      { id: 2, kind: 'arc', c: [30, 0], r: 4, start: 0, sweep: Math.PI / 2 },
      { id: 3, kind: 'line', a: [0, 0], b: [10, 10], construction: true },
    ])
    const v = await run<Made>('reverse.sketch.mirror', { sketch: 'Plate', pieces: [1, 2], axis: { sketchAxis: 'v' } })
    expect(v.made).toHaveLength(2)
    const [m1, m2] = v.made!.map(piece)
    expect(m1.kind === 'line' && near(m1.a, [-10, 5]) && near(m1.b, [-20, 5])).toBe(true)
    // An arc mirrored keeps counter-clockwise sweep: it now runs from 90° to 180°.
    expect(m2.kind === 'arc' && near(m2.c, [-30, 0]) && Math.abs(m2.r - 4) < 1e-12).toBe(true)
    expect(undoLabels().at(-1)).toBe('Agent: mirror 2 sketch pieces')
    const d = await run<Made>('reverse.sketch.mirror', { sketch: 'Plate', pieces: [1], axis: { piece: 3 } })
    const diag = piece(d.made![0])
    expect(diag.kind === 'line' && near(diag.a, [5, 10]) && near(diag.b, [5, 20])).toBe(true)
    const t = await run<Made>('reverse.sketch.mirror', { sketch: 'Plate', pieces: [1], axis: { through: [[0, 0], [1, 0]] } })
    const under = piece(t.made![0])
    expect(under.kind === 'line' && near(under.a, [10, -5])).toBe(true)
  })

  it('refuses what makes no sense, changing nothing', async () => {
    await plate([{ id: 1, kind: 'line', a: [10, 5], b: [20, 5] }, { id: 2, kind: 'circle', c: [0, 0], r: 3 }])
    const before = JSON.stringify(stored())
    expect((await refused('reverse.sketch.mirror', { sketch: 'Plate', pieces: [9], axis: { sketchAxis: 'u' } })).code).toBe('not_found')
    expect((await refused('reverse.sketch.mirror', { sketch: 'Plate', pieces: [1], axis: { sketchAxis: 'u', piece: 2 } })).message).toMatch(/exactly one/)
    expect((await refused('reverse.sketch.mirror', { sketch: 'Plate', pieces: [1], axis: { piece: 2 } })).message).toMatch(/not a line/)
    expect((await refused('reverse.sketch.mirror', { sketch: 'Plate', pieces: [1], axis: { piece: 1 } })).message).toMatch(/one of the pieces/)
    expect((await refused('reverse.sketch.mirror', { sketch: 'Plate', pieces: [1], axis: { through: [[3, 3], [3, 3]] } })).message).toMatch(/no length/)
    expect(JSON.stringify(stored())).toBe(before)
  })
})

describe('reverse.sketch.pattern', () => {
  it('lays a two-direction grid exactly, far from the origin', async () => {
    await plate([{ id: 1, kind: 'circle', c: [1000, 2000], r: 1 }])
    const g = await run<Made>('reverse.sketch.pattern', { sketch: 'Plate', pieces: [1], mode: 'linear', d1: { count: 3, spacing: 2.5 }, d2: { count: 2, spacing: 4 } })
    expect(g.made).toHaveLength(5)
    const centres = g.made!.map((id) => { const e = piece(id); return e.kind === 'circle' ? e.c : null })
    for (const [i, j] of [[1, 0], [2, 0], [0, 1], [1, 1], [2, 1]]) expect(centres.some((c) => c && near(c, [1000 + 2.5 * i, 2000 + 4 * j]))).toBe(true)
    expect(undoLabels().at(-1)).toMatch(/linear pattern of 1 sketch piece/)
  })

  it('goes round a picked centre with no copy on the original, and along a curve by arc length', async () => {
    await plate([
      { id: 1, kind: 'point', p: [10, 0] },
      { id: 2, kind: 'circle', c: [0, 0], r: 2 },
      { id: 3, kind: 'arc', c: [0, -30], r: 10, start: 0, sweep: Math.PI },
      { id: 4, kind: 'point', p: [10, -30] },
    ])
    const c = await run<Made>('reverse.sketch.pattern', { sketch: 'Plate', pieces: [1], mode: 'circular', centre: 2, count: 6 })
    expect(c.made).toHaveLength(5)
    const pts = c.made!.map((id) => { const e = piece(id); return e.kind === 'point' ? e.p : [NaN, NaN] as Vec2 })
    for (let k = 1; k < 6; k++) expect(pts.some((p) => near(p, [10 * Math.cos((k * Math.PI) / 3), 10 * Math.sin((k * Math.PI) / 3)], 1e-9))).toBe(true)
    expect(pts.some((p) => near(p, [10, 0], 1e-6))).toBe(false)
    const a = await run<Made>('reverse.sketch.pattern', { sketch: 'Plate', pieces: [4], mode: 'alongCurve', curve: 3, count: 5 })
    const along = a.made!.map((id) => { const e = piece(id); return e.kind === 'point' ? e.p : [NaN, NaN] as Vec2 })
    for (let k = 1; k < 5; k++) expect(along.some((p) => near(p, [10 * Math.cos((k * Math.PI) / 4), -30 + 10 * Math.sin((k * Math.PI) / 4)], 1e-7))).toBe(true)
  })

  it('refuses parallel directions, a missing count and a guide that is copied', async () => {
    await plate([{ id: 1, kind: 'line', a: [0, 0], b: [5, 0] }, { id: 2, kind: 'line', a: [0, 5], b: [5, 5] }])
    expect((await refused('reverse.sketch.pattern', { sketch: 'Plate', pieces: [1], mode: 'linear', d1: { count: 2, spacing: 5 }, d2: { along: 'u', count: 2, spacing: 5 } })).message).toMatch(/parallel/)
    expect((await refused('reverse.sketch.pattern', { sketch: 'Plate', pieces: [1], mode: 'circular' })).message).toMatch(/takes count/)
    expect((await refused('reverse.sketch.pattern', { sketch: 'Plate', pieces: [1, 2], mode: 'alongCurve', curve: 2, count: 3 })).message).toMatch(/one of the pieces being copied/)
    expect((await refused('reverse.sketch.pattern', { sketch: 'Plate', pieces: [1], mode: 'linear', d1: { count: 2, spacing: 0 } })).message).toMatch(/spacing other than 0/)
  })
})

describe('reverse.sketch.spline', () => {
  it('adds, removes, rebuilds and holds an end direction, each one undo step', async () => {
    await plate([{ id: 1, kind: 'spline', pts: [[0, 0], [10, 6], [20, -2], [30, 4], [40, 0]] }])
    const spline = () => piece(1) as SketchSpline
    await run('reverse.sketch.spline', { sketch: 'Plate', piece: 1, add: [5, 3.5] })
    expect(spline().pts).toHaveLength(6)
    await run('reverse.sketch.spline', { sketch: 'Plate', piece: 1, remove: 1 })
    expect(spline().pts).toHaveLength(5)
    const r = await run<Made>('reverse.sketch.spline', { sketch: 'Plate', piece: 1, rebuild: 9 })
    expect(spline().pts).toHaveLength(9)
    expect(r.deviation).toBeGreaterThan(0)
    expect(near(spline().pts[0], [0, 0]) && near(spline().pts[8], [40, 0])).toBe(true)
    await run('reverse.sketch.spline', { sketch: 'Plate', piece: 1, tangent: { end: 'a', angleDeg: 90 } })
    expect(spline().startSet).toBe(true)
    expect(Math.abs(spline().startDir! - Math.PI / 2)).toBeLessThan(1e-12)
    await run('reverse.sketch.spline', { sketch: 'Plate', piece: 1, tangent: { end: 'a', angleDeg: null } })
    expect(spline().startSet).toBeFalsy()
    // Agent changes are labelled as such in the undo history.
    expect(undoLabels().slice(-5)).toEqual(['Agent: add a spline point', 'Agent: remove a spline point', 'Agent: rebuild a spline', 'Agent: set a spline end direction', 'Agent: set a spline end direction'])
  })

  it('refuses a piece that is not a spline and two changes at once', async () => {
    await plate([{ id: 1, kind: 'line', a: [0, 0], b: [5, 0] }, { id: 2, kind: 'spline', pts: [[0, 0], [5, 5]] }])
    expect((await refused('reverse.sketch.spline', { sketch: 'Plate', piece: 1, rebuild: 4 })).message).toMatch(/not a spline/)
    expect((await refused('reverse.sketch.spline', { sketch: 'Plate', piece: 2, rebuild: 4, remove: 1 })).message).toMatch(/exactly one/)
    expect((await refused('reverse.sketch.spline', { sketch: 'Plate', piece: 2, remove: 1 })).message).toMatch(/2 points|keeps|at least/i)
  })
})

describe('reverse.sketch.select', () => {
  it('picks by kind, construction and nearness, and selects in the open editor', async () => {
    await plate([
      { id: 1, kind: 'line', a: [0, 0], b: [20, 0] },
      { id: 2, kind: 'line', a: [0, 10], b: [20, 10], construction: true },
      { id: 3, kind: 'circle', c: [40, 0], r: 5 },
    ])
    const lines = await run<{ picked: number[]; inEditor: boolean }>('reverse.sketch.select', { sketch: 'Plate', kind: 'line', construction: false })
    expect(lines).toMatchObject({ picked: [1], inEditor: false })
    const nearCircle = await run<{ picked: number[] }>('reverse.sketch.select', { sketch: 'Plate', near: [45.5, 0], within: 1 })
    expect(nearCircle.picked).toEqual([3])
    const id = useReverse.getState().features.find((f) => f.name === 'Plate')!.id
    useReverse.getState().editSketch(id)
    const open = await run<{ picked: number[]; inEditor: boolean }>('reverse.sketch.select', { sketch: 'Plate', pieces: [1, 3] })
    expect(open.inEditor).toBe(true)
    expect(useReverse.getState().sketchDraft?.selection).toEqual([1, 3])
    useReverse.getState().discardSketch()
  })
})

describe('reverse.sketch.analyse', () => {
  it('reads a closed square on the box walls as within tolerance, with no loose ends', async () => {
    await plate([
      { id: 1, kind: 'line', a: [-20, -20], b: [20, -20] },
      { id: 2, kind: 'line', a: [20, -20], b: [20, 20] },
      { id: 3, kind: 'line', a: [20, 20], b: [-20, 20] },
      { id: 4, kind: 'line', a: [-20, 20], b: [-20, -20] },
    ], [
      { kind: 'coincident', p: { entity: 1, at: 'b' }, q: { entity: 2, at: 'a' } },
      { kind: 'coincident', p: { entity: 2, at: 'b' }, q: { entity: 3, at: 'a' } },
      { kind: 'coincident', p: { entity: 3, at: 'b' }, q: { entity: 4, at: 'a' } },
      { kind: 'coincident', p: { entity: 4, at: 'b' }, q: { entity: 1, at: 'a' } },
    ])
    const a = await run<Analysed>('reverse.sketch.analyse', { sketch: 'Plate', tolerance: 0.1 })
    expect(a.deviationNote).toBeUndefined()
    expect(a.deviation!.within).toBeGreaterThan(0.999)
    expect(a.deviation!.failing).toEqual([])
    expect(a.regions).toBe(1)
    expect(a.closed).toBe(true)
    expect(a.looseEnds).toBeUndefined()
    for (const p of a.pieces) expect(p.curvature).toEqual({ k: 0 })
    expect(a.pieces[0].length).toBeCloseTo(40, 9)
  })

  it('splits a line that leaves the wall into within and outside, and reads true curvature', async () => {
    // From the wall at x = 20 out to 0.4 mm off it: the first quarter within 0.1.
    await plate([
      { id: 1, kind: 'line', a: [20, -10], b: [20.4, 10] },
      { id: 2, kind: 'arc', c: [0, 0], r: 5, start: 0, sweep: Math.PI / 2, construction: true },
      { id: 3, kind: 'spline', pts: [[-15, -15], [-10, -5], [-5, -15]], construction: true },
    ])
    const a = await run<Analysed>('reverse.sketch.analyse', { sketch: 'Plate', tolerance: 0.1 })
    const line = a.pieces.find((p) => p.id === 1)!
    expect(line.deviation!.within).toBeGreaterThan(0.2)
    expect(line.deviation!.within).toBeLessThan(0.3)
    expect(line.deviation!.max).toBeCloseTo(0.4, 2)
    expect(line.deviation!.outside).toHaveLength(1)
    expect(line.deviation!.outside![0].from[1]).toBeCloseTo(-5, 1)
    expect(a.deviation!.failing).toEqual([1])
    const arc = a.pieces.find((p) => p.id === 2)!
    expect(arc.curvature).toEqual({ k: 0.2, radius: 5 })
    expect(arc.deviation).toBeUndefined()
    const spline = a.pieces.find((p) => p.id === 3)!
    expect(spline.curvature!.minRadius).toBeGreaterThan(0)
    expect(spline.curvature!.kMax).toBeCloseTo(1 / spline.curvature!.minRadius!, 3)
    expect(a.closed).toBe(false)
    expect(a.looseEnds!.map((e) => `${e.piece}${e.at}`)).toEqual(['1a', '1b'])
    // A looser tolerance never fails more.
    const loose = await run<Analysed>('reverse.sketch.analyse', { sketch: 'Plate', tolerance: 0.5 })
    expect(loose.deviation!.failing).toEqual([])
  })

  it('answers without a deviation where nothing is asked of the scan', async () => {
    await plate([{ id: 1, kind: 'circle', c: [0, 0], r: 3 }])
    const a = await run<Analysed>('reverse.sketch.analyse', { sketch: 'Plate', deviation: false })
    expect(a.deviation).toBeUndefined()
    expect(a.pieces[0].curvature).toEqual({ k: 0.333333, radius: 3 })
    expect(a.regions).toBe(1)
    expect(a.closed).toBe(true)
  })
})
