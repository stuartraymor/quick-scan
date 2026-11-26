// SPDX-License-Identifier: AGPL-3.0-only
import { fitConeOnSelection } from '../../../src/core/fit/fitConeFromSeed'
import { fitSphereOnSelection } from '../../../src/core/fit/fitSphereFromSeed'
import type { Vec3 } from '../../../src/core/types'
import { addScaled } from '../../../src/core/vec'
import { cylinderPatch } from './autoConstrain'
import type { TrimPrimitive } from './features'
import type { ReKernel, LoopPiece } from './kernel'

/** Revolve the marked latitude/height interval and angular interval on the measured carrier. */
export function roundSurface(k: ReKernel, kind: 'cone' | 'sphere', positions: Float32Array, normals: Float32Array,
  ids: Uint32Array, xyz: Float32Array, expandPct: number) {
  const graph = { positions, normals }, settings = { method: 'gaussian', sigma: 0 } as const
  const fit = kind === 'cone' ? fitConeOnSelection(graph, ids, settings) : fitSphereOnSelection(graph, ids, settings)
  const axis: Vec3 = fit.kind === 'cone' ? fit.axis : [0,0,1]
  const patch = cylinderPatch(xyz, { origin:fit.center, axis, radius:fit.radius }, expandPct, 0)
  const radial = addScaled(addScaled([0,0,0],patch.u,Math.cos(patch.start)),patch.v,Math.sin(patch.start))
  const at = (height: number, radius: number) => addScaled(addScaled(fit.center,axis,height),radial,radius)
  let piece: LoopPiece, primitive: TrimPrimitive
  if (fit.kind === 'sphere') {
    const latitude = (z: number) => Math.asin(Math.max(-1, Math.min(1,z/fit.radius)))
    const point = (lat: number) => at(fit.radius*Math.sin(lat),fit.radius*Math.cos(lat))
    const lo = latitude(patch.from), hi = latitude(patch.to)
    piece = { kind:'arc', a:point(lo), m:point((lo+hi)/2), b:point(hi) }
    primitive = { kind:'sphere', center:fit.center, radius:fit.radius }
  } else {
    const slope = Math.tan(fit.halfAngle*Math.PI/180)
    const lo = Math.max(patch.from,-fit.radius/slope)
    piece = { kind:'line', a:at(lo,Math.max(0,fit.radius+slope*lo)), b:at(patch.to,fit.radius+slope*patch.to) }
    primitive = { kind:'cone', origin:fit.center, axis, length:fit.length, radius1:fit.radius1, radius2:fit.radius2 }
  }
  const face = k.revolveSheet(piece,fit.center,axis,patch.sweep)
  return { face, primitive, report:{ shape:kind, points:ids.length, rms:fit.sigma,
    max:Math.max(Math.abs(fit.residualMin ?? 0),Math.abs(fit.residualMax ?? 0)), radius:fit.radius, net:{u:0,v:0} } }
}
