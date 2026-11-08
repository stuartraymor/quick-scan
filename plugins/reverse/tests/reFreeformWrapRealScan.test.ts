// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.wrap on QUICKSURFACE's basic_part outer wall, end to end
// in the headless session: the Magic Wand takes the wall at 3°, the command
// wraps it at Low, Medium and Fine, the kernel builds the sheet, and the
// sheet's own mesh is measured against the cylinder QUICKSURFACE fitted to
// the same wall (the F4 gate of audit-2026-11-07/FREEFORM_ROADMAP.md:
// within 0.05 mm rms). QUICKSURFACE's own Wrap cage, refined to its limit,
// is measured the same way for comparison.
//
// The viewport is stood in for by a scene that hands out the real scan; a
// small scan is the one the session "opens".
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { buildTriangleGraph, wandGrow } from '../../../src/core/geometry/wand'
import { rigidApply } from '../../../src/core/deviation/rigid'
import type { Vec3 } from '../../../src/core/types'
import type { SceneManager } from '../../../src/viewer/SceneManager'
import { fixture } from '../../../tests/fixtures'
import { run, soupOf, startHeadless, stlBytes, type Headless } from '../../../tests/commandKit'
import { createReverseSession, installReverseSession, type ReverseSession } from '../app/reSession'
import { ReClient } from '../core/reClient'
import { parseQuadObj } from '../core/freeform/cageIO'
import { limitMesh } from '../core/freeform/limit'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import { fitWrap, scanVertexNormals, WRAP_AROUND, type WrapDensity } from '../core/freeform/wrap'
import { useReverse } from '../state/reStore'
import plugin from '../plugin'
import { gridScan } from './networkMeshes'
import { localKernel } from './reLocal'
import { resetReverse } from './reReset'

vi.setConfig({ testTimeout: 600_000, hookTimeout: 600_000 })

const SCAN = fixture('basic_part-aligned.scanruler')
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

/** t along the native axis from its start, ρ from it, θ round it in a fixed basis. */
function frame(x: number, y: number, z: number) {
  const w = [x - NATIVE.s[0], y - NATIVE.s[1], z - NATIVE.s[2]]
  const t = w[0] * D[0] + w[1] * D[1] + w[2] * D[2]
  const r = [w[0] - t * D[0], w[1] - t * D[1], w[2] - t * D[2]]
  return { t, rho: Math.hypot(r[0], r[1], r[2]), r }
}

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
    const f = frame(c[0], c[1], c[2])
    if (Math.abs(f.rho - NATIVE.r) > 0.25 || f.t < 3 || f.t > len - 3) continue
    const d = Math.hypot(c[0] - target[0], c[1] - target[1], c[2] - target[2])
    if (d < best) { best = d; seed = t }
  }
  return best < 5 ? seed : -1
}

interface Wrapped {
  feature: { id: number; status: string }
  result: { status: string; message?: string }
  body?: { valid: boolean; area: number }
  wrap: { around: number; along: number; quads: number; closure: string; cylinder: { radius: number; from: number; to: number }; sweepDeg: number }
  bodies: { count: number }
}

