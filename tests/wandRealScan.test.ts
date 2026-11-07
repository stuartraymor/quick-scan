// SPDX-License-Identifier: AGPL-3.0-only
// The Magic Wand on a real scan: QUICKSURFACE's basic_part example, aligned as
// in Example 1, against the cylinder QUICKSURFACE itself fitted to its outer
// wall (CreateCylinder in the exported .qscript of the same aligned frame).
//
// What the 2026-11-07 audit saw as "vertical unselected stripes" on this wall
// (G-03) are axial grooves about 1.7 mm deep: the rim triangles the wand
// leaves are tiny (median 0.02 mm²), turn 20° and more from the wall, and
// cover about 1 % of its area. So the checks here are by area, not by count,
// and the fit is held to the native cylinder at the level the two apps'
// selections allow (analysis/wand-2026-11-07/coverage.json).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import { buildTriangleGraph, wandGrow, type TriangleGraph } from '../src/core/geometry/wand'
import { fitCylinderOnSelection } from '../src/core/fit/fitCylinderFromSeed'
import { rigidApply } from '../src/core/deviation/rigid'
import type { FitSettings, MeshGraph } from '../src/core/types'
import { fixture } from './fixtures'

const FILE = fixture('basic_part-aligned.scanruler')

// QUICKSURFACE's Cylinder(1) of the outer wall in this frame.
const NATIVE = { s: [-1.250317984, 21.635862871, -264.868961646], e: [-1.069856164, 21.919975087, 53.125209598], r: 100.084537315 }

type Loaded = { g: MeshGraph; tg: TriangleGraph; axis: number[]; length: number; rad: Float64Array; along: Float64Array; area: Float64Array; centroid: Float64Array }

function load(path: string): Loaded {
  const zip = unzipSync(new Uint8Array(readFileSync(path)))
  const doc = JSON.parse(strFromU8(zip['project.json']))
  const stl = zip['scan.stl']
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
  const n = dv.getUint32(80, true)
  const soup = new Float32Array(n * 9), q = new Float64Array(3)
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const o = 84 + i * 50 + 12 + k * 12
    rigidApply(doc.scan.appliedAlignment, dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true), q)
    soup.set(q, i * 9 + k * 3)
  }
  const g = buildMeshGraph({ kind: 'soup', positions: soup })
  const tg = buildTriangleGraph(g.indices, g.positions)
  const length = Math.hypot(...NATIVE.e.map((v, i) => v - NATIVE.s[i]))
  const axis = NATIVE.e.map((v, i) => (v - NATIVE.s[i]) / length)
  const rad = new Float64Array(tg.count), along = new Float64Array(tg.count), area = new Float64Array(tg.count), centroid = new Float64Array(tg.count * 3)
  for (let t = 0; t < tg.count; t++) {
    const a = g.indices[t * 3] * 3, b = g.indices[t * 3 + 1] * 3, c = g.indices[t * 3 + 2] * 3
    const p = [0, 1, 2].map((j) => (g.positions[a + j] + g.positions[b + j] + g.positions[c + j]) / 3)
    centroid.set(p, t * 3)
    const d = p.map((v, i) => v - NATIVE.s[i]), tt = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]
    along[t] = tt
    rad[t] = Math.hypot(...d.map((v, i) => v - tt * axis[i])) - NATIVE.r
    const u = [0, 1, 2].map((j) => g.positions[b + j] - g.positions[a + j]), v = [0, 1, 2].map((j) => g.positions[c + j] - g.positions[a + j])
    area[t] = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2
  }
  return { g, tg, axis, length, rad, along, area, centroid }
}

/** Triangles on the wall: within 0.25 mm of the native cylinder, ends trimmed. */
function onWall(m: Loaded, t: number): boolean {
  return Math.abs(m.rad[t]) < 0.25 && m.along[t] > 3 && m.along[t] < m.length - 3
}

