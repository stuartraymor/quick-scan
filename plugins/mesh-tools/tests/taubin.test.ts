// SPDX-License-Identifier: AGPL-3.0-only
// Reduce noise: Taubin steps take the scatter off a flat sheet without
// shrinking it, hold the rim when asked, and touch only a selection.
import { describe, expect, it } from 'vitest'
import { taubinSmooth } from '../core/taubin'

/** An n × n grid of unit squares on Z = 0, every inner vertex lifted by a
 *  checkerboard of ±0.1 — the scatter to smooth. */
function noisyGrid(n: number) {
  const positions = new Float32Array((n + 1) * (n + 1) * 3)
  const idx: number[] = []
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const v = j * (n + 1) + i
    const inner = i > 0 && j > 0 && i < n && j < n
    positions.set([i, j, inner ? ((i + j) % 2 ? 0.1 : -0.1) : 0], v * 3)
  }
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1
    idx.push(a, b, d, a, d, c)
  }
  return { positions, indices: Uint32Array.from(idx), vertexCount: (n + 1) * (n + 1) }
}
const rough = (p: Float32Array) => { let m = 0; for (let v = 0; v < p.length / 3; v++) m = Math.max(m, Math.abs(p[v * 3 + 2])); return m }

describe('Reduce noise', () => {
  it('flattens the scatter more with more iterations', () => {
    const g = noisyGrid(10)
    const one = taubinSmooth(g.positions, g.indices, g.vertexCount, 1, true)
    const five = taubinSmooth(g.positions, g.indices, g.vertexCount, 5, true)
    expect(rough(one)).toBeLessThan(0.1)
    expect(rough(five)).toBeLessThan(rough(one))
  })

  it('holds the rim where it was with Apply on boundary edges off', () => {
    const g = noisyGrid(6)
    const p = taubinSmooth(g.positions, g.indices, g.vertexCount, 3, false)
    // The corner and an edge vertex: on the rim, so they stay.
    expect([p[0], p[1], p[2]]).toEqual([0, 0, 0])
    expect([p[3 * 3], p[3 * 3 + 1]]).toEqual([3, 0])
  })

  it('moves only the selection with Apply on selection only', () => {
    const g = noisyGrid(6)
    const p = taubinSmooth(g.positions, g.indices, g.vertexCount, 3, true, Uint32Array.of(8))
    for (let v = 0; v < g.vertexCount; v++) if (v !== 8) expect(p[v * 3 + 2]).toBe(g.positions[v * 3 + 2])
    expect(Math.abs(p[8 * 3 + 2])).toBeLessThan(0.1)
  })
})
