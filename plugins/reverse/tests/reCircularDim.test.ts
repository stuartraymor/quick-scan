// SPDX-License-Identifier: AGPL-3.0-only
// Options → Other → Circular dimensioning: a circle dimensioned by its
// diameter (QUICKSURFACE's default) or by its radius; an arc by its radius.
import { afterEach, describe, expect, it } from 'vitest'
import { dimensionFor, setCircularDimensioning } from '../core/draw'
import type { Sketch } from '../core/sketch'

const sketch: Sketch = {
  entities: [
    { id: 1, kind: 'circle', c: [0, 0], r: 6 },
    { id: 2, kind: 'arc', c: [20, 0], r: 3, start: 0, sweep: Math.PI / 2 },
  ],
  constraints: [],
  nextId: 3,
}

afterEach(() => setCircularDimensioning('diameter'))

describe('Circular dimensioning', () => {
  it('gives a circle its diameter by default, and its radius when set so', () => {
    expect(dimensionFor(sketch, { kind: 'piece', id: 1 }, null)).toMatchObject({ kind: 'diameter', value: 12 })
    setCircularDimensioning('radius')
    expect(dimensionFor(sketch, { kind: 'piece', id: 1 }, null)).toMatchObject({ kind: 'radius', value: 6 })
  })
  it('keeps an arc on its radius either way', () => {
    expect(dimensionFor(sketch, { kind: 'piece', id: 2 }, null)).toMatchObject({ kind: 'radius', value: 3 })
  })
})

import { scanReach } from '../state/scanReach'

describe('Extrude default depth', () => {
  it('reaches the far side of the scan along the sketch normal, as QUICKSURFACE opens it', () => {
    const p = new Float32Array([0, 0, -13, 0, 0, 17.559, 5, 5, 2])
    expect(scanReach([0, 0, -5], [0, 0, 1], p)).toBeCloseTo(22.559, 3)
    expect(scanReach([0, 0, 30], [0, 0, 1], p)).toBeNull()
    expect(scanReach([0, 0, 0], [0, 0, 1], null)).toBeNull()
  })
})
