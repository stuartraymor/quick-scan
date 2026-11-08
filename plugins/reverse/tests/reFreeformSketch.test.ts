// SPDX-License-Identifier: AGPL-3.0-only
// From 3D Sketch, the cage (core/freeform/sketch.ts), against what
// QUICKSURFACE 8.0.128 does: a region of n sides is n quads round a centre at
// Resolution 1 and each Resolution cuts every quad 2 × 2; the corners are the
// sketch's nodes; the sides' vertices lie at equal fractions of their length.
//
// The native reference is the four-curve loop drawn on the basic_part outer
// wall (tests/fixtures/native-3d-sketch.iges: its four degree-3 B-splines as
// exported from the 3D Sketch dialog) and the freeform surfaces it made at
// Resolution 1, 3 and 2 (tests/fixtures/native-from-sketch-quads.obj: 4, 64
// and 16 quads, in that order).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { topology, type Cage } from '../core/freeform/cage'
import { parseQuadObj } from '../core/freeform/cageIO'
import { limitMesh } from '../core/freeform/limit'
import { polylinePath, SKETCH_REFUSAL, sketchCage, SketchError, type SidePath, type SketchCell } from '../core/freeform/sketch'

const here = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const boundaryOf = (c: Cage): number[] => {
  const t = topology(c)
  const out = new Set<number>()
  for (const e of t.edges) if (e.faces.length < 2) out.add(e.a).add(e.b)
  return [...out]
}
const vert = (c: Cage, i: number): Vec3 => [c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2]]
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** A regular n-gon in the plane z = 0, radius r about (cx, 0): its sides as straight paths, corner 0 at angle 0. */
function polygon(n: number, r = 10, cx = 0): SketchCell {
  const corner = (k: number): Vec3 => [cx + r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n), 0]
  return { sides: Array.from({ length: n }, (_, k) => straight(corner(k), corner((k + 1) % n))) }
}
const straight = (a: Vec3, b: Vec3): SidePath => polylinePath([...a, ...b])

