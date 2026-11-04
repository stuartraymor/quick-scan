// SPDX-License-Identifier: AGPL-3.0-only
// A created primitive reads clearly over the scan: as in QUICKSURFACE, the
// palette colour itself (no longer deepened), translucent but well above a
// wash, and a plane that runs past the patch it was fitted to.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { deepen, PLANE_OVERHANG, PRIMITIVE_OPACITY, PRIMITIVE_OPACITY_SELECTED, PRIMITIVE_SHADE } from '../src/viewer/overlays'
import { PALETTE } from '../src/state/palette'

const lum = (hex: number) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b }

describe('primitive look', () => {
  it('keeps every palette colour at its own lightness', () => {
    for (const c of PALETTE) expect(lum(deepen(c))).toBeCloseTo(lum(new THREE.Color(c).getHex()), 3)
  })
  it('keeps hue (each channel scaled by the same factor)', () => {
    const base = new THREE.Color('#e8590c'), d = new THREE.Color(deepen('#e8590c'))
    expect(d.r / base.r).toBeCloseTo(PRIMITIVE_SHADE, 1)
    expect(d.g / base.g).toBeCloseTo(PRIMITIVE_SHADE, 1)
  })
  it('is above the old 0.5 wash, and denser still when selected', () => {
    expect(PRIMITIVE_OPACITY).toBeGreaterThan(0.55)
    expect(PRIMITIVE_OPACITY_SELECTED).toBeGreaterThan(PRIMITIVE_OPACITY)
  })
  it('draws a plane at its own extent, its handles on the sheet rim, as QUICKSURFACE does', () => {
    expect(PLANE_OVERHANG).toBe(1)
  })
})
