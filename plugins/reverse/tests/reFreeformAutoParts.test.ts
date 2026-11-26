// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform's parts on shapes whose answer is known: the least-squares
// fit (limitFit.ts), the scan's preparation (autoPrepare.ts), what Feature
// aligned reads off a scan (autoFeatures.ts) and Refine to tolerance
// (autoRefine.ts). The layout has its own (reFreeformInstant.test.ts), and
// the whole of it on real scans is reFreeformAutoScans.test.ts.
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { curvatureField, featureConstraints, hardEdgeConstraints } from '../core/freeform/autoFeatures'
import { guideConstraints, improveRims, mainPieces, meshArea, mirrored, positiveHalf, rims, subMesh, type WorkMesh } from '../core/freeform/autoPrepare'
import { refineToTolerance } from '../core/freeform/autoRefine'
import { type Cage, topology } from '../core/freeform/cage'
import { snapCage } from '../core/freeform/edit'
import { limitPositions } from '../core/freeform/limit'
import { type ScanProject, fitCageToScan, limitSamples, surfaceDeviation } from '../core/freeform/limitFit'
import { subdivide, subdivided } from '../core/freeform/subdivide'
import { sphereScan } from './networkMeshes'

const cube = (h: number): Cage => ({
  positions: Float64Array.from([-h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h, -h, -h, h, h, -h, h, h, h, h, -h, h, h]),
  faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
  creases: [],
})

/** A flat sheet of nu × nv quads over [0, w] × [0, h] at z = height(x, y). */
function sheet(nu: number, nv: number, w: number, h: number, height: (x: number, y: number) => number = () => 0): Cage {
  const positions: number[] = []
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) positions.push((i / nu) * w, (j / nv) * h, height((i / nu) * w, (j / nv) * h))
  const faces: number[][] = []
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i
    faces.push([a, a + 1, a + nu + 2, a + nu + 1])
  }
  return { positions: Float64Array.from(positions), faces, creases: [] }
}

const onSphere = (r: number): ScanProject => (p) => {
  const l = Math.hypot(p[0], p[1], p[2]) || 1
  const n: Vec3 = [p[0] / l, p[1] / l, p[2] / l]
  return { point: [n[0] * r, n[1] * r, n[2] * r], normal: n, distance: Math.abs(l - r) }
}

function triangleGrid(nu: number, nv: number, at: (u: number, v: number) => Vec3, wrapU = false): WorkMesh {
  const positions: number[] = []
  const cols = wrapU ? nu : nu + 1
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) positions.push(...at(i / nu, j / nv))
  const indices: number[] = []
  const id = (i: number, j: number) => j * cols + (i % cols)
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) indices.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1))
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

describe('limitSamples', () => {
  it('gives the limit points of the once-subdivided cage as weights over the cage’s vertices, creases and rims included', () => {
    const closed = subdivide(cube(10))
    const creased: Cage = { ...cube(10), creases: [[0, 1], [1, 2], [2, 3], [3, 0]] }
    const open = sheet(4, 3, 40, 30, (x, y) => 0.01 * x * y)
    for (const cage of [closed, creased, open]) {
      const { rows } = limitSamples(cage)
      const want = limitPositions(subdivide(cage))
      expect(rows.rows).toBe(want.length / 3)
      let worst = 0
      for (let r = 0; r < rows.rows; r++) {
        for (let k = 0; k < 3; k++) {
          let s = 0
          for (let i = rows.ptr[r]; i < rows.ptr[r + 1]; i++) s += rows.val[i] * cage.positions[rows.idx[i] * 3 + k]
          worst = Math.max(worst, Math.abs(s - want[r * 3 + k]))
        }
        let sum = 0
        for (let i = rows.ptr[r]; i < rows.ptr[r + 1]; i++) sum += rows.val[i]
        expect(sum).toBeCloseTo(1, 12)
      }
      expect(worst).toBeLessThan(1e-12)
    }
  })
})

