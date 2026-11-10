// SPDX-License-Identifier: AGPL-3.0-only
// Thicken and Offset on a converted freeform (F2). QUICKSURFACE thickens
// and offsets the Freeform; here the cage is converted first (convert.ts)
// and then:
//
//  - Offset: the cage's samples moved along the limit surface's normals
//    (limit.ts displacedAlongNormals) and made faces the same way, so the
//    offset is B-spline faces through points like the body it came from —
//    the kernel's own offset surfaces are not written as STEP to better
//    than a quarter of a millimetre at a cube corner (measured, F2). The
//    original stays. A closed cage gives the solid grown or shrunk, an open
//    one a sheet. Measured as the Analysis there is: the distance of the
//    offset's points from the body it came from.
//  - Thicken of an open cage's sheet: the kernel's thickening (one side or
//    half each way, wall measured along the sheet's edge). Its inner faces
//    are the kernel's offset surfaces, so the solid is whole in the kernel
//    but its STEP file reads back with gaps at the corners (stepCheck says).
//  - Thicken of a closed cage's solid, which has no side: the hollow wall
//    between it and its offset (out: the solid offset out less the solid;
//    in: the solid less its offset in; both: half each way), the offsets
//    made as above.
//
// In all of them a face that bends tighter than the distance folds
// without a word (faceOffsetLimits), so the distance is checked first.
// Direction X / Y / Z (a guess at QUICKSURFACE's, not measured): the side
// grown is the one whose normal leans to the positive axis, on average.

import type { ReKernel, Shape } from '../kernel'
import type { Vec3 } from '../../../../src/core/types'
import { patchesBody, type PatchSet } from './convert'

export type FreeformSide = 'in' | 'out' | 'both'
export type FreeformAxis = 'auto' | 'x' | 'y' | 'z'

/** What to do with the converted body. The patches are the cage's samples
 *  moved along the limit normals — by the distance, or for a closed cage's
 *  wall the outer and the inner surface (the body itself where absent). */
export type FreeformOp =
  | { kind: 'thicken'; thickness: number; side: FreeformSide; direction: FreeformAxis; walls?: { outer?: PatchSet; inner?: PatchSet } }
  | { kind: 'offset'; distance: number; patches: PatchSet }

export interface ShellReport {
  kind: 'thicken' | 'offset'
  /** The result is a closed solid, else a sheet. */
  solid: boolean
  valid: boolean
  faces: number
  area: number
  volume: number | null
  /** Thicken: the side grown, after the direction's rule. */
  side?: FreeformSide
  /** Thicken of a sheet: the wall along its edge, thinnest, mm. */
  wall?: number
  /** Offset: the distance of the result's points from the surface it came from. */
  deviation?: { points: number; min: number; max: number; rms: number }
}

/** How far a face's offset may stop short of the distance asked and still be said to take it. */
const SLACK = 1e-6

/** The side grown, flipped where `direction` says the other side leans to the axis. */
export function sideFor(k: ReKernel, sheet: Shape, side: FreeformSide, direction: FreeformAxis): FreeformSide {
  if (direction === 'auto' || side === 'both') return side
  const axis: Vec3 = direction === 'x' ? [1, 0, 0] : direction === 'y' ? [0, 1, 0] : [0, 0, 1]
  const points = k.facePoints(sheet).map((f) => f.at)
  const lean = k.sheetNormals(sheet, points).reduce((s, n) => s + n[0] * axis[0] + n[1] * axis[1] + n[2] * axis[2], 0)
  if (!(Math.abs(lean) > 1e-9)) return side
  // `out` grows along the normal: it should lean to the axis; `in` the other way.
  const flip = side === 'out' ? lean < 0 : lean > 0
  return flip ? (side === 'out' ? 'in' : 'out') : side
}

/** The most the body's faces offset by, each alone, towards `distance`'s side. */
function foldLimit(k: ReKernel, body: Shape, distance: number): number {
  let least = Math.abs(distance)
  for (const f of k.faceOffsetLimits(body, distance).faces) if (f.upTo < Math.abs(distance) * (1 - SLACK)) least = Math.min(least, f.upTo)
  return least
}

