// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import {
  AlignmentError,
  computeDatumAlignment,
  describeRigid,
  fitFromAlignPicks,
  manualRigid,
  transformFit,
} from '../src/core/alignment'
import { alignmentPreview, type AlignDraft } from '../src/state/store'
import { rigidCompose, rigidInvert, rigidRotationAngle } from '../src/core/deviation/rigid'
import { orthoBasis } from '../src/core/fit/linalg'
import { planeDatum } from '../src/core/fit/fitPlaneFromSeed'
import { cross, normalize } from '../src/core/vec'
import type { CylinderFit, PlaneFit, PointFit, SphereFit, Vec3 } from '../src/core/types'

const NO_STATS = { sigma: 0, usedPoints: 0, regionSize: 0 }

function planeFit(center: Vec3, normal: Vec3): PlaneFit {
  const n = normalize(normal)!
  const [u, v] = orthoBasis(n)
  return { kind: 'plane', center, normal: n, basisU: u, basisV: v, extentU: 5, extentV: 5, ...NO_STATS }
}

function cylinderFit(center: Vec3, axis: Vec3, radius = 4): CylinderFit {
  return { kind: 'cylinder', center, axis: normalize(axis)!, radius, length: 20, coverage: 360, ...NO_STATS }
}

function pointFit(center: Vec3): PointFit {
  return { kind: 'point', center, ...NO_STATS }
}

function sphereFit(center: Vec3, radius = 3): SphereFit {
  return { kind: 'sphere', center, radius, ...NO_STATS }
}

// Deliberately off-axis datums, so an axis-aligned bug cannot pass by accident.
const TILTED: Vec3 = [0.3, -0.5, 0.81]
const SKEWED: Vec3 = [0.9, 0.35, 0.1]

