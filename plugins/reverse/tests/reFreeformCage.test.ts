// SPDX-License-Identifier: AGPL-3.0-only
// The freeform cage (F0 of audit-2026-11-07/FREEFORM_ROADMAP.md): its
// topology, one Catmull–Clark step with creases, the limit masks, the quad
// OBJ QUICKSURFACE writes and reads, and the snap that gives the surface
// its shape — checked on cages with a known answer (a flat grid is its own
// limit; a regular ring's limit radius is (2 + cos θ) / 3 of its control
// radius; a crease holds its fold) and on the two cages QUICKSURFACE
// exported in the audit.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { bounds, type Cage, faceArea, faceKinds, topology, vertexCount } from '../core/freeform/cage'
import { parseQuadObj, writeQuadObj } from '../core/freeform/cageIO'
import { cageVertexLimits, limitMesh, limitPositions } from '../core/freeform/limit'
import { cylinderClosest, snapMesh } from '../core/freeform/snap'
import { subdivide, subdivided, vertexRule } from '../core/freeform/subdivide'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

function cage(vertices: Vec3[], faces: number[][], creases: [number, number][] = []): Cage {
  return { positions: Float64Array.from(vertices.flat()), faces, creases }
}

/** A grid of (nu − 1) × (nv − 1) quads over [0, nu − 1] × [0, nv − 1], z from `at`. */
function grid(nu: number, nv: number, at: (i: number, j: number) => number = () => 0): Cage {
  const v: Vec3[] = []
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) v.push([i, j, at(i, j)])
  const f: number[][] = []
  for (let j = 0; j + 1 < nv; j++) for (let i = 0; i + 1 < nu; i++) f.push([j * nu + i, j * nu + i + 1, (j + 1) * nu + i + 1, (j + 1) * nu + i])
  return cage(v, f)
}

/** A ring of `n` quads a side round the z axis, `rows` rows of vertices, radius r. */
function ring(n: number, rows: number, r: number, height: number): Cage {
  const v: Vec3[] = []
  for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n
    v.push([r * Math.cos(th), r * Math.sin(th), (height * j) / (rows - 1)])
  }
  const f: number[][] = []
  for (let j = 0; j + 1 < rows; j++) for (let i = 0; i < n; i++) f.push([j * n + i, j * n + ((i + 1) % n), (j + 1) * n + ((i + 1) % n), (j + 1) * n + i])
  return cage(v, f)
}

const cube = cage(
  [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
)

describe('cage topology', () => {
  it('reads a cube as a closed quad cage', () => {
    const t = topology(cube)
    expect(t.edges.length).toBe(12)
    expect(t.closed).toBe(true)
    expect(t.vertexEdges.every((e) => e.length === 3)).toBe(true)
    expect(faceKinds(cube)).toEqual({ quads: 6, triangles: 0, ngons: 0 })
    expect(faceArea(cube)).toBeCloseTo(6, 12)
  })
  it('refuses a face naming a vertex the cage has not, and an edge with three faces', () => {
    expect(() => topology(cage([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 5]]))).toThrow(/names vertex 5 of 3/)
    expect(() => topology(cage([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1]], [[0, 1, 2], [0, 1, 3], [0, 1, 4]]))).toThrow(/three faces/)
  })
})

