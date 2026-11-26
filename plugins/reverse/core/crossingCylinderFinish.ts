// SPDX-License-Identifier: AGPL-3.0-only
import { len, sub } from '../../../src/core/vec'
import type { EdgeInfo, FaceInfo } from './buildTypes'
import { diagonalOf, meshDeflection } from './buildTypes'
import type { ReKernel, Shape, Tracked } from './kernel'
import { composeHistory } from './kernelMath'
import { isTrap } from './kernelOps'

/** Some narrow bevels pass the exact kernel check, then acquire inconsistent edge
 * polygons when displayed. Rebuild the STEP edge representations only for those
 * results and verify them with the same display tessellation before accepting. */
export function validateCrossingChamfer(k: ReKernel, made: Tracked): Tracked {
  let repaired: Shape | undefined
  try {
    const sag = meshDeflection(diagonalOf(k, made.shape))
    k.mesh(made.shape, sag)
    if (k.isClosedSolid(made.shape) && k.isValid(made.shape)) return made
    repaired = k.importStep(k.exportStep([made.shape]))
    k.mesh(repaired, sag)
    if (!k.isValid(repaired) || !k.isClosedSolid(repaired) || k.solidCount(repaired) !== 1 ||
        k.faceCount(repaired) !== k.faceCount(made.shape)) {
      throw new Error('The beveled cylinder intersection could not be closed.')
    }
    const history = composeHistory(made.history, k.tracedHistory(made.shape, repaired))
    k.release(made.shape)
    return { ...made, shape: repaired, history }
  } catch (error) {
    if (!isTrap(error)) {
      k.release(made.shape)
      if (repaired !== undefined) k.release(repaired)
    }
    throw error
  }
}

/** A short intersection between cylindrical blends can run into a smaller
 * rolling fillet. A larger ball consumes that end fillet. Suppress just the
 * toroidal face shared by the two supports at that end, then roll the new
 * radius over the same trimmed intersection on the extended supports. */
export function crossingCylinderFillet(k: ReKernel, stock: Shape, pick: EdgeInfo,
    edges: readonly EdgeInfo[], faces: readonly FaceInfo[], radius: number): Tracked | null {
  const [a,b] = pick.faces
  const tori = faces.filter(face => face.fingerprint.kind === 'torus' && pick.ends.some(end => {
    const incident = edges.filter(e => e.faces.includes(face.hash) && e.ends.some(p => len(sub(p,end)) < 1e-4))
    return incident.some(e => e.faces.includes(a)) && incident.some(e => e.faces.includes(b))
  }))
  if (tori.length !== 1) return null
  let extended: Shape | undefined
  let rounded: Tracked | undefined
  try {
    if (!(radius * k.maxFaceCurvature(stock, tori[0].hash) > 1)) return null
    extended = k.deleteFaces(stock,[tori[0].hash])
    if (!k.isValid(extended) || !k.isClosedSolid(extended)) return null
    const probes = [pick.ends[0],pick.fingerprint.mid,pick.ends[1]]
    const tolerance = Math.max(1e-5, pick.fingerprint.length * 1e-5)
    const match = k.edgeThroughPoints(extended, pick.fingerprint.length, probes, tolerance)
    if (match === null) return null
    rounded = k.filletTracked(extended, [match], radius)
    if (!k.isClosedSolid(rounded.shape) || !k.isValid(rounded.shape) || k.solidCount(rounded.shape) !== 1) return null
    const result = { shape: rounded.shape, history: k.tracedHistory(stock,rounded.shape),
      note: 'The larger fillet continues through the adjoining smaller end round.' }
    rounded = undefined
    return result
  } catch (error) {
    if (isTrap(error)) throw error
    return null
  } finally {
    if (extended !== undefined) k.release(extended)
    if (rounded) k.release(rounded.shape)
  }
}
