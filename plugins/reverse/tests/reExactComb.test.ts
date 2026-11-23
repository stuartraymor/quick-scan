// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul 6: the curvature comb from the true derivative
// curvature — 0 on a line, 1/R on an arc — with no spikes, clamped teeth,
// even arc-length spacing and the tips' line touching the curve at an
// inflection.
import { describe, expect, it } from 'vitest'
import { addEntity, emptySketch, entityOf } from '../core/sketch'
import { DEFAULT_COMB, exactComb } from '../core/curvatureComb'

const length = (a: readonly number[], b: readonly number[]) => Math.hypot(b[0] - a[0], b[1] - a[1])
const piece = (input: Parameters<typeof addEntity>[1]) => { const s = emptySketch(); return entityOf(s, addEntity(s, input))! }

describe('exact curvature comb', () => {
  it('gives a line teeth of length 0', () => {
    const c = exactComb(piece({ kind: 'line', a: [0, 0], b: [30, 7] }), DEFAULT_COMB)!
    expect(c.teeth.length).toBeGreaterThan(10)
    for (const [a, b] of c.teeth) expect(length(a, b)).toBe(0)
  })
  it('gives an R10 arc teeth of 0.1 × scale, all outward and evenly spaced', () => {
    const c = exactComb(piece({ kind: 'arc', c: [3, -2], r: 10, start: 0.3, sweep: 2 }), { ...DEFAULT_COMB, scale: 50, density: 40 })!
    expect(c.teeth.length).toBe(41)
    for (const [a, b] of c.teeth) {
      expect(length(a, b)).toBeCloseTo(5, 10)
      expect(length([3, -2], b)).toBeCloseTo(15, 10)
    }
    const gaps = c.teeth.slice(1).map(([a], i) => length(c.teeth[i][0], a))
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6)
    expect(c.extreme!.k).toBeCloseTo(0.1, 12)
  })
  it('keeps a circle constant, clockwise arcs signed the other way', () => {
    const circle = exactComb(piece({ kind: 'circle', c: [0, 0], r: 4 }), { ...DEFAULT_COMB, scale: 8 })!
    for (const [a, b] of circle.teeth) expect(length(a, b)).toBeCloseTo(2, 10)
    const cw = exactComb(piece({ kind: 'arc', c: [0, 0], r: 10, start: 2, sweep: -1.5 }), DEFAULT_COMB)!
    expect(cw.extreme!.k).toBeCloseTo(-0.1, 12)
    for (const [, b] of cw.teeth) expect(Math.hypot(b[0], b[1])).toBeCloseTo(15, 10)
  })
  it('clamps every tooth to the maximum length, with no NaN or infinity', () => {
    const tight = exactComb(piece({ kind: 'spline', pts: [[0, 0], [5, 0.01], [5.02, 5], [0, 5.1]] }), { ...DEFAULT_COMB, scale: 1000, maxLength: 3 })!
    expect(tight.clamped).toBeGreaterThan(0)
    for (const [a, b] of tight.teeth) {
      expect([...a, ...b].every(Number.isFinite)).toBe(true)
      // The limit is given at the default scale and grows with the scale.
      expect(length(a, b)).toBeLessThanOrEqual((3 * 1000) / DEFAULT_COMB.scale + 1e-9)
    }
  })
  it('every bend answers the scale: a tight arc at the limit grows and shrinks with the slider like a gentle one', () => {
    const tight = piece({ kind: 'arc', c: [0, 0], r: 1, start: 0, sweep: 1.5 })
    const gentle = piece({ kind: 'arc', c: [0, 0], r: 40, start: 0, sweep: 1.5 })
    const tooth = (e: ReturnType<typeof piece>, scale: number) => { const c = exactComb(e, { ...DEFAULT_COMB, scale })!; return length(c.teeth[3][0], c.teeth[3][1]) }
    for (const [lo, hi] of [[50, 100], [100, 400], [400, 500]]) {
      expect(tooth(tight, hi) / tooth(tight, lo)).toBeCloseTo(hi / lo, 9)
      expect(tooth(gentle, hi) / tooth(gentle, lo)).toBeCloseTo(hi / lo, 9)
    }
    // The tight one is still held back: no taller than the limit allows.
    expect(tooth(tight, 50)).toBeCloseTo(DEFAULT_COMB.maxLength, 9)
  })
  it('crosses at an inflection, the tips line touching the curve', () => {
    const s = piece({ kind: 'spline', pts: [[0, 0], [10, 6], [20, 0], [30, -6], [40, 0]] })
    const c = exactComb(s, { ...DEFAULT_COMB, density: 80 })!
    expect(c.envelopes).toHaveLength(1)
    // Teeth on both sides, and a tip line point that lies on the curve.
    const env = c.envelopes[0]
    expect(env.length).toBeGreaterThan(c.teeth.length)
    const onCurve = env.filter((p) => c.teeth.some(([a]) => length(a, p) < 0.6))
    expect(onCurve.length).toBeGreaterThan(0)
    const unsigned = exactComb(s, { ...DEFAULT_COMB, density: 80, signed: false })!
    expect(unsigned.envelopes[0].length).toBe(unsigned.teeth.length)
  })
  it('smooths a noisy curve when asked, and draws the offset reference', () => {
    const pts: [number, number][] = Array.from({ length: 30 }, (_, i) => [i, 0.02 * Math.sin(i * 2.7)])
    const s = piece({ kind: 'spline', pts })
    const spread = (c: NonNullable<ReturnType<typeof exactComb>>) => Math.max(...c.teeth.map(([a, b]) => length(a, b)))
    const raw = exactComb(s, { ...DEFAULT_COMB, density: 300 })!, smooth = exactComb(s, { ...DEFAULT_COMB, density: 300, smooth: 6, offset: 2 })!
    expect(spread(smooth)).toBeLessThan(spread(raw))
    expect(smooth.offsetLine).toHaveLength(smooth.teeth.length)
    for (let i = 0; i < smooth.teeth.length; i++) expect(length(smooth.teeth[i][0], smooth.offsetLine![i])).toBeCloseTo(2, 9)
  })
  it('refuses a point and survives silly options', () => {
    expect(exactComb(piece({ kind: 'point', p: [1, 1] }), DEFAULT_COMB)).toBeNull()
    const c = exactComb(piece({ kind: 'arc', c: [0, 0], r: 1, start: 0, sweep: 1 }), { scale: NaN, density: -5, maxLength: Infinity, signed: true, smooth: 1e9, offset: NaN })!
    expect(c.teeth.length).toBeGreaterThanOrEqual(4)
    for (const [a, b] of c.teeth) expect([...a, ...b].every(Number.isFinite)).toBe(true)
    expect(c.offsetLine).toBeNull()
  })

  it('breaks the envelope where a spline turns a corner, and nowhere on a smooth one', () => {
    // A control-pole spline with three poles in a row at the middle joint
    // stands still there: a cusp, where the comb must not draw across.
    const s = emptySketch()
    const smooth = addEntity(s, { kind: 'spline', pts: [[0, 0], [10, 6], [20, -2], [30, 4]] })
    const cusp = addEntity(s, { kind: 'spline', pts: [[0, 0], [5, 8], [10, 0], [10, 0], [10, 0], [15, 8], [20, 0]], controlKnots: [0, 1, 2, 3, 4] })
    const a = exactComb(entityOf(s, smooth)!, { ...DEFAULT_COMB, density: 80 })!
    expect(a.breaks).toBe(0)
    expect(a.envelopes).toHaveLength(1)
    const b = exactComb(entityOf(s, cusp)!, { ...DEFAULT_COMB, density: 80 })!
    expect(b.breaks).toBeGreaterThanOrEqual(1)
    expect(b.envelopes.length).toBe(b.breaks + 1)
    for (const t of b.teeth) for (const p of t) expect(p.every(Number.isFinite)).toBe(true)
    // Knots that do not fit the poles: no comb, never a throw.
    const bad = addEntity(s, { kind: 'spline', pts: [[0, 0], [5, 8], [10, 0], [15, 8], [20, 0]], controlKnots: [0, 1] })
    expect(exactComb(entityOf(s, bad)!, DEFAULT_COMB)).toBeNull()
  })
})