describe('fitCageToScan', () => {
  it('takes a cage’s surface onto a sphere, nearer than moving each vertex by its own gap does', () => {
    const cage = subdivided(cube(20), 2)
    const project = onSphere(30)
    const fit = fitCageToScan(cage, project, { iterations: 6 })
    const fitted = surfaceDeviation(fit.cage, project, 0.05, 2)
    const closest = (p: Vec3) => { const q = project(p, [0, 0, 1]); return q ? { point: q.point, distance: q.distance } : null }
    const snapped = surfaceDeviation(snapCage(cage, closest, 8, 0.001).cage, project, 0.05, 2)
    expect(fitted.rms).toBeLessThan(snapped.rms)
    expect(fitted.rms).toBeLessThan(0.02)
    expect(fitted.max).toBeLessThan(0.1)
    expect(fit.stats.missed).toBe(0)
    // The connectivity is kept.
    expect(fit.cage.faces).toEqual(cage.faces)
    expect(fit.cage.positions.length).toBe(cage.positions.length)
  })

  it('carries a vertex whose samples find no scan with its neighbours, and holds the vertices asked', () => {
    const cage = sheet(6, 6, 60, 60, () => 3)
    // A plane at z = 0 with a hole in the middle: nothing to project on there.
    const project: ScanProject = (p) => (Math.hypot(p[0] - 30, p[1] - 30) < 12 ? null : { point: [p[0], p[1], 0], normal: [0, 0, 1], distance: Math.abs(p[2]) })
    const fit = fitCageToScan(cage, project, { iterations: 4 })
    expect(fit.stats.missed).toBeGreaterThan(0)
    for (let v = 0; v < fit.cage.positions.length / 3; v++) expect(Math.abs(fit.cage.positions[v * 3 + 2])).toBeLessThan(0.2)
    const held = fitCageToScan(cage, project, { iterations: 4, fixed: new Set([0]) })
    expect(held.cage.positions[2]).toBeCloseTo(3, 3)
  })
})

describe('autoPrepare', () => {
  const ball = sphereScan(20, 0, 4)

  it('leaves out the crumbs beside the part and keeps what was asked of it', () => {
    const crumb = triangleGrid(2, 2, (u, v) => [60 + u, v, 0])
    const offset = ball.positions.length / 3
    const both: WorkMesh = {
      positions: Float32Array.from([...ball.positions, ...crumb.positions]),
      indices: Uint32Array.from([...ball.indices, ...Array.from(crumb.indices, (i) => i + offset)]),
    }
    const kept = mainPieces(both)
    expect(kept.pieces).toBe(2)
    expect(kept.kept).toBe(1)
    expect(kept.mesh.indices.length).toBe(ball.indices.length)
    const part = subMesh(ball, [0, 1, 2])
    expect(part.indices.length).toBe(9)
    expect(part.positions.length / 3).toBeLessThanOrEqual(9)
  })

  it('cuts the positive half with its rim exactly on the plane, and a quad mesh of it mirrors to a whole one', () => {
    const half = positiveHalf(ball, 0)
    let min = Infinity
    for (let i = 0; i < half.positions.length; i += 3) min = Math.min(min, half.positions[i])
    expect(min).toBe(0)
    expect(meshArea(half) / meshArea(ball)).toBeCloseTo(0.5, 2)
    const loops = rims(half)
    expect(loops).toHaveLength(1)
    for (const v of loops[0]) expect(half.positions[v * 3]).toBe(0)
    // A strip of quads on x ≥ 0 whose rim at x ≈ 0 is welded to its mirror image.
    const strip = sheet(3, 2, 30, 20)
    strip.positions[0] = 0.2 // a rim vertex a little off the plane
    const whole = mirrored(strip.positions, strip.faces, 0, 1)
    expect(whole.onPlane).toBe(3)
    expect(whole.faces).toHaveLength(12)
    expect(whole.positions.length / 3).toBe(12 * 2 - 3)
    for (let v = 0; v < whole.partner.length; v++) {
      const w = whole.partner[v]
      expect(whole.positions[w * 3]).toBeCloseTo(-whole.positions[v * 3], 12)
      expect(whole.positions[w * 3 + 1]).toBe(whole.positions[v * 3 + 1])
    }
    expect(topology({ positions: whole.positions, faces: whole.faces, creases: [] }).edges.every((e) => e.faces.length <= 2)).toBe(true)
  })

  it('closes a small hole and evens the rim that is left', () => {
    const holed = triangleGrid(20, 20, (u, v) => [u * 40, v * 40, 0])
    const keep: number[] = []
    for (let t = 0; t < holed.indices.length / 3; t++) {
      const a = holed.indices[t * 3]
      const x = holed.positions[a * 3], y = holed.positions[a * 3 + 1]
      if (!(x >= 18 && x < 22 && y >= 18 && y < 22)) keep.push(t)
    }
    const m = subMesh(holed, keep)
    expect(rims(m)).toHaveLength(2)
    const done = improveRims(m, 30)
    expect(done.filled).toBe(1)
    expect(done.evened).toBe(1)
    expect(rims(done.mesh)).toHaveLength(1)
    expect(meshArea(done.mesh)).toBeGreaterThan(meshArea(m))
  })

  it('makes constraints of a guide curve at the vertices it runs by', () => {
    const plane = triangleGrid(40, 40, (u, v) => [u * 40, v * 40, 0])
    const c = guideConstraints(plane, [[5, 5, 0, 35, 35, 0]], 1)
    expect(c.length).toBeGreaterThan(20)
    for (const g of c) {
      expect(g.direction[0]).toBeCloseTo(Math.SQRT1_2, 6)
      expect(g.direction[1]).toBeCloseTo(Math.SQRT1_2, 6)
      expect(Math.abs(plane.positions[g.vertex * 3] - plane.positions[g.vertex * 3 + 1])).toBeLessThan(1.5)
    }
  })
})