function foldRefusal(what: string, asked: number, limit: number): Error {
  // units-ok: build message, also the agent's answer
  return new Error(`The surface does not ${what} by ${asked} mm: a face of it bends tighter than that, and takes ${Math.round(limit * 1000) / 1000} mm at most. Give a smaller distance.`)
}

/** The distances a thickening of side `side` reaches to either side of the surface. */
export const reach = (thickness: number, side: FreeformSide): [number, number] => (side === 'out' ? [thickness, 0] : side === 'in' ? [0, -thickness] : [thickness / 2, -thickness / 2])

/** A solid with a wall: `outer` less `inner`. */
function wall(k: ReKernel, outer: Shape, inner: Shape): Shape {
  const shape = k.cut(outer, inner)
  if (k.solidCount(shape) !== 1) {
    k.release(shape)
    throw new Error('The wall between the surface and its offset came out as more than one solid.')
  }
  return shape
}

/** The shape thickened or offset, and what came of it. The body is the
 *  caller's; so is the shape returned. */
export function freeformShell(k: ReKernel, body: Shape, closed: boolean, op: FreeformOp): { shape: Shape; report: ShellReport } {
  if (op.kind === 'offset') {
    const d = op.distance
    if (!(Math.abs(d) > 1e-9)) throw new Error('The offset needs a distance.')
    const limit = foldLimit(k, body, d)
    if (limit < Math.abs(d)) throw foldRefusal('offset', Math.abs(d), limit)
    const { shape } = patchesBody(k, op.patches)
    try {
      const deviation = k.skinDeviation(body, shape) ?? undefined
      // units-ok: kernel/API diagnostic reports model-space millimetres explicitly.
  if (deviation && Math.max(deviation.max - Math.abs(d), Math.abs(d) - deviation.min) > Math.abs(d) * 0.05 + 0.01) throw new Error(`The offset by ${d} mm leaves the surface: its points lie ${Math.round(deviation.min * 1000) / 1000} to ${Math.round(deviation.max * 1000) / 1000} mm from it.`)
      const solid = closed && k.isClosedSolid(shape)
      return { shape, report: { kind: 'offset', solid, valid: k.isValid(shape), faces: k.faceCount(shape), area: k.surfaceArea(shape), volume: solid ? k.volume(shape) : null, ...(deviation ? { deviation } : {}) } }
    } catch (e) {
      k.release(shape)
      throw e
    }
  }
  const t = op.thickness
  if (!(t > 0)) throw new Error('The thickness must be positive.')
  if (closed) {
    for (const d of reach(t, op.side)) {
      if (d === 0) continue
      const limit = foldLimit(k, body, d)
      if (limit < Math.abs(d)) throw foldRefusal('thicken', Math.abs(d), limit)
    }
    const made: Shape[] = []
    try {
      const surface = (patches: PatchSet | undefined): Shape => {
        if (!patches) return body
        const s = patchesBody(k, patches).shape
        made.push(s)
        return s
      }
      const shape = wall(k, surface(op.walls?.outer), surface(op.walls?.inner))
      const solid = k.isClosedSolid(shape)
      return { shape, report: { kind: 'thicken', solid, valid: k.isValid(shape), faces: k.faceCount(shape), area: k.surfaceArea(shape), volume: k.volume(shape), side: op.side } }
    } finally {
      k.release(...made)
    }
  }
  const side = sideFor(k, body, op.side, op.direction)
  const distances = side === 'out' ? [t] : side === 'in' ? [-t] : [t / 2, -t / 2]
  for (const d of distances) {
    const limit = foldLimit(k, body, d) * (t / Math.abs(d))
    if (limit < t * (1 - SLACK)) throw foldRefusal('thicken', t, limit)
  }
  const made = k.thickenTracked(body, t, side)
  return { shape: made.shape, report: { kind: 'thicken', solid: true, valid: k.isValid(made.shape), faces: k.faceCount(made.shape), area: k.surfaceArea(made.shape), volume: k.volume(made.shape), side, ...(made.wall ? { wall: made.wall.least } : {}) } }
}
