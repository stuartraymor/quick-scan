// SPDX-License-Identifier: AGPL-3.0-only
// Datum alignment: carry the part into the global coordinate system using
// measured elements as datums — the 3-2-1 / plane-line-point workflow of CMM
// software. A primary datum levels the part onto one axis, an optional
// secondary datum clocks the remaining rotation, and an origin point (or the
// datums themselves) fixes the translation.

import type { FitData, PlaneFit, Vec3 } from './types'
import {
  identityRigid,
  reorthonormalize,
  rigidApply,
  rigidCompose,
  rigidFromAxisAngle,
  rigidRotate,
  rigidRotationAngle,
  type Rigid,
} from './deviation/rigid'
import { acuteAngle, addScaled, cross, dot, normalize } from './vec'
import { orthoBasis } from './fit/linalg'
import { ConstructionError, evaluateConstruction } from './elements/construct'

/** A degenerate datum combination — the message is written for the user. */
export class AlignmentError extends Error {}

/** The three roles of a 3-2-1 alignment: level the part, stop it turning,
 *  set the zero point. */
export type AlignSlot = 'primary' | 'secondary' | 'origin'

/** How many points picked on the scan stand in for an element per slot —
 *  three span the levelling plane, two the rotation line, one the origin. */
export const ALIGN_PICK_COUNT: Record<AlignSlot, number> = {
  primary: 3,
  secondary: 2,
  origin: 1,
}

/** The stand-in geometry for a slot filled by picking on the scan: a plane
 *  through three points, a line through two, the point itself. Null while the
 *  picks are still incomplete.
 *
 *  The three-point plane's normal sign would otherwise depend on the order the
 *  points were clicked in — so when the surface normals at the picks come
 *  along (`towards`), the plane is turned to face the way the scanned surface
 *  does. That is what lets the UI talk about the picked face becoming the
 *  bottom or the top of the part and be right every time. */
export function fitFromAlignPicks(
  slot: AlignSlot,
  picks: Vec3[],
  modelSize: number,
  towards?: Vec3[],
): FitData | null {
  if (picks.length < ALIGN_PICK_COUNT[slot]) return null
  const pts: FitData[] = picks.map((center) => ({
    kind: 'point',
    center,
    sigma: 0,
    usedPoints: 0,
    regionSize: 0,
  }))
  try {
    if (slot === 'primary') {
      const plane = evaluateConstruction('plane-three-points', pts, [], modelSize) as PlaneFit
      const out: Vec3 = (towards ?? []).reduce<Vec3>(
        (acc, n) => [acc[0] + n[0], acc[1] + n[1], acc[2] + n[2]],
        [0, 0, 0],
      )
      if (dot(plane.normal, out) >= 0) return plane
      // Flip the normal and one basis vector together, so U × V stays N.
      return {
        ...plane,
        normal: [-plane.normal[0], -plane.normal[1], -plane.normal[2]],
        basisV: [-plane.basisV[0], -plane.basisV[1], -plane.basisV[2]],
      }
    }
    if (slot === 'secondary') return evaluateConstruction('line-two-points', pts, [], modelSize)
    return pts[0]
  } catch (e) {
    if (!(e instanceof ConstructionError)) throw e
    throw new AlignmentError(
      slot === 'primary'
        ? 'The three picked points lie on a line — spread them out.'
        : 'The two picked points coincide — pick them further apart.',
    )
  }
}

/** A signed global axis a datum direction is mapped onto. */
export type AxisDir = 'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-'

export function axisIndex(a: AxisDir): number {
  return a[0] === 'x' ? 0 : a[0] === 'y' ? 1 : 2
}

function axisVector(a: AxisDir): Vec3 {
  const v: Vec3 = [0, 0, 0]
  v[axisIndex(a)] = a[1] === '+' ? 1 : -1
  return v
}

/** The direction an element contributes as a datum: a plane or circle its
 *  normal, a line, cylinder or cone its axis. Points and spheres have none. */
