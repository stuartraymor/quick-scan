// SPDX-License-Identifier: AGPL-3.0-only
// Corner Trim's swept area (filled fan from the press point, as QUICKSURFACE
// fills it) and Auto Fillet read from the scan section between two lines, by
// the rules measured in QUICKSURFACE 8.0.128 (analysis/corner-sweep-2026-11-19).
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { piecesInSweep, rankSweptPairs, SweepArea } from '../core/cornerSweep'
import { sweepCornerTrim, sweptCandidates, type CornerTrimOptions } from '../core/sketchCornerTrim'
import { addConstraint, addEntity, anchorPoint, cloneSketch, emptySketch, entityOf, type Sketch, type SketchArc, type SketchLine } from '../core/sketch'
import { solveSketch } from '../core/solver'

const near = (p: Vec2, q: Vec2, tol = 1e-7) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol
const trim: CornerTrimOptions = { mode: 'trim', radiusMm: 1, addDimension: false }
const auto: CornerTrimOptions = { mode: 'autoFillet', radiusMm: 1, addDimension: true }
const ok = (r: ReturnType<typeof sweepCornerTrim>) => { if (!r.result.ok) throw new Error(r.result.error); return r.result }

describe('swept area', () => {
  // Press at A, up to B, across to C: the triangle between is taken.
  const up: Vec2[] = [[0, 0], [0, 5], [0, 10], [5, 10], [10, 10]]
  it('fills the triangle between the press point and the path, not just the L', () => {
    const area = new SweepArea({ path: up, radius: 0.2 })
    expect(area.contains([3, 6])).toBe(true)
    expect(area.contains([1, 9])).toBe(true)
    expect(area.contains([6, 3])).toBe(false)
    expect(area.contains([0.1, 4])).toBe(true)
    expect(area.contains([-1, 4])).toBe(false)
  })
  it('takes a piece lying wholly inside the fill, far from the cursor track', () => {
    const s = emptySketch()
    const inner = addEntity(s, { kind: 'line', a: [2, 5], b: [4, 7] })
    addEntity(s, { kind: 'line', a: [6, 1], b: [9, 2] })
    expect(piecesInSweep(s, { path: up, radius: 0.2 }).map((p) => p.id)).toEqual([inner])
  })
  it('a straight drag still takes what it passes over', () => {
    const s = emptySketch()
    const l = addEntity(s, { kind: 'line', a: [5, -5], b: [5, 5] })
    expect(piecesInSweep(s, { path: [[0, 0], [10, 0]], radius: 0.1 }).map((p) => p.id)).toEqual([l])
  })
  it('works whichever way the sweep turns', () => {
    const s = emptySketch()
    const l = addEntity(s, { kind: 'line', a: [-3, 4], b: [-2, 6] })
    const left: Vec2[] = [[0, 0], [0, 10], [-10, 10]], curved: Vec2[] = Array.from({ length: 20 }, (_, i) => [-10 * Math.sin(i / 19 * Math.PI / 2), 10 * Math.cos(i / 19 * Math.PI / 2)])
    expect(piecesInSweep(s, { path: left, radius: 0.1 }).map((p) => p.id)).toEqual([l])
    expect(piecesInSweep(s, { path: [[0, 0], ...curved], radius: 0.1 }).map((p) => p.id)).toEqual([l])
  })
})

