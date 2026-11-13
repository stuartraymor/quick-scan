// SPDX-License-Identifier: AGPL-3.0-only
// Plane secondary and tertiary datums zero their coordinate where they cross
// the planes already at zero — the three-plane corner — not at the centroid
// of the painted patch. Native reference (QUICKSURFACE, owned QSF fixtures,
// mesh positions re-read after save, residual < 9e-6 mm):
//   primary   plane n=(0,0,1)            c=(10,20,5)              Top
//   secondary plane n=(0,cos3°,sin3°)    c=(10,7−20·tan3°,25)     Front
//     → R = I, t = (−10, −7, −5)   (legacy centroid code: t_y = −5.9518)
//   + tertiary plane n=(cos5°,0,sin5°)   c=(3−15·tan5°,8,20)
//     → R = I, t = (−3, −7, −5)    (legacy centroid code: t_x = −1.6877)
import { describe, expect, it } from 'vitest'
import { computeDatumAlignment, transformFit, type AxisDir } from '../src/core/alignment'
import { rigidFromAxisAngle, rigidRotationAngle, type Rigid } from '../src/core/deviation/rigid'
import { orthoBasis } from '../src/core/fit/linalg'
import { normalize } from '../src/core/vec'
import type { CylinderFit, LineFit, PlaneFit, PointFit, Vec3 } from '../src/core/types'

const NO_STATS = { sigma: 0, usedPoints: 0, regionSize: 0 }
const rad = (d: number) => (d * Math.PI) / 180

function planeFit(center: Vec3, normal: Vec3): PlaneFit {
  const n = normalize(normal)!
  const [u, v] = orthoBasis(n)
  return { kind: 'plane', center, normal: n, basisU: u, basisV: v, extentU: 5, extentV: 5, ...NO_STATS }
}

function cylinderFit(center: Vec3, axis: Vec3): CylinderFit {
  return { kind: 'cylinder', center, axis: normalize(axis)!, radius: 4, length: 20, coverage: 360, ...NO_STATS }
}

const at = (m: Rigid, p: Vec3): Vec3 =>
  [0, 1, 2].map((i) => m.r[i * 3] * p[0] + m.r[i * 3 + 1] * p[1] + m.r[i * 3 + 2] * p[2] + m.t[i]) as Vec3

const t3 = Math.tan(rad(3)), t5 = Math.tan(rad(5))
/** The scan's bounding-box centre in the native cylinder fixture, as passed to
 *  computeDatumAlignment as centerOf (alignCenterOf). */
const MESH_CENTER: Vec3 = [2.084373474, -0.742008209, -90.98783876]
const nativePrimary = () => planeFit([10, 20, 5], [0, 0, 1])
const nativeSecondary = () => planeFit([10, 7 - 20 * t3, 25], [0, Math.cos(rad(3)), Math.sin(rad(3))])
const nativeTertiary = () => planeFit([3 - 15 * t5, 8, 20], [Math.cos(rad(5)), 0, Math.sin(rad(5))])

