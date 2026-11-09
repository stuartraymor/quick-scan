// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec3 } from '../../../src/core/types'
import { SURFACE_TRIANGLES, type SurfaceReport } from './buildTypes'
import { surfaceMeshCost } from './surfaceMeshCost'
import type { ReKernel } from './kernel'
import type { PolynomialSurface } from './surfaceStep'
import { surfaceAxis } from './surfaceStep'
import { controlNetOf, type SurfaceFitResult } from './surfaceFit'

/** The same exact representation feeds CAD construction and the editor. */
export function polynomialOfFit(fit: SurfaceFitResult): PolynomialSurface {
  const net = controlNetOf(fit)
  return {
    u: surfaceAxis(fit.knotsU, fit.degree, fit.nu),
    v: surfaceAxis(fit.knotsV, fit.degree, fit.nv),
    poles: Array.from({ length: fit.nu * fit.nv }, (_, i) => Array.from(net.points.slice(i * 3, i * 3 + 3))),
  }
}

/** An edited net is no longer a height field. Measure every region point
 * against the actual bounded CAD face, without reusing scalar-fit residuals. */
export function buildEditedSurface(kernel: ReKernel, surface: PolynomialSurface, xyz: Float32Array) {
  if (xyz.length === 0 || xyz.length % 3 !== 0) throw Error('The edited surface needs scan points for its report.')
  const cost = surfaceMeshCost(surface)
  if (cost.triangles > SURFACE_TRIANGLES) throw Error(`The edited surface would mesh to about ${Math.round(cost.triangles / 1000)} k triangles at its ${cost.chord} mm chord, more than ${SURFACE_TRIANGLES / 1000} k. Reduce the pole displacement or refit a coarser, smoother net.`)
  const face = kernel.surfaceFromControlNet(surface)
  try {
    let sum = 0, max = 0
    const worst: { at: Vec3; off: number }[] = []
    for (let i = 0; i < xyz.length; i += 3) {
      const at: Vec3 = [xyz[i], xyz[i + 1], xyz[i + 2]]
      const off = kernel.distanceToPoint(face, at)
      if (!Number.isFinite(off) || off < 0) throw Error('Could not measure the edited surface against the scan.')
      sum += off * off
      max = Math.max(max, off)
      if (worst.length < 10 || off > worst[worst.length - 1].off) {
        worst.push({ at, off }); worst.sort((a, b) => b.off - a.off)
        if (worst.length > 10) worst.pop()
      }
    }
    const report: SurfaceReport = {
      rms: Math.sqrt(sum / (xyz.length / 3)), max, points: xyz.length / 3,
      net: { u: surface.u.count, v: surface.v.count }, metric: 'closest-surface', worst,
      controlSurface: structuredClone(surface),
      controlNet: { rows: surface.u.count, cols: surface.v.count, degree: surface.u.degree, points: Float64Array.from(surface.poles.flat()) },
    }
    return { face, report }
  } catch (error) { kernel.release(face); throw error }
}
