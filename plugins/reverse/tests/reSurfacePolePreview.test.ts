// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { OcctKernel } from 'occt-wasm'
import { surfacePolePreview } from '../viewer/surfacePolePreview'
import { writeSurfaceStep, moveSurfacePole } from '../core/surfaceStep'

it('renders the edited XYZ spline with nonuniform knots, matching independent CAD evaluation', async () => {
  const u = { degree: 3, count: 5, knots: [-2, 0.3, 4], mults: [4, 1, 4] }
  const v = { degree: 2, count: 3, knots: [7, 11], mults: [3, 3] }
  const surface = moveSurfacePole({ u, v, poles: Array.from({ length: 15 }, (_, i) => [Math.floor(i / 3), i % 3, Math.sin(i)]) }, 1, 1, [1.5, -2, 3])
  const geometry = surfacePolePreview(surface, 12), raw = await OcctKernel.init()
  const shape = raw.importStep(writeSurfaceStep(surface)), faces = raw.getSubShapes(shape, 'face')
  try {
    const pos = geometry.getAttribute('position')
    expect(pos.count).toBe(169)
    expect(geometry.index!.count).toBe(12 * 12 * 6)
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
      const p = raw.pointOnSurface(faces[0], -2 + i / 12 * 6, 7 + j / 12 * 4), n = i * 13 + j
      expect(Math.hypot(p.x - pos.getX(n), p.y - pos.getY(n), p.z - pos.getZ(n))).toBeLessThan(1e-6)
    }
  } finally { geometry.dispose(); faces.forEach(f => raw.release(f)); raw.release(shape); raw[Symbol.dispose]() }
})
