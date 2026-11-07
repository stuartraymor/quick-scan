// SPDX-License-Identifier: AGPL-3.0-only
// Convert to CAD body (F1 of audit-2026-11-07/FREEFORM_ROADMAP.md): a cage's
// quads grown into regular blocks, each block's surface sampled on the limit
// and made one B-spline face, the faces sewn. Checked on cages with a known
// answer — a flat grid is one face of its own area; a cube is a solid of six
// faces; a torus of 48 quads sews from rectangles that cannot wrap — and on
// the Wrap cage QUICKSURFACE exported, against the limit surface sampled
// finely, with the STEP file read back.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { type Cage, faceArea, topology, vertexCount } from '../core/freeform/cage'
import { parseQuadObj } from '../core/freeform/cageIO'
import { patchesBody } from '../core/freeform/convert'
import { limitMesh } from '../core/freeform/limit'
import { cagePatches, findBlocks, MAX_BLOCK_SIDE } from '../core/freeform/patches'
import { subdivided } from '../core/freeform/subdivide'
import { ReKernel } from '../core/kernel'
import { vi } from 'vitest'

vi.setConfig({ testTimeout: 120_000 })

const kernelPromise = ReKernel.load()

function cage(vertices: Vec3[], faces: number[][], creases: [number, number][] = []): Cage {
  return { positions: Float64Array.from(vertices.flat()), faces, creases }
}

/** (nu − 1) × (nv − 1) quads over [0, nu − 1] × [0, nv − 1]. */
function grid(nu: number, nv: number, creases: [number, number][] = []): Cage {
  const v: Vec3[] = []
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) v.push([i, j, 0])
  const f: number[][] = []
  for (let j = 0; j + 1 < nv; j++) for (let i = 0; i + 1 < nu; i++) f.push([j * nu + i, j * nu + i + 1, (j + 1) * nu + i + 1, (j + 1) * nu + i])
  return cage(v, f, creases)
}

/** A torus of nu × nv quads, major radius R, minor r: every vertex has four edges. */
function torus(nu: number, nv: number, R: number, r: number): Cage {
  const v: Vec3[] = []
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = (2 * Math.PI * i) / nu, b = (2 * Math.PI * j) / nv
    v.push([(R + r * Math.cos(b)) * Math.cos(a), (R + r * Math.cos(b)) * Math.sin(a), r * Math.sin(b)])
  }
  const f: number[][] = []
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const i1 = (i + 1) % nu, j1 = (j + 1) % nv
    f.push([j * nu + i, j * nu + i1, j1 * nu + i1, j1 * nu + i])
  }
  return cage(v, f)
}

