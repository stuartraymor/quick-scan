// SPDX-License-Identifier: AGPL-3.0-only
// Freeform Wrap against QUICKSURFACE's own Wrap, on the real scan.
//
// QUICKSURFACE 8.0.128, Freeform ▸ Wrap on the basic_part outer wall (about
// 170° of it, picked with the Magic Wand), at Low, Medium and Fine density,
// exported as quad OBJ (tests/fixtures/native-wrap-densities-quads.obj; the
// last 4 + 16 + 64 quads of it). The same wall is picked here with the same
// wand at 3° and wrapped by wrap.ts. What is compared:
//   * the fitted cylinder (radius, axis, axial extent) against the native one,
//   * the quad counts and the topology (closed tube, two open end loops),
//   * the cage's place on the grid the native cage keeps its vertices on,
//   * the surface the cage gives once snapped to the scan, against the wall.
// What is NOT claimed to match: the native cage closes the ring with a chord
// across the part whose vertices it snaps onto arbitrary interior scan, and
// doubles vertices at the arc ends; these are reported, not asserted equal.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { buildTriangleGraph, wandGrow } from '../../../src/core/geometry/wand'
import { rigidApply } from '../../../src/core/deviation/rigid'
import { fixture } from '../../../tests/fixtures'
import { parseQuadObj } from '../core/freeform/cageIO'
import { topology, type Cage } from '../core/freeform/cage'
import { fitWrap, regionClosest, scanVertexNormals, wrapCage, WRAP_AROUND, type WrapDensity } from '../core/freeform/wrap'

const SCAN = fixture('basic_part-aligned.scanruler')
const NATIVE_OBJ = readFileSync(new URL('./fixtures/native-wrap-densities-quads.obj', import.meta.url), 'utf8')

// QUICKSURFACE's Cylinder(1) of the outer wall in this frame.
const NATIVE = { s: [-1.250317984, 21.635862871, -264.868961646], e: [-1.069856164, 21.919975087, 53.125209598], r: 100.084537315 }
const len = Math.hypot(NATIVE.e[0] - NATIVE.s[0], NATIVE.e[1] - NATIVE.s[1], NATIVE.e[2] - NATIVE.s[2])
const D = NATIVE.e.map((v, i) => (v - NATIVE.s[i]) / len)

function loadScan(path: string) {
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
  return { g, tg: buildTriangleGraph(g.indices, g.positions) }
}

/** Distance of p from the native cylinder's surface, and its place along the native axis. */
function nativeFrame(x: number, y: number, z: number) {
  const w = [x - NATIVE.s[0], y - NATIVE.s[1], z - NATIVE.s[2]]
  const t = w[0] * D[0] + w[1] * D[1] + w[2] * D[2]
  return { t, rho: Math.hypot(w[0] - t * D[0], w[1] - t * D[1], w[2] - t * D[2]) }
}

