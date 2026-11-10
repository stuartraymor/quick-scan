// SPDX-License-Identifier: AGPL-3.0-only
// How far past the surface it was measured on an element is drawn and
// exported.
//
// A fit is a measurement: its length and its extents say how much of the
// feature the scan actually covered, and the sigma, the patch size in the
// summary and the "left the measured surface" warning on a dimension all rest
// on that. So an extension is never folded into the fit — it is carried beside
// it and applied at the two places where geometry stops being a measurement
// and becomes something to look at or hand to CAD: the viewport and the STEP
// export. Everything that reports numbers keeps reading the raw fit.
//
// The values are millimetres per side, positive outward. Negative shrinks, and
// each side is clamped so the element can never be given away entirely.

import type { AxialWindow, ConeFit, CylinderFit, FitData, PlaneFit } from '../types'
import { addScaled } from '../vec'

/** A cylinder grows along its axis: `start` runs against it, `end` with it.
 *  A plane grows along its own in-plane axes, one value per edge.
 *
 *  `fitInside` turns a cylinder's two numbers from a drawing decision into a
 *  mask as well: the best fit then runs only on the scanned surface inside
 *  the drawn span. That is the one way an extension reaches the measurement
 *  — an end pulled in with it on leaves the surface beyond that end out of
 *  the fit, which is how a badly captured rim is kept from bending the axis. */
export type Extension =
  | { kind: 'cylinder'; start: number; end: number; fitInside?: boolean }
  | { kind: 'plane'; uMin: number; uMax: number; vMin: number; vMax: number; rotation?: number }
  /** A cone grows along its axis like a cylinder — `start` against the axis
   *  (the `radius1` end), `end` with it (the `radius2` end) — keeping its
   *  taper, axis and apex. Only set by Extract primitives' default extent:
   *  there are no grips or fields for it (see isExtendable). */
  | { kind: 'cone'; start: number; end: number }

export type CylinderSide = 'start' | 'end'
export type PlaneSide = 'uMin' | 'uMax' | 'vMin' | 'vMax'
export type ExtendSide = CylinderSide | PlaneSide

export const CYLINDER_SIDES: readonly CylinderSide[] = ['start', 'end']
export const PLANE_SIDES: readonly PlaneSide[] = ['uMin', 'uMax', 'vMin', 'vMax']

/** What is left of an element that has been shrunk as far as it may go. Small
 *  enough to be no size at all, large enough to stay a valid B-rep face. */
const MIN_SIZE = 1e-3

/** The kinds that can be extended: the two with a size of their own that is a
 *  drawing decision rather than a measured value. A sphere's radius and a
 *  point's position are the measurement itself. */
export type ExtendableFit = CylinderFit | PlaneFit

export function isExtendable(fit: FitData | undefined): fit is ExtendableFit {
  return fit !== undefined && (fit.kind === 'cylinder' || fit.kind === 'plane')
}

/** An untouched extension for the given geometry — every side at zero, so the
 *  element is drawn exactly as it was measured. */
export function zeroExtension(fit: ExtendableFit): Extension {
  return fit.kind === 'cylinder'
    ? { kind: 'cylinder', start: 0, end: 0 }
    : { kind: 'plane', uMin: 0, uMax: 0, vMin: 0, vMax: 0 }
}

/** The extension to work with for one element: its own, if it still matches
 *  the geometry (a re-opened plane draft can be switched to another kind, and
 *  a construction can change what it produces), otherwise a fresh zeroed one. */
export function extensionOf(fit: ExtendableFit, ext: Extension | undefined): Extension {
  return ext && ext.kind === fit.kind ? ext : zeroExtension(fit)
}

/** Whether anything has been extended at all — the panel and the summary only
 *  mention it when it has. */
export function isExtended(ext: Extension | undefined): boolean {
  if (!ext) return false
  return sides(ext).some((s) => sideValue(ext, s) !== 0) || (ext.kind === 'plane' && !!ext.rotation)
}

/** Whether the extension also confines the fit — a cylinder with the option
 *  on. Off, absent, and a plane all mean the fit takes the whole surface. */
export function fitsInside(ext: Extension | undefined): boolean {
  return ext?.kind === 'cylinder' && ext.fitInside === true
}

/** The span the fit is confined to, for the worker, or undefined when the
 *  whole measured surface goes in. Only the two numbers travel: the fitter
 *  applies them to the surface it finds, and reads the flag from nothing. */
export function fitWindow(ext: Extension | undefined): AxialWindow | undefined {
  return ext?.kind === 'cylinder' && ext.fitInside === true
    ? { start: ext.start, end: ext.end }
    : undefined
}

/** The same extension with the fit confined to its span or not. Only a
 *  cylinder has the option; a plane is handed back unchanged. */
export function withFitInside(ext: Extension, on: boolean): Extension {
  if (ext.kind !== 'cylinder') return ext
  if (on) return { ...ext, fitInside: true }
  const { fitInside: _off, ...rest } = ext
  return rest
}