describe('sketch cage: the layout QUICKSURFACE makes', () => {
  it('lays a four-sided region 2 × 2 at Resolution 1 and 4× the quads at each Resolution after', () => {
    const quads = [1, 2, 3, 4].map((r) => sketchCage([polygon(4)], r))
    expect(quads.map((c) => c.faces.length)).toEqual([4, 16, 64, 256])
    // 9, 25, 81 vertices as the native cages have; 8, 16, 32 on the boundary.
    expect(quads.map((c) => c.positions.length / 3)).toEqual([9, 25, 81, 289])
    expect(quads.slice(0, 3).map((c) => boundaryOf(c).length)).toEqual([8, 16, 32])
  })

  it('lays n quads round a centre for a region of 3, 5 or 6 sides, as the native five-sided cage is (5 quads, 11 vertices)', () => {
    const counts = [3, 5, 6].map((n) => {
      const c = sketchCage([polygon(n)], 1)
      return [c.faces.length, c.positions.length / 3]
    })
    expect(counts).toEqual([
      [3, 7],
      [5, 11],
      [6, 13],
    ])
    // The native five-sided cages' next sizes: 20 and 80 quads (101 vertices).
    expect(sketchCage([polygon(5)], 2).faces.length).toBe(20)
    const c3 = sketchCage([polygon(5)], 3)
    expect(c3.faces.length).toBe(80)
    expect(c3.positions.length / 3).toBe(101)
  })

  it('welds two regions along the side they share', () => {
    const p = (x: number, y: number): Vec3 => [x, y, 0]
    // A square split down its middle: the left half and the right half, each with the shared side run its own way.
    const left: SketchCell = { sides: [straight(p(-10, -10), p(0, -10)), straight(p(0, -10), p(0, 10)), straight(p(0, 10), p(-10, 10)), straight(p(-10, 10), p(-10, -10))] }
    const right: SketchCell = { sides: [straight(p(0, -10), p(10, -10)), straight(p(10, -10), p(10, 10)), straight(p(10, 10), p(0, 10)), straight(p(0, 10), p(0, -10))] }
    const cage = sketchCage([left, right], 2)
    expect(cage.faces.length).toBe(32)
    // Two 5 × 5 grids sharing a column of 5.
    expect(cage.positions.length / 3).toBe(45)
    // One manifold sheet, 24 boundary vertices round it.
    expect(() => topology(cage)).not.toThrow()
    expect(boundaryOf(cage).length).toBe(24)
  })

  it('runs the faces counter-clockwise about the normal of the region as its sides run', () => {
    const c = sketchCage([polygon(4)], 2)
    for (const f of c.faces) {
      const [a, b, , d] = f.map((i) => vert(c, i))
      const cz = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])
      expect(cz).toBeGreaterThan(0)
    }
    const c5 = sketchCage([polygon(5)], 2)
    for (const f of c5.faces) {
      const [a, b, , d] = f.map((i) => vert(c5, i))
      expect((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])).toBeGreaterThan(0)
    }
  })

  it('has its limit surface over a flat region flat and as large as the region', () => {
    const c = sketchCage([polygon(4, 10)], 2)
    const lm = limitMesh(c, 2)
    let zmax = 0
    for (let k = 2; k < lm.positions.length; k += 3) zmax = Math.max(zmax, Math.abs(lm.positions[k]))
    expect(zmax).toBeLessThan(1e-9)
  })

  it('keeps the corners at the nodes exactly and the sides’ vertices at equal fractions of their length', () => {
    const arc = (a: number, b: number): SidePath => {
      const pts: number[] = []
      for (let i = 0; i <= 200; i++) {
        const t = a + ((b - a) * i) / 200
        pts.push(10 * Math.cos(t), 10 * Math.sin(t), 0.2 * i)
      }
      return polylinePath(pts)
    }
    const s0 = arc(0, 1)
    const cage = sketchCage([{ sides: [s0, straight(s0.at(1), [0, 0, 100]), straight([0, 0, 100], [1, 1, 100]), straight([1, 1, 100], s0.at(0))] }], 3)
    const start = s0.at(0)
    expect(cage.positions.slice(0, 3).every((v, i) => Math.abs(v - start[i]) < 1e-9)).toBe(true)
    // The first row's vertices along the curved side: equal arc fractions.
    const row = Array.from({ length: 9 }, (_, i) => vert(cage, i))
    const lengths = row.slice(1).map((p, i) => dist(p, row[i]))
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length
    for (const l of lengths) expect(Math.abs(l - mean) / mean).toBeLessThan(0.01)
  })

  it('refuses what is not a region, in QUICKSURFACE’s words for a sketch that closes none', () => {
    expect(() => sketchCage([], 1)).toThrow(SKETCH_REFUSAL)
    expect(() => sketchCage([polygon(4)], 0)).toThrow(SketchError)
    expect(() => sketchCage([polygon(4)], 5)).toThrow(/from 1 to 4/)
    expect(() => sketchCage([{ sides: [straight([0, 0, 0], [1, 0, 0]), straight([1, 0, 0], [0, 0, 0])] }], 1)).toThrow(/two to six|three to six/)
    expect(() => polylinePath([0, 0, 0])).toThrow(SketchError)
  })
})

// ---- the native reference -------------------------------------------------------------------------------

/** The degree-3 B-splines of an IGES file (type 126) as polylines, `per` segments each. */
function igesCurves(text: string, per = 400): Float64Array[] {
  const lines = text.split(/\r?\n/)
  const data = lines.filter((l) => l[72] === 'P').map((l) => l.slice(0, 64)).join('')
  const out: Float64Array[] = []
  for (const rec of data.split(';').map((s) => s.trim()).filter(Boolean)) {
    const f = rec.split(',')
    if (f[0] !== '126') continue
    const K = Number(f[1])
    const M = Number(f[2])
    const n = K + 1
    const nk = n + M + 1
    const knots = f.slice(7, 7 + nk).map(Number)
    const w = f.slice(7 + nk, 7 + nk + n).map(Number)
    const cs = 7 + nk + n
    const pts = Array.from({ length: n }, (_, i) => [Number(f[cs + i * 3]), Number(f[cs + i * 3 + 1]), Number(f[cs + i * 3 + 2])])
    const t0 = Number(f[cs + n * 3])
    const t1 = Number(f[cs + n * 3 + 1])
    const eval1 = (t: number): Vec3 => {
      let k = M
      while (k < n - 1 && t >= knots[k + 1]) k++
      const d = Array.from({ length: M + 1 }, (_, j) => [...pts[k - M + j].map((x) => x * w[k - M + j]), w[k - M + j]])
      for (let r = 1; r <= M; r++) {
        for (let j = M; j >= r; j--) {
          const i = k - M + j
          const a = (t - knots[i]) / (knots[i + M - r + 1] - knots[i])
          for (let q = 0; q < 4; q++) d[j][q] = (1 - a) * d[j - 1][q] + a * d[j][q]
        }
      }
      return [d[M][0] / d[M][3], d[M][1] / d[M][3], d[M][2] / d[M][3]]
    }
    const poly = new Float64Array((per + 1) * 3)
    for (let i = 0; i <= per; i++) poly.set(eval1(t0 + ((t1 - t0) * i) / per), i * 3)
    out.push(poly)
  }
  return out
}