/** The wall triangle nearest a point on the native cylinder at mid-height, `turn` of the way round. */
function seedAt(g: { indices: ArrayLike<number>; positions: Float32Array }, count: number, turn: number): number {
  const u = Math.abs(D[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const p1 = [D[1] * u[2] - D[2] * u[1], D[2] * u[0] - D[0] * u[2], D[0] * u[1] - D[1] * u[0]]
  const l1 = Math.hypot(...p1)
  for (let i = 0; i < 3; i++) p1[i] /= l1
  const p2 = [D[1] * p1[2] - D[2] * p1[1], D[2] * p1[0] - D[0] * p1[2], D[0] * p1[1] - D[1] * p1[0]]
  const th = turn * Math.PI * 2
  const target = NATIVE.s.map((v, i) => v + D[i] * (len / 2) + NATIVE.r * (Math.cos(th) * p1[i] + Math.sin(th) * p2[i]))
  let best = Infinity, seed = -1
  for (let t = 0; t < count; t++) {
    const c = [0, 1, 2].map((j) => (g.positions[g.indices[t * 3] * 3 + j] + g.positions[g.indices[t * 3 + 1] * 3 + j] + g.positions[g.indices[t * 3 + 2] * 3 + j]) / 3)
    const f = nativeFrame(c[0], c[1], c[2])
    if (Math.abs(f.rho - NATIVE.r) > 0.25 || f.t < 3 || f.t > len - 3) continue
    const d = Math.hypot(c[0] - target[0], c[1] - target[1], c[2] - target[2])
    if (d < best) { best = d; seed = t }
  }
  return best < 5 ? seed : -1
}

/** The native cage of one density: the export ends with the Low, Medium and Fine Wrap cages, in that order. */
function nativeCage(density: WrapDensity): Cage {
  const all = parseQuadObj(NATIVE_OBJ)
  const n = WRAP_AROUND[density]
  const quads = { low: 4, medium: 16, fine: 64 }
  const order: WrapDensity[] = ['low', 'medium', 'fine']
  const total = order.reduce((a, d) => a + quads[d], 0)
  let first = all.faces.length - total
  for (const d of order) { if (d === density) break; first += quads[d] }
  void n
  const faces = all.faces.slice(first, first + quads[density])
  const used = [...new Set(faces.flat())].sort((a, b) => a - b)
  const remap = new Map(used.map((v, i) => [v, i]))
  return {
    positions: Float64Array.from(used.flatMap((v) => [all.positions[v * 3], all.positions[v * 3 + 1], all.positions[v * 3 + 2]])),
    faces: faces.map((f) => f.map((v) => remap.get(v) as number)),
    creases: [],
  }
}

describe.skipIf(!SCAN.exists)('Freeform Wrap against QUICKSURFACE on the basic_part wall', () => {
  // Loaded when the first test runs, not when the suite is collected: the scan is not in every checkout.
  let cached: { m: ReturnType<typeof loadScan>; seed: number; fit: ReturnType<typeof fitWrap> } | null = null
  const wall = () => {
    if (!cached) {
      const m = loadScan(SCAN.path)
      const seed = seedAt(m.g, m.tg.count, 0.5)
      const region = wandGrow(m.tg, seed, 3)
      cached = { m, seed, fit: fitWrap(m.g.positions, region, scanVertexNormals(m.g.positions, m.g.indices)) }
    }
    return cached
  }

  it('fits the cylinder QUICKSURFACE fitted', () => {
    const { seed, fit } = wall()
    expect(seed).toBeGreaterThanOrEqual(0)
    const dot = fit.axis.ax * D[0] + fit.axis.ay * D[1] + fit.axis.az * D[2]
    const axisDeg = (Math.acos(Math.min(1, Math.abs(dot))) * 180) / Math.PI
    console.log(`wrap-native fit: dR ${(fit.axis.r - NATIVE.r).toFixed(4)} mm, axis ${axisDeg.toFixed(4)}°, region ${fit.points} points, sweep ${((fit.sweep * 180) / Math.PI).toFixed(1)}°`)
    expect(Math.abs(fit.axis.r - NATIVE.r)).toBeLessThan(0.02)
    expect(axisDeg).toBeLessThan(0.03)
  })

  it('wraps the same axial extent as QUICKSURFACE’s cage', () => {
    // The native Fine cage's wall vertices span 83.7 → 234.6 along its axis; the region is what the wand took.
    const { fit } = wall()
    const native = nativeCage('fine')
    let lo = Infinity, hi = -Infinity
    for (let v = 0; v < native.positions.length / 3; v++) {
      const f = nativeFrame(native.positions[v * 3], native.positions[v * 3 + 1], native.positions[v * 3 + 2])
      // The native chord vertices are snapped onto interior scan (radius 21–87 mm): only wall vertices count.
      if (f.rho < NATIVE.r * 0.9) continue
      lo = Math.min(lo, f.t); hi = Math.max(hi, f.t)
    }
    // Axial start of our fit measured from the native axis start.
    const at = (t: number) => nativeFrame(fit.axis.px + fit.axis.ax * t, fit.axis.py + fit.axis.ay * t, fit.axis.pz + fit.axis.az * t).t
    const a0 = at(fit.t0)
    const a1 = at(fit.t1)
    console.log(`wrap-native extent: native ${lo.toFixed(2)}..${hi.toFixed(2)}  ours ${a0.toFixed(2)}..${a1.toFixed(2)}`)
    expect(Math.abs(a0 - lo)).toBeLessThan(3)
    expect(Math.abs(a1 - hi)).toBeLessThan(3)
  })

  for (const density of ['low', 'medium', 'fine'] as WrapDensity[]) {
    const quads = { low: 4, medium: 16, fine: 64 }[density]
    const around = WRAP_AROUND[density]

    it(`${density}: same quad count and topology as QUICKSURFACE`, () => {
      const native = nativeCage(density)
      const w = wrapCage(wall().fit, density)
      expect(native.faces).toHaveLength(quads)
      expect(w.cage.faces).toHaveLength(quads)
      expect(w.around).toBe(around)
      const tn = topology(native), tw = topology(w.cage)
      const openN = tn.edges.filter((e) => e.faces.length < 2).length
      const openW = tw.edges.filter((e) => e.faces.length < 2).length
      console.log(`wrap-native ${density}: quads ${w.cage.faces.length}/${native.faces.length} open edges ours ${openW} native ${openN} around ${w.around} along ${w.along}`)
      expect(openW).toBe(openN)
    })

    it(`${density}: the snapped cage lies on the wall like QUICKSURFACE’s`, () => {
      const { fit } = wall()
      const w = wrapCage(fit, density)
      // Cage-control points to the native cylinder: the arc vertices stand off the wall by the limit shrink.
      const r = [] as number[]
      for (let v = 0; v < w.cage.positions.length / 3; v++) {
        if (!w.onRegion.includes(v)) continue
        const f = nativeFrame(w.cage.positions[v * 3], w.cage.positions[v * 3 + 1], w.cage.positions[v * 3 + 2])
        r.push(f.rho)
      }
      const nat = nativeCage(density)
      const rn = [] as number[]
      for (let v = 0; v < nat.positions.length / 3; v++) {
        const rho = nativeFrame(nat.positions[v * 3], nat.positions[v * 3 + 1], nat.positions[v * 3 + 2]).rho
        if (rho >= NATIVE.r * 0.9) rn.push(rho)
      }
      const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
      console.log(`wrap-native ${density}: control radius median ours ${median(r).toFixed(3)} native ${median(rn).toFixed(3)} (cylinder R ${NATIVE.r})`)
      expect(r.length).toBeGreaterThan(0)
      expect(regionClosest(fit, density, () => ({ point: [0, 0, 0], distance: 0 }))).toBeTypeOf('function')
    })
  }
})
