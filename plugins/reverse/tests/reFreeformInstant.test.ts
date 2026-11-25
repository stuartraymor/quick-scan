// SPDX-License-Identifier: AGPL-3.0-only
// The TypeScript port of Instant Meshes (core/freeform/instant) on small
// synthetic scans: what the rest of Quick Scan relies on — pure quads, a
// manifold, the scan's topology, a count near the target, the same output
// for the same input — and the options: creases, constraints, cancelling.
import { describe, expect, it } from 'vitest'
import { instantQuads } from '../core/freeform/instant'
import type { InstantInput, InstantResult } from '../core/freeform/instant'

type Mesh = InstantInput & { positions: Float64Array }

/** A unit sphere: an octahedron subdivided `levels` times. */
function sphere(levels: number, radius = 1): Mesh {
  const pos: number[] = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]
  let tris: number[] = [0, 2, 4, 2, 1, 4, 1, 3, 4, 3, 0, 4, 2, 0, 5, 1, 2, 5, 3, 1, 5, 0, 3, 5]
  for (let l = 0; l < levels; l++) {
    const mid = new Map<number, number>()
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? a * 1e6 + b : b * 1e6 + a
      let m = mid.get(key)
      if (m === undefined) {
        m = pos.length / 3
        const x = pos[3 * a] + pos[3 * b], y = pos[3 * a + 1] + pos[3 * b + 1], z = pos[3 * a + 2] + pos[3 * b + 2]
        const len = Math.hypot(x, y, z)
        pos.push(x / len, y / len, z / len)
        mid.set(key, m)
      }
      return m
    }
    const next: number[] = []
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2]
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a)
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca)
    }
    tris = next
  }
  return { positions: Float64Array.from(pos, x => x * radius), indices: Uint32Array.from(tris) }
}

/** The half of a sphere with z ≥ 0 (whole triangles), open along its equator. */
function halfSphere(levels: number): Mesh {
  const whole = sphere(levels)
  const kept: number[] = []
  for (let t = 0; t < whole.indices.length; t += 3) {
    const a = whole.indices[t], b = whole.indices[t + 1], c = whole.indices[t + 2]
    if (whole.positions[3 * a + 2] + whole.positions[3 * b + 2] + whole.positions[3 * c + 2] > 1e-9) kept.push(a, b, c)
  }
  return { positions: whole.positions, indices: Uint32Array.from(kept) }
}

function torus(nu: number, nv: number, R = 3, r = 1): Mesh {
  const pos: number[] = [], tris: number[] = []
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u = i / nu * 2 * Math.PI, v = j / nv * 2 * Math.PI
    pos.push((R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v))
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * nv + j, b = ((i + 1) % nu) * nv + j, c = ((i + 1) % nu) * nv + (j + 1) % nv, d = i * nv + (j + 1) % nv
    tris.push(a, b, c, a, c, d)
  }
  return { positions: Float64Array.from(pos), indices: Uint32Array.from(tris) }
}

/** A flat square [0, size]² in z = 0, its normals +z. */
function plane(n: number, size = 10): Mesh {
  const pos: number[] = [], tris: number[] = []
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) pos.push(x / n * size, y / n * size, 0)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x
    if ((x + y) & 1) tris.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1)
    else tris.push(a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1)
  }
  return { positions: Float64Array.from(pos), indices: Uint32Array.from(tris) }
}

/** A cube [0, size]³, n × n squares per face, welded, wound outwards. */
function cube(n: number, size = 10): Mesh {
  const ids = new Map<string, number>()
  const pos: number[] = [], tris: number[] = []
  const vertex = (p: number[]): number => {
    const key = p.join(',')
    let id = ids.get(key)
    if (id === undefined) { id = pos.length / 3; pos.push(p[0] / n * size, p[1] / n * size, p[2] / n * size); ids.set(key, id) }
    return id
  }
  for (let axis = 0; axis < 3; axis++) for (const side of [0, n]) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const at = (di: number, dj: number): number => {
        const p = [0, 0, 0]
        p[axis] = side; p[u] = i + di; p[v] = j + dj
        return vertex(p)
      }
      const a = at(0, 0), b = at(1, 0), c = at(1, 1), d = at(0, 1)
      if (side === n) tris.push(a, b, c, a, c, d)
      else tris.push(a, c, b, a, d, c)
    }
  }
  return { positions: Float64Array.from(pos), indices: Uint32Array.from(tris) }
}