function datumDirection(fit: FitData): Vec3 | null {
  if (fit.kind === 'plane') return fit.normal
  if (fit.kind === 'line') return fit.dir
  if (fit.kind === 'cylinder' || fit.kind === 'cone') return fit.axis
  if (fit.kind === 'circle') return fit.normal
  return null
}

/** Whether a secondary runs the primary's way — too near parallel to clock
 *  a rotation — so it can only stand on the primary's own axis. */
export function secondaryAlongPrimary(primary: FitData, secondary: FitData): boolean {
  const a = datumDirection(primary), b = datumDirection(secondary)
  return !!a && !!b && acuteAngle(normalize(a)!, b) < MIN_CLOCK_ANGLE
}

/** Whether the tertiary clocks the rotation, as QUICKSURFACE lets it: the
 *  secondary runs the primary's way, and the tertiary is a plane or an axis
 *  that does not. */
export function tertiaryClocks(primary: FitData, secondary: FitData, tertiary: FitData): boolean {
  return tertiaryTileKind(tertiary) !== null && secondaryAlongPrimary(primary, secondary) && !secondaryAlongPrimary(primary, tertiary)
}

/** The tiles QUICKSURFACE shows for a tertiary feature: Top / Right / Front
 *  for a plane, X / Y / Z Axis for a cylinder, cone or line, none for a
 *  point or anything else without a direction. */
export function tertiaryTileKind(fit: FitData): 'plane' | 'axis' | null {
  return fit.kind === 'plane' ? 'plane' : fit.kind === 'cylinder' || fit.kind === 'cone' || fit.kind === 'line' ? 'axis' : null
}

export interface DatumSpec {
  fit: FitData
  axis: AxisDir
}

/** Below this angle two datum directions cannot clock a rotation. Matches the
 *  plane-intersection threshold in the constructions. */
const MIN_CLOCK_ANGLE = 0.2

/**
 * The rigid transform that carries the part into the global system defined by
 * the datums:
 *
 * - The primary datum's direction becomes the chosen signed axis. A plane also
 *   sets the zero of that axis (the plane lands on coordinate 0); a cylinder
 *   or line axis sets the zero of both perpendicular coordinates (the datum
 *   axis lands on the global axis line).
 * - The secondary datum's direction, projected perpendicular to the primary,
 *   becomes its chosen axis and clocks the rotation. It sets any of its
 *   coordinates the primary left open the same way.
 * - The origin point sets the zero of every coordinate the datums left open.
 *
 * With `centerOf` given (the part's bounding-box centre), any coordinate still
 * open after that is centred on the fitted primary plane’s measured bounds
 * (or on the scan-box centre for other datums). A part fresh
 * from the scanner lands on the coordinate planes instead of keeping an
 * arbitrary offset. Without it, anything unconstrained keeps its position:
 * the rotation pivots about the primary datum's centre so the part does not
 * fly off screen.
 *
 * `tertiaryAxis` is the axis the tertiary's direction becomes when the
 * secondary runs the primary's way and so cannot clock the rotation: the
 * tertiary clocks it instead (see tertiaryClocks).
 */