describe('Catmull–Clark step', () => {
  it('makes a quad of every corner and keeps a closed cage closed', () => {
    const s = subdivide(cube)
    expect(vertexCount(s)).toBe(8 + 6 + 12)
    expect(s.faces.length).toBe(24)
    expect(faceKinds(s)).toEqual({ quads: 24, triangles: 0, ngons: 0 })
    expect(topology(s).closed).toBe(true)
    // Symmetric about the cube's centre; the corners pulled inside it to
    // (Q + 2R) / 3 = 2/9 along each axis, the face points left on the faces.
    const b = bounds(s)
    expect(b.min[0] + b.max[0]).toBeCloseTo(1, 12)
    for (let v = 0; v < 8; v++) for (let k = 0; k < 3; k++) expect(Math.min(s.positions[v * 3 + k], 1 - s.positions[v * 3 + k])).toBeCloseTo(2 / 9, 12)
    expect(b.min[0]).toBe(0)
    expect(faceArea(s)).toBeLessThan(6)
  })
  it('leaves a flat grid flat and its interior vertices in place', () => {
    const g = grid(5, 5)
    const s = subdivide(g)
    for (let i = 2; i < s.positions.length; i += 3) expect(s.positions[i]).toBe(0)
    // Interior vertex (2, 2) is the mean of its ring: unmoved.
    expect(s.positions[12 * 3]).toBeCloseTo(2, 12)
    expect(s.positions[12 * 3 + 1]).toBeCloseTo(2, 12)
    // Its limit is itself.
    const lp = limitPositions(s)
    expect(lp[12 * 3]).toBeCloseTo(2, 12)
    expect(lp[12 * 3 + 1]).toBeCloseTo(2, 12)
  })
  it('holds a one-quad sheet at its corners and keeps it flat', () => {
    const one = grid(2, 2)
    expect([0, 1, 2, 3].map((v) => vertexRule(topology(one), v))).toEqual(['corner', 'corner', 'corner', 'corner'])
    const s = subdivided(one, 2)
    expect(s.faces.length).toBe(16)
    const b = bounds(s)
    expect(b.min).toEqual([0, 0, 0])
    expect(b.max).toEqual([1, 1, 0])
  })
  it('gives a regular ring the limit radius (2 + cos θ) / 3 of its control radius, away from the ends', () => {
    const n = 8, rc = 100
    const c = ring(n, 6, rc, 50)
    const lm = limitMesh(c, 3)
    const expected = (rc * (2 + Math.cos((2 * Math.PI) / n))) / 3
    // Vertices well inside the open ends follow the cubic B-spline circle; the ends are B-spline curves of the boundary rows.
    let checked = 0
    for (let v = 0; v < lm.positions.length / 3; v++) {
      const z = lm.positions[v * 3 + 2]
      if (z < 20 || z > 30) continue
      const r = Math.hypot(lm.positions[v * 3], lm.positions[v * 3 + 1])
      // The B-spline circle is not exact: within 0.1 % of the mean radius, as a cubic through 8 points is.
      expect(Math.abs(r - expected) / expected).toBeLessThan(2e-3)
      checked++
    }
    expect(checked).toBeGreaterThan(100)
    // The cage vertices' own limits, exactly on the formula (they lie on the control polygon's corners).
    const lim = cageVertexLimits(c)
    for (let j = 2; j < 4; j++) expect(Math.hypot(lim[j * n][0], lim[j * n][1])).toBeCloseTo(expected, 9)
  })
  it('keeps a crease sharp and a boundary a cubic B-spline', () => {
    // A tent: 3 × 3 vertices, the middle row raised; creased along the ridge it keeps its height, smooth it sags.
    const tent = (creased: boolean) => {
      const c = grid(3, 3, (_, j) => (j === 1 ? 10 : 0))
      if (creased) c.creases = [[3, 4], [4, 5]]
      return c
    }
    const ridgeTop = (c: Cage) => {
      const lp = limitPositions(subdivided(c, 2))
      let top = -Infinity
      for (let v = 0; v < lp.length / 3; v++) top = Math.max(top, lp[v * 3 + 2])
      return top
    }
    expect(ridgeTop(tent(false))).toBeLessThan(8)
    expect(ridgeTop(tent(true))).toBeCloseTo(10, 9)
    // The creased ridge's middle vertex is a crease vertex; its ends are corners (boundary + crease).
    const c = tent(true)
    const t = topology(c)
    expect(vertexRule(t, 4)).toBe('crease')
    expect(vertexRule(t, 3)).toBe('corner')
    // Creases carry to the children.
    expect(subdivide(c).creases.length).toBe(4)
  })
})

