// SPDX-License-Identifier: AGPL-3.0-only
// Extend Surface's run-on (core/extend.ts) against QUICKSURFACE 8.0.128's own:
// the Fit Surface of the basic_part wall (fixtures/native-extend-wall-grid.json,
// its 5 × 5 degree-4 net sampled 41 × 41), its whole edge chain run on 10 mm in
// each type, as exported (native-extend-{natural,soft,linear}10-surface.json:
// the native surface sampled 121 × 121 over its trimmed region and a little
// past it). What is held: the new edge lies 10 mm past the old, the
// corners stand where the native ones do, and the surface through the longer
// grid follows the native surface to a fraction of a millimetre.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXTEND_TYPES, type ExtendType, extendGrid, type PointGrid, runOn, runOnCount } from '../core/extend'

const here = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
type P3 = [number, number, number]
const gridOf = (name: string): PointGrid => {
  const f = JSON.parse(here(name)) as { rows: number; cols: number; points: number[] }
  return { rows: f.rows, cols: f.cols, points: Float64Array.from(f.points) }
}
const pt = (g: PointGrid, r: number, c: number): P3 => [g.points[(r * g.cols + c) * 3], g.points[(r * g.cols + c) * 3 + 1], g.points[(r * g.cols + c) * 3 + 2]]
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: P3) => Math.hypot(a[0], a[1], a[2])

/** Distance from p to triangle abc (Ericson, Real-Time Collision Detection). */
function toTriangle(p: P3, a: P3, b: P3, c: P3): number {
  const ab = sub(b, a)
  const ac = sub(c, a)
  const ap = sub(p, a)
  const d1 = dot(ab, ap)
  const d2 = dot(ac, ap)
  const along = (q: P3) => len(sub(p, q))
  if (d1 <= 0 && d2 <= 0) return along(a)
  const bp = sub(p, b)
  const d3 = dot(ab, bp)
  const d4 = dot(ac, bp)
  if (d3 >= 0 && d4 <= d3) return along(b)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3)
    return along([a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]])
  }
  const cp = sub(p, c)
  const d5 = dot(ab, cp)
  const d6 = dot(ac, cp)
  if (d6 >= 0 && d5 <= d6) return along(c)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6)
    return along([a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]])
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return along([b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])])
  }
  const denom = 1 / (va + vb + vc)
  const v = vb * denom
  const w = vc * denom
  return along([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w])
}

/** Distance from p to the nearest facet of a grid, by the facets round its nearest grid point. */
function toGrid(p: P3, g: PointGrid, near: (p: P3) => [number, number]): number {
  const [r0, c0] = near(p)
  let best = Infinity
  for (let r = Math.max(0, r0 - 2); r < Math.min(g.rows - 1, r0 + 2); r++) {
    for (let c = Math.max(0, c0 - 2); c < Math.min(g.cols - 1, c0 + 2); c++) {
      const a = pt(g, r, c)
      const b = pt(g, r, c + 1)
      const d = pt(g, r + 1, c)
      const e = pt(g, r + 1, c + 1)
      best = Math.min(best, toTriangle(p, a, b, e), toTriangle(p, a, e, d))
    }
  }
  return best
}

/** A nearest-grid-point lookup by hashing the points into cells. */
function nearestIn(g: PointGrid, cell = 6): (p: P3) => [number, number] {
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
  const bins = new Map<string, number[]>()
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const [x, y, z] = pt(g, r, c)
      const k = key(x, y, z)
      const list = bins.get(k)
      if (list) list.push(r * g.cols + c)
      else bins.set(k, [r * g.cols + c])
    }
  }
  return (p) => {
    let best = -1
    let bestD = Infinity
    for (let ring = 1; ring <= 6 && best < 0; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          for (let dz = -ring; dz <= ring; dz++) {
            const list = bins.get(key(p[0] + dx * cell, p[1] + dy * cell, p[2] + dz * cell))
            if (!list) continue
            for (const i of list) {
              const q = pt(g, Math.floor(i / g.cols), i % g.cols)
              const d = len(sub(p, q))
              if (d < bestD) {
                bestD = d
                best = i
              }
            }
          }
        }
      }
    }
    return best < 0 ? [0, 0] : [Math.floor(best / g.cols), best % g.cols]
  }
}