describe('Corner Trim from a sweep', () => {
  it('joins two lines with a gap at their crossing', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [-10, 0], b: [-1, 0] })
    addEntity(s, { kind: 'line', a: [0, 10], b: [0, 1] })
    const r = ok(sweepCornerTrim(s, { path: [[-3, -1], [-3, 2], [1, 2]], radius: 0.1 }, trim))
    expect(near((entityOf(r.sketch, 1) as SketchLine).b, [0, 0])).toBe(true)
    expect(near((entityOf(r.sketch, 2) as SketchLine).b, [0, 0])).toBe(true)
    expect((entityOf(r.sketch, 1) as SketchLine).a).toEqual([-10, 0])
  })
  it('trims the overhangs the area covers past the crossing', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [-10, 0], b: [3, 0] })
    addEntity(s, { kind: 'line', a: [0, 10], b: [0, -3] })
    const r = ok(sweepCornerTrim(s, { path: [[2, 0.5], [2, -2], [-0.5, -2]], radius: 0.1 }, trim))
    expect((entityOf(r.sketch, 1) as SketchLine).a).toEqual([-10, 0])
    expect(near((entityOf(r.sketch, 1) as SketchLine).b, [0, 0])).toBe(true)
    expect((entityOf(r.sketch, 2) as SketchLine).a).toEqual([0, 10])
    expect(near((entityOf(r.sketch, 2) as SketchLine).b, [0, 0])).toBe(true)
  })
  it('keeps the long side when the area straddles the crossing', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [-10, 0], b: [2, 0] })
    addEntity(s, { kind: 'line', a: [0, 10], b: [0, -2] })
    // Area covers both sides of the crossing on both lines, generously.
    const r = ok(sweepCornerTrim(s, { path: [[-1, 1], [3, 1], [3, -3], [-1, -3]], radius: 0.1 }, trim))
    expect((entityOf(r.sketch, 1) as SketchLine).a).toEqual([-10, 0])
    expect((entityOf(r.sketch, 2) as SketchLine).a).toEqual([0, 10])
  })
  it('picks the corner pair when a third piece is swept too, and leaves it alone', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [-10, 0], b: [-1, 0] })
    addEntity(s, { kind: 'line', a: [0, 10], b: [0, 1] })
    const stray = addEntity(s, { kind: 'line', a: [-4, -6], b: [-1.6, 6] })
    const area = new SweepArea({ path: [[-3, -1], [-3, 2], [1, 2]], radius: 0.1 })
    expect(piecesInSweep(s, area).map((p) => p.id).sort()).toEqual([1, 2, stray])
    expect(rankSweptPairs(s, area)[0].ids.sort()).toEqual([1, 2])
    const r = ok(sweepCornerTrim(s, area, trim))
    expect(entityOf(r.sketch, stray)).toEqual(entityOf(s, stray))
    expect(near((entityOf(r.sketch, 2) as SketchLine).b, [0, 0])).toBe(true)
  })
  it('passes over a corner already made and takes the new one', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [-10, 0], b: [0, 0] })
    addEntity(s, { kind: 'line', a: [0, 0], b: [0, 10] })
    addEntity(s, { kind: 'line', a: [0.5, 9], b: [8, 9] })
    const r = ok(sweepCornerTrim(s, { path: [[-1, -1], [-1, 11], [1.5, 11], [1.5, 7]], radius: 0.1 }, trim))
    expect(near((entityOf(r.sketch, 3) as SketchLine).a, [0, 9])).toBe(true)
  })
  it('a polyline corner that meets to 1e-14 is already made: no change, no undo step', () => {
    // A corner drawn by mouse in the GUI (seed 3, workflow 40): the shared
    // end differs in the 14th decimal. Making it bit-identical is not a trim.
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [5.75, -15], b: [19.999999797673482, -15] })
    addEntity(s, { kind: 'line', a: [19.999999797673517, -15], b: [20, 2.75] })
    addConstraint(s, { kind: 'coincident', p: { entity: 1, at: 'b' }, q: { entity: 2, at: 'a' } })
    const r = sweepCornerTrim(s, { path: [[18, -14], [18, -16.5], [21.5, -16.5], [21.5, -13]], radius: 0.1 }, trim)
    expect(r.result).toEqual({ ok: false, error: 'These pieces already meet at this corner.' })
  })
  it('joins a line and an arc swept across', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [-10, 0], b: [2, 0] })
    addEntity(s, { kind: 'arc', c: [10, 3], r: 5, start: 2, sweep: 1 })
    const r = ok(sweepCornerTrim(s, { path: [[1, -1], [1, 1.5], [5.05, 3.7]], radius: 0.1 }, trim))
    expect(near((entityOf(r.sketch, 1) as SketchLine).b, [6, 0])).toBe(true)
    expect(near(anchorPoint(entityOf(r.sketch, 2)!, 'b'), [6, 0])).toBe(true)
  })
  it('an empty sweep or a single piece changes nothing and says why', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [-10, 0], b: [-1, 0] })
    expect(sweepCornerTrim(s, { path: [[50, 50], [51, 52]], radius: 0.1 }, trim).result).toMatchObject({ ok: false })
    expect(sweepCornerTrim(s, { path: [[-2, -1], [-2, 1]], radius: 0.1 }, trim).result).toMatchObject({ ok: false, error: expect.stringMatching(/second piece/) })
  })
})