describe('quad OBJ', () => {
  it('reads and writes a cage without loss', () => {
    const c = cage([[0.1, 0.2, 0.3], [1, 0, 0], [1, 1, 0], [0, 1, 0], [2, 0.5, 0]], [[0, 1, 2, 3], [1, 4, 2]], [[0, 1]])
    const back = parseQuadObj(writeQuadObj(c))
    expect(Array.from(back.positions)).toEqual(Array.from(c.positions))
    expect(back.faces).toEqual(c.faces)
    expect(back.creases).toEqual(c.creases)
    expect(faceKinds(back)).toEqual({ quads: 1, triangles: 1, ngons: 0 })
  })
  it('reads QUICKSURFACE’s "Freeform surfaces as quads" export with its indices intact', () => {
    const c = parseQuadObj(fixture('native-freeforms-quads.obj'))
    expect(vertexCount(c)).toBe(12)
    expect(c.faces).toHaveLength(6)
    expect(faceKinds(c).quads).toBe(6)
    expect(c.faces[0]).toEqual([0, 1, 4, 3])
    const t = topology(c)
    expect(t.closed).toBe(false)
    expect(topology(parseQuadObj(writeQuadObj(c))).edges.length).toBe(t.edges.length)
  })
  it('refuses an OBJ with no faces, and a face past its vertices', () => {
    expect(() => parseQuadObj('v 0 0 0\nv 1 0 0\n')).toThrow(/no faces/)
    expect(() => parseQuadObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 4\n')).toThrow(/line 4/)
  })
})

describe('QUICKSURFACE’s Wrap cage of the basic_part wall', () => {
  // The cylinder QUICKSURFACE fitted to the wall (tests/wandRealScan.test.ts).
  const s: Vec3 = [-1.250317984, 21.635862871, -264.868961646]
  const e: Vec3 = [-1.069856164, 21.919975087, 53.125209598]
  const r = 100.084537315
  const len = Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2])
  const d: Vec3 = [(e[0] - s[0]) / len, (e[1] - s[1]) / len, (e[2] - s[2]) / len]
  const radial = (x: number, y: number, z: number) => {
    const w = [x - s[0], y - s[1], z - s[2]]
    const t = w[0] * d[0] + w[1] * d[1] + w[2] * d[2]
    return Math.hypot(w[0] - t * d[0], w[1] - t * d[1], w[2] - t * d[2]) - r
  }
  const all = parseQuadObj(fixture('native-wrap-quads.obj'))
  // The export holds the hand-made cage, its imported copy and the Wrap cage: the last eight vertices.
  const used = [...new Set(all.faces.filter((f) => f.every((i) => i >= 24)).flat())].sort((a, b) => a - b)
  const remap = new Map(used.map((v, i) => [v, i]))
  const wrap: Cage = {
    positions: Float64Array.from(used.flatMap((v) => [all.positions[v * 3], all.positions[v * 3 + 1], all.positions[v * 3 + 2]])),
    faces: all.faces.filter((f) => f.every((i) => i >= 24)).map((f) => f.map((v) => remap.get(v)!)),
    creases: [],
  }

  it('is a four-sided box round the wall, open at both ends', () => {
    expect(vertexCount(wrap)).toBe(8)
    expect(wrap.faces).toHaveLength(4)
    const t = topology(wrap)
    expect(t.closed).toBe(false)
    expect(t.edges.filter((x) => x.faces.length < 2)).toHaveLength(8)
    // Its corners stand 5–12 mm outside the wall.
    for (let v = 0; v < 8; v++) expect(radial(wrap.positions[v * 3], wrap.positions[v * 3 + 1], wrap.positions[v * 3 + 2])).toBeGreaterThan(4)
  })
  it('has a subdivision limit nowhere near the wall — the surface shown is the refined cage snapped to the scan', () => {
    const lm = limitMesh(wrap, 3)
    let worst = 0, sum = 0
    for (let v = 0; v < lm.positions.length / 3; v++) {
      const off = radial(lm.positions[v * 3], lm.positions[v * 3 + 1], lm.positions[v * 3 + 2])
      worst = Math.max(worst, Math.abs(off))
      sum += off * off
    }
    expect(Math.sqrt(sum / (lm.positions.length / 3))).toBeGreaterThan(10)
    expect(worst).toBeGreaterThan(50)
    // Snapped to the wall's cylinder, every vertex lies on it.
    const snapped = snapMesh(lm, cylinderClosest(s, d, r))
    expect(snapped.missed).toBe(0)
    for (let v = 0; v < snapped.positions.length / 3; v++) expect(Math.abs(radial(snapped.positions[v * 3], snapped.positions[v * 3 + 1], snapped.positions[v * 3 + 2]))).toBeLessThan(1e-9)
    // And moved by the limit's own distance from the wall, never more than the cage's reach.
    expect(Math.max(...Array.from(snapped.moved))).toBeLessThan(100)
  })
})