interface Topology { boundaryEdges: number; nonManifoldEdges: number; inconsistentEdges: number; euler: number; vertices: number; edges: number }

function topology(result: InstantResult): Topology {
  const nv = result.positions.length / 3
  const edges = new Map<number, { count: number; forward: number }>()
  const used = new Set<number>()
  for (const f of result.faces) {
    for (let k = 0; k < 4; k++) {
      const a = f[k], b = f[(k + 1) % 4]
      used.add(a)
      const key = a < b ? a * nv + b : b * nv + a
      const e = edges.get(key) ?? { count: 0, forward: 0 }
      e.count++
      if (a < b) e.forward++
      edges.set(key, e)
    }
  }
  let boundaryEdges = 0, nonManifoldEdges = 0, inconsistentEdges = 0
  for (const e of edges.values()) {
    if (e.count === 1) boundaryEdges++
    else if (e.count > 2) nonManifoldEdges++
    else if (e.forward !== 1) inconsistentEdges++
  }
  return { boundaryEdges, nonManifoldEdges, inconsistentEdges, euler: used.size - edges.size + result.faces.length, vertices: used.size, edges: edges.size }
}

/** What every result must be: pure quads over its own vertices, a manifold, wound alike, nothing unused. */
function expectCage(result: InstantResult): Topology {
  const nv = result.positions.length / 3
  expect(result.faces.length).toBeGreaterThan(0)
  for (const f of result.faces) {
    expect(f.length).toBe(4)
    expect(new Set(f).size).toBe(4)
    for (const v of f) expect(Number.isInteger(v) && v >= 0 && v < nv).toBe(true)
  }
  for (const x of result.positions) expect(Number.isFinite(x)).toBe(true)
  const t = topology(result)
  expect(t.nonManifoldEdges).toBe(0)
  expect(t.inconsistentEdges).toBe(0)
  expect(t.vertices).toBe(nv)
  expect(result.stats.quads).toBe(result.faces.length)
  expect(result.stats.boundaryEdges).toBe(t.boundaryEdges)
  return t
}

/** Six times the signed volume enclosed (positive when the faces are wound outwards). */
function signedVolume(result: InstantResult): number {
  const p = result.positions
  let v = 0
  for (const f of result.faces) {
    for (const [a, b, c] of [[f[0], f[1], f[2]], [f[0], f[2], f[3]]]) {
      v += p[3 * a] * (p[3 * b + 1] * p[3 * c + 2] - p[3 * b + 2] * p[3 * c + 1])
        - p[3 * a + 1] * (p[3 * b] * p[3 * c + 2] - p[3 * b + 2] * p[3 * c])
        + p[3 * a + 2] * (p[3 * b] * p[3 * c + 1] - p[3 * b + 1] * p[3 * c])
    }
  }
  return v
}

