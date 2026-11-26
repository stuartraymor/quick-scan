// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import { cadEdgeLength } from '../core/kernelMath'

it('measures an elliptic trim seam consistently as a full edge or as trimmed arcs', async () => {
  const kernel = await OcctKernel.init()
  const c = { x: 40, y: -30, z: 10 }, n = { x: -0.35, y: 0, z: 1 }
  const a = 10 * Math.hypot(1, 0.35), b = 10
  const whole = kernel.makeEllipseEdge(c, n, a, b)
  const left = kernel.makeEllipseArc(c, n, a, b, 0, Math.PI)
  const right = kernel.makeEllipseArc(c, n, a, b, Math.PI, 2 * Math.PI)
  const wrapped = kernel.makeEllipseArc(c, n, 10, 0.02, 5.5, 6.8)
  try {
    // Independent elliptic integral for the oblique section of an R10 cylinder.
    expect(cadEdgeLength(kernel, whole)).toBeCloseTo(64.71399704317352, 9)
    expect(cadEdgeLength(kernel, left) + cadEdgeLength(kernel, right)).toBeCloseTo(cadEdgeLength(kernel, whole), 10)
    expect(cadEdgeLength(kernel, wrapped)).toBeCloseTo(4.219598649178387, 9)
  } finally {
    for (const edge of [whole, left, right, wrapped]) kernel.release(edge)
  }
})
