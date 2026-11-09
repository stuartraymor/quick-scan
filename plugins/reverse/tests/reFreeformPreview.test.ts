// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import { Builder } from '../core/build'
import type { BuildStep } from '../core/features'
import { ReKernel } from '../core/kernel'

vi.setConfig({ testTimeout: 120_000 })
const kernel = ReKernel.load()
type FreeformStep = Extract<BuildStep, { kind: 'freeform' }>
const patch: FreeformStep = { kind: 'freeform', id: 1, name: 'Patch', positions: [0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0], faces: [[0, 1, 2, 3]], creases: [], steps: 2, snap: false }
const cube: FreeformStep = {
  ...patch, id: 2, name: 'Cube',
  positions: [0, 0, 0, 20, 0, 0, 20, 20, 0, 0, 20, 0, 0, 0, 20, 20, 0, 20, 20, 20, 20, 0, 20, 20],
  faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
  creases: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]],
}
const extent = (positions: Float32Array) => [0, 1, 2].map(k => {
  const values = Array.from(positions).filter((_, i) => i % 3 === k)
  return [Math.min(...values), Math.max(...values)]
})

describe('temporary freeform previews', () => {
  it('previews a sheet without inserting it into the document build', async () => {
    const b = new Builder(await kernel)
    try {
      const p = b.preview(patch, undefined)
      expect(p.closed).toBe(false)
      expect(p.volume).toBe(0)
      expect(p.sheetFaces).toBe(1)
      expect(p.mesh.indices.length).toBeGreaterThan(0)
      expect(b.build([], () => undefined).all).toEqual([])
      const built = b.build([patch], () => undefined)
      expect(built.results[0].status).toBe('ok')
      expect(extent(p.mesh.positions)).toEqual(extent(built.bodies[0].mesh.positions))
    } finally { b.dispose() }
  })

  it('matches committed solid volume and leaves an existing sheet intact', async () => {
    const b = new Builder(await kernel)
    try {
      b.build([patch], () => undefined)
      const original = b.body(patch.id)
      const p = b.preview(cube, undefined)
      expect(p.closed).toBe(true)
      expect(p.volume).toBeCloseTo(8000, 3)
      expect(p.sheetFaces).toBeUndefined()
      expect(b.body(patch.id)).toBe(original)
      expect(b.body(cube.id)).toBeUndefined()
      const built = b.build([patch, cube], () => undefined, true)
      expect(built.bodies.find(body => body.id === cube.id)?.volume).toBeCloseTo(p.volume, 6)
    } finally { b.dispose() }
  })

  it('releases a preview shape even when meshing fails', async () => {
    const k = await kernel, b = new Builder(k)
    const release = vi.spyOn(k, 'release')
    const mesh = vi.spyOn(k, 'mesh').mockImplementationOnce(() => { throw new Error('meshing failed') })
    try {
      expect(() => b.preview(patch, undefined)).toThrow('meshing failed')
      expect(release).toHaveBeenCalledWith(mesh.mock.calls[0][0])
      expect(b.build([], () => undefined).all).toEqual([])
    } finally { mesh.mockRestore(); release.mockRestore(); b.dispose() }
  })

  it('rejects snapping without a scan and preserves the prior model', async () => {
    const b = new Builder(await kernel)
    try {
      b.build([patch], () => undefined)
      const original = b.body(patch.id)
      expect(() => b.preview({ ...cube, snap: true }, undefined)).toThrow(/scan is not here/)
      expect(b.body(patch.id)).toBe(original)
      expect(b.body(cube.id)).toBeUndefined()
    } finally { b.dispose() }
  })
})
