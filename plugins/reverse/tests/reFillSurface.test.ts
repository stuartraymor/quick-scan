// SPDX-License-Identifier: AGPL-3.0-only
// Fill Surface's patch (core/fill.ts) against QUICKSURFACE 8.0.128's own on the
// four-curve loop on the basic_part wall (fixtures/native-fill-wall4-curves.json,
// the loop as exported with it) and the native surface itself (native-fill-wall4-surface.json).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { FILL_SIDES_REFUSAL, fillGrid } from '../core/fill'
import { polylinePath } from '../core/freeform/sketch'

const here = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const sidesOf = () => (JSON.parse(here('native-fill-wall4-curves.json')) as { curves: number[][][] }).curves.map((c) => polylinePath(c.flat()))

/** A point of a non-rational B-spline curve of control points `pts` and knots, at t (de Boor). */
function deBoor(knots: number[], pts: Vec3[], degree: number, t: number): Vec3 {
  const n = pts.length
  let k = degree
  while (k < n - 1 && t >= knots[k + 1]) k++
  const d = Array.from({ length: degree + 1 }, (_, j) => [...pts[k - degree + j]])
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = k - degree + j
      const a = (t - knots[i]) / (knots[i + degree - r + 1] - knots[i])
      for (let c = 0; c < 3; c++) d[j][c] = (1 - a) * d[j - 1][c] + a * d[j][c]
    }
  }
  return d[degree] as Vec3
}

/** QUICKSURFACE's Fill Surface on the loop (IGES entity 128), sampled `n` × `n` times across its parameter. */
function nativeSamples(n: number): number[][] {
  const f = JSON.parse(here('native-fill-wall4-surface.json')) as { degree: [number, number]; knotsU: number[]; knotsV: number[]; rowsV: number; colsU: number; points: Vec3[][] }
  const [du, dv] = f.degree
  const u0 = f.knotsU[du]
  const u1 = f.knotsU[f.colsU]
  const v0 = f.knotsV[dv]
  const v1 = f.knotsV[f.rowsV]
  const out: number[][] = []
  for (let a = 0; a < n; a++) {
    const u = u0 + ((u1 - u0) * a) / (n - 1) - (a === n - 1 ? 1e-9 : 0)
    const column = f.points.map((row) => deBoor(f.knotsU, row, du, u))
    for (let b = 0; b < n; b++) {
      const v = v0 + ((v1 - v0) * b) / (n - 1) - (b === n - 1 ? 1e-9 : 0)
      out.push(deBoor(f.knotsV, column, dv, v))
    }
  }
  return out
}
const native = nativeSamples(301)

describe('Fill Surface patch', () => {
  it('holds the four curves exactly, corners shared', () => {
    const sides = sidesOf()
    const g = fillGrid(sides, 41)
    expect(g.rows).toBe(41)
    expect(g.cols).toBe(41)
    const at = (j: number, i: number): Vec3 => [g.points[(j * 41 + i) * 3], g.points[(j * 41 + i) * 3 + 1], g.points[(j * 41 + i) * 3 + 2]]
    const near = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    for (const s of [0, 0.25, 0.5, 1]) {
      expect(near(at(0, Math.round(s * 40)), sides[0].at(s))).toBeLessThan(1e-9)
      expect(near(at(Math.round(s * 40), 40), sides[1].at(s))).toBeLessThan(1e-9)
      expect(near(at(40, Math.round(s * 40)), sides[2].at(1 - s))).toBeLessThan(1e-9)
      expect(near(at(Math.round(s * 40), 0), sides[3].at(1 - s))).toBeLessThan(1e-9)
    }
  })

  it('lies on the native surface to what the curves’ own parameter allows (0.44 mm at most when measured, all of it parameter)', () => {
    const g = fillGrid(sidesOf(), 41)
    const d: number[] = []
    for (let k = 0; k < g.points.length; k += 3) {
      let best = Infinity
      for (const s of native) {
        const e = Math.hypot(g.points[k] - s[0], g.points[k + 1] - s[1], g.points[k + 2] - s[2])
        if (e < best) best = e
      }
      d.push(best)
    }
    const mean = d.reduce((a, b) => a + b, 0) / d.length
    const max = Math.max(...d)
    console.log(`Fill patch to native Fill Surface: mean ${mean.toFixed(3)} max ${max.toFixed(3)} mm over ${d.length} samples`)
    expect(mean).toBeLessThan(0.3)
    expect(max).toBeLessThan(0.6)
  })

  it('is no plane: it bows with the wall as the native one does', () => {
    const g = fillGrid(sidesOf(), 41)
    const p = (j: number, i: number): Vec3 => [g.points[(j * 41 + i) * 3], g.points[(j * 41 + i) * 3 + 1], g.points[(j * 41 + i) * 3 + 2]]
    const a = p(0, 0)
    const b = p(0, 40)
    const d = p(40, 0)
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
    const nx = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const len = Math.hypot(nx[0], nx[1], nx[2])
    const m = p(20, 20)
    const off = Math.abs(((m[0] - a[0]) * nx[0] + (m[1] - a[1]) * nx[1] + (m[2] - a[2]) * nx[2]) / len)
    expect(off).toBeGreaterThan(3)
  })

  it('refuses a region that is not four-sided, and a sample count out of range', () => {
    const sides = sidesOf()
    expect(() => fillGrid(sides.slice(0, 3))).toThrow(FILL_SIDES_REFUSAL)
    expect(() => fillGrid(sides, 3)).toThrow(/samples a side/)
  })
})
