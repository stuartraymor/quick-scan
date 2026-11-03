// SPDX-License-Identifier: AGPL-3.0-only
// Multiple sections' stack, as QUICKSURFACE's dialog sets it: from the
// offset, the spacing apart, one way or both, across the part.
import { describe, expect, it } from 'vitest'
import { sectionOffsets } from '../src/ui/MultipleSections'

describe('Multiple sections offsets', () => {
  it('runs both ways from the offset by default, across the part', () => {
    expect(sectionOffsets(0, 10, 'both', -25, 25)).toEqual([-20, -10, 0, 10, 20])
  })
  it('runs one way only when asked', () => {
    expect(sectionOffsets(5, 10, 'positive', -25, 25)).toEqual([5, 15, 25])
    expect(sectionOffsets(5, 10, 'negative', -25, 25)).toEqual([-25, -15, -5, 5])
  })
  it('lands on the part when the offset is off it', () => {
    expect(sectionOffsets(0, 10, 'both', -253, -143)).toEqual([-250, -240, -230, -220, -210, -200, -190, -180, -170, -160, -150])
  })
  it('is one section with no spacing, and never runs away', () => {
    expect(sectionOffsets(3, 0, 'both', -1, 1)).toEqual([3])
    expect(sectionOffsets(0, 1e-6, 'both', -1e6, 1e6).length).toBe(500)
  })
})