describe('computeDatumAlignment', () => {
  it('levels a plane onto +Z and zeroes its coordinate', () => {
    const p = planeFit([12, -3, 7], TILTED)
    const m = computeDatumAlignment({ fit: p, axis: 'z+' }, null, null)
    const moved = transformFit(p, m) as PlaneFit
    expect(moved.normal[0]).toBeCloseTo(0, 9)
    expect(moved.normal[1]).toBeCloseTo(0, 9)
    expect(moved.normal[2]).toBeCloseTo(1, 9)
    expect(moved.center[2]).toBeCloseTo(0, 9)
  })

  it('respects the sign of the chosen axis', () => {
    const p = planeFit([1, 2, 3], TILTED)
    const m = computeDatumAlignment({ fit: p, axis: 'y-' }, null, null)
    const moved = transformFit(p, m) as PlaneFit
    expect(moved.normal[1]).toBeCloseTo(-1, 9)
    expect(moved.center[1]).toBeCloseTo(0, 9)
  })

  it.each(['z+', 'x+', 'y+'] as const)('keeps a fitted patch origin and heading when aligning it to %s', axis => {
    const p = planeFit([30, -40, 50], TILTED)
    const n = p.normal
    const u = normalize(cross([0, 1, 0], n))!, v = cross(n, u)
    // An asymmetric distribution, with all extremes represented. Neither
    // the sample mean nor the scan centre is the patch-bounds centre.
    const uv = [[-6,-4], [10,-4], [-6,8], [-5,-3], [-5,-3]]
    const pos = Float32Array.from(uv.flatMap(([x,y]) => p.center.map((a,i) => a+x*u[i]+y*v[i])))
    p.datum = planeDatum(pos, [0,1,2,3,4], n, p.center)!
    // The patch is boxed along the axis least along the normal, as QUICKSURFACE
    // places a plane's point: here X (0.3 against Y's 0.5).
    const nn = normalize(n)!, fu = normalize([1-nn[0]*nn[0], -nn[0]*nn[1], -nn[0]*nn[2]])!, fv = cross(nn, fu)
    const along = (w: number[]) => { const k = [0,1,2,3,4].map(j => [0,1,2].reduce((t,c) => t+(pos[3*j+c]-p.center[c])*w[c], 0)); return (Math.min(...k)+Math.max(...k))/2 }
    const origin = p.center.map((a,i) => a+along(fu)*fu[i]+along(fv)*fv[i])
    p.datum.origin.forEach((x,i) => expect(x).toBeCloseTo(origin[i],4))
    const m = computeDatumAlignment({fit:p,axis},null,null,[100,200,-50])
    const moved = transformFit(p,m) as PlaneFit
    moved.datum!.origin.forEach(x=>expect(x).toBeCloseTo(0,7))
    const i = axis === 'x+' ? 0 : axis === 'y+' ? 1 : 2
    expect(moved.normal[i]).toBeCloseTo(1,8)
    // QUICKSURFACE keeps the old axis least along the normal, leaving out the
    // one the plane lands on, where it was (align sweep 2026-11-11, planes
    // tilted about two axes): here X for z+ and y+ (0.3), Y for x+ (0.5
    // against Z's 0.81). It stays in the plane square to the other one.
    const keep = axis === 'x+' ? 1 : 0, other = 3 - i - keep
    const old = [0, 0, 0]; old[keep] = 1
    const turned = transformFit(pointFit(old as Vec3), m) as PointFit, zero = transformFit(pointFit([0, 0, 0]), m) as PointFit
    const kept = turned.center.map((x, j) => x - zero.center[j])
    expect(kept[other]).toBeCloseTo(0, 8)
    expect(kept[keep]).toBeGreaterThan(0)
    const again = computeDatumAlignment({fit:moved,axis},null,null)
    expect(rigidRotationAngle(again)).toBeCloseTo(0,6)
    expect(Math.hypot(...again.t)).toBeCloseTo(0,7)
  })

  it('produces a finite frame when the plane is parallel to the heading reference', () => {
    const d = planeDatum(Float32Array.from([1,10,2, 3,10,4, 5,10,2]), [0,1,2], [0,1,0], [0,10,0])
    expect(d?.u).toEqual([1,0,0])
    expect(d?.origin).toEqual([3,10,3])
  })

  it('puts a primary cylinder onto the global axis line', () => {
    const c = cylinderFit([5, 6, 7], SKEWED)
    const m = computeDatumAlignment({ fit: c, axis: 'z+' }, null, null)
    const moved = transformFit(c, m) as CylinderFit
    expect(moved.axis[2]).toBeCloseTo(1, 9)
    expect(moved.center[0]).toBeCloseTo(0, 9)
    expect(moved.center[1]).toBeCloseTo(0, 9)
    expect(moved.radius).toBe(c.radius)
    expect(moved.length).toBe(c.length)
  })

  it('clocks the rotation with a secondary datum', () => {
    const p = planeFit([0, 0, 10], TILTED)
    const c = cylinderFit([20, 5, 12], SKEWED)
    const m = computeDatumAlignment({ fit: p, axis: 'z+' }, { fit: c, axis: 'x+' }, null)
    const movedPlane = transformFit(p, m) as PlaneFit
    const movedCyl = transformFit(c, m) as CylinderFit
    // The primary still wins exactly…
    expect(movedPlane.normal[2]).toBeCloseTo(1, 9)
    expect(movedPlane.center[2]).toBeCloseTo(0, 9)
    // …and the secondary's projected direction lands in the XZ plane, X first.
    expect(movedCyl.axis[1]).toBeCloseTo(0, 9)
    expect(movedCyl.axis[0]).toBeGreaterThan(0)
    // The secondary axis owns the Y zero the plane left open.
    expect(movedCyl.center[1]).toBeCloseTo(0, 9)
  })

  it('sets the origin from a point for every coordinate the datums left open', () => {
    const p = planeFit([0, 0, 10], TILTED)
    const o = sphereFit([25, -8, 11])
    const m = computeDatumAlignment({ fit: p, axis: 'z+' }, null, o)
    const movedO = transformFit(o, m) as SphereFit
    const movedP = transformFit(p, m) as PlaneFit
    // The plane keeps Z; the sphere centre zeroes X and Y.
    expect(movedP.center[2]).toBeCloseTo(0, 9)
    expect(movedO.center[0]).toBeCloseTo(0, 9)
    expect(movedO.center[1]).toBeCloseTo(0, 9)
  })

  it('a lone origin point moves to the exact origin', () => {
    const c = cylinderFit([5, 6, 7], SKEWED)
    const o = pointFit([9, 9, 9])
    const m = computeDatumAlignment({ fit: c, axis: 'x+' }, null, o)
    const moved = transformFit(o, m) as PointFit
    // Cylinder → X axis owns Y and Z; the point sets the remaining X.
    expect(moved.center[0]).toBeCloseTo(0, 9)
  })

  it('is rigid: distances and angles survive', () => {
    const p = planeFit([12, -3, 7], TILTED)
    const a = pointFit([1, 2, 3])
    const b = pointFit([-4, 6, 2])
    const m = computeDatumAlignment({ fit: p, axis: 'z+' }, null, null)
    const ma = transformFit(a, m) as PointFit
    const mb = transformFit(b, m) as PointFit
    const before = Math.hypot(...([0, 1, 2].map((i) => a.center[i] - b.center[i]) as Vec3))
    const after = Math.hypot(...([0, 1, 2].map((i) => ma.center[i] - mb.center[i]) as Vec3))
    expect(after).toBeCloseTo(before, 9)
  })

  it('refuses parallel datum directions', () => {
    const p = planeFit([0, 0, 0], TILTED)
    const c = cylinderFit([5, 5, 5], TILTED)
    expect(() =>
      computeDatumAlignment({ fit: p, axis: 'z+' }, { fit: c, axis: 'x+' }, null),
    ).toThrow(AlignmentError)
  })

  it('ignores a secondary datum left on the primary’s own axis, as QUICKSURFACE does', () => {
    const p = planeFit([0, 0, 0], TILTED)
    const c = cylinderFit([5, 5, 5], SKEWED)
    const alone = computeDatumAlignment({ fit: p, axis: 'z+' }, null, null)
    const ignored = computeDatumAlignment({ fit: p, axis: 'z+' }, { fit: c, axis: 'z-' }, null)
    expect(Array.from(ignored.r)).toEqual(Array.from(alone.r))
    expect(Array.from(ignored.t)).toEqual(Array.from(alone.t))
  })

  it('handles an antiparallel primary (180° flip)', () => {
    const p = planeFit([0, 0, 5], [0, 0, -1])
    const m = computeDatumAlignment({ fit: p, axis: 'z+' }, null, null)
    const moved = transformFit(p, m) as PlaneFit
    expect(moved.normal[2]).toBeCloseTo(1, 9)
    expect(describeRigid(m).rotationDeg).toBeCloseTo(180, 6)
  })

  it('accepts picked points in any slot — full mix and match', () => {
    // Three points spanning the XY plane at z = 4, tilted slightly.
    const primary = fitFromAlignPicks('primary', [[0, 0, 4], [10, 0, 5], [0, 10, 4.5]], 100)!
    const secondary = fitFromAlignPicks('secondary', [[0, 0, 4], [10, 2, 5]], 100)!
    const origin = fitFromAlignPicks('origin', [[3, 3, 4]], 100)!
    expect(primary.kind).toBe('plane')
    expect(secondary.kind).toBe('line')
    expect(origin.kind).toBe('point')

    const m = computeDatumAlignment(
      { fit: primary, axis: 'z+' },
      { fit: secondary, axis: 'x+' },
      origin,
    )
    const movedPlane = transformFit(primary, m)
    const movedOrigin = transformFit(origin, m)
    expect(movedPlane.kind === 'plane' && Math.abs(movedPlane.normal[2])).toBeCloseTo(1, 9)
    expect(movedPlane.center[2]).toBeCloseTo(0, 9)
    // Plane owns Z, secondary line owns what it can, the point the rest.
    expect(Math.abs(movedOrigin.center[0])).toBeLessThan(1e-9)
  })

  it('orients the picked plane the way the scanned surface faces', () => {
    const picks: Vec3[] = [[0, 0, 4], [10, 0, 5], [0, 10, 4.5]]
    // Whatever the click order produced, the reported normal agrees with the
    // surface normals at the picks — here all pointing broadly down.
    const down: Vec3[] = [[0.1, 0, -1], [0, 0.1, -1], [0, 0, -1]]
    for (const order of [picks, [picks[2], picks[1], picks[0]]]) {
      const fit = fitFromAlignPicks('primary', order, 100, down)!
      expect(fit.kind === 'plane' && fit.normal[2]).toBeLessThan(0)
    }
    // …and with normals pointing up, it flips with them.
    const up = fitFromAlignPicks('primary', picks, 100, [[0, 0, 1], [0, 0, 1], [0, 0, 1]])!
    expect(up.kind === 'plane' && up.normal[2]).toBeGreaterThan(0)
  })

  it('centres the open coordinates on a plane’s own point, not on centerOf', () => {
    // A plane with no fitted patch (constructed, or opened from a
    // QUICKSURFACE project) is centred on its own point, as QUICKSURFACE
    // centres on a plane's stored point (align sweep 2026-11-11).
    const p = planeFit([12, -3, 7], TILTED)
    const m = computeDatumAlignment({ fit: p, axis: 'z+' }, null, null, [10, 20, 30])
    const movedPlane = transformFit(p, m) as PlaneFit
    movedPlane.center.forEach((x) => expect(x).toBeCloseTo(0, 9))
  })

  it('an origin point given, centerOf has nothing left to centre', () => {
    const p = planeFit([0, 0, 10], TILTED)
    const o = pointFit([25, -8, 11])
    const withCenter = computeDatumAlignment({ fit: p, axis: 'z+' }, null, o, [1, 2, 3])
    const moved = transformFit(o, withCenter) as PointFit
    expect(moved.center[0]).toBeCloseTo(0, 9)
    expect(moved.center[1]).toBeCloseTo(0, 9)
  })

  it('a zero point alone previews as a plain move onto the origin', () => {
    const draft: AlignDraft = {
      primary: null,
      primaryPicks: [],
      primaryPickNormals: [],
      primaryAxis: 'z-',
      secondary: null,
      secondaryPicks: [],
      secondaryAxis: 'x+',
      origin: null,
      originPicks: [[7, -3, 2]],
      pickSlot: null,
    }
    const shown = alignmentPreview(draft, [], 100)
    expect(shown.error).toBeNull()
    expect(shown.preview!.rotationDeg).toBeCloseTo(0, 12)
    const moved = transformFit(pointFit([7, -3, 2]), shown.preview!.rigid)
    expect(Math.hypot(...moved.center)).toBeLessThan(1e-12)
  })

  it('picked points return null while incomplete and reject degenerate sets', () => {
    expect(fitFromAlignPicks('primary', [[0, 0, 0], [1, 0, 0]], 100)).toBeNull()
    expect(fitFromAlignPicks('origin', [], 100)).toBeNull()
    expect(() => fitFromAlignPicks('primary', [[0, 0, 0], [1, 1, 1], [2, 2, 2]], 100)).toThrow(
      AlignmentError,
    )
    expect(() => fitFromAlignPicks('secondary', [[1, 1, 1], [1, 1, 1]], 100)).toThrow(
      AlignmentError,
    )
  })

  it('manual move / rotate: turns about the origin X→Y→Z, then moves', () => {
    // Pure move.
    const moved = transformFit(pointFit([1, 2, 3]), manualRigid([10, -5, 2], [0, 0, 0]))
    expect(moved.center[0]).toBeCloseTo(11, 12)
    expect(moved.center[1]).toBeCloseTo(-3, 12)
    expect(moved.center[2]).toBeCloseTo(5, 12)

    // 90° about Z carries +X onto +Y (right-handed).
    const turned = transformFit(pointFit([1, 0, 0]), manualRigid([0, 0, 0], [0, 0, 90]))
    expect(turned.center[0]).toBeCloseTo(0, 12)
    expect(turned.center[1]).toBeCloseTo(1, 12)

    // Order: X first, then Z. (0,1,0) → Rx90 → (0,0,1), unchanged by Rz.
    const both = transformFit(pointFit([0, 1, 0]), manualRigid([0, 0, 0], [90, 0, 90]))
    expect(both.center[2]).toBeCloseTo(1, 12)
    expect(Math.hypot(both.center[0], both.center[1])).toBeLessThan(1e-12)

    const zero = manualRigid([0, 0, 0], [0, 0, 0])
    expect(describeRigid(zero).rotationDeg).toBeCloseTo(0, 12)
    expect(describeRigid(zero).translation).toBeCloseTo(0, 12)
  })

  it('previews live from picked points, and follows the axis they point along', () => {
    // A tilted triangle of points, the way three clicks on a face arrive.
    const draft: AlignDraft = {
      primary: null,
      primaryPicks: [[0, 0, 4], [10, 0, 5], [0, 10, 4.5]],
      primaryPickNormals: [],
      primaryAxis: 'z+',
      secondary: null,
      secondaryPicks: [],
      secondaryAxis: 'x+',
      origin: null,
      originPicks: [],
      pickSlot: 'primary',
    }
    const shown = alignmentPreview(draft, [], 100)
    expect(shown.error).toBeNull()
    const levelled = transformFit(
      fitFromAlignPicks('primary', draft.primaryPicks, 100)!,
      shown.preview!.rigid,
    )
    expect(levelled.kind === 'plane' && levelled.normal[2]).toBeCloseTo(1, 9)
    expect(shown.preview!.rotationDeg).toBeGreaterThan(0)

    // The same picks pointing along −Y instead: the preview follows the choice.
    const sideways = alignmentPreview({ ...draft, primaryAxis: 'y-' }, [], 100)
    const turned = transformFit(
      fitFromAlignPicks('primary', draft.primaryPicks, 100)!,
      sideways.preview!.rigid,
    )
    expect(turned.kind === 'plane' && turned.normal[1]).toBeCloseTo(-1, 9)
  })

  it('preview stays quiet until the levelling slot is filled, and reports its own errors', () => {
    const empty: AlignDraft = {
      primary: null,
      primaryPicks: [[0, 0, 0], [1, 0, 0]],
      primaryPickNormals: [],
      primaryAxis: 'z+',
      secondary: null,
      secondaryPicks: [],
      secondaryAxis: 'x+',
      origin: null,
      originPicks: [],
      pickSlot: 'primary',
    }
    // Two of three points: nothing to show yet, and nothing wrong either.
    expect(alignmentPreview(empty, [], 100)).toEqual({ preview: null, error: null })

    // Collinear picks are a message for the operator, not an exception.
    const bad = alignmentPreview(
      { ...empty, primaryPicks: [[0, 0, 0], [1, 1, 1], [2, 2, 2]] },
      [],
      100,
    )
    expect(bad.preview).toBeNull()
    expect(bad.error).toMatch(/line/)
  })

  it('reset via the inverse composes to the identity', () => {
    const p = planeFit([12, -3, 7], TILTED)
    const c = cylinderFit([20, 5, 12], SKEWED)
    const m = computeDatumAlignment({ fit: p, axis: 'z+' }, { fit: c, axis: 'x+' }, null)
    const roundTrip = rigidCompose(rigidInvert(m), m)
    expect(rigidRotationAngle(roundTrip)).toBeLessThan(1e-12)
    expect(Math.hypot(roundTrip.t[0], roundTrip.t[1], roundTrip.t[2])).toBeLessThan(1e-9)
  })
})