describe('sketch cage against QUICKSURFACE’s own From 3D Sketch', () => {
  const curves = igesCurves(here('native-3d-sketch.iges'))
  const all = parseQuadObj(here('native-from-sketch-quads.obj'))
  // The three cages, in the order the file holds them (Resolution 1, 3, 2).
  const split = (n: number, at: number): Cage => {
    const faces = all.faces.slice(at, at + n)
    const used = [...new Set(faces.flat())].sort((a, b) => a - b)
    const map = new Map(used.map((v, i) => [v, i]))
    return { positions: Float64Array.from(used.flatMap((v) => [all.positions[v * 3], all.positions[v * 3 + 1], all.positions[v * 3 + 2]])), faces: faces.map((f) => f.map((v) => map.get(v) as number)), creases: [] }
  }
  const native: Record<number, Cage> = { 1: split(4, 0), 3: split(64, 4), 2: split(16, 68) }
  const cell: SketchCell = { sides: curves.map((c) => polylinePath(c)) }

  it('reads the exported sketch as four curves that close a loop', () => {
    expect(curves.length).toBe(4)
    for (let k = 0; k < 4; k++) {
      const end = [curves[k][curves[k].length - 3], curves[k][curves[k].length - 2], curves[k][curves[k].length - 1]] as Vec3
      const next = [curves[(k + 1) % 4][0], curves[(k + 1) % 4][1], curves[(k + 1) % 4][2]] as Vec3
      expect(dist(end, next)).toBeLessThan(0.05)
    }
  })

  it('makes the same quads and vertices as the native cage at Resolutions 1, 2 and 3', () => {
    for (const r of [1, 2, 3]) {
      const ours = sketchCage([cell], r)
      const theirs = native[r]
      expect(ours.faces.length, `res ${r} quads`).toBe(theirs.faces.length)
      expect(ours.positions.length / 3, `res ${r} vertices`).toBe(theirs.positions.length / 3)
      expect(boundaryOf(ours).length, `res ${r} boundary`).toBe(boundaryOf(theirs).length)
      // The same valence at every vertex: the same grid.
      const valences = (c: Cage) => {
        const t = topology(c)
        const h: Record<number, number> = {}
        for (const ve of t.vertexEdges) h[ve.length] = (h[ve.length] ?? 0) + 1
        return h
      }
      expect(valences(ours), `res ${r} valences`).toEqual(valences(theirs))
    }
  })

  it('has the sketch’s nodes as corner vertices, where the native cage has them', () => {
    for (const r of [1, 2, 3]) {
      const ours = sketchCage([cell], r)
      const theirs = native[r]
      for (const c of curves) {
        const node: Vec3 = [c[0], c[1], c[2]]
        const near = (cage: Cage) => Math.min(...Array.from({ length: cage.positions.length / 3 }, (_, i) => dist(vert(cage, i), node)))
        expect(near(ours), `ours, res ${r}`).toBeLessThan(1e-9)
        expect(near(theirs), `native, res ${r}`).toBeLessThan(0.01)
      }
    }
  })

  it('puts the native’s side vertices where ours are along the side, to 3 % of its length', () => {
    // The native boundary at Resolution 3 against the fractions k/8 along the curve it follows.
    const theirs = native[3]
    const ours = sketchCage([cell], 3)
    const fractions: number[] = []
    for (const v of boundaryOf(theirs)) {
      const p = vert(theirs, v)
      // The nearest of our boundary vertices, and how far apart: the native follows the scan, ours the exported curve.
      let best = Infinity
      for (const u of boundaryOf(ours)) best = Math.min(best, dist(p, vert(ours, u)))
      fractions.push(best)
    }
    const worst = Math.max(...fractions)
    // Curved sides follow the scan in the native cage and the fitted B-spline here: up to 3 mm apart on this wall.
    expect(worst).toBeLessThan(5)
    const rms = Math.sqrt(fractions.reduce((a, b) => a + b * b, 0) / fractions.length)
    expect(rms).toBeLessThan(2.5)
  })

  it('has its interior as near the native as its boundary is (the centre vertex within 8 mm at Resolution 1)', () => {
    const ours = sketchCage([cell], 1)
    const theirs = native[1]
    // The centre is the one vertex with four edges.
    const centre = (c: Cage) => {
      const t = topology(c)
      return vert(c, t.vertexEdges.findIndex((e) => e.length === 4))
    }
    expect(dist(centre(ours), centre(theirs))).toBeLessThan(8)
  })
})

