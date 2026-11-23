// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul 4: live tolerance analysis against the section contour.
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { addEntity, emptySketch } from '../core/sketch'
import { contourDistance, contourGrid, gradientColor, gradientPieces, sketchDeviation } from '../core/sketchDeviation'

/** A straight section from x = 0 to 100 along y = 0, sampled every 0.5. */
const flat = (): Vec2[][] => [Array.from({ length: 201 }, (_, i): Vec2 => [i * 0.5, 0])]

describe('sketch tolerance analysis', () => {
  it('one line passes along part of its length and fails along the rest', () => {
    // The line climbs from 0 to 0.4 mm off the section over 100 mm: with a
    // 0.1 mm tolerance it passes for the first quarter and fails after.
    const s = emptySketch(); addEntity(s, { kind: 'line', a: [0, 0], b: [100, 0.4] })
    const r = sketchDeviation(s, flat(), 0.1)!
    const pass = r.runs.filter((x) => x.cls === 'pass'), fail = r.runs.filter((x) => x.cls === 'fail')
    expect(pass).toHaveLength(1); expect(fail).toHaveLength(1)
    // The split is where the line is 0.1 mm off: x = 25, to well within a sample.
    expect(pass[0].pts.at(-1)![0]).toBeCloseTo(25, 6)
    expect(fail[0].pts[0][0]).toBeCloseTo(25, 6)
    expect(r.stats.passShare).toBeGreaterThan(0.24); expect(r.stats.passShare).toBeLessThan(0.26)
    expect(r.stats.max).toBeCloseTo(0.4, 6); expect(r.stats.min).toBeCloseTo(0, 9)
  })
  it('changing the tolerance moves the split at once', () => {
    const s = emptySketch(); addEntity(s, { kind: 'line', a: [0, 0], b: [100, 0.4] })
    const r = sketchDeviation(s, flat(), 0.3)!
    expect(r.runs.find((x) => x.cls === 'pass')!.pts.at(-1)![0]).toBeCloseTo(75, 6)
    expect(sketchDeviation(s, flat(), 0.5)!.runs.every((x) => x.cls === 'pass')).toBe(true)
  })
  it('measures arcs and circles to the right loop, not another one', () => {
    // Two concentric section circles, R10 and R20; a sketch circle R10.2.
    const ring = (r: number): Vec2[] => Array.from({ length: 721 }, (_, i): Vec2 => [r * Math.cos(i * Math.PI / 360), r * Math.sin(i * Math.PI / 360)])
    const s = emptySketch(); addEntity(s, { kind: 'circle', c: [0, 0], r: 10.2 })
    const r = sketchDeviation(s, [ring(10), ring(20)], 0.1)!
    expect(r.stats.mean).toBeCloseTo(0.2, 3)
    expect(r.runs.every((x) => x.cls === 'fail')).toBe(true)
    expect(sketchDeviation(s, [ring(10), ring(20)], 0.25)!.runs.every((x) => x.cls === 'pass')).toBe(true)
  })
  it('a piece far from any section has no reading, never a fake colour', () => {
    const s = emptySketch(); addEntity(s, { kind: 'line', a: [0, 50], b: [100, 50] })
    const r = sketchDeviation(s, flat(), 0.1)!
    expect(r.runs.every((x) => x.cls === 'none')).toBe(true)
    expect(r.stats.samples).toBe(0); expect(r.stats.unread).toBeGreaterThan(0)
  })
  it('construction pieces and gaps in the scan are left out', () => {
    const s = emptySketch(); addEntity(s, { kind: 'line', a: [0, 0.3], b: [100, 0.3], construction: true })
    expect(sketchDeviation(s, flat(), 0.1)!.runs).toHaveLength(0)
    // Two separate pieces of section, 40 mm apart, are never joined.
    const gapped: Vec2[][] = [Array.from({ length: 41 }, (_, i): Vec2 => [i * 0.5, 0]), Array.from({ length: 41 }, (_, i): Vec2 => [60 + i * 0.5, 0])]
    const grid = contourGrid(gapped)!
    expect(contourDistance(grid, [40, 0], 5)).toBeNull()
    expect(contourDistance(grid, [10, 0.05], 5)).toBeCloseTo(0.05, 9)
  })
  it('a long flat step of the section (a large flat face) is measured along its length', () => {
    const chain: Vec2[] = [[-20, -10], [-15, -15], [15, -15], [20, -10], ...Array.from({ length: 200 }, (_, i): Vec2 => [20 - i * 0.01, -10 + i * 0.01])]
    const grid = contourGrid([chain])!
    expect(contourDistance(grid, [0, -14.9], 1)).toBeCloseTo(0.1, 9)
    expect(contourDistance(grid, [7.3, -15.25], 1)).toBeCloseTo(0.25, 9)
  })
  it('the grid lookup agrees with brute force', () => {
    const pts: Vec2[] = Array.from({ length: 500 }, (_, i): Vec2 => [i * 0.3 + Math.sin(i) * 0.1, Math.cos(i * 0.05) * 5])
    const grid = contourGrid([pts])!
    for (let k = 0; k < 200; k++) {
      const p: Vec2 = [(k * 37) % 150, ((k * 13) % 14) - 7]
      let best = Infinity
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1]
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
        best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
      }
      const got = contourDistance(grid, p, 3)
      if (best <= 3) expect(got).toBeCloseTo(best, 9); else expect(got).toBeNull()
    }
  })
  it('gradient colours run green, amber, red', () => {
    expect(gradientColor(0)).toBe('#2fbf71'); expect(gradientColor(1)).toBe('#f0be32'); expect(gradientColor(5)).toBe('#e5484d')
    const s = emptySketch(); addEntity(s, { kind: 'line', a: [0, 0], b: [100, 0.4] })
    const r = sketchDeviation(s, flat(), 0.1)!
    const pieces = r.runs.flatMap((x) => gradientPieces(x, 0.1))
    expect(new Set(pieces.map((p) => p.color)).size).toBeGreaterThan(5)
  })
  it('a looser tolerance never makes more pieces fail', () => {
    // A piece 4 mm off a 100 mm section: no reading at any sensible tolerance.
    const s = emptySketch(); addEntity(s, { kind: 'line', a: [0, 0], b: [100, 0.4] }); addEntity(s, { kind: 'line', a: [20, 6], b: [60, 6] })
    let last = Infinity
    for (const tol of [0.05, 0.1, 0.3, 1, 2]) {
      const r = sketchDeviation(s, flat(), tol)!
      expect(r.stats.failing.length).toBeLessThanOrEqual(last); last = r.stats.failing.length
      expect(r.stats.failing).not.toContain(2)
    }
  })
  it('refuses a bad tolerance or an empty section', () => {
    const s = emptySketch(); addEntity(s, { kind: 'line', a: [0, 0], b: [1, 0] })
    expect(sketchDeviation(s, flat(), 0)).toBeNull(); expect(sketchDeviation(s, flat(), Number.NaN)).toBeNull()
    expect(sketchDeviation(s, [], 0.1)).toBeNull()
  })
})

describe('deviation runs name their piece', () => {
  it('each run carries the id of the sketch piece it lies on, so a selected piece can show through', () => {
    const s = emptySketch()
    const a = addEntity(s, { kind: 'line', a: [0, 0], b: [40, 0] })
    const b = addEntity(s, { kind: 'line', a: [60, 0], b: [100, 0.4] })
    const r = sketchDeviation(s, flat(), 0.1)!
    const ids = new Set(r.runs.map((x) => x.entity))
    expect(ids).toEqual(new Set([a, b]))
  })
})
