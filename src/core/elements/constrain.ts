// SPDX-License-Identifier: AGPL-3.0-only
// Constraining a fitted primitive, as the Extract primitives dialog offers it:
// hold a plane's normal or a cylinder's / line's axis parallel or
// perpendicular to a coordinate plane (OXY, OYZ, OXZ), or — Auto Constrain —
// snap a new primitive to the ones already made when it lies within a tilt
// tolerance of parallel or perpendicular, and onto them when it lies within a
// coincidence tolerance. The primitive is measured again on the same marked
// points with the direction held, so its σ says how well the scan agrees with
// the constraint, not what it was before.

import type { CylinderFit, FitData, LineFit, PlaneFit, Vec3 } from '../types'
import { add, dot, len, normalize, scale, sub } from '../vec'
import { patchExtents } from '../fit/fitPlaneFromSeed'
import { fitCircle2d } from '../fit/circle2d'
import { orthoBasis } from '../fit/linalg'

export type ConstraintId =
  | 'none' | 'parallel-oxy' | 'parallel-oyz' | 'parallel-oxz' | 'perpendicular-oxy' | 'perpendicular-oyz' | 'perpendicular-oxz'
  /** Held to a primitive already made, by its element id — as QUICKSURFACE
   *  lists "Parallel to Plane(1)" and "Perpendicular to Cylinder(1)". */
  | `${'parallel' | 'perpendicular'}-el${number}`

/** A primitive already made that a new one may be held to. */
export interface ConstraintRef { id: number; name: string; fit: FitData }

/** Step 2's whole list: the coordinate planes, then each primitive already
 *  made — a plane both ways, an axis (cylinder, cone, line) perpendicular. */
export function constraintOptions(refs: readonly ConstraintRef[]): { id: ConstraintId; label: string }[] {
  const out = [...CONSTRAINTS]
  for (const r of refs) {
    if (!directionOf(r.fit)) continue
    out.push({ id: `perpendicular-el${r.id}`, label: `Perpendicular to ${r.name}` })
    if (r.fit.kind === 'plane') out.push({ id: `parallel-el${r.id}`, label: `Parallel to ${r.name}` })
  }
  return out
}

/** The words for a constraint, for the status line. */
export function constraintLabel(id: ConstraintId, refs: readonly ConstraintRef[]): string {
  return constraintOptions(refs).find((c) => c.id === id)?.label ?? 'Not constrained'
}

export const CONSTRAINTS: { id: ConstraintId; label: string }[] = [
  { id: 'none', label: 'Not constrained' },
  { id: 'parallel-oxy', label: 'Parallel to (OXY)' },
  { id: 'parallel-oyz', label: 'Parallel to (OYZ)' },
  { id: 'parallel-oxz', label: 'Parallel to (OXZ)' },
  { id: 'perpendicular-oxy', label: 'Perpendicular to (OXY)' },
  { id: 'perpendicular-oyz', label: 'Perpendicular to (OYZ)' },
  { id: 'perpendicular-oxz', label: 'Perpendicular to (OXZ)' },
]

/** The normal of each coordinate plane. */
const DATUM_NORMAL: Record<'oxy' | 'oyz' | 'oxz', Vec3> = { oxy: [0, 0, 1], oyz: [1, 0, 0], oxz: [0, 1, 0] }

export interface ConstraintTolerances {
  tiltDeg: number
  coincidenceMm: number
}
export const DEFAULT_TOLERANCES: ConstraintTolerances = { tiltDeg: 0.5, coincidenceMm: 1 }

/** The direction a primitive is held by — a plane's normal, an axis — or null
 *  for one with none (a sphere, a point) or whose constraint is not built (a cone). */
export function directionOf(fit: FitData): Vec3 | null {
  if (fit.kind === 'plane') return fit.normal
  if (fit.kind === 'cylinder' || fit.kind === 'cone') return fit.axis
  if (fit.kind === 'line') return fit.dir
  return null
}
/** Kinds a constraint can be applied to: a cone's half-angle would have to be
 *  fitted again with its axis held, which is not built. */
export const canConstrain = (fit: FitData): boolean => fit.kind === 'plane' || fit.kind === 'cylinder' || fit.kind === 'line'

const unit = (v: Vec3): Vec3 | null => {
  const n = normalize(v)
  return n && Number.isFinite(n[0]) ? n : null
}
const alike = (v: Vec3, like: Vec3): Vec3 => (dot(v, like) < 0 ? scale(v, -1) : v)
const angleDeg = (a: Vec3, b: Vec3): number => (Math.acos(Math.min(1, Math.abs(dot(a, b)))) * 180) / Math.PI
/** Degrees off a right angle between two directions. */
const offRightDeg = (a: Vec3, b: Vec3): number => (Math.asin(Math.min(1, Math.abs(dot(a, b)))) * 180) / Math.PI

