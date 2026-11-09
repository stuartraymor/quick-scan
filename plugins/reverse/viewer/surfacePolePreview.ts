// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import { basisFunctions, findSpan } from '../core/surfaceFit'
import { validate, type PolynomialSurface, type SurfaceAxis } from '../core/surfaceStep'

/** Display tessellation only: never used for persisted or exported geometry.
 * Evaluate the XYZ spline directly, including tangential pole movement. */
export function surfacePolePreview(surface: PolynomialSurface, subdivisions = 40): THREE.BufferGeometry {
  validate(surface)
  const basis = (axis: SurfaceAxis) => {
    const knots = Float64Array.from(axis.knots.flatMap((k, i) => Array(axis.mults[i]).fill(k)))
    return Array.from({ length: subdivisions + 1 }, (_, i) => {
      const t = axis.knots[0] + (axis.knots.at(-1)! - axis.knots[0]) * i / subdivisions
      const span = findSpan(knots, axis.count, axis.degree, t), values = new Float64Array(axis.degree + 1)
      basisFunctions(knots, span, axis.degree, t, values)
      return { first: span - axis.degree, values }
    })
  }
  const u = basis(surface.u), v = basis(surface.v), positions = new Float32Array((subdivisions + 1) ** 2 * 3)
  const indices: number[] = []
  for (let i = 0; i <= subdivisions; i++) for (let j = 0; j <= subdivisions; j++) {
    const offset = (i * (subdivisions + 1) + j) * 3
    const xyz = [0, 0, 0]
    for (let a = 0; a < u[i].values.length; a++) for (let b = 0; b < v[j].values.length; b++) {
      const pole = surface.poles[(u[i].first + a) * surface.v.count + v[j].first + b]
      const weight = u[i].values[a] * v[j].values[b]
      for (let c = 0; c < 3; c++) xyz[c] += weight * pole[c]
    }
    positions.set(xyz, offset)
    if (i < subdivisions && j < subdivisions) {
      const p = i * (subdivisions + 1) + j, q = p + subdivisions + 1
      indices.push(p, q, q + 1, p, q + 1, p + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(indices); geometry.computeVertexNormals()
  return geometry
}
