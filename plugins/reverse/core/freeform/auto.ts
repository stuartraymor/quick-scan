// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform, Basic (F6 of audit-2026-11-07/FREEFORM_ROADMAP.md): a closed
// quad cage laid over the whole scan at a target number of quads.
//
// QUICKSURFACE's Basic algorithm, measured on 8.0.128 (analysis/freeform-2026-11-09):
// the whole of basic_part becomes one closed quad surface of sphere topology
// — 2000 quads (2002 vertices) for Medium, 4014 (4016) for Fine, which asks
// 4000 — nearly all of its vertices on four edges, a few per cent on three or
// five, with the edge a few millimetres, and the cage lies a few tenths of a
// millimetre off the scan (median 0.58 mm at Medium): it is snapped to the
// scan afterwards, as every freeform is.
//
// Here: the scan's surface is rasterised into a grid of cubes, the cubes the
// outside cannot reach are the solid, and the faces between the solid and the
// outside are the quads (the voxel remesh of the roadmap). The cube is
// chosen so that the faces come to the target. A pinch the cubes make — two
// cubes meeting at an edge or a corner alone — is filled, so the surface is a
// manifold. Its vertices are then laid onto the scan and relaxed along it
// until the quads are even. A hole in the scan smaller than a couple of cubes
// is closed by the grid, as a hole a native cage spans.
//
// Pure: a scan in (ScanPaths), a cage out.

import { ScanPaths } from '../../../../src/core/geometry/scanPath'
import type { Vec3 } from '../../../../src/core/types'
import type { Cage } from './cage'

/** The target quads of Low, Medium and Fine: QUICKSURFACE's own. */
export const AUTO_TARGETS = { low: 1000, medium: 2000, fine: 4000 } as const
export type AutoDensity = keyof typeof AUTO_TARGETS

/** The fewest and the most quads a cage is asked for. */
export const AUTO_QUADS_MIN = 100
export const AUTO_QUADS_MAX = 100_000

/** Cells the grid may hold: past this the cube is made larger. */
const MAX_CELLS = 6_000_000
/** Free cells round the part, so the outside is one piece reaching every side. */
const PAD = 3
/** Times the cube is tried for the target. */
const TRIES = 14
/** A count this near the target (a share of it) is taken at once. */
const GOOD_ENOUGH = 0.01
/** Passes of filling pinches before the grid is given up as not manifold. */
const FIX_PASSES = 40

export class AutoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AutoError'
  }
}

export interface AutoResult {
  cage: Cage
  /** The cage's quads, against the target asked for. */
  quads: number
  target: number
  /** The cube's side, mm. */
  cell: number
  /** Vertices with other than four edges. */
  irregular: number
  /** Mean edge of the cage, mm. */
  edge: number
  /** The cage is closed (every edge in two faces). */
  closed: boolean
  /** Cubes tried. */
  tries: number
}

interface Grid {
  nx: number
  ny: number
  nz: number
  h: number
  origin: Vec3
}

/** The scan's surface as points no further apart than `spacing`: its vertices, and the inside of any triangle longer than that. */
function surfacePoints(scan: ScanPaths, spacing: number): Float32Array {
  const p = scan.positions
  const idx = scan.indices
  const out: number[] = []
  for (let i = 0; i + 2 < p.length; i += 3) out.push(p[i], p[i + 1], p[i + 2])
  const dist = (a: number, b: number) => Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2])
  for (let t = 0; t < scan.triangleCount; t++) {
    const a = idx[t * 3] * 3
    const b = idx[t * 3 + 1] * 3
    const c = idx[t * 3 + 2] * 3
    const longest = Math.max(dist(a, b), dist(b, c), dist(c, a))
    if (!(longest > spacing)) continue
    const k = Math.min(48, Math.ceil(longest / spacing))
    for (let i = 0; i <= k; i++) {
      for (let j = 0; i + j <= k; j++) {
        const u = i / k
        const v = j / k
        const w = 1 - u - v
        out.push(w * p[a] + u * p[b] + v * p[c], w * p[a + 1] + u * p[b + 1] + v * p[c + 1], w * p[a + 2] + u * p[b + 2] + v * p[c + 2])
      }
    }
  }
  return Float32Array.from(out)
}