const cube = cage(
  [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map((p) => p.map((x) => x * 20) as Vec3),
  [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
)

/** The volume a closed quad mesh holds, by the divergence theorem; its sign says which way it faces. */
function meshVolume(positions: Float64Array, faces: number[][]): number {
  let v = 0
  for (const f of faces) {
    for (let k = 1; k + 1 < f.length; k++) {
      const a = f[0] * 3, b = f[k] * 3, c = f[k + 1] * 3
      const p = positions
      v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) + p[a + 1] * (p[b + 2] * p[c] - p[b] * p[c + 2]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6
    }
  }
  return v
}

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

describe('blocks', () => {
  it('grows a flat grid into one block, and cuts a long one at the most a block runs', () => {
    const one = findBlocks(grid(7, 5))
    expect(one).toHaveLength(1)
    expect(one[0].faces).toHaveLength(24)
    expect(Math.max(one[0].rows, one[0].cols)).toBe(7)
    const long = findBlocks(grid(31, 3))
    expect(long.reduce((n, b) => n + b.faces.length, 0)).toBe(60)
    expect(long.length).toBeGreaterThan(1)
    for (const b of long) expect(Math.max(b.rows, b.cols) - 1).toBeLessThanOrEqual(MAX_BLOCK_SIDE)
  })
  it('stops a block at a crease', () => {
    const creases: [number, number][] = []
    for (let j = 0; j < 4; j++) creases.push([j * 7 + 3, (j + 1) * 7 + 3])
    const blocks = findBlocks(grid(7, 5, creases))
    expect(blocks).toHaveLength(2)
    expect(blocks.map((b) => b.faces.length).sort()).toEqual([12, 12])
  })
  it('leaves a cube’s extraordinary corners between six blocks of one quad', () => {
    const blocks = findBlocks(cube)
    expect(blocks).toHaveLength(6)
    expect(blocks.every((b) => b.faces.length === 1)).toBe(true)
  })
  it('takes every quad of a torus once, in rectangles that do not wrap', () => {
    const t = torus(8, 6, 40, 10)
    const blocks = findBlocks(t)
    const seen = blocks.flatMap((b) => b.faces).sort((a, b) => a - b)
    expect(seen).toEqual(Array.from({ length: 48 }, (_, i) => i))
    for (const b of blocks) expect(new Set(b.vertices).size).toBe(b.vertices.length)
    expect(blocks.length).toBeLessThan(10)
  })
})

describe('patch grids', () => {
  it('samples a block at the cage’s refined vertices, shared along every seam', () => {
    const p = cagePatches(cube, 2)
    expect(p.grids).toHaveLength(6)
    expect(p.grids.every((g) => g.rows === 5 && g.cols === 5)).toBe(true)
    // Six faces of 5 × 5 points share their borders: the refined cube has 98 vertices.
    const distinct = new Set<string>()
    for (const g of p.grids) for (let i = 0; i < g.rows * g.cols; i++) distinct.add(Array.from(g.points.subarray(i * 3, i * 3 + 3)).map((x) => x.toFixed(9)).join(','))
    expect(distinct.size).toBe(vertexCount(subdivided(cube, 2)))
    expect(p.closed).toBe(true)
  })
  it('cuts a cage of triangles after refining it once, the limit being the same', () => {
    const tri = cage([[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10]], [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]])
    const p = cagePatches(tri, 1)
    expect(p.cage.faces.every((f) => f.length === 4)).toBe(true)
    expect(p.grids).toHaveLength(12)
    expect(p.closed).toBe(true)
  })
  it('refuses a step count out of range', () => {
    expect(() => cagePatches(cube, 0)).toThrow(/Steps run from 1 to 5/)
  })
})

describe('the body', () => {
  it('makes a flat grid one face of its own area', async () => {
    const k = await kernelPromise
    const { shape, report } = patchesBody(k, cagePatches(grid(7, 5), 2))
    try {
      expect(report).toMatchObject({ faces: 1, quads: 24, solid: false, valid: true, volume: null })
      expect(report.area).toBeCloseTo(24, 6)
    } finally {
      k.release(shape)
    }
  })

  it('makes a cube a valid solid of six faces whose volume is the limit’s within 0.2 %', async () => {
    const k = await kernelPromise
    const lm = limitMesh(cube, 5)
    const limit = Math.abs(meshVolume(lm.positions, lm.faces))
    const area = faceArea({ positions: lm.positions, faces: lm.faces, creases: [] })
    const { shape, report } = patchesBody(k, cagePatches(cube, 3))
    try {
      expect(report).toMatchObject({ quads: 6, blocks: 6, solid: true, valid: true })
      expect(report.faces).toBeGreaterThanOrEqual(6)
      expect(Math.abs(report.volume! - limit) / limit).toBeLessThan(2e-3)
      expect(Math.abs(report.area - area) / area).toBeLessThan(2e-3)
    } finally {
      k.release(shape)
    }
  })

  it('sews a torus of 48 quads from a few rectangles into a valid solid', async () => {
    const k = await kernelPromise
    const t = torus(8, 6, 40, 10)
    const lm = limitMesh(t, 4)
    const limit = Math.abs(meshVolume(lm.positions, lm.faces))
    const patches = cagePatches(t, 2)
    const { shape, report } = patchesBody(k, patches)
    try {
      expect(report.solid).toBe(true)
      expect(report.valid).toBe(true)
      expect(report.faces).toBeGreaterThanOrEqual(patches.blocks.length)
      expect(report.faces).toBeLessThan(48)
      expect(Math.abs(report.volume! - limit) / limit).toBeLessThan(2e-3)
    } finally {
      k.release(shape)
    }
  })

  it('converts the Wrap cage QuickSurface exported to a sheet of the limit’s area, and its STEP reads back', async () => {
    const k = await kernelPromise
    // The Wrap box is the four quads on vertices 24 and up.
    const all = parseQuadObj(fixture('native-wrap-quads.obj'))
    const used = [...new Set(all.faces.filter((f) => f.every((i) => i >= 24)).flat())].sort((a, b) => a - b)
    const index = new Map(used.map((v, i) => [v, i]))
    const wrap = cage(
      used.map((v) => [all.positions[v * 3], all.positions[v * 3 + 1], all.positions[v * 3 + 2]] as Vec3),
      all.faces.filter((f) => f.every((i) => i >= 24)).map((f) => f.map((i) => index.get(i)!)),
    )
    expect(wrap.faces).toHaveLength(4)
    expect(topology(wrap).closed).toBe(false)
    const lm = limitMesh(wrap, 5)
    const limit = faceArea({ positions: lm.positions, faces: lm.faces, creases: [] })
    const { shape, report } = patchesBody(k, cagePatches(wrap, 3))
    try {
      expect(report).toMatchObject({ solid: false, valid: true, volume: null })
      expect(Math.abs(report.area - limit) / limit).toBeLessThan(2e-3)
      const out = k.exportStepMended([shape], [{ name: 'Wrap' }], [true])
      const check = out.check ?? k.verifyStep(out.text, [shape], { sheets: [true] })
      expect(check.ok).toBe(true)
      expect(check.bodies[0].valid).toBe(true)
      expect(check.bodies[0].gap.max).toBeLessThan(0.01)
    } finally {
      k.release(shape)
    }
  })

  it('writes the cube as a STEP file that reads back a closed solid', async () => {
    const k = await kernelPromise
    const { shape, report } = patchesBody(k, cagePatches(cube, 3))
    try {
      expect(report.solid).toBe(true)
      const out = k.exportStepMended([shape], [{ name: 'Cube' }], [false])
      const check = out.check ?? k.verifyStep(out.text, [shape], { sheets: [false] })
      expect(check.ok).toBe(true)
      expect(check.bodies[0]).toMatchObject({ closed: true, valid: true, freeEdgeCount: 0 })
      expect(Math.abs(check.bodies[0].volume[1] - check.bodies[0].volume[0]) / report.volume!).toBeLessThan(1e-6)
    } finally {
      k.release(shape)
    }
  })
})
