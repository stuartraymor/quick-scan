// SPDX-License-Identifier: AGPL-3.0-only
// Wrap Surface's cage (F4): a region of a cylinder read for its axis,
// radius and extent, and the ring of quads laid over it at Low, Medium and
// Fine — outward, whole, and snapped onto the wall within the roadmap's
// 0.005 mm. Synthetic cylinders, so the answer is known.

import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { topology } from '../core/freeform/cage'
import { boundaryLoops, type Closest, deviation, snapCage } from '../core/freeform/edit'
import { cylinderClosest } from '../core/freeform/snap'
import { fitWrap, MAX_WRAP_QUADS, regionClosest, regionSnap, scanVertexNormals, settleWrap, snapRegionOf, snapWeight, WRAP_AROUND, WrapError, wrapCage } from '../core/freeform/wrap'

const R = 25
const LENGTH = 40
const norm = (d: Vec3): Vec3 => {
  const l = Math.hypot(...d)
  return [d[0] / l, d[1] / l, d[2] / l]
}
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/** Points of a cylinder about `axis` through `origin`, `sweep` radians from angle 0, `rows` × `cols`, with their normals. */
function cylinderPoints(axis: Vec3, origin: Vec3, sweep: number, opts: { rows?: number; cols?: number; radius?: number; length?: number; offsetAngle?: number } = {}) {
  const { rows = 30, cols = 120, radius = R, length = LENGTH, offsetAngle = 0.3 } = opts
  const a = norm(axis)
  const u = norm(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]))
  const v = cross(a, u)
  const positions = new Float32Array(rows * cols * 3)
  const normals = new Float32Array(rows * cols * 3)
  const idx: number[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const th = offsetAngle + (sweep * c) / (sweep >= 2 * Math.PI - 1e-9 ? cols : cols - 1)
      const t = (length * r) / (rows - 1) - length / 2
      const i = (r * cols + c) * 3
      for (let m = 0; m < 3; m++) {
        const rad = u[m] * Math.cos(th) + v[m] * Math.sin(th)
        positions[i + m] = origin[m] + a[m] * t + radius * rad
        normals[i + m] = rad
      }
      idx.push(r * cols + c)
    }
  }
  return { positions, normals, idx, axis: a }
}

const closestOf = (origin: Vec3, axis: Vec3, r = R): Closest => {
  const q = cylinderClosest(origin, norm(axis), r)
  return (p) => {
    const c = q(p, [0, 0, 0])
    return c ? { point: c, distance: Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) } : null
  }
}