export function computeDatumAlignment(
  primary: DatumSpec,
  secondary: DatumSpec | null,
  origin: FitData | null,
  centerOf?: Vec3 | null,
  tertiaryAxis?: AxisDir | null,
): Rigid {
  const d1raw = datumDirection(primary.fit)
  if (!d1raw)
    throw new AlignmentError(
      'Levelling needs a direction — use a plane, cylinder, line, or three picked points.',
    )
  const d1 = normalize(d1raw)!
  const e1 = axisVector(primary.axis)

  const m = identityRigid()

  // A secondary running the primary's way — the top face of a cylinder taken
  // as primary, say — cannot clock the rotation, but QUICKSURFACE takes it as
  // the primary's own axis: the primary turns the part, and the secondary only
  // sets the zero along that axis.
  const along = secondary !== null && secondaryAlongPrimary(primary.fit, secondary.fit)
  if (secondary && along) {
    if (axisIndex(secondary.axis) !== axisIndex(primary.axis))
      throw new AlignmentError("This feature runs the primary's way — it can only become the primary's own axis.")
  }
  const datum = primary.fit.kind === 'plane' ? primary.fit.datum : undefined
  // What clocks the rotation: the secondary, or — when it runs the primary's
  // way — the tertiary, on its own tile's axis. QUICKSURFACE 8.0.128
  // (controlled fixtures, 2026-11-11: Cylinder Z Axis, its cap plane Top,
  // a side plane tertiary) turns the side plane's normal onto Right or Front
  // as its tile says, and onto the negative side with Flip.
  const clock: DatumSpec | null =
    secondary && !along ? secondary
      : secondary && along && origin && tertiaryAxis && tertiaryClocks(primary.fit, secondary.fit, origin) && axisIndex(tertiaryAxis) !== axisIndex(primary.axis)
        ? { fit: origin, axis: tertiaryAxis }
        : null
  if (clock) {
    const d2raw = datumDirection(clock.fit)
    if (!d2raw)
      throw new AlignmentError(
        'The rotation step needs a direction — use a plane, cylinder, line, or two picked points.',
      )
    if (axisIndex(clock.axis) === axisIndex(primary.axis))
      throw new AlignmentError('Levelling and rotation cannot use the same axis.')
    // Project the secondary direction perpendicular to the primary: the
    // primary always wins exactly, the secondary only clocks.
    const d2 = normalize(addScaled(d2raw, d1, -dot(d2raw, d1)))!
    const e2 = axisVector(clock.axis)
    const d3 = cross(d1, d2)
    const e3 = cross(e1, e2)
    // R = Σₖ eₖ ⊗ dₖ maps the datum frame onto the global one.
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        m.r[i * 3 + j] = e1[i] * d1[j] + e2[i] * d2[j] + e3[i] * d3[j]
      }
    }
  } else if (datum) {
    // A Front alignment keeps the projected X direction along X. Top
    // and Right keep the projected Y direction along Y.
    const front = axisIndex(primary.axis) === 1
    const localU = front ? datum.frontU : datum.u
    const localV = cross(d1, localU)
    const targetU: Vec3 = front ? [1, 0, 0] : cross([0, 1, 0], e1)
    const targetV = cross(e1, targetU)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        m.r[i * 3 + j] = targetU[i] * localU[j] + targetV[i] * localV[j] + e1[i] * d1[j]
      }
    }
  } else {
    // Minimal rotation carrying d1 onto e1.
    const axis = cross(d1, e1)
    const sin = Math.hypot(...axis)
    const cos = dot(d1, e1)
    if (sin < 1e-12) {
      if (cos < 0) {
        // Antiparallel: a half-turn about any perpendicular.
        setRotationAxisAngle(m, orthoBasis(d1)[0], Math.PI)
      }
    } else {
      setRotationAxisAngle(m, axis, Math.atan2(sin, cos))
    }
  }
  const rigid = reorthonormalize(m)

  // Translation: pivot about the primary centre, then let each datum zero the
  // coordinates it owns, and the origin point everything still open.
  const c1 = datum?.origin ?? primary.fit.center
  const out = new Float64Array(3)
  rigidRotate(rigid, c1[0], c1[1], c1[2], out)
  rigid.t[0] = c1[0] - out[0]
  rigid.t[1] = c1[1] - out[1]
  rigid.t[2] = c1[2] - out[2]

  const constrained = new Set<number>()
  const zeroCoord = (k: number, value: number) => {
    if (constrained.has(k)) return
    rigid.t[k] -= value
    constrained.add(k)
  }
  const zeroAt = (anchor: Vec3, coords: number[]) => {
    rigidApply(rigid, anchor[0], anchor[1], anchor[2], out)
    for (const k of coords) zeroCoord(k, out[k])
  }
  const datumCoords = (spec: DatumSpec): number[] => {
    const k = axisIndex(spec.axis)
    // A plane owns the coordinate along its normal; an axis the two across it.
    return spec.fit.kind === 'plane' ? [k] : [0, 1, 2].filter((i) => i !== k)
  }
  zeroAt(c1, datumCoords(primary))
  // Plane after plane: a secondary or tertiary plane zeroes its coordinate
  // where it crosses the planes already set at zero, not at its patch centroid
  // — QUICKSURFACE does (QSF fixtures, 0.0.198: a 3° wall secondary and a 5°
  // tertiary both land on the three-plane corner). A tilted face's centroid
  // stands off that corner by tan(tilt) × its height above the other datums.
  // Other datum kinds and degenerate crossings keep the centroid.
  const planeChain = primary.fit.kind === 'plane'
  const axisSecondary = planeChain && secondary !== null && !along && (secondary.fit.kind === 'cylinder' || secondary.fit.kind === 'cone' || secondary.fit.kind === 'line')
  if (secondary) {
    const k = axisIndex(secondary.axis)
    const v = planeChain && !along && secondary.fit.kind === 'plane' ? planeCrossing(rigid, secondary.fit, k, constrained) : null
    if (v !== null) zeroCoord(k, v)
    else zeroAt(secondary.fit.center, datumCoords(secondary))
  }
  if (origin) {
    const open = [0, 1, 2].filter((i) => !constrained.has(i))
    const v =
      // A cylinder secondary too (native 0.0.198: Plane Top, tilted Cylinder
      // to X, tilted Plane tertiary → the tertiary's crossing). Only after a
      // plane primary: cylinder-primary combinations remain a separate case.
      planeChain && (secondary === null || secondary.fit.kind === 'plane' || secondary.fit.kind === 'cylinder') && origin.kind === 'plane' && open.length === 1
        ? planeCrossing(rigid, origin, open[0], constrained)
        : null
    if (v !== null) zeroCoord(open[0], v)
    // A plane tertiary square to the one coordinate still open (Plane(1)
    // again, which QUICKSURFACE fills in itself) cannot fix it: it is left
    // to the secondary axis below, as QUICKSURFACE leaves it.
    else if (!(planeChain && origin.kind === 'plane' && open.length === 1 && axisSecondary)) zeroAt(originAnchor(rigid, origin, primary), [0, 1, 2])
  }
  // A cylinder or line secondary after a plane primary fixes its own
  // coordinate where its axis crosses the primary plane, when nothing else
  // has: QUICKSURFACE (basic_part, 2026-11-11: Plane Top, Cylinder X Axis,
  // tertiary Plane(1)) puts x = 0 where the cylinder's axis meets z = 0 —
  // 1049 mm from the part's middle for an axis tilted 3.3° off the plane.
  if (axisSecondary && secondary) {
    const k = axisIndex(secondary.axis)
    if (!constrained.has(k)) {
      const at = originAnchor(rigid, secondary.fit, primary)
      if (at !== secondary.fit.center) zeroAt(at, [k])
    }
  }
  // What is still open is centred on the primary itself where it has a
  // measured centre: a plane's datum origin, or a cylinder's mid-axis point —
  // QUICKSURFACE (Cylinder primary on Z Axis alone, 0.0.198 QSF fixture) puts
  // the cylinder's centre at z = 0, not the scan's box centre. Others keep
  // centring on the box.
  if (centerOf) zeroAt(datum?.origin ?? (primary.fit.kind === 'cylinder' ? primary.fit.center : centerOf), [0, 1, 2])

  return rigid
}

