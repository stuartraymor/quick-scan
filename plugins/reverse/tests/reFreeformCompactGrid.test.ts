// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { compactRepeatedGrid } from '../core/freeform/compactGrid'
import type { PatchGrid } from '../core/freeform/patches'
import { ReKernel } from '../core/kernel'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/auto-lego-collapsed-grid.json', import.meta.url), 'utf8'))
const grid = (): PatchGrid => ({ points: Float64Array.from(fixture.points), rows: fixture.rows, cols: fixture.cols, faces: [0] })
const samples = (g: PatchGrid) => new Set(Array.from({ length: g.rows * g.cols }, (_, i) => Array.from(g.points.slice(i * 3, i * 3 + 3)).join(',')))

it('removes exact duplicate strips from the captured snapped Lego grid, preserving every distinct sample', () => {
  const original = grid(), copy = original.points.slice(), compact = compactRepeatedGrid(original)
  expect([compact.rows, compact.cols]).toEqual([3, 2])
  expect(samples(compact)).toEqual(samples(original))
  expect(original.points).toEqual(copy)
  expect(compact.faces).toBe(original.faces)
})

it('does not merge near-but-distinct sample strips', () => {
  const original = grid()
  original.points[3] += 1e-12
  expect(compactRepeatedGrid(original)).toBe(original)
})

it('removes repeated rows as well as columns without reordering the survivors', () => {
  const g: PatchGrid = { rows: 3, cols: 3, points: Float64Array.from([0,0,0, 0,0,0, 1,0,0, 0,0,0, 0,0,0, 1,0,0, 0,1,0, 0,1,0, 1,1,0]), faces: [1] }
  expect(compactRepeatedGrid(g)).toMatchObject({ rows: 2, cols: 2, points: Float64Array.from([0,0,0,1,0,0,0,1,0,1,1,0]) })
})

it('reports fully collapsed and nonfinite grids explicitly instead of fabricating surface area', () => {
  expect(() => compactRepeatedGrid({ rows: 2, cols: 2, points: new Float64Array(12), faces: [0] })).toThrow(/collapses to a curve or point/)
  const invalid = grid(); invalid.points[0] = NaN
  expect(() => compactRepeatedGrid(invalid)).toThrow(/nonfinite/)
})

it('reproduces the real kernel knot failure and builds a valid face after exact compaction', async () => {
  const kernel = await ReKernel.load(), original = grid(), compact = compactRepeatedGrid(original)
  expect(() => kernel.surfaceThrough(original.points, original.rows, original.cols)).toThrow(/VKnots interval values too close/)
  const shape = kernel.surfaceThrough(compact.points, compact.rows, compact.cols)
  try {
    expect(kernel.isValid(shape)).toBe(true)
    expect(kernel.surfaceArea(shape)).toBeCloseTo(0.002681014212296746, 10)
    const mesh = kernel.mesh(shape, 0.0001)
    expect(mesh.indices.length).toBeGreaterThan(0)
    expect(Array.from(mesh.positions).every(Number.isFinite)).toBe(true)
    expect(Array.from(mesh.normals).every(Number.isFinite)).toBe(true)
    for (let i = 0; i < mesh.normals.length; i += 3) expect(Math.hypot(mesh.normals[i], mesh.normals[i+1], mesh.normals[i+2])).toBeCloseTo(1, 5)
  } finally { kernel.release(shape) }
}, 120000)