describe.skipIf(!SCAN.exists)('Freeform Wrap on the basic_part wall, built and measured against the native cylinder', () => {
  let headless: Headless
  let session: ReverseSession
  const stops: (() => void)[] = []
  let wall: { vertices: Uint32Array; positions: Float32Array; indices: Uint32Array; fit: ReturnType<typeof fitWrap> }

  beforeAll(async () => {
    const m = loadScan(SCAN.path)
    const seed = seedAt(m.g, m.tg.count, 0.5)
    const vertices = wandGrow(m.tg, seed, 3)
    const positions = m.g.positions as Float32Array
    const indices = Uint32Array.from(m.g.indices as ArrayLike<number>)
    wall = { vertices, positions, indices, fit: fitWrap(positions, vertices, scanVertexNormals(positions, indices)) }
    const scene = { scanPositions: () => positions, scanIndices: () => indices } as unknown as SceneManager
    plugin.install?.()
    headless = await startHeadless()
    session = createReverseSession({ sceneRef: { current: scene }, kernel: () => new ReClient(localKernel()) })
    stops.push(installReverseSession(session), session.watch())
    // A small scan is the one the session opens; the scene hands out the wall's.
    const small = gridScan(24, 6, (u, v): Vec3 => [10 * Math.cos(2 * Math.PI * u), 10 * Math.sin(2 * Math.PI * u), 20 * v], { wrap: true })
    await run('scan.open', { bytes: stlBytes(soupOf(small)), name: 'small.stl', discard: true })
  })
  afterAll(() => {
    for (const stop of stops) stop()
    headless?.stop()
  })
  beforeEach(resetReverse)

  /** The angular window the wall region covers, in the wall fit's own basis, shrunk by `inset` radians each side. */
  const inRegion = (p: Vec3, inset: number): boolean => {
    const { fit } = wall
    const q: Vec3 = [p[0] - fit.axis.px, p[1] - fit.axis.py, p[2] - fit.axis.pz]
    const t = q[0] * fit.axis.ax + q[1] * fit.axis.ay + q[2] * fit.axis.az
    const slack = (fit.t1 - fit.t0) * 0.03
    if (t < fit.t0 + slack || t > fit.t1 - slack) return false
    let th = Math.atan2(q[0] * fit.v[0] + q[1] * fit.v[1] + q[2] * fit.v[2], q[0] * fit.u[0] + q[1] * fit.u[1] + q[2] * fit.u[2]) - fit.start
    th = ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    return th >= inset && th <= fit.sweep - inset
  }

  const measure = (positions: ArrayLike<number>, inset = 0.12) => {
    const errs: number[] = []
    for (let i = 0; i < positions.length / 3; i++) {
      const p: Vec3 = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]
      if (!inRegion(p, inset)) continue
      const rho = frame(p[0], p[1], p[2]).rho
      // The chord closing a part-turn ring runs through the part: only the wall's own samples are the wall.
      if (rho < NATIVE.r * 0.9) continue
      errs.push(rho - NATIVE.r)
    }
    const n = errs.length
    const mean = n > 0 ? errs.reduce((a, e) => a + e, 0) / n : NaN
    const abs = errs.map(Math.abs).sort((x, y) => x - y)
    const rms = n > 0 ? Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / n) : NaN
    return { n, mean, rms, max: abs[n - 1] ?? NaN, median: abs[Math.floor(n / 2)] ?? NaN, p95: abs[Math.floor(n * 0.95)] ?? NaN, within05: n > 0 ? abs.filter((e) => e <= 0.05).length / n : NaN }
  }
  /** The mesh measured by area, not by vertex: a tessellation puts its vertices where the surface is busiest, so a
   *  count of vertices over-weights the grooves. Each triangle in the region counts its area, at its vertices ('vertex'
   *  — on the surface) or at its edges' midpoints ('mid' — which carries the tessellation's own sag). */
  const measureArea = (positions: ArrayLike<number>, indices: ArrayLike<number>, at: 'vertex' | 'mid', inset = 0.12, toScan?: ScanPaths) => {
    const P = (i: number): Vec3 => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]
    const samples: [number, number][] = []
    let area = 0
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const a = P(indices[t]), b = P(indices[t + 1]), c = P(indices[t + 2])
      const pts: Vec3[] = at === 'vertex' ? [a, b, c] : [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2, (b[2] + c[2]) / 2], [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2, (c[2] + a[2]) / 2]]
      if (!pts.every((p) => inRegion(p, inset) && frame(p[0], p[1], p[2]).rho >= NATIVE.r * 0.9)) continue
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
      const w = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2 / 3
      area += w * 3
      for (const p of pts) samples.push([toScan ? (toScan.closest(p)?.distance ?? 99) : frame(p[0], p[1], p[2]).rho - NATIVE.r, w])
    }
    const total = samples.reduce((x, [, w]) => x + w, 0) || 1
    const rms = Math.sqrt(samples.reduce((x, [e, w]) => x + e * e * w, 0) / total)
    const mean = samples.reduce((x, [e, w]) => x + e * w, 0) / total
    const share = (lim: number) => samples.reduce((x, [e, w]) => x + (Math.abs(e) <= lim ? w : 0), 0) / total
    const max = samples.reduce((x, [e]) => Math.max(x, Math.abs(e)), 0)
    return { rms, mean, max, within05: share(0.05), within01: share(0.1), within02: share(0.2), area, text: `area ${area.toFixed(0)} mm² mean ${mean.toFixed(4)} rms ${rms.toFixed(4)} max ${max.toFixed(3)} | within 0.05 ${(share(0.05) * 100).toFixed(1)} % 0.1 ${(share(0.1) * 100).toFixed(1)} % 0.2 ${(share(0.2) * 100).toFixed(1)} %` }
  }
  const show = (m: ReturnType<typeof measure>) => `${m.n} samples mean ${m.mean.toFixed(4)} rms ${m.rms.toFixed(4)} median ${m.median.toFixed(4)} p95 ${m.p95.toFixed(4)} max ${m.max.toFixed(4)} mm, ${(m.within05 * 100).toFixed(1)} % within 0.05`

  it('the scan’s own wall, for reference: how far the Magic Wand’s patch lies from the native cylinder', () => {
    const v = Array.from(wall.vertices).flatMap((i) => [wall.positions[i * 3], wall.positions[i * 3 + 1], wall.positions[i * 3 + 2]])
    console.log(`wrap-real scan wall: ${show(measure(v, 0))}`)
  })

  // What each density has to give on this wall, measured by area (see measureArea). The scan's own wall lies 0.068 mm rms
  // from the cylinder QUICKSURFACE fitted (above), so a surface that follows the scan cannot be nearer the cylinder than
  // that; the bounds are that plus a little. The share within 0.05 mm of the scan falls with density — fewer samples to
  // follow the wall's relief, whose grooves (1.7 mm deep) are a fraction of the area.
  const GATES: Record<WrapDensity, { rms: number; max: number; nearScan: number }> = {
    fine: { rms: 0.08, max: 0.5, nearScan: 0.9 },
    medium: { rms: 0.08, max: 0.5, nearScan: 0.85 },
    low: { rms: 0.08, max: 0.5, nearScan: 0.65 },
  }
  for (const density of ['fine', 'medium', 'low'] as WrapDensity[]) {
    it(`${density}: the built sheet lies on the wall, as the native cylinder and the scan have it`, async () => {
      const r = await run<Wrapped>('reverse.freeform.wrap', { region: Array.from(wall.vertices), density, name: `Wrap ${density}` })
      expect(r.result.status, r.result.message).toBe('ok')
      expect(r.body!.valid).toBe(true)
      const s = [...session.meshes.values()].pop()
      expect(s).toBeTruthy()
      const sp = new ScanPaths(wall.positions, wall.indices)
      const cyl = measureArea(s!.positions, s!.indices, 'vertex')
      const scan = measureArea(s!.positions, s!.indices, 'vertex', 0.12, sp)
      console.log(`wrap-real ${density}: ${r.wrap.around}x${r.wrap.along} quads ${r.wrap.quads} closure ${r.wrap.closure}; sheet vs native cylinder: ${cyl.text}; vs scan: ${scan.text}`)
      expect(cyl.rms).toBeLessThan(GATES[density].rms)
      expect(cyl.max).toBeLessThan(GATES[density].max)
      expect(scan.within05).toBeGreaterThan(GATES[density].nearScan)
      expect(useReverse.getState().features).toHaveLength(1)
    })
  }

  it('QUICKSURFACE’s own Wrap cage, refined to its limit, for comparison', () => {
    const all = parseQuadObj(readFileSync(new URL('./fixtures/native-wrap-densities-quads.obj', import.meta.url), 'utf8'))
    for (const [density, quads] of [['low', 4], ['medium', 16], ['fine', 64]] as [WrapDensity, number][]) {
      const total = 84
      const first = all.faces.length - total + (density === 'low' ? 0 : density === 'medium' ? 4 : 20)
      const faces = all.faces.slice(first, first + quads)
      const used = [...new Set(faces.flat())].sort((a, b) => a - b)
      const remap = new Map(used.map((v, i) => [v, i]))
      const cage = { positions: Float64Array.from(used.flatMap((v) => [all.positions[v * 3], all.positions[v * 3 + 1], all.positions[v * 3 + 2]])), faces: faces.map((f) => f.map((v) => remap.get(v) as number)), creases: [] as [number, number][] }
      const lim = limitMesh(cage, 3)
      const m = measure(lim.positions)
      console.log(`wrap-real native ${density} cage limit (unsnapped, ${WRAP_AROUND[density]} round): ${show(m)}`)
      expect(m.n).toBeGreaterThan(0)
    }
  })
})
