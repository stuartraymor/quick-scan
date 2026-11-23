// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.23: what Measure reads off a sketch, checked against the brief's
// numbers (13.5 M01–M11, M21; 14.8) — exact values from the pieces' own
// definitions, each result named for what it is.

import { describe, expect, it } from 'vitest'
import { addEntity, addRectangle, emptySketch, type Sketch } from '../core/sketch'
import { findRegions } from '../core/regions'
import { measureOne, measureRegion, measureTwo, type MeasureRef, type MeasureResult } from '../core/measureEval'

const get = (rs: MeasureResult[], key: string) => {
  const m = rs.find((x) => x.key === key)
  if (!m) throw new Error(`no ${key} in ${rs.map((x) => x.key).join(', ')}`)
  return m
}
const pt = (entity: number, at: string): MeasureRef => ({ kind: 'point', anchor: { entity, at: at as never } })
const circle20 = (): { s: Sketch; id: number } => {
  const s = emptySketch()
  const id = addEntity(s, { kind: 'circle', c: [5, -3], r: 20 })
  return { s, id }
}

describe('Measure: one circle of radius 20 (M01, M05, 14.8)', () => {
  it('the circumference alone: radius, diameter, circumference, disk area, centre — all exact', () => {
    const { s, id } = circle20()
    const rs = measureOne(s, { kind: 'piece', id })
    expect(get(rs, 'radius').value).toBe(20)
    expect(get(rs, 'diameter').value).toBe(40)
    expect(get(rs, 'circumference').value).toBeCloseTo(125.663706, 6)
    expect(get(rs, 'area').value).toBeCloseTo(1256.637061, 6)
    expect(get(rs, 'area').label).toMatch(/disk/)
    expect(get(rs, 'center').point).toEqual([5, -3])
    expect(rs.every((m) => m.exact)).toBe(true)
  })

  it('M02: centre then right quadrant: 20 mm, ΔX 20, ΔY 0, named the radius', () => {
    const { s, id } = circle20()
    const rs = measureTwo(s, pt(id, 'center'), pt(id, 'q0'))
    expect(get(rs, 'distance').value).toBeCloseTo(20, 12)
    expect(get(rs, 'distance').label).toMatch(/radius/)
    expect(get(rs, 'dx').value).toBeCloseTo(20, 12)
    expect(get(rs, 'dy').value).toBeCloseTo(0, 12)
  })

  it('M03: right then top quadrants: chord 28.284271, 20 and 20, 90°, short arc 31.415927, long arc apart', () => {
    const { s, id } = circle20()
    const rs = measureTwo(s, pt(id, 'q0'), pt(id, 'q1'))
    expect(get(rs, 'distance').value).toBeCloseTo(28.284271, 6)
    expect(get(rs, 'distance').label).toMatch(/Chord/)
    expect(get(rs, 'dx').value).toBeCloseTo(20, 12)
    expect(get(rs, 'dy').value).toBeCloseTo(20, 12)
    expect(get(rs, 'centralAngle').value).toBeCloseTo(90, 10)
    expect(get(rs, 'arcShort').value).toBeCloseTo(31.415927, 6)
    expect(get(rs, 'arcLong').value).toBeCloseTo(94.247780, 6)
  })

  it('M04: left then right quadrants: 40 mm across', () => {
    const { s, id } = circle20()
    const rs = measureTwo(s, pt(id, 'q2'), pt(id, 'q0'))
    expect(get(rs, 'distance').value).toBeCloseTo(40, 12)
    expect(get(rs, 'centralAngle').value).toBeCloseTo(180, 10)
  })
})