function bounds(p: ArrayLike<number>): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i + 2 < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      if (p[i + k] < min[k]) min[k] = p[i + k]
      if (p[i + k] > max[k]) max[k] = p[i + k]
    }
  }
  return { min, max }
}

function gridFor(min: Vec3, max: Vec3, h: number, shift: number): Grid {
  const origin: Vec3 = [min[0] - (PAD + shift) * h, min[1] - (PAD + shift * 0.61) * h, min[2] - (PAD + shift * 0.37) * h]
  return { nx: Math.ceil((max[0] - origin[0]) / h) + PAD, ny: Math.ceil((max[1] - origin[1]) / h) + PAD, nz: Math.ceil((max[2] - origin[2]) / h) + PAD, h, origin }
}

/** 1 for each cell the scan's points fall in, else 0. */
function mark(points: Float32Array, g: Grid): Uint8Array {
  const cells = new Uint8Array(g.nx * g.ny * g.nz)
  for (let i = 0; i + 2 < points.length; i += 3) {
    const x = Math.floor((points[i] - g.origin[0]) / g.h)
    const y = Math.floor((points[i + 1] - g.origin[1]) / g.h)
    const z = Math.floor((points[i + 2] - g.origin[2]) / g.h)
    if (x < 0 || y < 0 || z < 0 || x >= g.nx || y >= g.ny || z >= g.nz) continue
    cells[x + g.nx * (y + g.ny * z)] = 1
  }
  return cells
}

/** The solid: every cell the outside does not reach through free cells from a corner of the grid. */
function solidOf(surface: Uint8Array, g: Grid): Uint8Array {
  const n = g.nx * g.ny * g.nz
  const outside = new Uint8Array(n)
  const stack = new Int32Array(n)
  let top = 0
  stack[top++] = 0
  outside[0] = 1
  const sx = 1
  const sy = g.nx
  const sz = g.nx * g.ny
  while (top > 0) {
    const c = stack[--top]
    const x = c % g.nx
    const y = Math.floor(c / g.nx) % g.ny
    const z = Math.floor(c / sz)
    const visit = (d: number) => {
      if (!outside[d] && !surface[d]) {
        outside[d] = 1
        stack[top++] = d
      }
    }
    if (x > 0) visit(c - sx)
    if (x < g.nx - 1) visit(c + sx)
    if (y > 0) visit(c - sy)
    if (y < g.ny - 1) visit(c + sy)
    if (z > 0) visit(c - sz)
    if (z < g.nz - 1) visit(c + sz)
  }
  const solid = new Uint8Array(n)
  for (let c = 0; c < n; c++) solid[c] = outside[c] ? 0 : 1
  return solid
}

interface Voxels {
  /** Lattice coordinates of each vertex, 3 each. */
  lattice: number[]
  faces: number[][]
}

/** The faces between solid and free cells, each wound counter-clockwise seen from outside. */
function facesOf(solid: Uint8Array, g: Grid): Voxels {
  const ids = new Map<number, number>()
  const lattice: number[] = []
  const faces: number[][] = []
  const sx = g.nx + 1
  const sy = g.ny + 1
  const vertex = (i: number, j: number, k: number): number => {
    const key = i + sx * (j + sy * k)
    const had = ids.get(key)
    if (had !== undefined) return had
    const id = lattice.length / 3
    lattice.push(i, j, k)
    ids.set(key, id)
    return id
  }
  const cellAt = (i: number, j: number, k: number): number => (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz ? 0 : solid[i + g.nx * (j + g.ny * k)])
  for (let k = 0; k < g.nz; k++) {
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        if (!solid[i + g.nx * (j + g.ny * k)]) continue
        const c = [i, j, k]
        for (let axis = 0; axis < 3; axis++) {
          const u = (axis + 1) % 3
          const v = (axis + 2) % 3
          for (const sign of [1, -1]) {
            const nb = [i, j, k]
            nb[axis] += sign
            if (cellAt(nb[0], nb[1], nb[2])) continue
            const corners: number[] = []
            for (const [du, dv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
              const q = [0, 0, 0]
              q[axis] = c[axis] + (sign > 0 ? 1 : 0)
              q[u] = c[u] + du
              q[v] = c[v] + dv
              corners.push(vertex(q[0], q[1], q[2]))
            }
            faces.push(sign > 0 ? corners : corners.reverse())
          }
        }
      }
    }
  }
  return { lattice, faces }
}