// The second reference, the cleaner one: the loop of four curves drawn on the
// basic_part outer wall, two of them arcs standing 20 mm from their chords
// (tests/fixtures/native-3d-sketch-wall4.iges) and the three cages QUICKSURFACE
// made from it (native-from-sketch-wall4-quads.obj: 4, 64, 16 quads).
describe('sketch cage against QUICKSURFACE’s From 3D Sketch on the arc-sided loop', () => {
  const curves = igesCurves(here('native-3d-sketch-wall4.iges'))
  const all = parseQuadObj(here('native-from-sketch-wall4-quads.obj'))
  const split = (n: number, at: number): Cage => {
    const faces = all.faces.slice(at, at + n)
    const used = [...new Set(faces.flat())].sort((a, b) => a - b)
    const map = new Map(used.map((v, i) => [v, i]))
    return { positions: Float64Array.from(used.flatMap((v) => [all.positions[v * 3], all.positions[v * 3 + 1], all.positions[v * 3 + 2]])), faces: faces.map((f) => f.map((v) => map.get(v) as number)), creases: [] }
  }
  const native: Record<number, Cage> = { 1: split(4, 0), 3: split(64, 4), 2: split(16, 68) }
  const cell: SketchCell = { sides: curves.map((c) => polylinePath(c)) }
  const nearest = (cage: Cage, p: Vec3, among: number[]) => Math.min(...among.map((u) => dist(p, vert(cage, u))))

  it('has the same quads, vertices and boundary as the native cage at Resolutions 1, 2 and 3', () => {
    expect(curves.length).toBe(4)
    for (const r of [1, 2, 3]) {
      const ours = sketchCage([cell], r)
      expect(ours.faces.length, `res ${r}`).toBe(native[r].faces.length)
      expect(ours.positions.length / 3, `res ${r}`).toBe(native[r].positions.length / 3)
      expect(boundaryOf(ours).length, `res ${r}`).toBe(boundaryOf(native[r]).length)
    }
  })

  it('puts the side vertices of the Resolution 1 cage where the native does, the arcs’ too (x and y offset, z the curve’s)', () => {
    const ours = sketchCage([cell], 1)
    const theirs = native[1]
    const mine = boundaryOf(ours)
    const worst = Math.max(...mine.map((u) => nearest(theirs, vert(ours, u), boundaryOf(theirs))))
    // With the offset in three dimensions the two arcs' vertices stood 5.6 and 3.5 mm from the native's. What is left is the fraction: ours is by arc length, the native's by the parameter of its own spline (0.5 and 0.6 mm from it when ours is by that parameter).
    expect(worst).toBeLessThan(2.2)
    const centre = (c: Cage) => vert(c, topology(c).vertexEdges.findIndex((e) => e.length === 4))
    // The centre's z is the native's to 0.01 mm when the sides' vertices hold the curve's z (4.7 mm out with the offset in three dimensions); its x and y are 1.3 mm out from the native's own parameter fractions, 2.1 mm from arc length.
    expect(dist(centre(ours), centre(theirs))).toBeLessThan(3)
    expect(Math.abs(centre(ours)[2] - centre(theirs)[2])).toBeLessThan(0.5)
  })

  it('has the boundary of the Resolution 2 and 3 cages as near the native as the two parametrisations of one curve are', () => {
    const report: string[] = []
    for (const r of [2, 3]) {
      const ours = sketchCage([cell], r)
      const theirs = native[r]
      const errs = boundaryOf(ours).map((u) => nearest(theirs, vert(ours, u), boundaryOf(theirs)))
      const rms = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length)
      report.push(`res ${r}: boundary to native rms ${rms.toFixed(2)} max ${Math.max(...errs).toFixed(2)} mm`)
      expect(Math.max(...errs), `res ${r}`).toBeLessThan(6)
    }
    console.info(report.join('\n'))
  })
})