describe('Measure: arcs, centres and lines', () => {
  it('M07: a partial arc: radius, sweep, chord, arc length, ends', () => {
    const s = emptySketch()
    const id = addEntity(s, { kind: 'arc', c: [0, 0], r: 10, start: 0, sweep: Math.PI / 3 })
    const rs = measureOne(s, { kind: 'piece', id })
    expect(get(rs, 'radius').value).toBe(10)
    expect(get(rs, 'sweep').value).toBeCloseTo(60, 10)
    expect(get(rs, 'chord').value).toBeCloseTo(10, 10)
    expect(get(rs, 'arcLength').value).toBeCloseTo((10 * Math.PI) / 3, 10)
    // Its two ends: the chord, and the path along the arc itself — not the
    // circle's long way round, which is not a path of the arc.
    const along = measureTwo(s, pt(id, 'a'), pt(id, 'b'))
    expect(get(along, 'distance').value).toBeCloseTo(10, 10)
    expect(get(along, 'arcAlong').value).toBeCloseTo((10 * Math.PI) / 3, 10)
    expect(along.some((m) => m.key === 'arcLong')).toBe(false)
  })

  it('M08: two concentric centres: zero, said to be concentric, the diameters left as they are', () => {
    const s = emptySketch()
    const a = addEntity(s, { kind: 'circle', c: [7, 7], r: 10 })
    const b = addEntity(s, { kind: 'circle', c: [7, 7], r: 17.5 })
    const rs = measureTwo(s, pt(a, 'center'), pt(b, 'center'))
    expect(get(rs, 'distance').value).toBe(0)
    expect(get(rs, 'distance').note).toMatch(/concentric/)
    const whole = measureTwo(s, { kind: 'piece', id: a }, { kind: 'piece', id: b })
    expect(get(whole, 'diameterDifference').value).toBeCloseTo(15, 12)
    expect(get(whole, 'minDistance').value).toBeCloseTo(7.5, 12)
  })

  it('M09: centres at (0, 0) and (3, 4): 5, with 3 and 4', () => {
    const s = emptySketch()
    const a = addEntity(s, { kind: 'circle', c: [0, 0], r: 1 })
    const b = addEntity(s, { kind: 'circle', c: [3, 4], r: 2 })
    const rs = measureTwo(s, pt(a, 'center'), pt(b, 'center'))
    expect(get(rs, 'distance').value).toBe(5)
    expect(get(rs, 'distance').label).toMatch(/Centre-to-centre/)
    expect(get(rs, 'dx').value).toBe(3)
    expect(get(rs, 'dy').value).toBe(4)
    const whole = measureTwo(s, { kind: 'piece', id: a }, { kind: 'piece', id: b })
    expect(get(whole, 'minDistance').value).toBeCloseTo(2, 12)
    expect(get(whole, 'maxDistance').value).toBeCloseTo(8, 12)
  })

  it('M10: two lines at 40°: 40 and 140, and the lines are not touched', () => {
    const s = emptySketch()
    const t = (40 * Math.PI) / 180
    const a = addEntity(s, { kind: 'line', a: [0, 0], b: [10, 0] })
    const b = addEntity(s, { kind: 'line', a: [0, 0], b: [10 * Math.cos(t), 10 * Math.sin(t)] })
    const before = JSON.stringify(s)
    const rs = measureTwo(s, { kind: 'piece', id: a }, { kind: 'piece', id: b })
    expect(get(rs, 'angle').value).toBeCloseTo(40, 10)
    expect(get(rs, 'angleSupplement').value).toBeCloseTo(140, 10)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('M11: a point to a line: to the segment and to the line extended, with witnesses on each', () => {
    const s = emptySketch()
    const l = addEntity(s, { kind: 'line', a: [0, 0], b: [10, 0] })
    const p = addEntity(s, { kind: 'point', p: [14, 3] })
    const rs = measureTwo(s, { kind: 'piece', id: p }, { kind: 'piece', id: l })
    expect(get(rs, 'minDistance').value).toBeCloseTo(5, 12)
    expect(get(rs, 'minDistance').witness?.[1]).toEqual([10, 0])
    expect(get(rs, 'lineDistance').value).toBeCloseTo(3, 12)
    expect(get(rs, 'lineDistance').witness?.[1]).toEqual([14, 0])
  })
})

describe('Measure: closed regions (M21)', () => {
  it('a 40 × 20 plate with a hole of radius 5: outer 120, hole 10π, area 800 − 25π, all exact', () => {
    const s = emptySketch()
    addRectangle(s, [0, 0], [40, 20])
    addEntity(s, { kind: 'circle', c: [20, 10], r: 5 })
    const plate = findRegions(s).find((r) => r.holes.length === 1)!
    const rs = measureRegion(plate, s)
    expect(get(rs, 'perimeter').value).toBeCloseTo(120, 9)
    expect(get(rs, 'holePerimeter1').value).toBeCloseTo(10 * Math.PI, 9)
    expect(get(rs, 'area').value).toBeCloseTo(800 - 25 * Math.PI, 9)
    expect(rs.every((m) => m.exact)).toBe(true)
  })

  it('a slot (two lines and two half circles): perimeter and area exact, not the sampled polygon', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [0, 0], b: [30, 0] })
    addEntity(s, { kind: 'arc', c: [30, 5], r: 5, start: -Math.PI / 2, sweep: Math.PI })
    addEntity(s, { kind: 'line', a: [30, 10], b: [0, 10] })
    addEntity(s, { kind: 'arc', c: [0, 5], r: 5, start: Math.PI / 2, sweep: Math.PI })
    const slot = findRegions(s)[0]
    const rs = measureRegion(slot, s)
    expect(get(rs, 'perimeter').value).toBeCloseTo(60 + 10 * Math.PI, 9)
    expect(get(rs, 'area').value).toBeCloseTo(300 + 25 * Math.PI, 9)
  })
})