describe('autoFeatures', () => {
  it('reads a cylinder’s straight direction as its axis, and gives it to the layout', () => {
    const tube = triangleGrid(96, 40, (u, v) => [10 * Math.cos(u * 2 * Math.PI), 10 * Math.sin(u * 2 * Math.PI), v * 60], true)
    const f = curvatureField(tube, 4)
    let along = 0, counted = 0
    for (let v = 0; v < tube.positions.length / 3; v++) {
      const z = tube.positions[v * 3 + 2]
      if (z < 6 || z > 54) continue
      counted++
      if (Math.abs(f.direction[v * 3 + 2]) > 0.95) along++
      expect(Math.abs(f.k[v * 2])).toBeGreaterThan(0.05)
      expect(Math.abs(f.k[v * 2])).toBeLessThan(0.2)
    }
    expect(along / counted).toBeGreaterThan(0.95)
    const c = featureConstraints(tube, 4, 40)
    expect(c.length).toBeGreaterThan(counted / 2)
  })

  it('gives nothing on a sphere, which bends alike every way, and the edges of a box', () => {
    const ball = sphereScan(20, 0, 4)
    expect(featureConstraints(ball, 4, 40).length).toBeLessThan(0.05 * (ball.positions.length / 3))
    // Two squares meeting at a right angle along x.
    const fold = triangleGrid(10, 10, (u, v) => (v <= 0.5 ? [u * 20, v * 20, 0] : [u * 20, 10, (v - 0.5) * 20]))
    const hard = hardEdgeConstraints(fold, 40)
    expect(hard).toHaveLength(11)
    for (const h of hard) {
      expect(Math.abs(h.direction[0])).toBeCloseTo(1, 6)
      expect(h.position![1]).toBeCloseTo(10, 5)
    }
  })
})

describe('refineToTolerance', () => {
  it('adds rows of quads where the surface is off, and stays a quad cage', () => {
    // A ridge along y at x = 20 that a coarse sheet cannot follow.
    const ridge = (x: number) => 4 * Math.exp(-((x - 20) ** 2) / 8)
    const project: ScanProject = (p) => ({ point: [p[0], p[1], ridge(p[0])], normal: [0, 0, 1], distance: Math.abs(p[2] - ridge(p[0])) })
    const coarse = fitCageToScan(sheet(6, 3, 40, 20), project).cage
    const before = surfaceDeviation(coarse, project, 0.1, 2)
    const r = refineToTolerance(coarse, project, 0.1, { maxQuads: 200 })
    const after = surfaceDeviation(r.cage, project, 0.1, 2)
    expect(r.cage.faces.length).toBeGreaterThan(coarse.faces.length)
    expect(r.cage.faces.length).toBeLessThanOrEqual(200)
    expect(after.max).toBeLessThan(before.max / 2)
    expect(r.cage.faces.every((f) => f.length === 4 && new Set(f).size === 4)).toBe(true)
    const t = topology(r.cage)
    expect(t.edges.every((e) => e.faces.length <= 2)).toBe(true)
    // The rows were added across the ridge, not along it: more columns in x, the same rows in y.
    const ys = new Set(Array.from({ length: r.cage.positions.length / 3 }, (_, v) => Math.round(r.cage.positions[v * 3 + 1] * 10)))
    expect(ys.size).toBe(4)
  })

  it('leaves a cage already within the tolerance as it is', () => {
    const project: ScanProject = (p) => ({ point: [p[0], p[1], 0], normal: [0, 0, 1], distance: Math.abs(p[2]) })
    const flat = sheet(4, 4, 40, 40)
    const r = refineToTolerance(flat, project, 0.01, { maxQuads: 500 })
    expect(r.cage.faces).toHaveLength(16)
    expect(r.rounds).toBe(0)
    expect(r.off).toBe(0)
  })
})