// A closed section: a 40 × 30 plate whose bottom-right corner is shaped by
// `corner`, the other corners sharp; dense on the corner, sparse on flats.
function plate(corner: (t: number) => Vec2, steps = 24, noise = 0, seed = 7): Vec2[] {
  let state = seed
  const rand = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648 }
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand())
  const pts: Vec2[] = [[-20, -15]]
  for (let x = -18; x < 10; x += 0.5) pts.push([x, -15])
  for (let i = 0; i <= steps; i++) pts.push(corner(i / steps))
  for (let y = -5; y < 15; y += 0.5) pts.push([20, y])
  pts.push([20, 15], [-20, 15], [-20, -15])
  return noise ? pts.map(([x, y]) => [x + noise * gauss(), y + noise * gauss()]) : pts
}
const roundCorner = (r: number) => (t: number): Vec2 => { const a = -Math.PI / 2 + t * Math.PI / 2; return [20 - r + r * Math.cos(a), -15 + r + r * Math.sin(a)] }
// Lines on the bottom and right edges, stopping short of the corner.
function edges(): Sketch {
  const s = emptySketch()
  addEntity(s, { kind: 'line', a: [-10, -15], b: [12, -15] })
  addEntity(s, { kind: 'line', a: [20, 10], b: [20, -7] })
  return s
}
// Over both line ends and the round, as in QUICKSURFACE (native-21).
const across: Vec2[] = [[11, -16], [11, -5], [21, -5], [21, -16]]
// A thin wedge over the two line ends that leaves the round unpainted (native-15).
const endsOnly: Vec2[] = [[11, -16], [11, -12], [21, -6]]