describe('a secondary running the primary\'s way (QUICKSURFACE: cylinder on Z Axis, its top face as Top)', () => {
  const at = (m: ReturnType<typeof computeDatumAlignment>, p: Vec3): Vec3 => {
    const r = m.r, t = m.t
    return [0, 1, 2].map((i) => r[i * 3] * p[0] + r[i * 3 + 1] * p[1] + r[i * 3 + 2] * p[2] + t[i]) as Vec3
  }
  it('stands the axis on Z and puts the face at Z = 0', () => {
    const axis = normalize(TILTED)!
    const base: Vec3 = [12, -7, 30]
    const top: Vec3 = [base[0] + axis[0] * 15, base[1] + axis[1] * 15, base[2] + axis[2] * 15]
    const m = computeDatumAlignment({ fit: cylinderFit(base, axis), axis: 'z+' }, { fit: planeFit(top, axis), axis: 'z+' }, null)
    const a = at(m, base), b = at(m, top)
    // Both points on the cylinder's axis land on the Z axis …
    expect(Math.hypot(a[0], a[1])).toBeLessThan(1e-9)
    expect(Math.hypot(b[0], b[1])).toBeLessThan(1e-9)
    // … the top face at zero, the base 15 below it.
    expect(b[2]).toBeCloseTo(0, 9)
    expect(a[2]).toBeCloseTo(-15, 9)
  })
  it('refuses that secondary on any other axis', () => {
    const axis = normalize(TILTED)!
    expect(() => computeDatumAlignment({ fit: cylinderFit([0, 0, 0], axis), axis: 'z+' }, { fit: planeFit([1, 1, 1], axis), axis: 'y-' }, null)).toThrow(AlignmentError)
  })
})