/** The lattice vertices where the surface is not a manifold — an edge in more than two faces, or a vertex whose faces fall into more than one fan. */
function pinches(m: Voxels): { edges: [number, number][]; vertices: number[] } {
  const nv = m.lattice.length / 3
  const edgeFaces = new Map<number, number>()
  const key = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a)
  const around: number[][] = Array.from({ length: nv }, () => [])
  m.faces.forEach((f, fi) => {
    for (let k = 0; k < 4; k++) {
      const a = f[k]
      const b = f[(k + 1) % 4]
      edgeFaces.set(key(a, b), (edgeFaces.get(key(a, b)) ?? 0) + 1)
      around[a].push(fi)
    }
  })
  const edges: [number, number][] = []
  for (const [e, count] of edgeFaces) if (count > 2) edges.push([Math.floor(e / nv), e % nv])
  const vertices: number[] = []
  for (let v = 0; v < nv; v++) {
    const fs = around[v]
    if (fs.length < 2) continue
    // Faces joined where they share an edge at v: the other end of that edge names it.
    const parent = fs.map((_, i) => i)
    const find = (a: number): number => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]]
        a = parent[a]
      }
      return a
    }
    const byNeighbour = new Map<number, number>()
    fs.forEach((fi, i) => {
      const f = m.faces[fi]
      const at = f.indexOf(v)
      for (const w of [f[(at + 1) % 4], f[(at + 3) % 4]]) {
        const had = byNeighbour.get(w)
        if (had === undefined) byNeighbour.set(w, i)
        else parent[find(i)] = find(had)
      }
    })
    if (new Set(fs.map((_, i) => find(i))).size > 1) vertices.push(v)
  }
  return { edges, vertices }
}

/** The surface of a solid made a manifold by filling the free cells about each pinch. */
function manifold(solid: Uint8Array, g: Grid): Voxels | null {
  for (let pass = 0; pass < FIX_PASSES; pass++) {
    const m = facesOf(solid, g)
    const bad = pinches(m)
    if (bad.edges.length === 0 && bad.vertices.length === 0) return m
    const fill = (i: number, j: number, k: number) => {
      if (i < 1 || j < 1 || k < 1 || i >= g.nx - 1 || j >= g.ny - 1 || k >= g.nz - 1) return
      solid[i + g.nx * (j + g.ny * k)] = 1
    }
    const around = (v: number) => {
      const i = m.lattice[v * 3]
      const j = m.lattice[v * 3 + 1]
      const k = m.lattice[v * 3 + 2]
      for (const di of [-1, 0]) for (const dj of [-1, 0]) for (const dk of [-1, 0]) fill(i + di, j + dj, k + dk)
    }
    for (const v of bad.vertices) around(v)
    for (const [a, b] of bad.edges) {
      around(a)
      around(b)
    }
  }
  return null
}

/** The surface for a cube of side h, its grid shifted by `shift` of a cube; null where the surface will not be made a manifold. */
function voxelSurface(points: Float32Array, min: Vec3, max: Vec3, h: number, shift: number): { m: Voxels; g: Grid } | null {
  const g = gridFor(min, max, h, shift)
  const solid = solidOf(mark(points, g), g)
  const m = manifold(solid, g)
  return m ? { m, g } : null
}

function neighboursOf(nv: number, faces: number[][]): number[][] {
  const sets = Array.from({ length: nv }, () => new Set<number>())
  for (const f of faces) {
    for (let k = 0; k < f.length; k++) {
      sets[f[k]].add(f[(k + 1) % f.length])
      sets[f[(k + 1) % f.length]].add(f[k])
    }
  }
  return sets.map((s) => [...s])
}