/** The wall triangle nearest a point on the native cylinder at mid-height, `turn` of the way round. */
function seedAt(m: Loaded, turn: number): number {
  const a = m.axis, u = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const p1 = [a[1] * u[2] - a[2] * u[1], a[2] * u[0] - a[0] * u[2], a[0] * u[1] - a[1] * u[0]]
  const l1 = Math.hypot(...p1)
  for (let i = 0; i < 3; i++) p1[i] /= l1
  const p2 = [a[1] * p1[2] - a[2] * p1[1], a[2] * p1[0] - a[0] * p1[2], a[0] * p1[1] - a[1] * p1[0]]
  const th = turn * Math.PI * 2
  const target = NATIVE.s.map((v, i) => v + a[i] * (m.length / 2) + NATIVE.r * (Math.cos(th) * p1[i] + Math.sin(th) * p2[i]))
  let best = Infinity, seed = -1
  for (let t = 0; t < m.tg.count; t++) {
    if (!onWall(m, t)) continue
    const d = Math.hypot(m.centroid[t * 3] - target[0], m.centroid[t * 3 + 1] - target[1], m.centroid[t * 3 + 2] - target[2])
    if (d < best) { best = d; seed = t }
  }
  return best < 5 ? seed : -1
}

function takenTriangles(m: Loaded, sel: Uint32Array): Uint8Array {
  const on = new Uint8Array(m.tg.vertexSpan)
  for (const v of sel) on[v] = 1
  const out = new Uint8Array(m.tg.count)
  for (let t = 0; t < m.tg.count; t++) if (on[m.tg.corners[t * 3]] && on[m.tg.corners[t * 3 + 1]] && on[m.tg.corners[t * 3 + 2]]) out[t] = 1
  return out
}

describe.skipIf(!FILE.exists)('Magic Wand on the basic_part outer wall', () => {
  const m = load(FILE.path)
  // The wall runs round the half away from the U cut (about 90°–270° in this frame).
  const seeds = [0.3, 0.4, 0.5, 0.6, 0.7].map((turn) => seedAt(m, turn)).filter((s) => s >= 0)

  it('finds seeds round the wall', () => {
    expect(seeds.length).toBeGreaterThanOrEqual(3)
  })

  it('takes the same patch from any seed on the wall', () => {
    const sizes = seeds.map((s) => wandGrow(m.tg, s, 3).length)
    expect(new Set(sizes).size).toBe(1)
  })

  it('covers the wall by area at 3° and stays off the groove rims and the neighbouring faces', () => {
    const taken = takenTriangles(m, wandGrow(m.tg, seeds[0], 3))
    let wall = 0, hit = 0, leak = 0, rimCount = 0, rimArea = 0
    for (let t = 0; t < m.tg.count; t++) {
      if (onWall(m, t)) {
        wall += m.area[t]
        if (taken[t]) hit += m.area[t]
        else { rimCount++; rimArea += m.area[t] }
      } else if (taken[t]) leak += m.area[t]
    }
    expect(hit / wall).toBeGreaterThan(0.97)
    expect(leak / hit).toBeLessThan(0.01)
    // The audit's "stripes": many tiny triangles, little area (median 0.02 mm² at 0.0.154).
    expect(rimCount).toBeGreaterThan(10_000)
    expect(rimArea / rimCount).toBeLessThan(0.05)
  })

  it('fits the cylinder QUICKSURFACE fitted, to the level the selections allow', () => {
    const f = fitCylinderOnSelection(m.g, wandGrow(m.tg, seeds[0], 3), { method: 'gaussian', sigma: 3 } as FitSettings)
    const axisDeg = (Math.acos(Math.min(1, Math.abs(f.axis[0] * m.axis[0] + f.axis[1] * m.axis[1] + f.axis[2] * m.axis[2]))) * 180) / Math.PI
    const d = [f.center[0] - NATIVE.s[0], f.center[1] - NATIVE.s[1], f.center[2] - NATIVE.s[2]]
    const tt = d[0] * m.axis[0] + d[1] * m.axis[1] + d[2] * m.axis[2]
    const offset = Math.hypot(...d.map((v, i) => v - tt * m.axis[i]))
    // 0.0.154: dR +0.0048 mm, axis 0.0129°, offset 0.0048 mm (analysis/wand-2026-11-07/fit-variants.json).
    expect(Math.abs(f.radius - NATIVE.r)).toBeLessThan(0.01)
    expect(axisDeg).toBeLessThan(0.02)
    expect(offset).toBeLessThan(0.01)
  })
})
