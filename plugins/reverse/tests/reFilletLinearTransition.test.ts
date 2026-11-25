// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, expect, it } from 'vitest'
import { ReKernel, type Shape } from '../core/kernel'
import { linearVariableRound } from '../core/linearVariableRound'
import type { Vec3 } from '../../../src/core/types'

let k: ReKernel
beforeAll(async () => { k = await ReKernel.load() })

function edgeAt(stock: Shape, p: Vec3) {
  const matches = k.edges(stock, 0.05).filter(e => Math.hypot(...e.mid.map((x, i) => x - p[i])) < 1e-5)
  expect(matches).toHaveLength(1)
  return matches[0]
}

it('holds circular sections and linearly interpolates both sides of an interior radius station', () => {
  const stock = k.box([0, 0, 0], [20, 14, 10])
  const held = [stock]
  try {
    const edge = edgeAt(stock, [0, 0, 5])
    const reverse = edge.ends[0][2] > 5
    const made = linearVariableRound(k, stock, edge.hash, reverse ? [2, 1] : [1, 2], [{position: reverse ? 0.7 : 0.3, radius: 3}])
    held.push(made.shape)
    const back = k.importStep(k.exportStep([made.shape]))
    held.push(back)
    expect(k.isClosedSolid(back)).toBe(true)
    const surfaces = k.faces(back).map(f => k.faceCopy(back, f.hash))
    held.push(...surfaces)
    for (const [z, r] of [[1.5, 2], [3, 3], [6.5, 2.5]]) {
      for (const phi of [0, Math.PI / 6, Math.PI / 4, Math.PI / 3, Math.PI / 2]) {
        const point: Vec3 = [r * (1 - Math.cos(phi)), r * (1 - Math.sin(phi)), z]
        expect(Math.min(...surfaces.map(face => k.distanceToPoint(face, point)))).toBeLessThan(0.00001)
      }
    }
    const expectedChip = (1 - Math.PI / 4) * (3 * (1 + 3 + 9) + 7 * (9 + 6 + 4)) / 3
    expect(Math.abs(k.volume(stock) - k.volume(back) - expectedChip)).toBeLessThan(0.00001)
  } finally { k.release(...held) }
})

it('adds the requested material at a concave corner and declines an oversized support strip', () => {
  const stock = k.box([0, 0, 0], [20, 16, 10])
  const notch = k.box([8, 6, -2], [23, 19, 12])
  const cut = k.cutTracked(stock, notch).shape
  const held = [stock, notch, cut]
  try {
    const edge = edgeAt(cut, [8, 6, 5])
    const before = k.volume(cut)
    const made = linearVariableRound(k, cut, edge.hash, [1, 2])
    held.push(made.shape)
    expect(k.isClosedSolid(made.shape)).toBe(true)
    expect(Math.abs(k.volume(made.shape) - before - (1 - Math.PI / 4) * 70 / 3)).toBeLessThan(0.00001)
    expect(() => linearVariableRound(k, cut, edge.hash, [1, 30])).toThrow(/support face/)
    expect(k.volume(cut)).toBe(before)
  } finally { k.release(...held) }
})

it('declines a circular rim and retains the starting solid', () => {
  const disk = k.face({ outer: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 5 }], holes: [] })
  const stock = k.extrude(disk, [0, 0, 1], 0, 10)
  try {
    const rim = k.edges(stock, 0.05).find(e => e.kind === 'circle')!
    expect(() => linearVariableRound(k, stock, rim.hash, [1, 2])).toThrow(/straight edge/)
    expect(k.isClosedSolid(stock)).toBe(true)
  } finally { k.release(stock, disk) }
})
