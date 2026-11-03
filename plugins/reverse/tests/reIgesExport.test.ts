// SPDX-License-Identifier: AGPL-3.0-only
// Edit Sketch → Export in IGES: a well-formed fixed-column IGES file with a
// line per sketch line and a circular arc, placed on the sketch plane, per
// arc or circle.

import { describe, expect, it } from 'vitest'
import { sketchToIges } from '../core/igesExport'
import type { SketchEntity } from '../core/sketch'

const frame = { origin: [10, 0, 5] as [number, number, number], normal: [0, -1, 0] as [number, number, number], basisU: [1, 0, 0] as [number, number, number], basisV: [0, 0, 1] as [number, number, number] }
const entities: SketchEntity[] = [
  { id: 1, kind: 'line', a: [0, 0], b: [20, 0] },
  { id: 2, kind: 'circle', c: [5, 5], r: 3 },
  { id: 3, kind: 'arc', c: [0, 0], r: 4, start: 0, sweep: -Math.PI / 2 },
  { id: 4, kind: 'line', a: [0, 0], b: [0, 9], construction: true },
]

describe('sketch IGES export', () => {
  const text = sketchToIges(entities, frame, 'Sketch 1')
  const lines = text.trimEnd().split('\r\n')
  it('writes fixed 80-column records in S, G, D, P, T order, numbered within each', () => {
    expect(lines.every((l) => l.length === 80)).toBe(true)
    const letters = lines.map((l) => l[72])
    expect(letters.join('').replace(/(.)\1*/g, '$1')).toBe('SGDPT')
    for (const s of 'SGDP') {
      const nums = lines.filter((l) => l[72] === s).map((l) => Number(l.slice(73)))
      expect(nums).toEqual(nums.map((_, i) => i + 1))
    }
  })
  it('counts each section in the terminate record', () => {
    const t = lines[lines.length - 1]
    const count = (s: string) => lines.filter((l) => l[72] === s).length
    expect(Number(t.slice(1, 8))).toBe(count('S'))
    expect(Number(t.slice(9, 16))).toBe(count('G'))
    expect(Number(t.slice(17, 24))).toBe(count('D'))
    expect(Number(t.slice(25, 32))).toBe(count('P'))
  })
  it('writes the placement, two lines left out of construction, and two arcs on it', () => {
    const types = lines.filter((l) => l[72] === 'D').filter((_, i) => i % 2 === 0).map((l) => Number(l.slice(0, 8)))
    expect(types).toEqual([124, 110, 100, 100])
    // The arcs point at the placement (DE 1); the line places itself.
    const arcs = lines.filter((l) => l[72] === 'D' && Number(l.slice(0, 8)) === 100 && Number(l.slice(73)) % 2 === 1)
    expect(arcs.every((l) => Number(l.slice(48, 56)) === 1)).toBe(true)
  })
  it('puts the line in 3D on the sketch plane', () => {
    const p = lines.find((l) => l[72] === 'P' && l.startsWith('110,'))!
    expect(p.slice(0, 64).trim()).toBe('110,10.0,0.0,5.0,30.0,0.0,5.0;')
  })
})