describe('instantQuads (Instant Meshes port)', () => {
  it('covers a sphere with a closed, outward, pure-quad manifold near the target count', () => {
    const result = instantQuads(sphere(5), { quads: 240 })
    const t = expectCage(result)
    expect(t.boundaryEdges).toBe(0)
    expect(t.euler).toBe(2)
    expect(result.stats.components).toBe(1)
    expect(Math.abs(result.faces.length - 240) / 240).toBeLessThan(0.15)
    expect(signedVolume(result)).toBeGreaterThan(0)
    // On the sphere: smoothed and reprojected.
    for (let i = 0; i < result.positions.length; i += 3) {
      const r = Math.hypot(result.positions[i], result.positions[i + 1], result.positions[i + 2])
      expect(Math.abs(r - 1)).toBeLessThan(0.08)
    }
    // A 4-RoSy field on a sphere has singularities, and the cage irregular vertices.
    expect(result.singularities).toBeGreaterThanOrEqual(8)
    expect(result.stats.irregular).toBeGreaterThanOrEqual(8)
    // The edge the quads were laid at: √(4π / 240) for a square of the sphere each.
    expect(result.scale).toBeGreaterThan(0.2)
    expect(result.scale).toBeLessThan(0.26)
  })

  it('keeps the genus of a torus', () => {
    const result = instantQuads(torus(96, 48), { quads: 400 })
    const t = expectCage(result)
    expect(t.boundaryEdges).toBe(0)
    expect(t.euler).toBe(0)
    expect(result.stats.components).toBe(1)
    expect(Math.abs(result.faces.length - 400) / 400).toBeLessThan(0.15)
  })

  it('leaves an open scan open, its boundary on the rim', () => {
    const half = instantQuads(halfSphere(5), { quads: 160 })
    const th = expectCage(half)
    expect(th.boundaryEdges).toBeGreaterThan(8)
    expect(th.euler).toBe(1)
    expect(half.stats.components).toBe(1)

    const flat = instantQuads(plane(48), { quads: 144 })
    const tp = expectCage(flat)
    expect(tp.euler).toBe(1)
    expect(Math.abs(flat.faces.length - 144) / 144).toBeLessThan(0.15)
    // Aligned to the square: the boundary is the square's rim, about 12 quads a side.
    expect(tp.boundaryEdges).toBeGreaterThanOrEqual(40)
    expect(tp.boundaryEdges).toBeLessThanOrEqual(56)
    const nv = flat.positions.length / 3
    const count = new Map<number, number>()
    for (const f of flat.faces) for (let k = 0; k < 4; k++) {
      const a = f[k], b = f[(k + 1) % 4], key = a < b ? a * nv + b : b * nv + a
      count.set(key, (count.get(key) ?? 0) + 1)
    }
    for (const [key, c] of count) {
      if (c !== 1) continue
      for (const v of [Math.floor(key / nv), key % nv]) {
        const x = flat.positions[3 * v], y = flat.positions[3 * v + 1]
        expect(Math.min(Math.abs(x), Math.abs(x - 10), Math.abs(y), Math.abs(y - 10))).toBeLessThan(0.25)
      }
    }
    // Wound to the scan's side: +z.
    for (const f of flat.faces) {
      const [a, b, , d] = f, p = flat.positions
      const nz = (p[3 * b] - p[3 * a]) * (p[3 * d + 1] - p[3 * a + 1]) - (p[3 * b + 1] - p[3 * a + 1]) * (p[3 * d] - p[3 * a])
      expect(nz).toBeGreaterThan(0)
    }
  })

  it('follows the edges of a cube when given a crease angle', () => {
    const scan = cube(20)
    const result = instantQuads(scan, { quads: 384, creaseAngle: 30 })
    const t = expectCage(result)
    expect(t.boundaryEdges).toBe(0)
    expect(t.euler).toBe(2)
    expect(signedVolume(result)).toBeGreaterThan(0)
    expect(Math.abs(result.faces.length - 384) / 384).toBeLessThan(0.2)
    // Vertices sit on the cube, and some along each of its twelve edges.
    const onEdge = new Set<string>()
    for (let i = 0; i < result.positions.length; i += 3) {
      const p = [result.positions[i], result.positions[i + 1], result.positions[i + 2]]
      const off = p.map(x => Math.min(Math.abs(x), Math.abs(x - 10)))
      expect(Math.min(...off)).toBeLessThan(0.6)
      const near = off.map(o => o < 0.3)
      if (near.filter(Boolean).length === 2) {
        const free = near.indexOf(false)
        onEdge.add(`${free}:${p.map((x, k) => (k === free ? '-' : x < 5 ? 0 : 1)).join('')}`)
      }
    }
    expect(onEdge.size).toBe(12)
  })

  it('is deterministic, and the seed is an input', () => {
    const scan = sphere(4)
    const a = instantQuads(scan, { quads: 120, seed: 3 })
    const b = instantQuads(scan, { quads: 120, seed: 3 })
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions))
    expect(b.faces).toEqual(a.faces)
    expect(b.singularities).toBe(a.singularities)
    const c = instantQuads(scan, { quads: 120, seed: 4 })
    expectCage(c)
    expect(Array.from(c.positions)).not.toEqual(Array.from(a.positions))
  })

  it('turns the field to a direction constraint', () => {
    const scan = plane(48)
    // A guide along the diagonal of the square: its vertices, each told the diagonal.
    const direction: [number, number, number] = [Math.SQRT1_2, Math.SQRT1_2, 0]
    const constraints = []
    for (let k = 4; k <= 44; k++) constraints.push({ vertex: k * 49 + k, direction, weight: 1 })
    const aligned = (result: InstantResult): number => {
      const p = result.positions
      let near = 0, all = 0
      for (const f of result.faces) for (let k = 0; k < 4; k++) {
        const a = f[k], b = f[(k + 1) % 4]
        const angle = Math.atan2(p[3 * b + 1] - p[3 * a + 1], p[3 * b] - p[3 * a]) * 180 / Math.PI
        // The angle to the nearest of the diagonal and its perpendicular.
        const off = Math.abs(((angle - 45) % 90 + 135) % 90 - 45)
        all++
        if (off <= 15) near++
      }
      return near / all
    }
    const guided = instantQuads(scan, { quads: 144, boundaries: false, constraints })
    expectCage(guided)
    expect(aligned(guided)).toBeGreaterThan(0.8)
    // With the boundary aligned and no guide the same scan gives the square's own grid.
    const plain = instantQuads(scan, { quads: 144 })
    expect(aligned(plain)).toBeLessThan(0.2)
  })

  it('reports progress through its stages and stops when the callback throws', () => {
    const scan = sphere(4)
    const seen: string[] = []
    let last = -1
    instantQuads(scan, {
      quads: 120,
      progress: (stage, fraction) => {
        expect(fraction).toBeGreaterThanOrEqual(0)
        expect(fraction).toBeLessThanOrEqual(1)
        if (seen[seen.length - 1] !== stage) { seen.push(stage); last = -1 }
        expect(fraction).toBeGreaterThanOrEqual(last)
        last = fraction
      },
    })
    expect(seen.slice(0, 4)).toEqual(['prepare', 'hierarchy', 'orientation', 'position'])
    expect(seen).toContain('extract')
    expect(seen).toContain('smooth')

    for (const stop of ['prepare', 'orientation', 'position', 'extract', 'smooth']) {
      expect(() => instantQuads(scan, {
        quads: 120,
        progress: stage => { if (stage === stop) throw new Error(`cancelled in ${stop}`) },
      })).toThrow(`cancelled in ${stop}`)
    }
  })

  it('accepts what it cannot use: no triangles, a sizing field', () => {
    const none = instantQuads({ positions: new Float64Array(0), indices: new Uint32Array(0) }, { quads: 100 })
    expect(none.faces).toEqual([])
    expect(none.positions.length).toBe(0)
    expect(() => instantQuads({ positions: new Float64Array(9), indices: Uint32Array.from([0, 1, 7]) }, { quads: 100 })).toThrow(/does not exist/)
    expect(() => instantQuads({ positions: Float64Array.from([0, 0, 0, 1, 0, NaN, 0, 1, 0]), indices: Uint32Array.from([0, 1, 2]) }, { quads: 100 })).toThrow(/not finite/)
    const scan = sphere(4)
    const sized = instantQuads(scan, { quads: 120, sizing: new Float32Array(scan.positions.length / 3).fill(1) })
    const plain = instantQuads(scan, { quads: 120 })
    expect(sized.faces).toEqual(plain.faces)
    // Float32 positions are taken as well.
    expectCage(instantQuads({ positions: Float32Array.from(scan.positions), indices: scan.indices }, { quads: 120 }))
  })
})