describe('plane datums zero at their crossing (native QSF fixtures)', () => {
  it('a 3° secondary wall zeroes Y at the wall/floor line — native t = (−10, −7, −5)', () => {
    // The measured primary carries its datum (origin at its centre), as a
    // fitted plane does; X, which neither plane owns, is centred on that
    // origin — not on the scan's box centre passed as centerOf.
    const primary: PlaneFit = { ...nativePrimary(), datum: { origin: [10, 20, 5], u: [1, 0, 0], frontU: [1, 0, 0] } }
    const m = computeDatumAlignment({ fit: primary, axis: 'z+' }, { fit: nativeSecondary(), axis: 'y+' }, null, MESH_CENTER)
    expect(rigidRotationAngle(m)).toBeLessThan(1e-7)
    expect(m.t[0]).toBeCloseTo(-10, 9)
    expect(m.t[1]).toBeCloseTo(-7, 9) // baseline (centroid): −5.9518
    expect(m.t[2]).toBeCloseTo(-5, 9)
  })

  it('a 5° tertiary plane zeroes X at the three-plane corner — native t = (−3, −7, −5)', () => {
    for (const centerOf of [undefined, [123, -45, 6] as Vec3]) {
      const m = computeDatumAlignment({ fit: nativePrimary(), axis: 'z+' }, { fit: nativeSecondary(), axis: 'y+' }, nativeTertiary(), centerOf)
      expect(rigidRotationAngle(m)).toBeLessThan(1e-7)
      expect(m.t[0]).toBeCloseTo(-3, 9) // baseline (centroid): −1.6877
      expect(m.t[1]).toBeCloseTo(-7, 9)
      expect(m.t[2]).toBeCloseTo(-5, 9)
    }
  })

  it('gives the same pose when the whole part arrives turned and moved', () => {
    const M = rigidFromAxisAngle(normalize([0.3, -0.7, 0.5])!, 1.1)
    M.t.set([37, -12, 64])
    const ref = computeDatumAlignment({ fit: nativePrimary(), axis: 'z+' }, { fit: nativeSecondary(), axis: 'y+' }, nativeTertiary())
    const moved = computeDatumAlignment(
      { fit: transformFit(nativePrimary(), M), axis: 'z+' },
      { fit: transformFit(nativeSecondary(), M), axis: 'y+' },
      transformFit(nativeTertiary(), M),
    )
    for (const p of [[3, 7, 5], [0, 0, 0], [50, -20, 33]] as Vec3[]) {
      const a = at(ref, p), b = at(moved, at(M, p))
      for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(a[i], 8)
    }
    at(moved, at(M, [3, 7, 5])).forEach((x) => expect(x).toBeCloseTo(0, 8))
  })

  // Three tilted faces meeting at a known corner, their patches painted far
  // from it. Whatever axes they are sent to — swapped, negative — the corner
  // lands on the origin.
  const corner: Vec3 = [4, -6, 9]
  const faces = ([n, a, b]: [Vec3, number, number]): PlaneFit => {
    const nn = normalize(n)!
    const [u, v] = orthoBasis(nn)
    return planeFit([0, 1, 2].map((i) => corner[i] + a * u[i] + b * v[i]) as Vec3, nn)
  }
  const n1: [Vec3, number, number] = [[0.05, -0.03, 1], 25, -18]
  const n2: [Vec3, number, number] = [[0.02, 1, 0.06], -22, 30]
  const n3: [Vec3, number, number] = [[1, 0.04, 0.09], 28, 24]
  it.each([
    ['z+', 'y+'],
    ['z-', 'x+'],
    ['x+', 'z-'],
    ['y-', 'x-'],
    ['z+', 'y-'],
  ] as [AxisDir, AxisDir][])('primary %s, secondary %s: the corner lands on the origin', (a1, a2) => {
    const m = computeDatumAlignment({ fit: faces(n1), axis: a1 }, { fit: faces(n2), axis: a2 }, faces(n3))
    at(m, corner).forEach((x) => expect(x).toBeCloseTo(0, 8))
    // The primary still wins exactly.
    const moved = transformFit(faces(n1), m) as PlaneFit
    const k = a1[0] === 'x' ? 0 : a1[0] === 'y' ? 1 : 2
    expect(moved.normal[k]).toBeCloseTo(a1[1] === '+' ? 1 : -1, 9)
  })
})

describe('invariants: what keeps its legacy anchor', () => {
  it('square faces give exactly the centroid result as before', () => {
    const m = computeDatumAlignment(
      { fit: planeFit([1, 2, 3], [0, 0, 1]), axis: 'z+' },
      { fit: planeFit([40, 5, 60], [0, 1, 0]), axis: 'y+' },
      planeFit([7, 80, 90], [1, 0, 0]),
    )
    expect(rigidRotationAngle(m)).toBeLessThan(1e-7)
    ;[-7, -5, -3].forEach((x, i) => expect(m.t[i]).toBeCloseTo(x, 12))
  })

  // Native mixed case (QSF physical-click comparison): Plane(1) Top as P1;
  // Cylinder(2) axis (cos5°,0,sin5°), base (10+10cos5°,20,5+10sin5°), length
  // 20, to X; tertiary Plane(3) as P2 → R = I, t = (−3, −20, −5).
  // Old code (tertiary centroid): t_x = −(3 − 15·tan5°) = −1.6877.
  it('a tilted cylinder secondary, then a tilted tertiary plane: native t = (−3, −20, −5)', () => {
    const c5 = Math.cos(rad(5)), s5 = Math.sin(rad(5))
    const cyl = { ...cylinderFit([10 + 20 * c5, 20, 5 + 20 * s5], [c5, 0, s5]), length: 20 }
    for (const centerOf of [undefined, MESH_CENTER]) {
      const m = computeDatumAlignment({ fit: nativePrimary(), axis: 'z+' }, { fit: cyl, axis: 'x+' }, nativeTertiary(), centerOf)
      expect(rigidRotationAngle(m)).toBeLessThan(1e-7)
      expect(m.t[0]).toBeCloseTo(-3, 9)
      expect(m.t[1]).toBeCloseTo(-20, 9)
      expect(m.t[2]).toBeCloseTo(-5, 9)
    }
  })

  it('a tertiary plane with only a primary (two coordinates open) keeps its centroid', () => {
    const tert = nativeTertiary()
    const m = computeDatumAlignment({ fit: nativePrimary(), axis: 'z+' }, null, tert)
    const c = at(m, tert.center)
    expect(c[0]).toBeCloseTo(0, 9)
    expect(c[1]).toBeCloseTo(0, 9)
  })

  it('a tertiary plane that hardly faces the open axis keeps only the primary plane’s zero', () => {
    // |n_x| ≈ 0.002, below QUICKSURFACE's crossing cut-off (0.01): it cannot
    // fix x, and QUICKSURFACE then keeps only the primary's own zero — the
    // part is otherwise only turned (align sweep 3, 2026-11-12: b17, h1, h4,
    // h5, h6).
    const tert = planeFit([17, 3, 40], [0.002, 0, 1])
    const m = computeDatumAlignment({ fit: nativePrimary(), axis: 'z+' }, { fit: planeFit([0, 7, 5], [0, 1, 0]), axis: 'y+' }, tert)
    expect(m.t[0]).toBeCloseTo(0, 9)
    expect(m.t[1]).toBeCloseTo(0, 9)
    expect(at(m, nativePrimary().center)[2]).toBeCloseTo(0, 9)
  })

  it('reads the fits and never writes them', () => {
    const fits = [nativePrimary(), nativeSecondary(), nativeTertiary()]
    const before = JSON.stringify(fits)
    computeDatumAlignment({ fit: fits[0], axis: 'z+' }, { fit: fits[1], axis: 'y+' }, fits[2], [1, 2, 3])
    expect(JSON.stringify(fits)).toBe(before)
  })
})