/** The direction the constraint asks for, nearest to `current`; null when
 *  `current` leaves it undetermined (a normal along the datum's own normal
 *  cannot be made perpendicular to it) or the fit has no direction. */
export function constrainedDirection(fit: FitData, constraint: ConstraintId, refs: readonly ConstraintRef[] = []): Vec3 | null {
  const current = directionOf(fit)
  if (!current || !canConstrain(fit) || constraint === 'none') return null
  const [mode, target] = constraint.split('-') as ['parallel' | 'perpendicular', string]
  let N: Vec3 | null
  let refIsPlane = true
  if (target.startsWith('el')) {
    const ref = refs.find((r) => r.id === Number(target.slice(2)))
    N = ref ? directionOf(ref.fit) : null
    refIsPlane = ref?.fit.kind === 'plane'
  } else N = DATUM_NORMAL[target as 'oxy' | 'oyz' | 'oxz']
  if (!N) return null
  // Directions compared: a plane's normal, an axis. Plane to plane (or axis to
  // axis), parallel means the same direction; plane to axis, perpendicular does.
  const along = (fit.kind === 'plane') === refIsPlane ? mode === 'parallel' : mode === 'perpendicular'
  if (along) return alike(N, current)
  return unit(sub(current, scale(N, dot(current, N))))
}

const centroid = (pos: Float32Array, idx: ArrayLike<number>): Vec3 => {
  let x = 0, y = 0, z = 0
  for (let i = 0; i < idx.length; i++) { const j = idx[i] * 3; x += pos[j]; y += pos[j + 1]; z += pos[j + 2] }
  const n = Math.max(1, idx.length)
  return [x / n, y / n, z / n]
}
const point = (pos: Float32Array, i: number): Vec3 => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]

/** The residual figures of a fit, from its signed residuals. */
function figures(res: number[]): { sigma: number; formError: number; residualMin: number; residualMax: number } {
  let s = 0, lo = Infinity, hi = -Infinity
  for (const e of res) { s += e * e; if (e < lo) lo = e; if (e > hi) hi = e }
  return { sigma: Math.sqrt(s / Math.max(1, res.length)), formError: hi - lo, residualMin: lo, residualMax: hi }
}

/** A plane with its normal held to `n`, measured again on the points: through
 *  their mean, or at `offset` (n · x) when that is held too. */
function planeWith(fit: PlaneFit, pos: Float32Array, idx: ArrayLike<number>, n: Vec3, offset?: number): PlaneFit | null {
  const c = centroid(pos, idx)
  const d = offset ?? dot(n, c)
  const ext=patchExtents(pos,idx,{nx:n[0],ny:n[1],nz:n[2],d})
  if(!ext)return null
  const res=Array.from(idx,i=>dot(n,point(pos,i))-d)
  return {...fit,...figures(res),...ext,normal:n}
}

/** A cylinder with its axis held to `a`: the circle the points make seen down
 *  the axis, fitted again (algebraic least squares) — or about `through`, an
 *  axis point held too, with only the radius free. */
function cylinderWith(fit: CylinderFit, pos: Float32Array, idx: ArrayLike<number>, a: Vec3, through?: Vec3): CylinderFit | null {
  const [bu, bv] = orthoBasis(a)
  const n = idx.length
  if (n < 3) return null
  let cu: number, cv: number
  if (through) {
    cu = dot(bu, through)
    cv = dot(bv, through)
  } else {
    const x=new Float64Array(n), y=new Float64Array(n)
    for(let i=0;i<n;i++){const p=point(pos,idx[i]);x[i]=dot(bu,p);y[i]=dot(bv,p)}
    const circle=fitCircle2d(x,y)
    if(!circle)return null
    cu=circle.cu;cv=circle.cv
  }
  let rsum = 0, lo = Infinity, hi = -Infinity
  const dists: number[] = []
  for (let i = 0; i < n; i++) {
    const p = point(pos, idx[i])
    const r = Math.hypot(dot(bu, p) - cu, dot(bv, p) - cv)
    dists.push(r)
    rsum += r
    const t = dot(a, p)
    if (t < lo) lo = t
    if (t > hi) hi = t
  }
  const radius = rsum / n
  const t = (lo + hi) / 2
  const center = add(add(scale(bu, cu), scale(bv, cv)), scale(a, t))
  return { ...fit, ...figures(dists.map((r) => r - radius)), center, axis: a, radius, length: hi - lo }
}

/** A line with its direction held to `d`, through the points' mean. */
function lineWith(fit: LineFit, pos: Float32Array, idx: ArrayLike<number>, d: Vec3): LineFit {
  const c = centroid(pos, idx)
  const res: number[] = []
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < idx.length; i++) {
    const q = sub(point(pos, idx[i]), c)
    const t = dot(d, q)
    if (t < lo) lo = t
    if (t > hi) hi = t
    res.push(len(sub(q, scale(d, t))))
  }
  return { ...fit, ...figures(res), center: add(c, scale(d, (lo + hi) / 2)), dir: d, length: hi - lo }
}

