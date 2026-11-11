// SPDX-License-Identifier: AGPL-3.0-only
// Extract primitives against QUICKSURFACE 8.0.128 on the saved test parts
// (QUICKSCAN/test-models, 2026-11-11): each part was taken through Extract
// primitives and Align in QUICKSURFACE and saved there (native-<part>.qsf and
// .qscript). The numbers below are QUICKSURFACE's own: the fit RMS it saves
// in the primitive's record and the geometry its script exports. Quick Scan's
// wand region from the same face, fitted as the app fits it (every vertex,
// once, nothing dropped), must give the same primitive.
//
// The parts are too large for the repository. They are found in
// QUICKSCAN_TEST_MODELS, or next to QUICKSCAN_FIXTURES as test-models; the
// tests are skipped, and say so, without them.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseSTL } from '../src/core/parsers/stl'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import { buildTriangleGraph, wandGrowBoth } from '../src/core/geometry/wand'
import { fitPlaneOnSelection } from '../src/core/fit/fitPlaneFromSeed'
import { fitCylinderOnSelection } from '../src/core/fit/fitCylinderFromSeed'
import { autoConstrainFit, constrainFit } from '../src/core/elements/constrain'
import type { CylinderFit, FitData, MeshGraph, PlaneFit, Vec3 } from '../src/core/types'

const root = process.env.QUICKSCAN_TEST_MODELS ?? (process.env.QUICKSCAN_FIXTURES ? join(process.env.QUICKSCAN_FIXTURES, '..', 'test-models') : '')
const part = (name: string) => {
  const path = root ? join(root, name, `${name}.stl`) : ''
  const ok = !!path && existsSync(path)
  if (!ok) console.warn(`\n⚠ Test part "${name}" not found — its QUICKSURFACE comparison is SKIPPED. Set QUICKSCAN_TEST_MODELS to the test-models folder.\n`)
  return { path, ok }
}
const load = (path: string) => {
  const buf = readFileSync(path)
  const g = buildMeshGraph(parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer)) as unknown as MeshGraph
  return { g, tg: buildTriangleGraph(g.indices, g.positions) }
}
const EVERY_POINT = { method: 'gaussian', sigma: 0 } as never
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const deg = (a: Vec3, b: Vec3) => (Math.acos(Math.min(1, Math.abs(dot(a, b)))) * 180) / Math.PI
/** A direction and a point of QUICKSURFACE's aligned frame, in the scan's own
 *  frame: R and t take the scan to the aligned frame (recovered from the
 *  saved mesh, worst residual under 1e-5 mm). */
const frame = (R: number[][], t: number[]) => ({
  dir: (d: number[]): Vec3 => [0, 1, 2].map((c) => R[0][c] * d[0] + R[1][c] * d[1] + R[2][c] * d[2]) as Vec3,
  point: (p: number[]): Vec3 => { const q = [p[0] - t[0], p[1] - t[1], p[2] - t[2]]; return [0, 1, 2].map((c) => R[0][c] * q[0] + R[1][c] * q[1] + R[2][c] * q[2]) as Vec3 },
})

const lego = part('lego')
describe.skipIf(!lego.ok)('lego (wand 10°)', () => {
  it('Plane(1), Plane(2) and the free Cylinder(1) on a stud land on QUICKSURFACE’s fits', () => {
    const { g, tg } = load(lego.path)
    const top = wandGrowBoth(tg, 10470, 10), side = wandGrowBoth(tg, 6671, 10), stud = wandGrowBoth(tg, 46316, 10)
    expect([top.vertices.length, side.vertices.length]).toEqual([8003, 8641])
    const p1 = autoConstrainFit(fitPlaneOnSelection(g, top.vertices, EVERY_POINT) as FitData, g.positions, top.vertices, [])
    expect(p1.notes).toEqual(['Perpendicular to (OYZ)'])
    expect((p1.fit as PlaneFit).sigma).toBeCloseTo(0.0308736332873954, 10)
    const p2 = autoConstrainFit(fitPlaneOnSelection(g, side.vertices, EVERY_POINT) as FitData, g.positions, side.vertices, [{ id: 1, name: 'Plane(1)', fit: p1.fit }])
    expect(p2.notes).toEqual(['Parallel to (OYZ)'])
    expect((p2.fit as PlaneFit).sigma).toBeCloseTo(0.03410091662160804, 10)
    // QUICKSURFACE's stud cylinder is a poor, tilted fit (the stud is short);
    // Quick Scan's is the same one.
    const cyl = fitCylinderOnSelection(g, stud.vertices, EVERY_POINT) as unknown as CylinderFit
    expect(cyl.sigma).toBeCloseTo(0.3054681890672474, 9)
    expect(cyl.radius).toBeCloseTo(2.213116673, 6)
  }, 300_000)
})