describe('Auto Fillet reads the corner from the scan', () => {
  it('reconstructs a circular round: radius, centre, tangent points, editable radius', () => {
    const s = edges(), before = cloneSketch(s)
    const r = ok(sweepCornerTrim(s, { path: across, radius: 0.1 }, auto, [], [plate(roundCorner(5))]))
    expect(r.shape).toBe('arc')
    const arc = r.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')!
    // Within the chord sag of a 24-step tessellated round.
    expect(Math.abs(arc.r - 5)).toBeLessThan(0.01)
    expect(near(arc.c, [15, -10], 0.02)).toBe(true)
    const a = entityOf(r.sketch, 1) as SketchLine, b = entityOf(r.sketch, 2) as SketchLine
    expect(near(a.b, [arc.c[0], -15], 1e-6)).toBe(true)
    expect(near(b.b, [20, arc.c[1]], 1e-6)).toBe(true)
    expect(near(a.a, [-10, -15], 1e-9) && near(b.a, [20, 10], 1e-9)).toBe(true)
    expect(r.sketch.constraints.filter((c) => c.kind === 'tangent')).toHaveLength(2)
    expect(r.sketch.constraints.some((c) => c.kind === 'radius')).toBe(true)
    expect(r.confirm).toBeUndefined()
    expect(s).toEqual(before)
  })
  it('fits the section points themselves, giving QUICKSURFACE’s radius on plate-dense', () => {
    // The mid-height section of plate-dense.obj: each outline vertex, then the
    // crossing of the side triangle's diagonal (the chord midpoint). QUICKSURFACE
    // 8.0.128 reads R 5.004061 mm off this round (analysis/corner-sweep-2026-11-19).
    const v = Array.from({ length: 25 }, (_, i) => roundCorner(5)(i / 24))
    const section: Vec2[] = [[-20, -15]]
    for (let x = -19.5; x < 15; x += 0.25) section.push([x, -15])
    for (let i = 0; i < 24; i++) section.push(v[i], [(v[i][0] + v[i + 1][0]) / 2, (v[i][1] + v[i + 1][1]) / 2])
    for (let y = -10; y < 15; y += 0.25) section.push([20, y])
    section.push([20, 15], [-20, 15], [-20, -15])
    const r = ok(sweepCornerTrim(edges(), { path: across, radius: 0.1 }, auto, [], [section]))
    const arc = r.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')!
    expect(Math.abs(arc.r - 5.004061)).toBeLessThan(2e-5)
  })
  it('joins sharp when the sweep covers the line ends but not the scan round, as QUICKSURFACE does', () => {
    const r = ok(sweepCornerTrim(edges(), { path: endsOnly, radius: 0.1 }, auto, [], [plate(roundCorner(5))]))
    expect(r.shape).toBe('sharp')
    expect(r.unswept).toBe(true)
    expect(near((entityOf(r.sketch, 1) as SketchLine).b, [20, -15]) && near((entityOf(r.sketch, 2) as SketchLine).b, [20, -15])).toBe(true)
    expect(r.sketch.entities.some((e) => e.kind === 'arc')).toBe(false)
  })
  it('follows rounds of other sizes and corner angles', () => {
    for (const radius of [1, 2.5, 8]) {
      const r = ok(sweepCornerTrim(edges(), { path: across, radius: 0.1 }, auto, [], [plate(roundCorner(radius), 32)]))
      const arc = r.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')!
      expect(Math.abs(arc.r - radius)).toBeLessThan(0.01 * radius + 0.005)
    }
    // A 120° (obtuse) corner: the right side slants.
    const R = 4, half = Math.PI / 3, dB: Vec2 = [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)]
    const x: Vec2 = [10, -15], t = R / Math.tan(half), c: Vec2 = [x[0] - t, -15 + R]
    const pts: Vec2[] = []
    for (let u = -20; u < 10 - t; u += 0.4) pts.push([u, -15])
    for (let i = 0; i <= 30; i++) { const a = -Math.PI / 2 + (i / 30) * (Math.PI / 3); pts.push([c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]) }
    for (let u = t; u < 20; u += 0.4) pts.push([x[0] + dB[0] * u, x[1] + dB[1] * u])
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [-10, -15], b: [3, -15] })
    addEntity(s, { kind: 'line', a: [x[0] + dB[0] * 18, x[1] + dB[1] * 18], b: [x[0] + dB[0] * 6, x[1] + dB[1] * 6] })
    const r = ok(sweepCornerTrim(s, { path: [[2, -16], [2, -8], [14, -8], [14, -16]], radius: 0.1 }, auto, [], [pts]))
    const arc = r.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')!
    expect(arc.r).toBeCloseTo(R, 2)
  })
  it('stays on the round through scan noise and sets a few spikes aside', () => {
    const noisy = plate(roundCorner(5), 60, 0.02)
    noisy.splice(80, 0, [17.5, -13.5], [18.9, -11.2])
    const r = ok(sweepCornerTrim(edges(), { path: across, radius: 0.1 }, auto, [], [noisy]))
    expect(r.shape).toBe('arc')
    const arc = r.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')!
    expect(Math.abs(arc.r - 5)).toBeLessThan(0.02)
    expect(r.profile!.some((p) => near(p, [17.5, -13.5], 1e-9) || near(p, [18.9, -11.2], 1e-9))).toBe(false)
    expect(r.confirm).toBeUndefined()
  })
  it('asks before applying when a large share of the round is stray', () => {
    // Every fourth vertex on the round pulled 0.5 mm inwards.
    let k = 0
    const torn = plate(roundCorner(5), 30).map((p): Vec2 => {
      const onRound = p[0] > 15.01 && p[1] < -10.01 && p[1] > -14.99
      if (!onRound || k++ % 4) return p
      const d = Math.hypot(p[0] - 15, p[1] + 10)
      return [15 + (p[0] - 15) * (d - 0.5) / d, -10 + (p[1] + 10) * (d - 0.5) / d]
    })
    const r = ok(sweepCornerTrim(edges(), { path: across, radius: 0.1 }, auto, [], [torn]))
    expect(r.shape).toBe('arc')
    expect(r.confirm).toMatch(/stray/)
  })
  it('rounds a corner that is not circular with its least-squares arc, as QUICKSURFACE does (3 x 9 ellipse: R 4.565252)', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [-12, 15], b: [14, 15] })
    addEntity(s, { kind: 'line', a: [20, -4], b: [20, 3] })
    const r = ok(sweepCornerTrim(s, { path: [[13, 16], [13, 2], [21, 2], [21, 16]], radius: 0.1 }, auto, [], [plateDense()]))
    expect(r.shape).toBe('arc')
    expect(r.sketch.entities.some((e) => e.kind === 'spline')).toBe(false)
    const arc = r.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')!
    expect(Math.abs(arc.r - 4.565252)).toBeLessThan(2e-5)
    expect(r.sketch.constraints.filter((c) => c.kind === 'tangent')).toHaveLength(2)
    expect(solveSketch(cloneSketch(r.sketch), {}).ok).toBe(true)
  })
  it('a sharp scan corner joins the lines at their crossing', () => {
    const sharp = (t: number): Vec2 => t < 0.5 ? [10 + 20 * t, -15] : [20, -15 + 20 * (t - 0.5)]
    const r = ok(sweepCornerTrim(edges(), { path: across, radius: 0.1 }, auto, [], [plate(sharp, 20)]))
    expect(r.shape).toBe('sharp')
    expect(near((entityOf(r.sketch, 1) as SketchLine).b, [20, -15])).toBe(true)
    expect(r.sketch.entities).toHaveLength(2)
  })
  it('a chamfered scan corner still gets a tangent arc, never a chamfer line', () => {
    const chamfer = (t: number): Vec2 => [16 + 4 * t, -15 + 4 * t]
    const r = ok(sweepCornerTrim(edges(), { path: across, radius: 0.1 }, auto, [], [plate(chamfer, 20)]))
    expect(r.shape).toBe('arc')
    expect(r.sketch.entities.map((e) => e.kind).sort()).toEqual(['arc', 'line', 'line'])
  })
  it('refuses rather than guesses when no scan section reaches the corner', () => {
    const away = [[-50, -50], [-40, -50], [-40, -40]] as Vec2[]
    const r = sweepCornerTrim(edges(), { path: across, radius: 0.1 }, auto, [], [away])
    expect(r.result.ok).toBe(false)
  })
  it('lines fitted slightly off the scan still find the round', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [-10, -15.05], b: [12, -15] })
    addEntity(s, { kind: 'line', a: [20.03, 10], b: [20, -7] })
    const r = ok(sweepCornerTrim(s, { path: across, radius: 0.1 }, auto, [], [plate(roundCorner(5), 40)]))
    const arc = r.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')!
    expect(Math.abs(arc.r - 5)).toBeLessThan(0.1)
  })
})