/** The vertices laid on the scan and relaxed along it: each moved to the scan's nearest point, then toward the middle of its neighbours', `iterations` times, ending on the scan. */
export function relaxOnto(positions: Float64Array, faces: number[][], scan: ScanPaths, iterations = 24, weight = 0.5): Float64Array {
  const nv = positions.length / 3
  const nb = neighboursOf(nv, faces)
  let cur = Float64Array.from(positions)
  const project = (src: Float64Array): Float64Array => {
    const out = Float64Array.from(src)
    for (let v = 0; v < nv; v++) {
      const c = scan.closest([src[v * 3], src[v * 3 + 1], src[v * 3 + 2]])
      if (c) out.set(c.point, v * 3)
    }
    return out
  }
  for (let it = 0; it < iterations; it++) {
    const on = project(cur)
    const next = Float64Array.from(on)
    for (let v = 0; v < nv; v++) {
      const ns = nb[v]
      if (ns.length === 0) continue
      for (let k = 0; k < 3; k++) {
        let s = 0
        for (const w of ns) s += on[w * 3 + k]
        next[v * 3 + k] = on[v * 3 + k] + weight * (s / ns.length - on[v * 3 + k])
      }
    }
    cur = next
  }
  return project(cur)
}

function surfaceArea(scan: ScanPaths): number {
  const p = scan.positions
  const idx = scan.indices
  let area = 0
  for (let t = 0; t < scan.triangleCount; t++) {
    const a = idx[t * 3] * 3
    const b = idx[t * 3 + 1] * 3
    const c = idx[t * 3 + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
  }
  return area
}

/** The closed quad cage of a scan at about `target` quads: see the head of the file. */
export function autoCage(scan: ScanPaths, target: number, relax = 2, weight = 0.5): AutoResult {
  if (!Number.isFinite(target) || target < AUTO_QUADS_MIN || target > AUTO_QUADS_MAX) throw new AutoError(`Target quads: from ${AUTO_QUADS_MIN} to ${AUTO_QUADS_MAX}.`)
  if (scan.triangleCount === 0) throw new AutoError('There is no scan to make a freeform from.')
  const { min, max } = bounds(scan.positions)
  const area = surfaceArea(scan)
  if (!(area > 0)) throw new AutoError('The scan has no surface to make a freeform from.')
  // The cube for a surface of random aim: a face of it is 1.5 of a cube's face, about.
  const guess = Math.sqrt((1.5 * area) / target)
  let hLow = guess / 3
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  while (((span / hLow + 2 * PAD) ** 3) > MAX_CELLS) hLow *= 1.25
  // The points are no further apart than half the smallest cube tried, so that no cube the surface runs through is missed.
  const points = surfacePoints(scan, hLow / 2)
  let h = Math.max(guess, hLow)
  let best: { m: Voxels; g: Grid; error: number } | null = null
  let tries = 0
  for (let t = 0; t < TRIES; t++) {
    tries++
    // After the first tries the grid is shifted a little, for a different count at the same cube.
    const shift = t < 4 ? 0 : ((t * 0.37) % 1)
    const s = voxelSurface(points, min, max, h, shift)
    if (!s) {
      h *= 1.07
      continue
    }
    const count = s.m.faces.length
    const error = Math.abs(count - target) / target
    if (!best || error < best.error) best = { ...s, error }
    if (error <= GOOD_ENOUGH) break
    h = Math.max(hLow, h * Math.sqrt(count / target) * (1 + 0.01 * ((t % 3) - 1)))
  }
  if (!best) throw new AutoError('The scan could not be made a closed surface of cubes: its surface is too thin or too broken at this size.')
  const { m, g } = best
  const nv = m.lattice.length / 3
  const lattice = new Float64Array(nv * 3)
  for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) lattice[v * 3 + k] = g.origin[k] + m.lattice[v * 3 + k] * g.h
  const positions = relaxOnto(lattice, m.faces, scan, relax, weight)
  const cage: Cage = { positions, faces: m.faces, creases: [] }
  const nb = neighboursOf(nv, m.faces)
  const irregular = nb.filter((n) => n.length !== 4).length
  let edgeSum = 0
  let edgeCount = 0
  nb.forEach((ns, v) => {
    for (const w of ns) {
      if (w < v) continue
      edgeSum += Math.hypot(positions[v * 3] - positions[w * 3], positions[v * 3 + 1] - positions[w * 3 + 1], positions[v * 3 + 2] - positions[w * 3 + 2])
      edgeCount++
    }
  })
  return { cage, quads: m.faces.length, target, cell: g.h, irregular, edge: edgeCount > 0 ? edgeSum / edgeCount : 0, closed: true, tries }
}