export function sides(ext: Extension): readonly ExtendSide[] {
  return ext.kind === 'plane' ? PLANE_SIDES : CYLINDER_SIDES
}

/** The kinds an extension is carried and drawn for: the two with grips
 *  (isExtendable), and the cone, which only Extract primitives extends. */
export function carriesExtension(fit: FitData | undefined): fit is ExtendableFit | ConeFit {
  return isExtendable(fit) || fit?.kind === 'cone'
}

/** How far past the selected patch Extract primitives draws a new primitive,
 *  as a share of the measured size: each plane edge by this times the half
 *  extent on its axis, each cylinder end by this times the length, a cone's
 *  larger end by this times the length. Read off QUICKSURFACE's saved QSF
 *  geometry for plane, cylinder and cone extractions (parent measurement,
 *  2026-11-10); the plane's in-plane frame is QuickScan's own fitted one. */
export const EXTRACT_EXTENT_FACTOR = 0.55

/** The extension a fresh Extract primitives fit starts with — computed from
 *  the measured fit alone and replacing (never adding to) any other, so a
 *  refit under a constraint gives the same default again. Undefined for kinds
 *  that are not drawn past their surface. */
export function defaultExtractExtension(fit: FitData | undefined): Extension | undefined {
  const k = EXTRACT_EXTENT_FACTOR
  const ok = (v: number) => Number.isFinite(v) && v > 0
  if (fit?.kind === 'plane') {
    if (!ok(fit.extentU) || !ok(fit.extentV)) return undefined
    const u = k * fit.extentU, v = k * fit.extentV
    return { kind: 'plane', uMin: u, uMax: u, vMin: v, vMax: v }
  }
  if (fit?.kind === 'cylinder') {
    if (!ok(fit.length)) return undefined
    return { kind: 'cylinder', start: k * fit.length, end: k * fit.length }
  }
  if (fit?.kind === 'cone') {
    if (!ok(fit.length)) return undefined
    // The larger end, whichever way the axis happens to point.
    return fit.radius2 >= fit.radius1
      ? { kind: 'cone', start: 0, end: k * fit.length }
      : { kind: 'cone', start: k * fit.length, end: 0 }
  }
  return undefined
}

/** The cone's radius change per millimetre along its axis: the analytic
 *  half-angle, signed by which end is the larger. Falls back to the two end
 *  radii when the angle is unusable. */
function coneSlope(fit: ConeFit): number {
  const sign = fit.radius2 >= fit.radius1 ? 1 : -1
  const tan = Math.abs(Math.tan((fit.halfAngle * Math.PI) / 180))
  if (Number.isFinite(tan)) return sign * tan
  return fit.length > 0 ? (fit.radius2 - fit.radius1) / fit.length : 0
}

/** A cone carried further along its own surface: the axis, half-angle and
 *  apex stay put, the interval along the axis moves, and the middle and the
 *  radii are read off the taper again. Never past the apex. */
function extendCone(fit: ConeFit, ext: { start: number; end: number }): ConeFit {
  const half = fit.length / 2
  let lo = -half - (Number.isFinite(ext.start) ? ext.start : 0)
  let hi = half + (Number.isFinite(ext.end) ? ext.end : 0)
  const k = coneSlope(fit)
  // r(t) = radius + k t, t along the axis from the fit's centre.
  if (k !== 0) {
    const apex = -fit.radius / k
    if (k > 0 && lo < apex) lo = apex
    if (k < 0 && hi > apex) hi = apex
  }
  // A malformed or over-shrunk saved interval must not move a cone through
  // its apex and manufacture a negative middle radius.
  if (!Number.isFinite(lo + hi) || hi - lo < MIN_SIZE) return fit
  if (lo === -half && hi === half) return fit
  const mid = (lo + hi) / 2
  return {
    ...fit,
    center: addScaled(fit.center, fit.axis, mid),
    length: hi - lo,
    radius: fit.radius + k * mid,
    radius1: Math.max(0, fit.radius + k * lo),
    radius2: Math.max(0, fit.radius + k * hi),
  }
}

export function sideValue(ext: Extension, side: ExtendSide): number {
  return (ext as Record<string, unknown>)[side] as number
}

/** The two sides that share an axis: they trade off against each other, which
 *  is what makes the clamp below a matter between a pair rather than one
 *  value on its own. */
function opposite(side: ExtendSide): ExtendSide {
  if (side === 'start') return 'end'
  if (side === 'end') return 'start'
  if (side === 'uMin') return 'uMax'
  if (side === 'uMax') return 'uMin'
  return side === 'vMin' ? 'vMax' : 'vMin'
}

/** The measured size along the axis a side grows on — a cylinder's length,
 *  the full width or height of a plane's patch. */
function fittedSpan(fit: ExtendableFit, side: ExtendSide): number {
  if (fit.kind === 'cylinder') return fit.length
  return 2 * (side === 'uMin' || side === 'uMax' ? fit.extentU : fit.extentV)
}