const wall = gridOf('native-extend-wall-grid.json')
const all = { u0: 10, u1: 10, v0: 10, v1: 10 }

/** The grid's outer boundary points, in order round. */
const rim = (g: PointGrid): P3[] => {
  const out: P3[] = []
  for (let c = 0; c < g.cols; c++) out.push(pt(g, 0, c))
  for (let r = 1; r < g.rows; r++) out.push(pt(g, r, g.cols - 1))
  for (let c = g.cols - 2; c >= 0; c--) out.push(pt(g, g.rows - 1, c))
  for (let r = g.rows - 2; r >= 1; r--) out.push(pt(g, r, 0))
  return out
}

/** The native trimmed region's corners (IGES entities 19–25 of each export, mm). */
const NATIVE_CORNERS: Record<ExtendType, P3[]> = {
  natural: [[-108.96, 68.72, -220.85], [110.09, 63.01, -225.19], [109.78, 67.63, 10.69], [-113.55, 60.28, 15.08]],
  linear: [[-109.03, 68.72, -220.85], [110.08, 63.01, -225.19], [109.75, 67.63, 10.7], [-113.45, 60.29, 15.1]],
  soft: [[-108.99, 68.72, -220.85], [110.12, 63.0, -225.19], [109.79, 67.63, 10.69], [-113.54, 60.28, 15.09]],
}