describe('wrap fit', () => {
  it('reads a whole tilted cylinder: axis, radius, extent, and that it goes all the way round', () => {
    const origin: Vec3 = [10, -4, 7]
    const s = cylinderPoints([0.3, 0.5, 0.8], origin, 2 * Math.PI, { offsetAngle: 1.1 })
    const fit = fitWrap(s.positions, s.idx, s.normals)
    expect(fit.axis.r).toBeCloseTo(R, 4)
    expect(Math.abs(fit.axis.ax * s.axis[0] + fit.axis.ay * s.axis[1] + fit.axis.az * s.axis[2])).toBeGreaterThan(1 - 1e-9)
    expect(fit.closed).toBe(true)
    expect(fit.t1 - fit.t0).toBeCloseTo(LENGTH, 4)
  })

  it('reads a 120° strip as open, with its sweep', () => {
    const s = cylinderPoints([0, 0, 1], [0, 0, 0], (2 * Math.PI) / 3, { offsetAngle: 2.5 })
    const fit = fitWrap(s.positions, s.idx, s.normals)
    expect(fit.closed).toBe(false)
    expect(fit.sweep).toBeCloseTo((2 * Math.PI) / 3, 2)
    expect(fit.axis.r).toBeCloseTo(R, 3)
  })

  it('takes a given axis direction and radius', () => {
    const s = cylinderPoints([0, 1, 0], [0, 0, 0], 2 * Math.PI)
    const fit = fitWrap(s.positions, s.idx, null, { dir: [0, 5, 0], radius: 24 })
    expect(fit.axis.r).toBe(24)
    expect(Math.abs(fit.axis.ay)).toBeCloseTo(1, 9)
  })

  it('closes a 170° wall with a chord as QUICKSURFACE does: N round, the arc on the wall with its two ends creased, the chord held in the snap', () => {
    const s = cylinderPoints([0, 0, 1], [0, 0, 0], (170 * Math.PI) / 180, { offsetAngle: (95 * Math.PI) / 180, length: 150, rows: 40, cols: 200, radius: 100 })
    const f = fitWrap(s.positions, s.idx, s.normals)
    expect(f.closed).toBe(false)
    const counts = { low: [4, 1], medium: [8, 2], fine: [16, 4] } as const
    for (const d of ['low', 'medium', 'fine'] as const) {
      const w = wrapCage(f, d)
      expect([w.around, w.along]).toEqual(counts[d])
      expect(w.closure).toBe('chord')
      expect(boundaryLoops(w.cage)).toHaveLength(2)
      // The corners where the chord leaves the wall: an edge down each end of the arc, per row of quads.
      expect(w.cage.creases).toHaveLength(2 * counts[d][1])
    }
    const w = wrapCage(f, 'fine')
    const angle = (i: number) => {
      const q = [0, 1, 2].map((m) => w.cage.positions[i * 3 + m] - [f.axis.px, f.axis.py, f.axis.pz][m])
      const th = Math.atan2(q[0] * f.v[0] + q[1] * f.v[1] + q[2] * f.v[2], q[0] * f.u[0] + q[1] * f.u[1] + q[2] * f.u[2])
      return (((th * 180) / Math.PI) + 360) % 360
    }
    const radius = (i: number) => Math.hypot(w.cage.positions[i * 3] - f.axis.px, w.cage.positions[i * 3 + 1] - f.axis.py)
    const arc = w.onRegion.filter((i) => i < 16)
    expect(arc.length).toBeGreaterThanOrEqual(8)
    // The arc is an open strip from one end of the region to the other, evenly stepped, its ends on the wall (they are creases: the limit passes through them).
    const degs = arc.map(angle)
    expect(Math.abs(degs[0] - ((((f.start * 180) / Math.PI) % 360) + 360) % 360)).toBeLessThan(0.5)
    const steps = degs.slice(1).map((a1, i) => a1 - degs[i])
    for (const st of steps) expect(Math.abs(st - steps[0])).toBeLessThan(0.05)
    expect(Math.abs(radius(arc[0]) - 100)).toBeLessThan(0.02)
    expect(Math.abs(radius(arc[arc.length - 1]) - 100)).toBeLessThan(0.02)
    // The chord runs straight between the ends, on the axis' side of the wall.
    const chordFirst = w.cage.positions.slice(arc.length * 3, arc.length * 3 + 3)
    expect(Math.hypot(chordFirst[0], chordFirst[1])).toBeLessThan(100)
    // Settled, the cage's limit lies on the wall over the region; the chord is left alone.
    const exactWall = closestOf([f.axis.px, f.axis.py, f.axis.pz], [0, 0, 1], 100)
    const before = Float64Array.from(w.cage.positions)
    const cage = settleWrap(w, 'fine')
    const held = Array.from({ length: before.length / 3 }, (_, i) => i).filter((i) => !w.onRegion.includes(i) && Math.hypot(before[i * 3] - f.axis.px, before[i * 3 + 1] - f.axis.py) < 60)
    expect(held.length).toBeGreaterThan(0)
    for (const i of held) for (let k = 0; k < 3; k++) expect(cage.positions[i * 3 + k]).toBe(before[i * 3 + k])
    const seg = (2 * Math.PI) / 16
    const interior = regionClosest({ ...f, start: f.start + 1.5 * seg, sweep: f.sweep - 3 * seg }, 'fine', exactWall)
    const dev = deviation(cage, (p) => interior(p), 0.05)
    expect(dev.points).toBeGreaterThan(100)
    // Between its vertices (21° apart) the cage's surface lies a few hundredths of a millimetre inside the wall; the build's snap of the refined surface closes that.
    expect(dev.rms).toBeLessThan(0.1)
    expect(dev.max).toBeLessThan(0.2)
  })

  it('refuses what is not a curved wall: a plane, too few points, a zero axis, no normals', () => {
    const plane = new Float32Array(300 * 3)
    const normals = new Float32Array(300 * 3)
    for (let i = 0; i < 300; i++) {
      plane.set([i % 20, Math.floor(i / 20), 0], i * 3)
      normals.set([0, 0, 1], i * 3)
    }
    const all = Array.from({ length: 300 }, (_, i) => i)
    expect(() => fitWrap(plane, all, normals)).toThrow(/too flat/)
    expect(() => fitWrap(plane, [0, 1, 2], normals)).toThrow(WrapError)
    expect(() => fitWrap(plane, all, null)).toThrow(/no triangles/)
    expect(() => fitWrap(plane, all, null, { dir: [0, 0, 0] })).toThrow(/zero vector/)
    expect(() => fitWrap(plane, [...all.slice(0, 20), 99999], normals)).toThrow(/does not have/)
  })

  it('finds vertex normals from triangles', () => {
    const s = cylinderPoints([0, 0, 1], [0, 0, 0], 2 * Math.PI, { rows: 10, cols: 60 })
    const tri: number[] = []
    for (let r = 0; r < 9; r++) for (let c = 0; c < 60; c++) {
      const a = r * 60 + c, b = r * 60 + ((c + 1) % 60), d = (r + 1) * 60 + c, e = (r + 1) * 60 + ((c + 1) % 60)
      tri.push(a, b, e, a, e, d)
    }
    const n = scanVertexNormals(s.positions, tri)
    // The middle rows point out of the wall.
    let worst = 0
    for (let i = 60 * 3; i < 60 * 8; i++) worst = Math.max(worst, Math.abs(n[i] - s.normals[i]))
    expect(worst).toBeLessThan(0.02)
    const fit = fitWrap(s.positions, s.idx, n)
    expect(fit.axis.r).toBeCloseTo(R, 2)
  })
})