/** A plane datum's crossing of the coordinates already zeroed: the value
 *  coordinate `k` takes, in the current aligned frame, at the point of the
 *  plane where every `constrained` coordinate is 0 and every other open one
 *  stays at the plane's centre. Solved from n·(x − c) = 0 with n and c as the
 *  rigid carries them. An untilted plane gives its centre's own coordinate, as
 *  before. Null when the plane hardly faces `k` (below the clocking angle), so
 *  the caller keeps its centroid. Reads the fit; never writes it. */
function planeCrossing(rigid: Rigid, plane: PlaneFit, k: number, constrained: ReadonlySet<number>): number | null {
  const p = new Float64Array(3), q = new Float64Array(3)
  rigidApply(rigid, plane.center[0], plane.center[1], plane.center[2], p)
  rigidRotate(rigid, plane.normal[0], plane.normal[1], plane.normal[2], q)
  const len = Math.hypot(q[0], q[1], q[2])
  // MIN_CLOCK_ANGLE is in degrees, as acuteAngle returns.
  if (!(Math.abs(q[k]) >= Math.sin((MIN_CLOCK_ANGLE * Math.PI) / 180) * len)) return null
  let s = 0
  for (const j of constrained) if (j !== k) s += q[j] * p[j]
  const v = p[k] + s / q[k]
  return Number.isFinite(v) ? v : null
}

