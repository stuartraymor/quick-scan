// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.24: Measure's Sketch way picks by the snap bar's Pick switches (the
// Dimension tool's), and shows what a click would take before it: the
// piece or the loop outlined, nothing for a point.

import { describe, expect, it } from 'vitest'
import { MEASURE_ALLOW, measureHitAt, outlineOfHit, refOfHit } from '../core/measurePick'
import { addEntity, addRectangle, emptySketch } from '../core/sketch'

function plate() {
  const s = emptySketch()
  const c = addEntity(s, { kind: 'circle', c: [5, -3], r: 20 })
  return { s, c }
}

describe('Measure picks by the Pick switches', () => {
  it('with Quad off, a quadrant square is the circle, paired or not', () => {
    const { s, c } = plate()
    const on = measureHitAt(s, [25.2, -3], 1)!
    expect(refOfHit(on, true)).toEqual({ kind: 'point', anchor: { entity: c, at: 'q0' } })
    const off = measureHitAt(s, [25.2, -3], 1, { ...MEASURE_ALLOW, quadrant: false })!
    expect(refOfHit(off, false)).toEqual({ kind: 'piece', id: c })
    expect(refOfHit(off, true)).toEqual({ kind: 'piece', id: c })
  })

  it('with Curve off, a click on the rim away from every square takes no piece', () => {
    const { s } = plate()
    const spot: [number, number] = [5 + 20 * Math.cos(1), -3 + 20 * Math.sin(1)]
    expect(measureHitAt(s, spot, 1)?.kind).toBe('pick')
    const hit = measureHitAt(s, spot, 1, { ...MEASURE_ALLOW, curve: false })
    expect(hit === null || hit.kind !== 'pick').toBe(true)
  })

  it('with Centre off, the centre is not taken', () => {
    const { s, c } = plate()
    const on = measureHitAt(s, [5.2, -3.1], 1)!
    expect(refOfHit(on, false)).toEqual({ kind: 'point', anchor: { entity: c, at: 'center' } })
    const off = measureHitAt(s, [5.2, -3.1], 1, { ...MEASURE_ALLOW, center: false })
    expect(off === null || off.kind !== 'pick' || off.pick.kind !== 'point').toBe(true)
  })
})

describe('Measure preview outline', () => {
  it('a circle is outlined along its rim, closed', () => {
    const { s } = plate()
    const hit = measureHitAt(s, [5 + 20 * Math.cos(1), -3 + 20 * Math.sin(1)], 1)!
    const [loop, ...rest] = outlineOfHit(s, hit)
    expect(rest).toEqual([])
    expect(loop.length).toBeGreaterThan(32)
    for (const p of loop) expect(Math.hypot(p[0] - 5, p[1] + 3)).toBeCloseTo(20, 9)
    expect(Math.hypot(loop[0][0] - loop[loop.length - 1][0], loop[0][1] - loop[loop.length - 1][1])).toBeLessThan(1e-9)
  })

  it('a quadrant square by itself outlines its circle; a centre outlines nothing', () => {
    const { s } = plate()
    expect(outlineOfHit(s, measureHitAt(s, [25.2, -3], 1)!)).toHaveLength(1)
    expect(outlineOfHit(s, measureHitAt(s, [5.2, -3.1], 1)!)).toEqual([])
  })

  it('a loop clicked inside outlines its edge and each hole, closed', () => {
    const s = emptySketch()
    addRectangle(s, [0, 0], [40, 20])
    addEntity(s, { kind: 'circle', c: [20, 10], r: 5 })
    const hit = measureHitAt(s, [5, 15], 0.5)!
    expect(hit.kind).toBe('region')
    const loops = outlineOfHit(s, hit)
    expect(loops).toHaveLength(2)
    for (const l of loops) expect(l[0]).toEqual(l[l.length - 1])
    const xs = loops[0].map((p) => p[0])
    expect(Math.min(...xs)).toBeCloseTo(0, 9)
    expect(Math.max(...xs)).toBeCloseTo(40, 9)
  })

  it('a loop found once is found again after the sketch is edited in place', () => {
    const s = emptySketch()
    addRectangle(s, [0, 0], [40, 20])
    expect(measureHitAt(s, [5, 15], 0.5)?.kind).toBe('region')
    expect(measureHitAt(s, [50, 15], 0.5)).toBeNull()
    // Edited in place, as an open sketch is: the cached loops must not stand.
    for (const e of s.entities) if (e.kind === 'line') {
      if (e.a[0] === 40) e.a = [60, e.a[1]]
      if (e.b[0] === 40) e.b = [60, e.b[1]]
    }
    expect(measureHitAt(s, [50, 15], 0.5)?.kind).toBe('region')
  })
})
