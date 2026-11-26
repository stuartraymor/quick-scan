// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform, the whole run (core/freeform/autoFreeform.ts) on solids
// whose answer is known — a sphere, a box, a torus, an open dome: the quad
// cage a field-aligned layout lays over a scan and the fit takes onto it.
import { describe, expect, it } from 'vitest'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import { AUTO_QUADS_MAX, AUTO_QUADS_MIN, AUTO_TARGETS, AutoError, DETAIL_FACTOR, type AutoSettings, runAutoFreeform } from '../core/freeform/autoFreeform'
import { sphereScan } from './networkMeshes'

const auto = (m: { positions: Float32Array; indices: Uint32Array }, settings: Partial<AutoSettings> & { quads: number }) => runAutoFreeform(m, { algorithm: 'basic', ...settings })

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

describe('runAutoFreeform', () => {
  it('covers a sphere with a closed genus-0 quad mesh near the target, its surface on the scan', () => {
    const ball = sphereScan(30, 0.01, 5)
    const scan = new ScanPaths(ball.positions, ball.indices)
    for (const target of [300, 1000, 2000]) {
      const r = auto(ball, { quads: target })
      expect(Math.abs(r.quads - target) / target).toBeLessThan(0.08)
      const t = topology(r.cage)
      expect(t).toMatchObject({ F: r.quads, loose: 0, euler: 2 })
      expect(r.closed).toBe(true)
      expect(r.boundaryEdges).toBe(0)
      expect(r.cage.faces.every((f) => f.length === 4 && new Set(f).size === 4)).toBe(true)
      // The fitted surface lies on the sphere: far nearer than the cage's own vertices, which stand off it.
      expect(r.deviation.rms).toBeLessThan(0.05)
      expect(r.deviation.max).toBeLessThan(0.5)
      expect(r.deviation.missed).toBe(0)
      for (let v = 0; v < t.V; v++) {
        const c = scan.closest([r.cage.positions[v * 3], r.cage.positions[v * 3 + 1], r.cage.positions[v * 3 + 2]])
        expect(c!.distance).toBeLessThan(1.5)
      }
      // Edges even: the mean is close to the square the target makes of the area.
      expect(r.edge).toBeGreaterThan(0.6 * Math.sqrt((4 * Math.PI * 900) / target))
      expect(r.edge).toBeLessThan(1.5 * Math.sqrt((4 * Math.PI * 900) / target))
      // The preview mesh is the surface measured: sixteen sub-quads a quad.
      expect(r.surface.indices.length).toBe(r.quads * 16 * 6)
    }
  })

  it('winds every face outward', () => {
    const { cage } = auto(sphereScan(30, 0, 5), { quads: 800 })
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
    const b = auto(box(40, 30, 20), { quads: 600 })
    expect(topology(b.cage)).toMatchObject({ loose: 0, euler: 2 })
    expect(Math.abs(b.quads - 600) / 600).toBeLessThan(0.1)
    const t = auto(torus(25, 8), { quads: 1200 })
    expect(topology(t.cage)).toMatchObject({ loose: 0, euler: 0 })
    expect(Math.abs(t.quads - 1200) / 1200).toBeLessThan(0.1)
  })

  it('lays an open cage over an open scan, its rim on the scan’s', () => {
    // A dome: the cap of a sphere above z = 10.
    const ball = sphereScan(30, 0, 5)
    const keep: number[] = []
    for (let t = 0; t < ball.indices.length; t += 3) {
      if ([0, 1, 2].every((k) => ball.positions[ball.indices[t + k] * 3 + 2] > 10)) keep.push(ball.indices[t], ball.indices[t + 1], ball.indices[t + 2])
    }
    const dome = { positions: ball.positions, indices: Uint32Array.from(keep) }
    const r = auto(dome, { quads: 400 })
    expect(r.closed).toBe(false)
    expect(r.boundaryEdges).toBeGreaterThan(10)
    const t = topology(r.cage)
    // One rim: a disc.
    expect(t.euler).toBe(1)
    let lowest = Infinity
    for (let v = 0; v < t.V; v++) lowest = Math.min(lowest, r.cage.positions[v * 3 + 2])
    expect(lowest).toBeGreaterThan(6)
    expect(lowest).toBeLessThan(14)
    expect(r.deviation.rms).toBeLessThan(0.1)
  })

  it('leaves out a crumb beside the part, and says how many pieces there were', () => {
    const ball = sphereScan(30, 0, 4)
    const n = ball.positions.length / 3
    const positions = Float32Array.from([...ball.positions, 80, 0, 0, 81, 0, 0, 80, 1, 0])
    const indices = Uint32Array.from([...ball.indices, n, n + 1, n + 2])
    const r = auto({ positions, indices }, { quads: 300 })
    expect(r.pieces).toBe(2)
    expect(r.piecesKept).toBe(1)
    expect(r.closed).toBe(true)
  })

  it('Feature aligned keeps a smooth sphere close to the requested density', () => {
    const ball = sphereScan(30, 0, 5)
    expect(AUTO_TARGETS).toEqual({ low: 1000, medium: 2000, fine: 4000 })
    const low = auto(ball, { algorithm: 'feature', quads: 400, details: 'low' })
    const balanced = auto(ball, { algorithm: 'feature', quads: 400 })
    expect(Math.abs(low.quads - 400 * DETAIL_FACTOR.low) / (400 * DETAIL_FACTOR.low)).toBeLessThan(0.1)
    expect(Math.abs(balanced.quads - 400) / 400).toBeLessThan(0.1)
    expect(balanced.algorithm).toBe('feature')
  })

  it('reports each stage as it runs, and stops when the progress throws', () => {
    const ball = sphereScan(30, 0, 5)
    const seen: string[] = []
    let last = -1
    runAutoFreeform(ball, { algorithm: 'basic', quads: 500 }, (stage, overall) => {
      if (seen[seen.length - 1] !== stage) seen.push(stage)
      expect(overall).toBeGreaterThanOrEqual(last - 1e-9)
      expect(overall).toBeLessThanOrEqual(1)
      last = overall
    })
    expect(seen).toEqual(['prepare', 'layout', 'fit', 'refine', 'measure'])
    expect(last).toBe(1)
    let calls = 0
    expect(() => runAutoFreeform(ball, { algorithm: 'basic', quads: 500 }, (stage) => { if (stage === 'layout' && ++calls > 3) throw new Error('stopped') })).toThrow()
  })

  it('refuses a target out of range, an algorithm it has not and a scan with nothing in it', () => {
    const ball = sphereScan(30, 0, 3)
    expect(() => auto(ball, { quads: AUTO_QUADS_MIN - 1 })).toThrow(AutoError)
    expect(() => auto(ball, { quads: AUTO_QUADS_MAX + 1 })).toThrow(AutoError)
    expect(() => auto(ball, { quads: Number.NaN })).toThrow(AutoError)
    expect(() => auto(ball, { quads: 500, algorithm: 'bogus' as never })).toThrow(AutoError)
    expect(() => auto({ positions: new Float32Array(0), indices: new Uint32Array(0) }, { quads: 1000 })).toThrow(AutoError)
  })
})