/** Where a zero-point feature fixes the open coordinates. An axis (cylinder,
 *  cone, line) as the tertiary feature gives the point where it crosses the
 *  primary plane, as QUICKSURFACE does (basic_part, primary Plane/Top, tertiary
 *  Cylinder/X Axis: x = 0 where the axis meets z = 0). Its fitted centre lies at
 *  mid-length, and a slightly tilted axis put the part 0.06 mm off (0.0.150).
 *  Anything else, or an axis along the plane, uses its centre. */
function originAnchor(rigid: Rigid, origin: FitData, primary: DatumSpec): Vec3 {
  const dir = origin.kind === 'cylinder' || origin.kind === 'cone' ? origin.axis : origin.kind === 'line' ? origin.dir : null
  if (!dir || primary.fit.kind !== 'plane') return origin.center
  const k = axisIndex(primary.axis)
  const p = new Float64Array(3), q = new Float64Array(3)
  rigidApply(rigid, origin.center[0], origin.center[1], origin.center[2], p)
  rigidRotate(rigid, dir[0], dir[1], dir[2], q)
  if (!(Math.abs(q[k]) > 1e-6)) return origin.center
  const t = -p[k] / q[k]
  return [origin.center[0] + t * dir[0], origin.center[1] + t * dir[1], origin.center[2] + t * dir[2]]
}

/** How far either side of a levelling plane another face counts as near it,
 *  mm, and the half-width of the band a face's points are gathered in. */
const PARALLEL_REACH = 5
const PARALLEL_BAND = 0.3

/**
 * A face parallel to a levelling plane, a few millimetres off it, that holds
 * more of the scan than the plane itself — the plane may be a pad's floor or
 * a step, and the face the part stands on the other one.
 *
 * `points` are scan points facing the way the plane does (thinned evenly, so
 * their count stands for area). Those within PARALLEL_BAND of the plane are
 * its own; the densest band as wide as that, clear of it, is the other face. Returns that face's offset along the plane's normal (mm,
 * negative behind it) and how many times the plane's points it holds — or
 * null when no such face holds half as many again.
 */