/** The fit with its direction held to `dir`, measured again on the points. */
export function withDirection(fit: FitData, pos: Float32Array, idx: ArrayLike<number>, dir: Vec3, hold?: { offset?: number; through?: Vec3 }): FitData | null {
  const d = unit(dir)
  if (!d || idx.length < 3) return null
  if (fit.kind === 'plane') return planeWith(fit, pos, idx, d, hold?.offset)
  if (fit.kind === 'cylinder') return cylinderWith(fit, pos, idx, d, hold?.through)
  if (fit.kind === 'line') return lineWith(fit, pos, idx, d)
  return null
}

/** Minimize squared orthogonal distances with a normal constrained to the
 * plane across ref. For isotropic scatter the initial orientation is as good. */
function bestNormalAcross(pos:Float32Array, idx:ArrayLike<number>, ref:Vec3, initial:Vec3):Vec3 {
 const [u,v]=orthoBasis(ref), c=centroid(pos,idx)
 let xx=0,xy=0,yy=0
 for(let i=0;i<idx.length;i++){const p=sub(point(pos,idx[i]),c),x=dot(p,u),y=dot(p,v);xx+=x*x;xy+=x*y;yy+=y*y}
 if(Math.hypot(xx-yy,2*xy)<=1e-12*(xx+yy))return initial
 const t=.5*Math.atan2(2*xy,xx-yy)
 return alike(add(scale(u,-Math.sin(t)),scale(v,Math.cos(t))),initial)
}
/** Step 2's dropdown: the fit held parallel or perpendicular to a coordinate
 *  plane, or null when it cannot be (no direction, or it lies along the
 *  datum's normal and perpendicular is then undetermined). */
export function constrainFit(fit: FitData, pos: Float32Array, idx: ArrayLike<number>, constraint: ConstraintId, refs: readonly ConstraintRef[] = []): FitData | null {
  const dir = constrainedDirection(fit, constraint, refs)
  if (!dir) return null
  const target=constraint.split('-')[1]
  const ref=target?.startsWith('el') ? refs.find(r=>r.id===Number(target.slice(2)))?.fit : undefined
  const axis=ref ? directionOf(ref) : DATUM_NORMAL[target as keyof typeof DATUM_NORMAL]
  return withDirection(fit,pos,idx,fit.kind==='plane' && axis && Math.abs(dot(axis,dir))<1e-8 ? bestNormalAcross(pos,idx,axis,dir) : dir)
}

export interface Neighbour { id?: number; name: string; fit: FitData }
export interface AutoChoice { id: ConstraintId; label: string }
interface AutoFit { fit: FitData; notes: string[]; choice?: AutoChoice }

/** Auto Constrain: the new fit snapped to the primitives already made. A
 *  direction within `tiltDeg` of parallel — or of perpendicular — to one of
 *  theirs is held to it (the nearest wins); a plane then within
 *  `coincidenceMm` of a parallel one's is moved onto it, and a cylinder whose
 *  axis then lies within it of a parallel one's onto that axis. `notes` say
 *  what was done, for the status line. */
