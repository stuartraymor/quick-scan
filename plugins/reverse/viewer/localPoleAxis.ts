// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import { validate, type PolynomialSurface } from '../core/surfaceStep'

const subtract = (a: readonly number[], b: readonly number[]): Vec3 => [a[0]-b[0], a[1]-b[1], a[2]-b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
function unit(v: Vec3): Vec3 | null {
  const length = Math.hypot(...v)
  return length > 0 && Number.isFinite(length) ? [v[0]/length, v[1]/length, v[2]/length] : null
}

/** Local red axis measured at three native interior poles. Average unit
 * normals of incident triangles with a consistent b-d cell diagonal.
 * Green=normal cross red is independently measured at one interior pole.
 * Blue=averaged normal is independently measured at the same pole.
 * Boundary/degenerate behavior is defensive, not yet native-verified.
 * Input/output coordinates are the net's own coordinate system. */
export function localPoleFrame(surface: PolynomialSurface, u: number, v: number): { x: Vec3; y: Vec3; z: Vec3 } | null {
  validate(surface)
  if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0 || u >= surface.u.count || v >= surface.v.count) throw Error('Control pole is outside the net')
  const index = (i: number, j: number) => i * surface.v.count + j
  const selected = index(u, v)
  const sum: Vec3 = [0, 0, 0]
  for (let i = Math.max(0, u-1); i <= Math.min(u, surface.u.count-2); i++) {
    for (let j = Math.max(0, v-1); j <= Math.min(v, surface.v.count-2); j++) {
      const a=index(i,j), b=index(i+1,j), c=index(i+1,j+1), d=index(i,j+1)
      for (const triangle of [[a,b,d], [b,c,d]]) {
        if (!triangle.includes(selected)) continue
        const [p,q,r] = triangle.map(k => surface.poles[k])
        const n = unit(cross(subtract(q,p), subtract(r,p)))
        if (n) for (let k=0; k<3; k++) sum[k] += n[k]
      }
    }
  }
  const normal = unit(sum)
  if (!normal) return null
  let least = 0
  for (let k=1; k<3; k++) if (Math.abs(normal[k]) < Math.abs(normal[least])) least = k
  const basis: Vec3 = [0,0,0]; basis[least] = 1
  const x = unit(cross(basis, normal))
  if (!x) return null
  const y = unit(cross(normal, x))
  return y ? { x, y, z: normal } : null
}

export function localPoleRedAxis(surface: PolynomialSurface, u: number, v: number): Vec3 | null {
  return localPoleFrame(surface, u, v)?.x ?? null
}