// The mid-height section of analysis/corner-sweep-2026-11-19/plate-dense.obj:
// outline vertices (flats every 0.5, R5 bottom-right in 24 steps, 3 x 9
// quarter ellipse top-right in 32) and the chord midpoints between them.
function plateDense(): Vec2[] {
  const o: Vec2[] = []
  const seg = (a: Vec2, b: Vec2) => { const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5)); for (let i = 0; i < n; i++) o.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]) }
  seg([-20, -15], [15, -15])
  for (let i = 0; i < 24; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * i / 24; o.push([15 + 5 * Math.cos(a), -10 + 5 * Math.sin(a)]) }
  seg([20, -10], [20, 6])
  for (let i = 0; i < 32; i++) { const a = (Math.PI / 2) * i / 32; o.push([17 + 3 * Math.cos(a), 6 + 9 * Math.sin(a)]) }
  seg([17, 15], [-20, 15]); seg([-20, 15], [-20, -15])
  const out: Vec2[] = []
  for (let i = 0; i < o.length; i++) { const a = o[i], b = o[(i + 1) % o.length]; out.push(a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) }
  out.push(o[0])
  return out
}

describe('the corner point decides a fillet, as in QUICKSURFACE', () => {
  const fixed: CornerTrimOptions = { mode: 'fixedFillet', radiusMm: 3, addDimension: true }
  const roundPts = plateDense().filter((p) => p[0] > 15 && p[1] < -10 && p[0] < 20 && p[1] > -15)
  // Most of the round painted, the corner point (20, -15) not.
  const roundNotCorner: Vec2[] = [[11.5, -15.5], [11.5, -5], [20.6, -5], [20.6, -14.2]]
  // The corner point and the line ends painted, almost none of the round.
  const cornerNotRound: Vec2[] = [[20, -15], [11, -15.1], [11, -14.95], [20, -15], [20.1, -6.5], [19.95, -6.5]]
  it('the test sweeps paint what they say', () => {
    const a = new SweepArea({ path: roundNotCorner, radius: 0.1 }), b = new SweepArea({ path: cornerNotRound, radius: 0.1 })
    expect(a.contains([20, -15])).toBe(false)
    expect(roundPts.filter((p) => a.contains(p)).length).toBeGreaterThan(0.6 * roundPts.length)
    expect(b.contains([20, -15])).toBe(true)
    // Only within 0.1 mm of the lines, where the round runs into them; the
    // round itself bulges 1.46 mm off its corner.
    const painted = roundPts.filter((p) => b.contains(p))
    expect(painted.length).toBeLessThan(0.25 * roundPts.length)
    expect(painted.every((p) => Math.min(p[1] + 15, 20 - p[0]) < 0.1)).toBe(true)
  })
  it('Auto Fillet over the round but not the corner point joins sharp', () => {
    const r = ok(sweepCornerTrim(edges(), { path: roundNotCorner, radius: 0.1 }, auto, [], [plateDense()]))
    expect(r.unswept).toBe(true)
    expect(r.shape).toBe('sharp')
    expect(r.sketch.entities.some((e) => e.kind === 'arc')).toBe(false)
    expect(near((entityOf(r.sketch, 1) as SketchLine).b, [20, -15]) && near((entityOf(r.sketch, 2) as SketchLine).b, [20, -15])).toBe(true)
  })
  it('Auto Fillet over the corner point fits the whole section round, swept or not (R 5.004061)', () => {
    const r = ok(sweepCornerTrim(edges(), { path: cornerNotRound, radius: 0.1 }, auto, [], [plateDense()]))
    const arc = r.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')!
    expect(Math.abs(arc.r - 5.004061)).toBeLessThan(2e-5)
  })
  it('the held preview is rebuilt when the sweep reaches the corner point', () => {
    // Same pair and ends, but only the second area holds the corner point.
    const before = sweptCandidates(edges(), { path: roundNotCorner, radius: 0.1 })
    const after = sweptCandidates(edges(), { path: [...roundNotCorner, [20.6, -15.5]], radius: 0.1 })
    expect(before.pairs[0].ids.sort()).toEqual(after.pairs[0].ids.sort())
    expect(before.key).not.toBe(after.key)
  })
  it('Fixed Size Fillet follows the same rule', () => {
    const sharp = ok(sweepCornerTrim(edges(), { path: endsOnly, radius: 0.1 }, fixed))
    expect(sharp.unswept).toBe(true)
    expect(sharp.sketch.entities.some((e) => e.kind === 'arc')).toBe(false)
    const round = ok(sweepCornerTrim(edges(), { path: across, radius: 0.1 }, fixed))
    expect(round.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')!.r).toBeCloseTo(3, 9)
  })
  it('a fillet between separate lines is the join and then the fillet (two undo steps); between joined lines, one', () => {
    const r = ok(sweepCornerTrim(edges(), { path: across, radius: 0.1 }, auto, [], [plateDense()]))
    expect(r.joined).toBeDefined()
    expect(r.joined!.entities.some((e) => e.kind === 'arc')).toBe(false)
    expect(near((entityOf(r.joined!, 1) as SketchLine).b, [20, -15]) && near((entityOf(r.joined!, 2) as SketchLine).b, [20, -15])).toBe(true)
    const again = ok(sweepCornerTrim(r.joined!, { path: across, radius: 0.1 }, auto, [], [plateDense()]))
    expect(again.joined).toBeUndefined()
    expect(again.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')!.r).toBeCloseTo(r.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')!.r, 9)
    // Corner Trim and an unswept fillet are a single step.
    expect(ok(sweepCornerTrim(edges(), { path: across, radius: 0.1 }, trim)).joined).toBeUndefined()
    expect(ok(sweepCornerTrim(edges(), { path: endsOnly, radius: 0.1 }, auto, [], [plateDense()])).joined).toBeUndefined()
  })
})