describe('wrap cage', () => {
  const origin: Vec3 = [3, 2, -5]
  const axis: Vec3 = [0.2, -0.4, 0.9]
  const whole = cylinderPoints(axis, origin, 2 * Math.PI)
  const fit = fitWrap(whole.positions, whole.idx, whole.normals)
  // The axis point the fit chose lies on the axis; the exact query uses it.
  const exact = closestOf([fit.axis.px, fit.axis.py, fit.axis.pz], axis)

  it.each([
    ['low', 4, 1],
    ['medium', 8, 2],
    ['fine', 16, 4],
  ] as const)('lays %s: %d quads round and %d along a whole cylinder, outward, with an open ring at each end', (density, around, along) => {
    const w = wrapCage(fit, density)
    expect(WRAP_AROUND[density]).toBe(around)
    expect(w.around).toBe(around)
    expect(w.along).toBe(along)
    expect(w.cage.faces).toHaveLength(around * along)
    // Every directed edge once: faces wind the same way round.
    const seen = new Set<string>()
    for (const f of w.cage.faces) for (let i = 0; i < f.length; i++) {
      const key = `${f[i]}>${f[(i + 1) % f.length]}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    const loops = boundaryLoops(w.cage)
    expect(loops).toHaveLength(2)
    expect(topology(w.cage).edges.every((e) => e.faces.length <= 2)).toBe(true)
    // Outward: each face's normal leans away from the axis.
    for (const f of w.cage.faces) {
      const p = f.map((i): Vec3 => [w.cage.positions[i * 3], w.cage.positions[i * 3 + 1], w.cage.positions[i * 3 + 2]])
      const n = cross([p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], [p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]])
      const c = [0, 1, 2].map((m) => (p[0][m] + p[1][m] + p[2][m] + p[3][m]) / 4 - [fit.axis.px, fit.axis.py, fit.axis.pz][m])
      const along = c[0] * fit.axis.ax + c[1] * fit.axis.ay + c[2] * fit.axis.az
      const r = [c[0] - along * fit.axis.ax, c[1] - along * fit.axis.ay, c[2] - along * fit.axis.az]
      expect(n[0] * r[0] + n[1] * r[1] + n[2] * r[2]).toBeGreaterThan(0)
    }
  })

  it('has a limit surface already near the wall before the snap, and on it within 0.005 mm after', () => {
    const w = wrapCage(fit, 'fine')
    const before = deviation(w.cage, exact, 0.005)
    // Cubic B-spline weights leave a few tenths of a millimetre at 16 round.
    expect(before.max).toBeLessThan(0.6)
    const { cage, stats } = snapCage(w.cage, exact, 12, 0.001)
    expect(stats.max).toBeLessThan(0.005)
    expect(deviation(cage, exact, 0.005).within).toBe(stats.points)
    expect(cage.faces).toHaveLength(w.cage.faces.length)
  })

  it('moves a coarse Low cage towards the wall too, though four quads round cannot make a circle: the cage gives topology, the snapped refined surface the shape', () => {
    const w = wrapCage(fit, 'low')
    const before = deviation(w.cage, exact, 0.005)
    expect(before.max).toBeGreaterThan(0.5)
    const { stats } = snapCage(w.cage, exact, 40, 0.001)
    expect(stats.max).toBeLessThan(before.max)
    expect(stats.max).toBeLessThan(0.8)
  })

  it('lays a 120° strip as an open sheet: 3 quads round at Medium, one boundary loop, its limit already near the wall', () => {
    const s = cylinderPoints([0, 0, 1], [0, 0, 0], (2 * Math.PI) / 3, { offsetAngle: 2.5 })
    const f = fitWrap(s.positions, s.idx, s.normals)
    const w = wrapCage(f, 'medium', 'none')
    expect(f.closed).toBe(false)
    expect(w.around).toBe(3)
    expect(w.cage.positions.length / 3).toBe((w.along + 1) * 4)
    expect(boundaryLoops(w.cage)).toHaveLength(1)
    const exactStrip = closestOf([f.axis.px, f.axis.py, f.axis.pz], [0, 0, 1])
    // The ends sit on the wall and the inside points are set for the limit to land on it: already within 0.8 mm
    // (3 quads cannot make an arc), and snapping holds that.
    const before = deviation(w.cage, exactStrip).max
    const { stats } = snapCage(w.cage, exactStrip, 40, 0.001)
    expect(before).toBeLessThan(0.8)
    expect(stats.max).toBeLessThan(before + 0.05)
  })

})

describe('the snap region a wrap leaves with its feature', () => {
  const s = cylinderPoints([0, 0, 1], [0, 0, 0], (170 * Math.PI) / 180, { offsetAngle: (95 * Math.PI) / 180, length: 150, rows: 40, cols: 200, radius: 100 })
  const f = fitWrap(s.positions, s.idx, s.normals)
  const region = snapRegionOf(f, 'medium')!
  // A point at `angle` round the fit's own basis, `rho` from the axis, `z` along it from the axis point.
  const at = (angle: number, rho: number, z: number): Vec3 => [0, 1, 2].map((k) => [f.axis.px, f.axis.py, f.axis.pz][k] + rho * (Math.cos(angle) * f.u[k] + Math.sin(angle) * f.v[k]) + z * [f.axis.ax, f.axis.ay, f.axis.az][k]) as Vec3
  const mid = f.start + f.sweep / 2

  it('is none for a region that goes all the way round, and kept for one that does not', () => {
    const whole = cylinderPoints([0, 0, 1], [0, 0, 0], 2 * Math.PI)
    expect(snapRegionOf(fitWrap(whole.positions, whole.idx, whole.normals), 'medium')).toBeNull()
    expect(region.sweep).toBeCloseTo((170 * Math.PI) / 180, 1)
    expect(region.margin).toBeCloseTo(Math.PI / 8, 12)
  })

  it('weighs 1 over the arc at the wall and 0 across the part and far off the wall', () => {
    const z = (f.t0 + f.t1) / 2
    expect(snapWeight(region, at(mid, 100, z))).toBe(1)
    expect(snapWeight(region, at(mid, 96, z))).toBe(1)
    expect(snapWeight(region, at(mid, 60, z))).toBe(0)
    expect(snapWeight(region, at(mid + Math.PI, 100, z))).toBe(0)
    expect(snapWeight(region, at(mid, 100, f.t1 + 20))).toBe(0)
  })

  it('falls off smoothly past the arc ends, with no step for the surface to tear on', () => {
    const z = (f.t0 + f.t1) / 2
    const end = f.start + f.sweep
    const ws = Array.from({ length: 41 }, (_, i) => snapWeight(region, at(end - region.margin * 0.5 + (region.margin * 2.5 * i) / 40, 100, z)))
    expect(ws[0]).toBe(1)
    expect(ws[ws.length - 1]).toBe(0)
    for (let i = 1; i < ws.length; i++) {
      expect(ws[i]).toBeLessThanOrEqual(ws[i - 1] + 1e-12)
      expect(ws[i - 1] - ws[i]).toBeLessThan(0.1)
    }
  })

  it('moves a point by the weight toward the scan point, and leaves the rest', () => {
    const z = (f.t0 + f.t1) / 2
    // A scan point 0.3 mm off the wall: the relief the snap is to follow.
    const near = regionSnap(region, (p) => [p[0] + 0.3, p[1], p[2]])
    const p = at(mid, 100, z)
    expect(near(p)![0] - p[0]).toBeCloseTo(0.3, 6)
    expect(near(at(mid + Math.PI, 100, z))).toBeNull()
    const edge = at(f.start + f.sweep + region.margin * 0.5, 100, z)
    const w = snapWeight(region, edge)
    expect(w).toBeGreaterThan(0)
    expect(w).toBeLessThan(1)
    expect(near(edge)![0] - edge[0]).toBeCloseTo(0.3 * w, 6)
  })

  it('draws a point that stands off the wall onto the cylinder first: a coarse cage’s sag is brought back', () => {
    const z = (f.t0 + f.t1) / 2
    const low = snapRegionOf(f, 'low')!
    // 8 mm inside the wall, as a Low cage’s surface stands between its control points; the scan has the wall at the cylinder.
    const wall = (p: Vec3): Vec3 => cylinderClosest([f.axis.px, f.axis.py, f.axis.pz], [f.axis.ax, f.axis.ay, f.axis.az], 100)(p, [0, 0, 0]) as Vec3
    const snapped = regionSnap(low, wall)(at(mid, 92, z))!
    expect(Math.hypot(snapped[0] - f.axis.px, snapped[1] - f.axis.py)).toBeCloseTo(100, 6)
    // A scan point 8 mm from the cylinder is not the wall (a hole, the far side of a thin wall): the surface stays on the cylinder.
    const far = regionSnap(low, (p) => [p[0] + 8, p[1], p[2]])(at(mid, 100, z))!
    const home = at(mid, 100, z)
    expect(Math.hypot(far[0] - home[0], far[1] - home[1], far[2] - home[2])).toBeLessThan(1e-6)
  })
})

describe('wrap limits', () => {
  it('refuses a long thin region at fine density with the quad budget in the words', () => {
    const s = cylinderPoints([0, 0, 1], [0, 0, 0], 2 * Math.PI, { radius: 1, length: 1e5, rows: 40 })
    const f = fitWrap(s.positions, s.idx, s.normals)
    expect(() => wrapCage(f, 'fine')).toThrow(new RegExp(String(MAX_WRAP_QUADS)))
    expect(() => wrapCage(f, 'dense' as never)).toThrow(/low, medium or fine/)
  })
})
