// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { negateExpression, resizeFullDepth } from '../core/extrudeDepth'

describe('two-sided extrusion depth', () => {
  it('scales both signed endpoints in the measured 12:2 proportion, including after a flip', () => {
    for (const sign of [1, -1]) {
      const out = resizeFullDepth({ kind: 'distance', from: -2 * sign, to: 12 * sign }, 16)
      expect(out.from).toBeCloseTo(-2.28571428571429 * sign, 12)
      expect(out.to).toBeCloseTo(13.7142857142857 * sign, 12)
    }
  })
  it('preserves one-sided offsets outside the sketch and can recover from both depths being zero', () => {
    const legacy = { kind: 'distance' as const, from: 2, to: 12 }
    expect(resizeFullDepth(legacy, 16)).toEqual(legacy)
    expect(resizeFullDepth({ kind: 'distance', from: 0, to: 0 }, 16)).toEqual({ kind: 'distance', from: 0, to: 16 })
  })
  it('round trips displayed depth expressions without removing parentheses around only one term', () => {
    for (const formula of ['height + 5', '-(width) + (height)', '(a + (b * c))']) {
      expect(negateExpression(negateExpression(formula))).toBe(formula)
    }
    expect(negateExpression('-(a + (b * c))')).toBe('a + (b * c)')
  })
})