/**
 * How far one side may be pulled in before there would be nothing left along
 * that axis. Shrinking is allowed — it is the only way to trim a fit that ran
 * a little past the feature — but the far side has already had its say, so
 * what is left to give is whatever the two of them still span.
 */
export function minSide(fit: ExtendableFit, ext: Extension, side: ExtendSide): number {
  const far = sideValue(ext, opposite(side))
  return MIN_SIZE - fittedSpan(fit, side) - far
}

/** One side changed, clamped so the element keeps a size. */
export function withSide(
  fit: ExtendableFit,
  ext: Extension,
  side: ExtendSide,
  value: number,
): Extension {
  const v = Number.isFinite(value) ? Math.max(value, minSide(fit, ext, side)) : 0
  return { ...ext, [side]: v } as Extension
}

/**
 * The geometry as it should be drawn and exported: the same surface, carrying
 * however much of it the user asked for.
 *
 * Only the size and the middle move. The axis, the normal, the radius and the
 * in-plane basis are the fit's own and are handed straight on, so an extended
 * element is still exactly the measured surface — there is just more of it.
 */
export function applyExtension(fit: FitData, ext: Extension | undefined): FitData {
  if (!ext || !carriesExtension(fit) || ext.kind !== fit.kind) return fit

  if (fit.kind === 'cone' && ext.kind === 'cone') return extendCone(fit, ext)

  if (fit.kind === 'cylinder' && ext.kind === 'cylinder') {
    const length = Math.max(fit.length + ext.start + ext.end, MIN_SIZE)
    if (length === fit.length && ext.start === ext.end) return fit
    return {
      ...fit,
      length,
      center: addScaled(fit.center, fit.axis, (ext.end - ext.start) / 2),
    }
  }

  if (fit.kind === 'plane' && ext.kind === 'plane') {
    const extentU = Math.max(fit.extentU + (ext.uMin + ext.uMax) / 2, MIN_SIZE / 2)
    const extentV = Math.max(fit.extentV + (ext.vMin + ext.vMax) / 2, MIN_SIZE / 2)
    const angle = (ext.rotation ?? 0) * Math.PI / 180
    const c = Math.cos(angle), s = Math.sin(angle)
    const basisU = addScaled(fit.basisU.map(v => v * c) as typeof fit.basisU, fit.basisV, s)
    const basisV = addScaled(fit.basisV.map(v => v * c) as typeof fit.basisV, fit.basisU, -s)
    let center = addScaled(fit.center, basisU, (ext.uMax - ext.uMin) / 2)
    center = addScaled(center, basisV, (ext.vMax - ext.vMin) / 2)
    return { ...fit, extentU, extentV, center, basisU, basisV }
  }

  return fit
}

/** The full width and height (or length) the element is drawn at, for the
 *  readout beside the fields. */
export function extendedSpans(fit: ExtendableFit, ext: Extension | undefined): number[] {
  const applied = applyExtension(fit, ext)
  if (applied.kind === 'cylinder') return [applied.length]
  if (applied.kind === 'plane') return [2 * applied.extentU, 2 * applied.extentV]
  return []
}

/**
 * The extension that makes a plane patch square, by growing the shorter axis
 * out to the longer one — half of the difference onto each of its two edges,
 * so the patch keeps its middle. It never cuts: a square that trimmed the
 * measured surface away would hide the very thing that was measured.
 */
export function squareExtension(fit: PlaneFit, ext: Extension | undefined): Extension {
  const e = extensionOf(fit, ext)
  if (e.kind !== 'plane') return e
  const u = 2 * fit.extentU + e.uMin + e.uMax
  const v = 2 * fit.extentV + e.vMin + e.vMax
  const side = Math.max(u, v)
  const du = (side - u) / 2
  const dv = (side - v) / 2
  return {
    ...e,
    kind: 'plane',
    uMin: e.uMin + du,
    uMax: e.uMax + du,
    vMin: e.vMin + dv,
    vMax: e.vMax + dv,
  }
}

/** Spin a rectangular patch about its current centre, without refitting the plane. */
export function withPlaneRotation(fit: PlaneFit, ext: Extension | undefined, degrees: number): Extension {
  const e = extensionOf(fit, ext)
  if (e.kind !== 'plane' || !Number.isFinite(degrees)) return e
  const delta = (degrees - (e.rotation ?? 0)) * Math.PI / 180
  const a = (e.uMax - e.uMin) / 2, b = (e.vMax - e.vMin) / 2
  const u = a * Math.cos(delta) + b * Math.sin(delta)
  const v = -a * Math.sin(delta) + b * Math.cos(delta)
  const su = (e.uMin + e.uMax) / 2, sv = (e.vMin + e.vMax) / 2
  return { ...e, rotation: degrees, uMin: su - u, uMax: su + u, vMin: sv - v, vMax: sv + v }
}