// Native reference (QUICKSURFACE, owned QSF, residual < 9e-6 mm): Cylinder(1)
// axis Z, radius 5, base (10,20,−10), length 40 → centre (10,20,10); primary
// Z Axis alone → R = I, t = (−10, −20, −10). Old code with the scan's box
// centre MESH_CENTER as centerOf: t = (−10, −20, +90.98783876).
// With a secondary plane Z at (10,20,5): native t = (−10, −20, −5).
describe('a primary cylinder centres what is still open on its own centre (native QSF fixture)', () => {
  const cyl = () => ({ ...cylinderFit([10, 20, 10], [0, 0, 1]), radius: 5, length: 40 })

  it('primary Z Axis alone: t = (−10, −20, −10), not the box centre', () => {
    const m = computeDatumAlignment({ fit: cyl(), axis: 'z+' }, null, null, MESH_CENTER)
    expect(rigidRotationAngle(m)).toBeLessThan(1e-7)
    expect(m.t[0]).toBeCloseTo(-10, 9)
    expect(m.t[1]).toBeCloseTo(-20, 9)
    expect(m.t[2]).toBeCloseTo(-10, 9) // baseline: +90.98783876
  })

  it('a cap plane as secondary keeps precedence: t = (−10, −20, −5)', () => {
    const m = computeDatumAlignment({ fit: cyl(), axis: 'z+' }, { fit: planeFit([10, 20, 5], [0, 0, 1]), axis: 'z+' }, null, MESH_CENTER)
    expect(m.t[0]).toBeCloseTo(-10, 9)
    expect(m.t[1]).toBeCloseTo(-20, 9)
    expect(m.t[2]).toBeCloseTo(-5, 9)
  })

  it('an explicit zero point keeps priority over the cylinder centre', () => {
    const o: PointFit = { kind: 'point', center: [3, 4, 50], ...NO_STATS }
    const m = computeDatumAlignment({ fit: cyl(), axis: 'z+' }, null, o, MESH_CENTER)
    expect(at(m, o.center)[2]).toBeCloseTo(0, 9)
    expect(at(m, [10, 20, 10])[2]).toBeCloseTo(-40, 9)
  })

  it.each(['x-', 'y+', 'z-'] as AxisDir[])('a tilted cylinder sent to %s lands its centre on the origin', (axis) => {
    const c = cylinderFit([5, -6, 37], [0.3, -0.5, 0.81])
    const m = computeDatumAlignment({ fit: c, axis }, null, null, MESH_CENTER)
    at(m, c.center).forEach((x) => expect(x).toBeCloseTo(0, 8))
    const moved = transformFit(c, m) as CylinderFit
    const k = axis[0] === 'x' ? 0 : axis[0] === 'y' ? 1 : 2
    expect(moved.axis[k]).toBeCloseTo(axis[1] === '+' ? 1 : -1, 9)
  })

  it('without centerOf the open coordinate keeps its place, as before', () => {
    const m = computeDatumAlignment({ fit: cyl(), axis: 'z+' }, null, null)
    expect(m.t[2]).toBeCloseTo(0, 9)
  })

  it('a line primary still centres on the box centre, as before', () => {
    const line: LineFit = { kind: 'line', center: [10, 20, 10], dir: [0, 0, 1], length: 40, ...NO_STATS }
    const m = computeDatumAlignment({ fit: line, axis: 'z+' }, null, null, MESH_CENTER)
    expect(m.t[2]).toBeCloseTo(-MESH_CENTER[2], 9)
  })

  it('reads the cylinder and never writes it', () => {
    const c = cyl()
    const before = JSON.stringify(c)
    computeDatumAlignment({ fit: c, axis: 'z+' }, null, null, MESH_CENTER)
    expect(JSON.stringify(c)).toBe(before)
  })
})