const machine = part('machine_part')
describe.skipIf(!machine.ok)('machine_part (wand 6°)', () => {
  it('the hole held Parallel to Y Axis lands on QUICKSURFACE’s cylinder and its saved RMS', () => {
    const { g, tg } = load(machine.path)
    const hole = wandGrowBoth(tg, 125103, 6)
    expect(hole.vertices.length).toBe(5457)
    const free = fitCylinderOnSelection(g, hole.vertices, EVERY_POINT) as unknown as CylinderFit
    // QUICKSURFACE snapped it (within its 0.5° tilt tolerance): the vertex fit
    // is 0.48° off Y; a fit on the triangles' corners is 0.53° and would not.
    expect(deg(free.axis, [0, 1, 0])).toBeLessThan(0.5)
    const held = constrainFit(free as FitData, g.positions, hole.vertices, 'perpendicular-oxz') as unknown as CylinderFit
    expect(held.sigma).toBeCloseTo(0.10429175905415711, 9)
    expect(held.radius).toBeCloseTo(4.797733824, 5)
    const f = frame([[-0.986153971, 0, -0.165832281], [0.164737375, -0.114723118, -0.979642896], [-0.019024796, -0.993397507, 0.113134659]], [49.849942, -238.345571, 11.952922])
    const a = f.point([0, -191.363043216, 27.901673401]), d = held.center.map((x, i) => x - a[i]) as Vec3
    const along = dot(d, held.axis)
    expect(Math.hypot(...d.map((x, i) => x - along * held.axis[i]))).toBeLessThan(1e-4)
  }, 300_000)
})

const bearing = part('bearinghousing')
describe.skipIf(!bearing.ok)('bearinghousing (wand 2° and 6°)', () => {
  it('a plane held perpendicular keeps its projected normal, and each plane’s point is QUICKSURFACE’s', () => {
    const { g, tg } = load(bearing.path)
    const f = frame([[0.002671994, -0.999035851, -0.043820405], [0.844615772, -0.021205487, 0.534952826], [-0.535366285, -0.038440796, 0.843744776]], [-19.969636, -43.032717, -15.093896])
    const fit = (seed: number, degrees: number, made: { id: number; name: string; fit: FitData }[]) => {
      const w = wandGrowBoth(tg, seed, degrees)
      return autoConstrainFit(fitPlaneOnSelection(g, w.vertices, EVERY_POINT) as FitData, g.positions, w.vertices, made)
    }
    const p1 = fit(3, 2, []), p2 = fit(15, 2, [{ id: 1, name: 'Plane(1)', fit: p1.fit }])
    const p3 = fit(194, 6, [{ id: 1, name: 'Plane(1)', fit: p1.fit }, { id: 2, name: 'Plane(2)', fit: p2.fit }])
    expect(p2.notes[0]).toMatch(/^perpendicular to Plane\(1\)/)
    expect(p3.notes[0]).toMatch(/^perpendicular to Plane\(2\)/)
    // Plane(2): within 2e-5° of QUICKSURFACE's normal (refitting the normal
    // across the points instead was 0.008° off).
    expect(deg((p2.fit as PlaneFit).normal, f.dir([0, 0, 1]))).toBeLessThan(1e-4)
    // Each plane's point, the centre of its patch: Plane(3)'s normal is 2.4°
    // off Y, and it is boxed along X as QUICKSURFACE boxes it (0.068 mm off
    // when boxed along Y).
    const native: [FitData, number[]][] = [
      [p1.fit, [-24.883576507, 0, -15.232757097]],
      [p2.fit, [-24.229511478, -46.410680871, 0]],
      [p3.fit, [0.231673444, -59.323109887, -14.76684283]],
    ]
    const off = native.map(([fit, p]) => { const o = (fit as PlaneFit).datum!.origin, q = f.point(p); return Math.hypot(o[0] - q[0], o[1] - q[1], o[2] - q[2]) })
    expect(off[0]).toBeLessThan(1e-5)
    expect(off[1]).toBeLessThan(1e-5)
    expect(off[2]).toBeLessThan(0.002)
  }, 300_000)
})

describe('a plane’s point, without the test parts', () => {
  it('boxes the patch in the frame of the axis least along the normal', async () => {
    const { planeDatum } = await import('../src/core/fit/fitPlaneFromSeed')
    // A 40 × 10 patch turned 30° in its plane, the plane's normal 2.4° off Y.
    const tilt = (2.4 * Math.PI) / 180, n: Vec3 = [0, Math.cos(tilt), Math.sin(tilt)]
    const ex: Vec3 = [1, 0, 0], ez: Vec3 = [0, -Math.sin(tilt), Math.cos(tilt)]
    const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6)
    const u: Vec3 = [c * ex[0] + s * ez[0], c * ex[1] + s * ez[1], c * ex[2] + s * ez[2]]
    const v: Vec3 = [-s * ex[0] + c * ez[0], -s * ex[1] + c * ez[1], -s * ex[2] + c * ez[2]]
    const pts: number[] = []
    for (let i = 0; i <= 40; i++) for (let j = 0; j <= 10; j++) for (let k = 0; k < 3; k++) pts.push(7 + (i - 3) * u[k] + j * v[k])
    const datum = planeDatum(Float32Array.from(pts), Array.from({ length: pts.length / 3 }, (_, i) => i), n, [7, 7, 7])!
    // Boxed along X projected into the plane (the axis least along the normal).
    const fu: Vec3 = ex, fv: Vec3 = [n[1] * fu[2] - n[2] * fu[1], n[2] * fu[0] - n[0] * fu[2], n[0] * fu[1] - n[1] * fu[0]]
    let a = Infinity, b = -Infinity, cc = Infinity, d = -Infinity
    for (let i = 0; i < pts.length; i += 3) { const p: Vec3 = [pts[i] - 7, pts[i + 1] - 7, pts[i + 2] - 7]; a = Math.min(a, dot(p, fu)); b = Math.max(b, dot(p, fu)); cc = Math.min(cc, dot(p, fv)); d = Math.max(d, dot(p, fv)) }
    const want = [0, 1, 2].map((k) => 7 + fu[k] * (a + b) / 2 + fv[k] * (cc + d) / 2)
    expect(Math.hypot(...datum.origin.map((x, k) => x - want[k]))).toBeLessThan(1e-4)
  })
})