describe('Extend Surface run-on', () => {
  it('runs an edge on along its own line, curve and fade as asked', () => {
    // Eight points 0.1 rad apart on a circle of radius 50 (5 mm apart); run on 10 mm from the last.
    const line: P3[] = Array.from({ length: 8 }, (_, k) => [50 * Math.cos(0.1 * k), 50 * Math.sin(0.1 * k), 0] as P3)
    const last = line[line.length - 1]
    const natural = runOn(line, 10, 4, 'natural')
    const linear = runOn(line, 10, 4, 'linear')
    const soft = runOn(line, 10, 4, 'soft')
    // Natural stays on the circle to a few microns; linear leaves it by the sagitta, soft in between.
    const off = (p: P3) => Math.hypot(p[0], p[1]) - 50
    expect(Math.abs(off(natural[3]))).toBeLessThan(0.1)
    expect(off(linear[3])).toBeGreaterThan(0.9)
    expect(off(soft[3])).toBeGreaterThan(Math.abs(off(natural[3])))
    expect(off(soft[3])).toBeLessThan(off(linear[3]))
    // Every type starts from the end and runs on by arc: 10 mm at the last point.
    for (const run of [natural, linear, soft]) expect(len(sub(run[3], last))).toBeGreaterThan(9.7)
    expect(len(sub(linear[3], last))).toBeCloseTo(10, 6)
  })

  it('needs four points and a direction', () => {
    expect(() => runOn([[0, 0, 0], [1, 0, 0], [2, 0, 0]], 1, 2, 'natural')).toThrow(/four points/)
    expect(() => runOn([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], 1, 2, 'natural')).toThrow()
    expect(runOnCount(5, 10)).toBe(2)
    expect(runOnCount(2, 10)).toBe(5)
    expect(runOnCount(0, 10)).toBe(2)
    expect(runOnCount(100, 1)).toBe(2)
  })

  it('keeps the old grid whole and runs every side on', () => {
    const grown = extendGrid(wall, all, 'natural')
    expect(grown.rows).toBeGreaterThan(wall.rows)
    expect(grown.cols).toBeGreaterThan(wall.cols)
    expect(grown.points.length).toBe(grown.rows * grown.cols * 3)
    // Where the old grid sits in the new: the old corner's place.
    let dr = -1
    let dc = -1
    for (let r = 0; r < grown.rows; r++) for (let c = 0; c < grown.cols; c++) if (len(sub(pt(grown, r, c), pt(wall, 0, 0))) < 1e-9) [dr, dc] = [r, c]
    expect(dr).toBeGreaterThan(0)
    expect(dc).toBeGreaterThan(0)
    expect(dr + wall.rows).toBeLessThan(grown.rows)
    expect(dc + wall.cols).toBeLessThan(grown.cols)
    for (let r = 0; r < wall.rows; r += 8) for (let c = 0; c < wall.cols; c += 8) expect(len(sub(pt(grown, r + dr, c + dc), pt(wall, r, c)))).toBeLessThan(1e-9)
    expect(grown.points.every(Number.isFinite)).toBe(true)
  })

  it('runs only the sides named', () => {
    const one = extendGrid(wall, { v1: 10 }, 'linear')
    expect(one.cols).toBe(wall.cols)
    expect(one.rows).toBeGreaterThan(wall.rows)
    // The old rows are the first of the new: only the far edge grew.
    for (let c = 0; c < wall.cols; c += 8) expect(len(sub(pt(one, 0, c), pt(wall, 0, c)))).toBeLessThan(1e-9)
    expect(extendGrid(wall, {}, 'linear')).toBe(wall)
    expect(() => extendGrid({ points: new Float64Array(9), rows: 1, cols: 3 }, all, 'natural')).toThrow(/malformed/)
  })

  for (const type of EXTEND_TYPES) {
    it(`${type}: the new edge lies 10 mm past the old, its corners where QUICKSURFACE’s are`, () => {
      const grown = extendGrid(wall, all, type)
      const oldRim = rim(wall)
      // Each point of the new rim to the old rim's polyline: about 10 mm along the surface (the chord is a little less on a curve).
      const toOld = (p: P3) => {
        let best = Infinity
        for (let i = 0; i + 1 < oldRim.length; i++) {
          const a = oldRim[i]
          const b = oldRim[i + 1]
          const ab = sub(b, a)
          const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / dot(ab, ab)))
          best = Math.min(best, len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t])))
        }
        return best
      }
      const far = rim(grown).map(toOld)
      const mean = far.reduce((a, b) => a + b, 0) / far.length
      expect(mean).toBeGreaterThan(9.6)
      expect(mean).toBeLessThan(10.1)
      // The corners: each native corner has one of ours within a millimetre or two (ours run on the edges, native trims a parameter box).
      const ours = [pt(grown, 0, 0), pt(grown, 0, grown.cols - 1), pt(grown, grown.rows - 1, 0), pt(grown, grown.rows - 1, grown.cols - 1)]
      for (const corner of NATIVE_CORNERS[type]) expect(Math.min(...ours.map((o) => len(sub(o, corner))))).toBeLessThan(2.5)
    })

    it(`${type}: the grid lies on QUICKSURFACE’s extended surface`, () => {
      const native = gridOf(`native-extend-${type}10-surface.json`)
      const near = nearestIn(native)
      const grown = extendGrid(wall, all, type)
      let sum = 0
      let max = 0
      let n = 0
      for (let r = 0; r < grown.rows; r++) {
        for (let c = 0; c < grown.cols; c++) {
          const d = toGrid(pt(grown, r, c), native, near)
          sum += d
          max = Math.max(max, d)
          n++
        }
      }
      // eslint-disable-next-line no-console
      console.info(`extend ${type} 10 mm vs native: mean ${(sum / n).toFixed(3)} mm, max ${max.toFixed(3)} mm over ${n} points`)
      expect(sum / n).toBeLessThan(0.05)
      expect(max).toBeLessThan(0.3)
    })
  }
})
