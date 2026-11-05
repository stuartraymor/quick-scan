// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { addConstraint, addEntity, emptySketch, type SketchLine } from '../core/sketch'
import { brushPoints, fitBrushPrimitive, sketchWithBrushFit } from '../core/sketchBrush'
import { solveSketch } from '../core/solver'

const options = { tolerance: 0.1, axisDegrees: 1, curvePoints: 8 }

describe('fitted line stability through confirmation and repeated editing', () => {
  for (const vertical of [false, true]) for (const shift of [0, 200]) {
    it(`keeps a legacy ${vertical ? 'vertical' : 'horizontal'} line length at origin ${shift}`, () => {
      const map = ([x, y]: Vec2): Vec2 => vertical ? [shift + y, shift + x] : [shift + x, shift + y]
      const sketch = emptySketch()
      const points: Vec2[] = Array.from({ length: 720 }, (_, i) => map([-90 + i / 4, i / 720 * 0.4 + 0.02 * Math.sin(i)]))
      const id = addEntity(sketch, { kind: 'line', a: map([-90, 0.2]), b: map([89.75, 0.2]), points, scatter: 0.02 })
      addConstraint(sketch, { kind: vertical ? 'vertical' : 'horizontal', entity: id })
      for (let i = 0; i < 10; i++) solveSketch(sketch)
      const line = sketch.entities[0] as SketchLine
      expect(Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1])).toBeCloseTo(179.75, 6)
      expect(line.a[vertical ? 1 : 0]).toBeCloseTo(shift - 90, 6)
      expect(line.b[vertical ? 1 : 0]).toBeCloseTo(shift + 89.75, 6)
    })
  }

  for (const angle of [0, Math.PI / 2, 0.37]) {
    it(`preserves the length-weighted preview after apply and JSON reopening at angle ${angle}`, () => {
      const points: Vec2[] = [...Array.from({ length: 640 }, (_, i): Vec2 => [-40 + i / 16, -0.03]), ...Array.from({ length: 81 }, (_, i): Vec2 => [i / 2, 0])]
        .map(([x, y]): Vec2 => [20 + x * Math.cos(angle) - y * Math.sin(angle), -80 + x * Math.sin(angle) + y * Math.cos(angle)])
      const fit = fitBrushPrimitive('line', brushPoints([points]), options)
      if (!fit.ok || fit.entity.kind !== 'line') throw Error('Expected fitted line')
      const preview = fit.entity
      let sketch = sketchWithBrushFit(emptySketch(), fit)!
      expect(preview.pointWeights).toHaveLength(points.length)
      for (let i = 0; i < 5; i++) {
        solveSketch(sketch)
        sketch = JSON.parse(JSON.stringify(sketch))
        const line = sketch.entities[0] as SketchLine
        expect(Math.hypot(line.a[0] - preview.a[0], line.a[1] - preview.a[1])).toBeLessThan(1e-6)
        expect(Math.hypot(line.b[0] - preview.b[0], line.b[1] - preview.b[1])).toBeLessThan(1e-6)
        expect(line.pointWeights).toEqual(preview.pointWeights)
      }
    })
  }

  it('still applies a driving length while retaining the fitted carrier', () => {
    const fit = fitBrushPrimitive('line', brushPoints([[[0, 2], [5, 2.001], [10, 2]]]), options)
    if (!fit.ok || fit.entity.kind !== 'line') throw Error('Expected fitted line')
    const sketch = sketchWithBrushFit(emptySketch(), fit)!
    addConstraint(sketch, { kind: 'length', entity: sketch.entities[0].id, value: 12 })
    solveSketch(sketch)
    const line = sketch.entities[0] as SketchLine
    expect(line.b[0] - line.a[0]).toBeCloseTo(12, 6)
    expect(line.b[1] - line.a[1]).toBeCloseTo(0, 7)
    expect(line.a[1]).toBeCloseTo(fit.entity.a[1], 6)
  })
})
