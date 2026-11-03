// SPDX-License-Identifier: AGPL-3.0-only
// Create Sketch → Define interactive: two clicks give an upright sketch
// plane through the section line, snapped to X or Y when asked.

import { describe, expect, it } from 'vitest'
import { sectionLinePlane } from '../state/sectionLineStore'

describe('Define interactive section line', () => {
  it('snaps a line running mostly along X to the plane facing Y, through the start', () => {
    expect(sectionLinePlane([1, 2, 3], [11, 3, 0], true)).toEqual({ kind: 'world', axis: 'y', offset: 2 })
  })
  it('snaps a line running mostly along Y to the plane facing X', () => {
    expect(sectionLinePlane([4, 0, 0], [5, -9, 0], true)).toEqual({ kind: 'world', axis: 'x', offset: 4 })
  })
  it('without snap, stands an upright plane exactly along the line, right-handed', () => {
    const p = sectionLinePlane([0, 0, 0], [3, 4, 7], false)
    expect(p?.kind).toBe('fitted')
    if (p?.kind !== 'fitted') return
    const { normal: n, basisU: u, basisV: v } = p.frame
    expect(u[0]).toBeCloseTo(0.6, 12)
    expect(u[1]).toBeCloseTo(0.8, 12)
    expect(v).toEqual([0, 0, 1])
    const nxu = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]
    nxu.forEach((c, i) => expect(c).toBeCloseTo(v[i], 12))
  })
  it('refuses two clicks one above the other', () => {
    expect(sectionLinePlane([1, 1, 0], [1, 1, 5], true)).toBeNull()
  })
})
