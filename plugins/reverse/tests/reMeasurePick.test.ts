// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.23: Measure's clicks on a sketch, taken as the Dimension tool takes
// them, and what they read — the brief's M02–M05, M09 and M21 by clicks;
// the sketch is never changed.

import { describe, expect, it } from 'vitest'
import type { SectionFrame } from '../../../src/core/section/frame'
import { liftPoint } from '../core/profiles'
import { measureHitAt, planeSpot, pointOfHit, readoutAcross, readoutOne, readoutTwo, refOfHit } from '../core/measurePick'
import { addEntity, addRectangle, emptySketch } from '../core/sketch'

const value = (rows: { key: string; value: number }[], key: string) => {
  const r = rows.find((x) => x.key === key)
  if (!r) throw new Error(`no ${key} in ${rows.map((x) => x.key).join(', ')}`)
  return r.value
}

function plate() {
  const s = emptySketch()
  const c = addEntity(s, { kind: 'circle', c: [5, -3], r: 20 })
  const d = addEntity(s, { kind: 'circle', c: [45, 27], r: 10 })
  return { s, c, d }
}

describe('Measure clicks on a sketch', () => {
  it('a click on a circle\'s rim reads the circle: R 20, Ø 40, C 125.663706', () => {
    const { s, c } = plate()
    const hit = measureHitAt(s, [5 + 20 * Math.cos(1), -3 + 20 * Math.sin(1)], 1)!
    expect(refOfHit(hit, false)).toEqual({ kind: 'piece', id: c })
    const r = readoutOne(s, hit, 'Sketch1')
    expect(r.title).toBe(`Sketch1: circle ${c}`)
    expect(value(r.rows, 'radius')).toBe(20)
    expect(value(r.rows, 'diameter')).toBe(40)
    expect(value(r.rows, 'circumference')).toBeCloseTo(125.663706, 6)
  })

  it('a click on a quadrant square reads the circle by itself, and is the quadrant point once paired', () => {
    const { s, c } = plate()
    const right = measureHitAt(s, [25.2, -3], 1)!
    expect(refOfHit(right, false)).toEqual({ kind: 'piece', id: c })
    expect(refOfHit(right, true)).toEqual({ kind: 'point', anchor: { entity: c, at: 'q0' } })
    const top = measureHitAt(s, [5, 17.1], 1)!
    const r = readoutTwo(s, right, top, 'Sketch1')
    expect(value(r.rows, 'distance')).toBeCloseTo(28.284271, 6)
    expect(value(r.rows, 'centralAngle')).toBeCloseTo(90, 10)
    expect(value(r.rows, 'arcShort')).toBeCloseTo(31.415927, 6)
  })

  it('centre to quadrant reads 20, named the radius; centre to centre reads (40, 30) → 50', () => {
    const { s, c, d } = plate()
    const centre = measureHitAt(s, [5.3, -3.2], 1)!
    expect(refOfHit(centre, false)).toEqual({ kind: 'point', anchor: { entity: c, at: 'center' } })
    const r = readoutTwo(s, centre, measureHitAt(s, [25, -3], 1)!, 'Sketch1')
    expect(value(r.rows, 'distance')).toBeCloseTo(20, 12)
    expect(r.rows[0].label).toMatch(/radius/)
    const cc = readoutTwo(s, centre, measureHitAt(s, [45, 27], 1)!, 'Sketch1')
    expect(value(cc.rows, 'distance')).toBeCloseTo(50, 12)
    expect(value(cc.rows, 'dx')).toBeCloseTo(40, 12)
    expect(value(cc.rows, 'dy')).toBeCloseTo(30, 12)
    expect(cc.title).toBe(`Sketch1: centre of circle ${c} → centre of circle ${d}`)
  })

  it('the sheet\'s zero is a point to measure to: centre to origin', () => {
    const { s } = plate()
    const zero = measureHitAt(s, [0.2, 0.1], 1)!
    expect(zero).toEqual({ kind: 'origin' })
    const r = readoutTwo(s, measureHitAt(s, [5, -3], 1)!, zero, 'Sketch1')
    expect(value(r.rows, 'distance')).toBeCloseTo(Math.hypot(5, 3), 12)
  })

  it('a click inside a closed loop reads the loop: plate with a hole, perimeter 120 and area 800 − 25π', () => {
    const s = emptySketch()
    addRectangle(s, [0, 0], [40, 20])
    addEntity(s, { kind: 'circle', c: [20, 10], r: 5 })
    const before = JSON.stringify(s)
    const hit = measureHitAt(s, [5, 15], 0.5)!
    expect(hit.kind).toBe('region')
    const r = readoutOne(s, hit, 'Plate')
    expect(r.title).toBe('Plate: closed loop with 1 hole')
    expect(value(r.rows, 'perimeter')).toBeCloseTo(120, 9)
    expect(value(r.rows, 'area')).toBeCloseTo(800 - 25 * Math.PI, 9)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('nothing of the sketch under the click: no hit', () => {
    const { s } = plate()
    expect(measureHitAt(s, [200, 200], 1)).toBeNull()
  })
})

describe('Measure on the part: a sketch stood in its plane', () => {
  // A plane tilted about X by 30°, lifted 7 mm.
  const t = Math.PI / 6
  const frame: SectionFrame = { origin: [1, 2, 7], basisU: [1, 0, 0], basisV: [0, Math.cos(t), Math.sin(t)], normal: [0, -Math.sin(t), Math.cos(t)] }

  it('a ray down onto the tilted plane comes back as the sheet point it passes through', () => {
    const sheet: [number, number] = [12.5, -4]
    const p = liftPoint(frame, sheet)
    const hit = planeSpot(frame, [p[0] + 3, p[1] - 5, p[2] + 40], [-3 / Math.hypot(3, 5, 40), 5 / Math.hypot(3, 5, 40), -40 / Math.hypot(3, 5, 40)])!
    expect(hit.spot[0]).toBeCloseTo(sheet[0], 9)
    expect(hit.spot[1]).toBeCloseTo(sheet[1], 9)
    expect(hit.t).toBeCloseTo(Math.hypot(3, 5, 40), 9)
  })

  it('a ray along the plane meets it nowhere', () => {
    expect(planeSpot(frame, [0, 0, 0], [1, 0, 0])).toBeNull()
  })

  it('two sketches: centres a known 3D distance apart', () => {
    const { s } = plate()
    const other: SectionFrame = { origin: [0, 0, 30], basisU: [1, 0, 0], basisV: [0, 1, 0], normal: [0, 0, 1] }
    const a = liftPoint(frame, pointOfHit(s, measureHitAt(s, [5, -3], 1)!)!)
    const b = liftPoint(other, pointOfHit(s, measureHitAt(s, [45, 27], 1)!)!)
    const r = readoutAcross(a, b, 'A → B')
    expect(value(r.rows, 'distance')).toBeCloseTo(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), 12)
    expect(value(r.rows, 'dz')).toBeCloseTo(Math.abs(b[2] - a[2]), 12)
  })
})
