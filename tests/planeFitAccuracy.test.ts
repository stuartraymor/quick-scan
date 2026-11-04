// SPDX-License-Identifier: AGPL-3.0-only
// Plane-fit accuracy against known geometry. Two faults found by comparing
// with QUICKSURFACE 8.0.128 on basic_part (2026-11-03): a fit that counted
// vertices let densely meshed parts outvote the surface, and the 1σ "used
// points" preset re-derived its cut-off every round until ten points were left.
// A second pass (2026-11-04) found QUICKSURFACE's own fit on a marked area is
// vertex-counted: only the seeded path, whose grown region reaches a dense
// rim, keeps the area weighting.
import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import { fitPlaneOnSelection } from '../src/core/fit/fitPlaneFromSeed'
import { fitPlaneClipped } from '../src/core/fit/plane'
import { vertexAreas } from '../src/core/fit/vertexArea'

/** Triangles of a grid of squares over [x0,x1]×[y0,y1] at `step`, heights from `z`. */
function grid(x0: number, x1: number, y0: number, y1: number, step: number, z: (x: number, y: number) => number): number[] {
  const out: number[] = []
  for (let x = x0; x < x1 - 1e-9; x += step) for (let y = y0; y < y1 - 1e-9; y += step) {
    const a = [x, y], b = [x + step, y], c = [x + step, y + step], d = [x, y + step]
    for (const [p, q, r] of [[a, b, c], [a, c, d]]) out.push(p[0], p[1], z(p[0], p[1]), q[0], q[1], z(q[0], q[1]), r[0], r[1], z(r[0], r[1]))
  }
  return out
}

describe('plane fit weighted by the surface each vertex stands for', () => {
  // A 40 × 40 mm face meshed at 2 mm, and beside it a 6 × 6 mm patch meshed
  // at 0.1 mm that sits 0.02 mm proud — a densely scanned bump.
  const coarse = grid(-20, 20, -20, 20, 2, () => 0)
  // Leave the coarse squares under the dense patch out, so the surface is single.
  const keep: number[] = []
  for (let t = 0; t < coarse.length; t += 9) {
    const cx = (coarse[t] + coarse[t + 3] + coarse[t + 6]) / 3, cy = (coarse[t + 1] + coarse[t + 4] + coarse[t + 7]) / 3
    if (!(cx > 4 && cx < 10 && cy > 4 && cy < 10)) keep.push(...coarse.slice(t, t + 9))
  }
  const dense = grid(4, 10, 4, 10, 0.1, () => 0.02)
  const graph = buildMeshGraph({ kind: 'soup', positions: new Float32Array([...keep, ...dense]) })
  const all = new Uint32Array(graph.vertexCount).map((_, i) => i)
  // The surface's own mean height: 0.02 mm over 36 of 1600 mm².
  const trueOffset = (0.02 * 36) / 1600

  it('the dense patch holds most of the vertices but little of the area', () => {
    const area = vertexAreas(graph.positions, graph.indices)
    let denseVerts = 0, denseArea = 0, total = 0
    for (let v = 0; v < graph.vertexCount; v++) {
      total += area[v]
      if (graph.positions[3 * v + 2] > 0.01) { denseVerts++; denseArea += area[v] }
    }
    expect(denseVerts / graph.vertexCount).toBeGreaterThan(0.8)
    expect(denseArea / total).toBeLessThan(0.05)
  })

  it('weighted by area, lies at the surface’s mean height, not the dense patch’s', () => {
    // The seeded fit's weighting, for a region grown into a dense rim.
    const fit = fitPlaneClipped(graph.positions, all, 0, vertexAreas(graph.positions, graph.indices))!
    expect(Math.abs(fit.plane.nz)).toBeGreaterThan(1 - 1e-9)
    expect(Math.abs(Math.abs(fit.plane.d) - trueOffset)).toBeLessThan(2e-4)
    // Counted by vertices it sits over 0.01 mm up, twenty-odd times too high.
    const unweighted = fitPlaneClipped(graph.positions, all, 0)!
    expect(Math.abs(unweighted.plane.d)).toBeGreaterThan(0.01)
  })

  it('on a marked selection counts every vertex once, as QUICKSURFACE does', () => {
    // Measured 2026-11-04: QUICKSURFACE's Extract primitives fits are
    // vertex-counted least squares on the marked area (basic_part's face
    // within 0.01 µm; known-truth spheres and cylinders within 0.1 µm).
    const fit = fitPlaneOnSelection(graph, all, { method: 'gaussian', sigma: 0 })
    const offset = fit.normal[0] * fit.center[0] + fit.normal[1] * fit.center[1] + fit.normal[2] * fit.center[2]
    const unweighted = fitPlaneClipped(graph.positions, all, 0)!
    expect(Math.abs(Math.abs(offset) - Math.abs(unweighted.plane.d))).toBeLessThan(1e-9)
  })
})

describe('the 1σ used-points preset', () => {
  it('keeps most of a noisy plane rather than running down to ten points', () => {
    // A 30 × 30 mm plane, 0.02 mm Gaussian noise, a handful of 1 mm outliers.
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())
    const n = 20_000
    const pts = new Float32Array(3 * n)
    for (let i = 0; i < n; i++) {
      pts[3 * i] = (rand() - 0.5) * 30
      pts[3 * i + 1] = (rand() - 0.5) * 30
      pts[3 * i + 2] = 0.02 * gauss() + (i % 1000 === 0 ? 1 : 0)
    }
    const idx = new Uint32Array(n).map((_, i) => i)
    const one = fitPlaneClipped(pts, idx, 1)!
    expect(one.used.length).toBeGreaterThan(0.5 * n)
    expect(Math.abs(one.plane.d)).toBeLessThan(0.002)
    expect(1 - Math.abs(one.plane.nz)).toBeLessThan(1e-6)
    // The outliers are out at every preset.
    for (const k of [1, 2, 3]) {
      const f = fitPlaneClipped(pts, idx, k)!
      let outliersKept = 0
      for (const v of f.used) if (pts[3 * v + 2] > 0.5) outliersKept++
      expect(outliersKept).toBe(0)
    }
  })
})
