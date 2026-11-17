// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul 3.1: the angle dimension measures the sector it is put
// down in — the angle, its supplement, or a corner's reflex.
import { describe, expect, it } from 'vitest'
import { addConstraint, addEntity, emptySketch, entityOf, type SketchLine } from '../core/sketch'
import { angleForSector, measureAngleDimension, sectorAt } from '../core/angleSector'
import { dimShape } from '../core/dimLayout'
import { solveSketch } from '../core/solver'
import { mirrorAbout } from '../core/sketchEdits'

const deg = (r: number) => (r * 180) / Math.PI
const dir = (l: SketchLine) => Math.atan2(l.b[1] - l.a[1], l.b[0] - l.a[0])

/** A corner at the origin: line a along +X, line b at 60° to it. */
function corner() {
  const s = emptySketch()
  const a = addEntity(s, { kind: 'line', a: [0, 0], b: [10, 0] })
  const b = addEntity(s, { kind: 'line', a: [0, 0], b: [5, 5 * Math.sqrt(3)] })
  return { s, a, b }
}
/** Two lines crossing at the origin at 60°. */
function crossing() {
  const s = emptySketch()
  const a = addEntity(s, { kind: 'line', a: [-10, 0], b: [10, 0] })
  const b = addEntity(s, { kind: 'line', a: [-5, -5 * Math.sqrt(3)], b: [5, 5 * Math.sqrt(3)] })
  return { s, a, b }
}

describe('angle dimension sector', () => {
  it('a corner: inside 60°, beside it 120°, behind it the reflex 300°', () => {
    const { s, a, b } = corner()
    expect(angleForSector(s, a, b, [5, 2])?.value).toBeCloseTo(60, 9)
    expect(angleForSector(s, a, b, [-5, 2])?.value).toBeCloseTo(120, 9)
    expect(angleForSector(s, a, b, [5, -2])?.value).toBeCloseTo(120, 9)
    expect(angleForSector(s, a, b, [-3, -3])?.value).toBeCloseTo(300, 9)
  })
  it('crossing lines: the two quadrants of each angle read the same', () => {
    const { s, a, b } = crossing()
    expect(angleForSector(s, a, b, [5, 2])?.value).toBeCloseTo(60, 9)
    expect(angleForSector(s, a, b, [-5, -2])?.value).toBeCloseTo(60, 9)
    expect(angleForSector(s, a, b, [-5, 2])?.value).toBeCloseTo(120, 9)
    expect(angleForSector(s, a, b, [5, -2])?.value).toBeCloseTo(120, 9)
  })
  it('the arc drawn sweeps the sector the cursor is in', () => {
    const { s, a, b } = corner()
    for (const at of [[5, 2], [-5, 2], [5, -2], [-3, -3]] as [number, number][]) {
      const r = angleForSector(s, a, b, at)!
      const shape = dimShape({ id: 1, kind: 'angle', a, b, value: r.value, sector: r.sector }, s, [], 1)
      expect(shape?.kind).toBe('angle'); if (shape?.kind !== 'angle') return
      expect(deg(shape.sweep)).toBeCloseTo(r.value, 9)
      // The cursor's direction lies inside the drawn sweep.
      const t = Math.atan2(at[1] - shape.vertex[1], at[0] - shape.vertex[0])
      const into = ((t - shape.a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI)
      expect(into).toBeLessThan(shape.sweep)
    }
  })
  it('the solver drives the supplementary and reflex sectors', () => {
    for (const [at, target, expected] of [[[-5, 2], 100, 80], [[-3, -3], 290, 70]] as const) {
      const { s, a, b } = corner()
      const r = angleForSector(s, a, b, [...at])!
      addConstraint(s, { kind: 'coincident', p: { entity: a, at: 'a' }, q: { entity: b, at: 'a' } })
      addConstraint(s, { kind: 'horizontal', entity: a })
      addConstraint(s, { kind: 'length', entity: a, value: 10 }); addConstraint(s, { kind: 'length', entity: b, value: 10 })
      addConstraint(s, { kind: 'angle', a, b, value: target, sector: r.sector })
      const out = solveSketch(s); expect(out.ok).toBe(true)
      const lb = entityOf(s, b) as SketchLine
      expect(Math.abs(((deg(dir(lb)) % 360) + 360) % 360 - expected)).toBeLessThan(1e-5)
      expect(measureAngleDimension(s, a, b, r.sector)).toBeCloseTo(target, 6)
    }
  })
  it('a dimension without a sector keeps the folded 0–180° reading', () => {
    const { s, a, b } = corner()
    expect(measureAngleDimension(s, a, b, undefined)).toBeCloseTo(60, 9)
  })
  it('a mirrored copy keeps the same sector', () => {
    const { s, a, b } = corner()
    const r = angleForSector(s, a, b, [-3, -3])!
    addConstraint(s, { kind: 'angle', a, b, value: r.value, sector: r.sector })
    const m = mirrorAbout(s, [a, b], { a: [20, 0], b: [20, 1] }); expect(m.ok).toBe(true); if (!m.ok) return
    const copy = m.sketch.constraints.find(c => c.kind === 'angle' && c.a !== a)
    expect(copy?.kind).toBe('angle'); if (copy?.kind !== 'angle') return
    expect(measureAngleDimension(m.sketch, copy.a, copy.b, copy.sector)).toBeCloseTo(300, 9)
  })
  it('parallel or zero-length lines have no sector', () => {
    expect(sectorAt({ a: [0, 0], b: [1, 0] }, { a: [0, 1], b: [1, 1] }, [0, 0.5])).toBeNull()
    expect(sectorAt({ a: [0, 0], b: [0, 0] }, { a: [0, 1], b: [1, 1] }, [0, 0.5])).toBeNull()
  })
})
