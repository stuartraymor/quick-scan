// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { chooseInstantFit, pointsUnderPath } from '../core/instantFit'
import type { BrushPoint } from '../core/sketchBrush'
import type { Vec2 } from '../../../src/core/flat/types'

const chain = (pts: Vec2[]): BrushPoint[] => pts.map((p, i) => ({ key: `0:${i}`, chain: 0, index: i, p }))
const opts = { tolerance: 0.1, axisDegrees: 1, curvePoints: 8 }
// Deterministic small noise, like a scanned edge.
const noise = (i: number) => 0.04 * Math.sin(i * 12.9898)

describe('Shift-drag Instant Fit', () => {
  it('a brushed straight scanned edge becomes a horizontal-snapped line', () => {
    const fit = chooseInstantFit(chain(Array.from({ length: 200 }, (_, i): Vec2 => [i * 0.5, 3 + noise(i)])), opts)
    expect(fit.ok && fit.kind).toBe('line')
    if (fit.ok) expect(fit.axis).toBe('horizontal')
  })
  it('a brushed rounded section becomes an arc', () => {
    const fit = chooseInstantFit(chain(Array.from({ length: 60 }, (_, i): Vec2 => { const t = (Math.PI / 2) * i / 59; return [10 * Math.cos(t), 10 * Math.sin(t)] })), opts)
    expect(fit.ok && fit.kind).toBe('arc')
    if (fit.ok && fit.entity.kind === 'arc') expect(fit.entity.r).toBeCloseTo(10, 6)
  })
  it('a brushed sharp corner becomes ONE arc spanning the stroke (observed natively)', () => {
    const pts: Vec2[] = [...Array.from({ length: 40 }, (_, i): Vec2 => [0, 20 - i * 0.5]), ...Array.from({ length: 41 }, (_, i): Vec2 => [i * 0.5, 0])]
    const fit = chooseInstantFit(chain(pts), opts)
    expect(fit.ok && fit.kind).toBe('arc')
  })
  it('takes only the points under the brush and refuses an oversized selection', () => {
    const pts = chain([[0, 0], [5, 0], [5, 4], [50, 50]])
    expect(pointsUnderPath(pts, [[0, 0], [10, 0]], 1)?.map((p) => p.key)).toEqual(['0:0', '0:1'])
    expect(pointsUnderPath(pts, [[0, 0], [10, 0]], 100, 2)).toBeNull()
    expect(pointsUnderPath(pts, [], 1)).toEqual([])
  })
})