export function autoConstrainFit(fit: FitData, pos: Float32Array, idx: ArrayLike<number>, others: readonly Neighbour[], tol: ConstraintTolerances = DEFAULT_TOLERANCES): AutoFit {
  const own = directionOf(fit)
  if (!own || !canConstrain(fit)) return { fit, notes: [] }
  let best: { dir: Vec3; off: number; how: 'parallel' | 'perpendicular'; to: Neighbour } | null = null
  for (const o of others) {
    const od = directionOf(o.fit)
    if (!od || o.fit.kind === 'cone') continue
    const par = angleDeg(own, od)
    if (par <= tol.tiltDeg && (!best || par < best.off)) best = { dir: alike(od, own), off: par, how: 'parallel', to: o }
    const perp = offRightDeg(own, od)
    if (perp <= tol.tiltDeg && (!best || perp < best.off)) {
      const flat = unit(sub(own, scale(od, dot(own, od))))
      if (flat) best = { dir: flat, off: perp, how: 'perpendicular', to: o }
    }
  }
  // A first plane can snap to OXY, OYZ or OXZ even when the history is empty.
  // The world plane supplies a direction. Fit the offset to the selected points.
  if (fit.kind === 'plane') {
    let closest = best?.off ?? Infinity
    let world: ConstraintId | undefined
    let hasParallelWorld = false
    for (const datum of ['oxy', 'oyz', 'oxz'] as const) {
      const angle = angleDeg(own, DATUM_NORMAL[datum]);
      if (angle <= tol.tiltDeg) hasParallelWorld = true
      if (angle <= tol.tiltDeg && angle < closest) {
        world = `parallel-${datum}`;
        closest = angle;
      }
    }
    // A parallel hold determines both tilt angles. When none is in
    // range, the plane may still stand perpendicular to a coordinate plane.
    // For indistinguishable directions, prefer the world reference.
    if (!hasParallelWorld && best?.how !== 'parallel') {
      for (const datum of ['oxy', 'oyz', 'oxz'] as const) {
        const angle = offRightDeg(own, DATUM_NORMAL[datum])
        const wins = angle < closest || (!world && Math.abs(angle - closest) < 1e-9)
        if (angle <= tol.tiltDeg && wins) {
          world = `perpendicular-${datum}`
          closest = angle
        }
      }
    }
    if (world) {
      const held = constrainFit(fit, pos, idx, world);
      if (held) {
        const label = constraintLabel(world, []);
        return { fit: held, notes: [label], choice: { id: world, label } };
      }
    }
  }
  if (!best) return { fit, notes: [] }
  const notes: string[] = [`${best.how} to ${best.to.name}${best.off > 0.005 ? ` (${best.off.toFixed(2)}° off)` : ''}`]
  if(fit.kind==="plane" && best.how==="perpendicular") best.dir=bestNormalAcross(pos,idx,directionOf(best.to.fit)!,best.dir)
  let out = withDirection(fit, pos, idx, best.dir)
  if (!out) return { fit, notes: [] }
  if (best.how === 'parallel') {
    if (out.kind === 'plane' && best.to.fit.kind === 'plane') {
      const gap = dot(out.normal, sub(out.center, best.to.fit.center))
      if (Math.abs(gap) <= tol.coincidenceMm) {
        const held = withDirection(fit, pos, idx, best.dir, { offset: dot(out.normal, best.to.fit.center) })
        if (held) { out = held; notes.push(`coincident with ${best.to.name}`) }
      }
    } else if (out.kind === 'cylinder' && best.to.fit.kind === 'cylinder') {
      const a = out.axis
      const apart = sub(out.center, best.to.fit.center)
      const across = len(sub(apart, scale(a, dot(a, apart))))
      if (across <= tol.coincidenceMm) {
        const held = withDirection(fit, pos, idx, best.dir, { through: best.to.fit.center })
        if (held) { out = held; notes.push(`on the axis of ${best.to.name}`) }
      }
    }
  }
  // For an axis and a plane, parallel *directions* mean that the axis is
  // perpendicular to the plane. The dropdown describes the actual entities.
  const mixed = (fit.kind === 'plane') !== (best.to.fit.kind === 'plane');
  const parallel = (best.how === 'parallel') !== mixed;
  const mode = parallel ? 'parallel' : 'perpendicular';
  const choice: AutoChoice | undefined = best.to.id === undefined ? undefined : {
    id: `${mode}-el${best.to.id}`, label: `${parallel ? 'Parallel' : 'Perpendicular'} to ${best.to.name}`,
  };
  return { fit: out, notes, choice }
}

/** Analysis: the indices (positions in `idx`) of marked points lying further
 *  than `toleranceMm` from the fit, with the worst distance. */
export function pointsBeyond(fit: FitData, pos: Float32Array, idx: ArrayLike<number>, toleranceMm: number): { far: number[]; worst: number } {
  const far: number[] = []
  let worst = 0
  for (let i = 0; i < idx.length; i++) {
    const p = point(pos, idx[i])
    const e = Math.abs(distanceTo(fit, p))
    if (!Number.isFinite(e)) continue
    if (e > worst) worst = e
    if (e > toleranceMm) far.push(i)
  }
  return { far, worst }
}

/** How far a point lies from the fit's surface. NaN for kinds with no surface here. */
function distanceTo(fit: FitData, p: Vec3): number {
  if (fit.kind === 'plane') return dot(fit.normal, sub(p, fit.center))
  if (fit.kind === 'sphere') return len(sub(p, fit.center)) - fit.radius
  if (fit.kind === 'cylinder') {
    const q = sub(p, fit.center)
    return len(sub(q, scale(fit.axis, dot(fit.axis, q)))) - fit.radius
  }
  if (fit.kind === 'cone') {
    const q = sub(p, fit.center)
    const t = dot(fit.axis, q)
    const rho = len(sub(q, scale(fit.axis, t)))
    const half = (fit.halfAngle * Math.PI) / 180
    // The radius at t along the axis, and the distance to the slanted wall.
    return (rho - (fit.radius + t * Math.tan(half))) * Math.cos(half)
  }
  if (fit.kind === 'line') {
    const q = sub(p, fit.center)
    return len(sub(q, scale(fit.dir, dot(fit.dir, q))))
  }
  return NaN
}

