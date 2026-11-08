// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform, Basic (F6 of audit-2026-11-07/FREEFORM_ROADMAP.md), the
// core: the closed quad cage that a voxel remesh lays over a scan, on solids
// whose answer is known — a sphere, a box, a torus.
import { describe, expect, it } from 'vitest'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import { AUTO_QUADS_MAX, AUTO_QUADS_MIN, AutoError, autoCage } from '../core/freeform/auto'
import { subdivide } from '../core/freeform/subdivide'
import { sphereScan } from './networkMeshes'

const paths = (m: { positions: Float32Array; indices: Uint32Array }) => new ScanPaths(m.positions, m.indices)

/** A torus of major radius R, minor r. */
function torus(R: number, r: number, nu = 80, nv = 40) {
  const positions: number[] = []
  const indices: number[] = []
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const u = (i / nu) * 2 * Math.PI
      const v = (j / nv) * 2 * Math.PI
      positions.push((R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v))
    }
  }
  const id = (i: number, j: number) => (i % nu) * nv + (j % nv)
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) indices.push(id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j), id(i + 1, j + 1), id(i, j + 1))
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

/** A box a × b × c about the origin, each face a grid of n × n squares of two triangles. */
function box(a: number, b: number, c: number, n = 24) {
  const positions: number[] = []
  const indices: number[] = []
  const dims = [a, b, c]
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [-1, 1]) {
      const u = (axis + 1) % 3
      const v = (axis + 2) % 3
      const base = positions.length / 3
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          const p = [0, 0, 0]
          p[axis] = (side * dims[axis]) / 2
          p[u] = (i / n - 0.5) * dims[u]
          p[v] = (j / n - 0.5) * dims[v]
          positions.push(p[0], p[1], p[2])
        }
      }
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const q = base + j * (n + 1) + i
          if (side > 0) indices.push(q, q + 1, q + n + 2, q, q + n + 2, q + n + 1)
          else indices.push(q, q + n + 2, q + 1, q, q + n + 1, q + n + 2)
        }
      }
    }
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}

/** Counts of a cage: vertices, edges, faces, and how many edges lie in other than two faces. */
function topology(c: { positions: Float64Array; faces: number[][] }) {
  const edges = new Map<string, number>()
  for (const f of c.faces) {
    for (let k = 0; k < f.length; k++) {
      const a = f[k]
      const b = f[(k + 1) % f.length]
      const key = a < b ? `${a},${b}` : `${b},${a}`
      edges.set(key, (edges.get(key) ?? 0) + 1)
    }
  }
  const V = c.positions.length / 3
  const E = edges.size
  const F = c.faces.length
  const loose = [...edges.values()].filter((n) => n !== 2).length
  return { V, E, F, euler: V - E + F, loose }
}

describe('autoCage', () => {
  it('covers a sphere with a closed genus-0 quad mesh near the target, vertices on the scan', () => {
    const scan = paths(sphereScan(30, 0.01, 5))
    for (const target of [300, 1000, 2000]) {
      const r = autoCage(scan, target)
      expect(Math.abs(r.quads - target) / target).toBeLessThan(0.05)
      const t = topology(r.cage)
      expect(t).toMatchObject({ F: r.quads, loose: 0, euler: 2 })
      // Every face a quad; every vertex on the scan to within a hair, the cage kept off the inside.
      expect(r.cage.faces.every((f) => f.length === 4)).toBe(true)
      for (let v = 0; v < t.V; v++) {
        const c = scan.closest([r.cage.positions[v * 3], r.cage.positions[v * 3 + 1], r.cage.positions[v * 3 + 2]])
        expect(c!.distance).toBeLessThan(0.6)
      }
      // The voxel surface of a sphere is staircase all over: many vertices with three or five edges (a flat-sided part has far fewer; basic_part 8 %, native 2.6 %), but most still have four.
      expect(r.irregular / t.V).toBeLessThan(0.5)
      // Edges even: the mean is close to the square the target makes of the area.
      expect(r.edge).toBeGreaterThan(0.6 * Math.sqrt((4 * Math.PI * 900) / target))
      expect(r.edge).toBeLessThan(1.5 * Math.sqrt((4 * Math.PI * 900) / target))
    }
  })

  it('winds every face outward', () => {
    const scan = paths(sphereScan(30, 0, 5))
    const { cage } = autoCage(scan, 800)
    let inward = 0
    for (const f of cage.faces) {
      const p = f.map((v) => [cage.positions[v * 3], cage.positions[v * 3 + 1], cage.positions[v * 3 + 2]])
      const n = [0, 1, 2].map((k) => {
        const a = (k + 1) % 3
        const b = (k + 2) % 3
        // Newell normal of the quad.
        let s = 0
        for (let i = 0; i < 4; i++) s += (p[i][a] - p[(i + 1) % 4][a]) * (p[i][b] + p[(i + 1) % 4][b])
        return s
      })
      const mid = [0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k] + p[3][k]) / 4)
      if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0) inward++
    }
    expect(inward).toBe(0)
  })

  it('wraps a box and a torus as closed surfaces of the right topology', () => {
    const b = autoCage(paths(box(40, 30, 20)), 600)
    expect(topology(b.cage)).toMatchObject({ loose: 0, euler: 2 })
    expect(Math.abs(b.quads - 600) / 600).toBeLessThan(0.08)
    const t = autoCage(paths(torus(25, 8)), 1200)
    expect(topology(t.cage)).toMatchObject({ loose: 0, euler: 0 })
    expect(Math.abs(t.quads - 1200) / 1200).toBeLessThan(0.08)
  })

  it('refines to a smooth surface the scan lies close to', () => {
    const scan = paths(sphereScan(30, 0.01, 5))
    const { cage } = autoCage(scan, 1500)
    const fine = subdivide(subdivide(cage))
    let worst = 0
    let sum = 0
    for (let v = 0; v < fine.positions.length; v += 3) {
      const c = scan.closest([fine.positions[v], fine.positions[v + 1], fine.positions[v + 2]])!
      worst = Math.max(worst, c.distance)
      sum += c.distance
    }
    // A cage on the scan lies inside it by the shrink of the limit surface: a fraction of the edge, not far.
    expect(worst).toBeLessThan(1.2)
    expect(sum / (fine.positions.length / 3)).toBeLessThan(0.5)
  })

  it('refuses a target out of range and a scan with nothing in it', () => {
    const scan = paths(sphereScan(30, 0, 3))
    expect(() => autoCage(scan, AUTO_QUADS_MIN - 1)).toThrow(AutoError)
    expect(() => autoCage(scan, AUTO_QUADS_MAX + 1)).toThrow(AutoError)
    expect(() => autoCage(scan, Number.NaN)).toThrow(AutoError)
    expect(() => autoCage(new ScanPaths(new Float32Array(0), new Uint32Array(0)), 1000)).toThrow(AutoError)
  })
})
