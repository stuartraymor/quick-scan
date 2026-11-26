// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, expect, it } from 'vitest'
import { Builder } from '../core/build'
import { ReKernel, type Shape } from '../core/kernel'
import { build } from './reKit'

let kernel: ReKernel
beforeAll(async () => { kernel = await ReKernel.load() })

it('finishes both short spline intersections of a thickened STEP sheet at the requested size', async () => {
  const builder = new Builder(kernel)
  const owned: Shape[] = []
  const points: number[] = []
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) points.push(4 * col, 3 * row, 0.6 * Math.sin(col / 3) * Math.cos(row / 4))
  }
  try {
    await build(builder, [
      { id: 1, kind: 'fill', name: 'Patch', points, rows: 5, cols: 5, visible: true },
      { id: 2, kind: 'extend', name: 'Extended patch', sheet: 1, offset: 2, type: 'natural', sides: ['u0', 'v1'], samples: 19, visible: true },
      { id: 3, kind: 'thicken', name: 'Slab', sheet: 2, thickness: 1.5, side: 'out', op: 'new', visible: true },
    ])
    const native = builder.body(3)!
    const stock = kernel.importStep(builder.exportStep([3]))
    owned.push(stock)
    const stockVolume = kernel.volume(stock)
    const shortEdges = kernel.edges(native, 0.02).filter(e => Math.abs(e.length - 1.5) < 1e-5 && ((e.mid[0] < 1 && e.mid[1] > 11) || (e.mid[0] > 17 && e.mid[1] < 0)))
    expect(shortEdges).toHaveLength(2)
    for (const edge of shortEdges) {
      const match = kernel.edges(stock, 0.02).filter(e => Math.hypot(...e.mid.map((x, i) => x - edge.mid[i])) < 1e-5)
      expect(match).toHaveLength(1)
      for (const method of ['filletTracked', 'chamferTracked'] as const) {
        const expected = kernel[method](native, [edge.hash], 0.0375)
        owned.push(expected.shape)
        const result = kernel[method](stock, [match[0].hash], 0.0375)
        owned.push(result.shape)
        expect(kernel.isClosedSolid(result.shape)).toBe(true)
        expect(Math.abs(kernel.volume(result.shape) - kernel.volume(expected.shape))).toBeLessThan(0.000002)
        const referenceStep = kernel.importStep(kernel.exportStep([expected.shape]))
        owned.push(referenceStep)
        const reopened = kernel.importStep(kernel.exportStep([result.shape]))
        owned.push(reopened)
        expect(kernel.solidCount(reopened)).toBe(1)
        expect(kernel.isClosedSolid(reopened)).toBe(true)
        expect(kernel.volume(reopened)).toBeLessThan(stockVolume)
        expect(Math.abs(kernel.volume(reopened) - kernel.volume(referenceStep))).toBeLessThan(0.000002)
        expect(kernel.volume(stock)).toBe(stockVolume)
      }
    }
  } finally {
    kernel.release(...owned)
    builder.dispose()
  }
}, 30000)