export function parallelFaceNear(points: Float32Array, center: Vec3, normal: Vec3): { offset: number; times: number } | null {
  const n = normalize(normal)
  if (!n) return null
  const offsets: number[] = []
  let own = 0
  for (let i = 0; i + 2 < points.length; i += 3) {
    const d = (points[i] - center[0]) * n[0] + (points[i + 1] - center[1]) * n[1] + (points[i + 2] - center[2]) * n[2]
    if (Math.abs(d) <= PARALLEL_BAND) own++
    else if (Math.abs(d) >= 2 * PARALLEL_BAND && Math.abs(d) <= PARALLEL_REACH) offsets.push(d)
  }
  offsets.sort((a, b) => a - b)
  // The densest window two band-widths wide, by two pointers over the sorted offsets.
  let best = { count: 0, from: 0, to: 0 }
  for (let lo = 0, hi = 0; lo < offsets.length; lo++) {
    while (hi < offsets.length && offsets[hi] - offsets[lo] <= 2 * PARALLEL_BAND) hi++
    if (hi - lo > best.count) best = { count: hi - lo, from: lo, to: hi }
  }
  // A handful of points is no face, and one barely larger is no reason to doubt.
  if (own === 0 || best.count < 20 || best.count < 1.5 * own) return null
  let sum = 0
  for (let i = best.from; i < best.to; i++) sum += offsets[i]
  return { offset: sum / best.count, times: best.count / own }
}

/** The translation that puts the given point at 0, 0, 0 — an alignment made of
 *  nothing but a zero point, for the user who only wants to say where zero is. */
export function translationToOrigin(point: Vec3): Rigid {
  const m = identityRigid()
  m.t.set([-point[0], -point[1], -point[2]])
  return m
}

function setRotationAxisAngle(m: Rigid, axis: Vec3, angle: number): void {
  const n = normalize(axis)!
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  const [x, y, z] = n
  m.r.set([
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ])
}

/** The transform of the manual move / rotate box: turn the part about the
 *  global zero point — about X, then Y, then Z — then move it. */
export function manualRigid(move: Vec3, rotateDeg: Vec3): Rigid {
  const rot = (axis: Vec3, deg: number) => rigidFromAxisAngle(axis, (deg * Math.PI) / 180)
  const m = rigidCompose(
    rot([0, 0, 1], rotateDeg[2]),
    rigidCompose(rot([0, 1, 0], rotateDeg[1]), rot([1, 0, 0], rotateDeg[0])),
  )
  m.t.set(move)
  return m
}

/** How far a transform moves the part, for the preview readout. */
export function describeRigid(m: Rigid): { rotationDeg: number; translation: number } {
  return {
    rotationDeg: (rigidRotationAngle(m) * 180) / Math.PI,
    translation: Math.hypot(m.t[0], m.t[1], m.t[2]),
  }
}

const tmp = new Float64Array(3)

function movePoint(m: Rigid, p: Vec3): Vec3 {
  rigidApply(m, p[0], p[1], p[2], tmp)
  return [tmp[0], tmp[1], tmp[2]]
}

function moveDir(m: Rigid, d: Vec3): Vec3 {
  rigidRotate(m, d[0], d[1], d[2], tmp)
  return normalize([tmp[0], tmp[1], tmp[2]]) ?? [tmp[0], tmp[1], tmp[2]]
}

/** The same element geometry, carried through a rigid transform. Residual
 *  statistics are distances and survive a rigid motion unchanged. */
export function transformFit(fit: FitData, m: Rigid): FitData {
  switch (fit.kind) {
    case 'point':
    case 'sphere':
      return { ...fit, center: movePoint(m, fit.center) }
    case 'line':
      return { ...fit, center: movePoint(m, fit.center), dir: moveDir(m, fit.dir) }
    case 'cylinder':
    case 'cone':
    case 'torus':
      return { ...fit, center: movePoint(m, fit.center), axis: moveDir(m, fit.axis) }
    case 'circle':
      return { ...fit, center: movePoint(m, fit.center), normal: moveDir(m, fit.normal) }
    case 'plane':
      return {
        ...fit,
        center: movePoint(m, fit.center),
        normal: moveDir(m, fit.normal),
        ...(fit.datum ? { datum: { origin: movePoint(m, fit.datum.origin), u: moveDir(m, fit.datum.u), frontU: moveDir(m, fit.datum.frontU) } } : {}),
        basisU: moveDir(m, fit.basisU),
        basisV: moveDir(m, fit.basisV),
      }
  }
}
