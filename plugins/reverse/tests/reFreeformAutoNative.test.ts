// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform on the real scan, against QUICKSURFACE 8.0.128's own.
//
// Native, measured on basic_part (analysis/freeform-2026-11-09): Basic Medium
// (target 2000) gives exactly 2000 quads, Fine (4000) 4014; each a closed
// genus-0 quad mesh with 2.6 % / 2.3 % of its vertices not of four edges, the
// mean edge 7.74 mm (Medium) and 5.40 mm (Fine), covering the whole part. The
// Medium cage is tests/fixtures/native-auto-basic-medium-quads.obj (the last
// 2000 faces; the 84 before are other freeforms of that document). Feature
// aligned at Medium gives 2079 / 4375 / 7759 / 11589 quads for Feature
// Details Low / Balanced / Higher / Highest, 1.2 % irregular at Balanced, and
// its Balanced cage converts to 104 CAD faces.
//
// QUICKSURFACE makes its Basic cages with Instant Meshes, which it ships; the
// layout here is a port of it (core/freeform/instant), so the counts, the
// topology and the share of irregular points are compared like for like.
// NOT claimed: the same quads (the layout's start is random), or Feature
// aligned's share of irregular points (its layout engine is proprietary; ours
// has about 2 % where it has 1.2 %).
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { rigidApply } from '../../../src/core/deviation/rigid'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import { fixture } from '../../../tests/fixtures'
import type { Cage } from '../core/freeform/cage'
import { AUTO_BUILD_STEPS, cageCounts, runAutoFreeform, scanProjector } from '../core/freeform/autoFreeform'
import { parseQuadObj } from '../core/freeform/cageIO'
import { fitCageToScan, surfaceDeviation } from '../core/freeform/limitFit'
import { freeformBody } from '../core/freeform/make'
import { ReKernel } from '../core/kernel'

vi.setConfig({ testTimeout: 600_000 })

const SCAN = fixture('basic_part-aligned.scanruler')
const here = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

function loadScan(path: string) {
  const zip = unzipSync(new Uint8Array(readFileSync(path)))
  const doc = JSON.parse(strFromU8(zip['project.json']))
  const stl = zip['scan.stl']
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength)
  const n = dv.getUint32(80, true)
  const soup = new Float32Array(n * 9)
  const q = new Float64Array(3)
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const o = 84 + i * 50 + 12 + k * 12
      rigidApply(doc.scan.appliedAlignment, dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true), q)
      soup.set(q, i * 9 + k * 3)
    }
  }
  return buildMeshGraph({ kind: 'soup', positions: soup })
}

function nativeMedium(): Cage {
  const all = parseQuadObj(here('native-auto-basic-medium-quads.obj'))
  const faces = all.faces.slice(all.faces.length - 2000)
  const used = [...new Set(faces.flat())].sort((a, b) => a - b)
  const map = new Map(used.map((v, i) => [v, i]))
  return { positions: Float64Array.from(used.flatMap((v) => [all.positions[v * 3], all.positions[v * 3 + 1], all.positions[v * 3 + 2]])), faces: faces.map((f) => f.map((v) => map.get(v) as number)), creases: [] }
}

function boxOf(c: Cage): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < c.positions.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], c.positions[i + k])
    max[k] = Math.max(max[k], c.positions[i + k])
  }
  return { min, max }
}

function euler(c: Cage): { V: number; E: number; F: number; loose: number } {
  const edges = new Map<string, number>()
  for (const f of c.faces) for (let k = 0; k < f.length; k++) {
    const a = f[k], b = f[(k + 1) % f.length]
    const key = a < b ? `${a},${b}` : `${b},${a}`
    edges.set(key, (edges.get(key) ?? 0) + 1)
  }
  return { V: c.positions.length / 3, E: edges.size, F: c.faces.length, loose: [...edges.values()].filter((n) => n !== 2).length }
}

describe.skipIf(!SCAN.exists)('Auto Freeform on basic_part against QUICKSURFACE', () => {
  // Skipped suites still collect their callback; load optional scans only when run.
  function prepare() {
    const g = loadScan(SCAN.path)
    const mesh = { positions: g.positions, indices: g.indices }
    const project = scanProjector(new ScanPaths(g.positions, g.indices))
    const native = nativeMedium()
    return { mesh, project, native }
  }
  let data: ReturnType<typeof prepare>
  beforeAll(() => { data = prepare() }, 120_000)

  it('Basic Medium: about 2000 quads, a closed sphere-like mesh, edge, box and irregular points like native’s', () => {
    const { mesh, native } = data
    const r = runAutoFreeform(mesh, { algorithm: 'basic', quads: 2000 })
    const t = euler(r.cage)
    expect(Math.abs(r.quads - 2000) / 2000).toBeLessThan(0.05)
    expect(t.loose).toBe(0)
    expect(t.V - t.E + t.F).toBe(2)
    expect(r.edge / 7.74).toBeGreaterThan(0.85)
    expect(r.edge / 7.74).toBeLessThan(1.15)
    // Native: 2.6 % of its vertices not of four edges. Ours, by the same layout method, within a point and a half of it.
    const theirs = cageCounts(native)
    console.info(`Auto Basic Medium: ours ${r.quads} quads, ${r.irregular} irregular (${((100 * r.irregular) / t.V).toFixed(2)} %), edge ${r.edge.toFixed(2)}; native ${native.faces.length} quads, ${theirs.irregular} irregular (${((100 * theirs.irregular) / (native.positions.length / 3)).toFixed(2)} %), edge ${theirs.edge.toFixed(2)}`)
    expect(r.irregular / t.V).toBeLessThan(theirs.irregular / (native.positions.length / 3) + 0.015)
    // The fitted cage lies about the scan's box, as native's control cage does (it overshoots the scan by up to 5.6 mm: the surface, not the cage, meets the scan).
    const ours = boxOf(r.cage)
    const sb = boxOf({ positions: Float64Array.from(mesh.positions), faces: [], creases: [] })
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(ours.min[k] - sb.min[k])).toBeLessThan(6)
      expect(Math.abs(ours.max[k] - sb.max[k])).toBeLessThan(6)
    }
  })

  it('Basic Fine: about 4000 quads, edge like native’s 5.40 mm', () => {
    const r = runAutoFreeform(data.mesh, { algorithm: 'basic', quads: 4000 })
    const t = euler(r.cage)
    expect(Math.abs(r.quads - 4014) / 4014).toBeLessThan(0.05)
    expect(t.loose).toBe(0)
    expect(t.V - t.E + t.F).toBe(2)
    expect(r.edge / 5.4).toBeGreaterThan(0.85)
    expect(r.edge / 5.4).toBeLessThan(1.15)
  })

  it('fitted, its surface lies as near the scan as native’s cage does through the same fit', () => {
    const { mesh, project, native } = data
    const r = runAutoFreeform(mesh, { algorithm: 'basic', quads: 2000 })
    const theirs = surfaceDeviation(fitCageToScan(native, project).cage, project, 0.05, 2)
    const ours = r.deviation
    console.info(`Auto Basic Medium, fitted: ours rms ${ours.rms.toFixed(3)} max ${ours.max.toFixed(2)} within 0.05 ${(ours.within / ours.points).toFixed(3)}; native rms ${theirs.rms.toFixed(3)} max ${theirs.max.toFixed(2)} within 0.05 ${(theirs.within / theirs.points).toFixed(3)}`)
    // Native's layout sits a little better on the part's sharp edges: ours is within a third of its rms (measured 0.16 against 0.14).
    expect(ours.rms).toBeLessThan(1.35 * theirs.rms)
    expect(ours.max).toBeLessThan(2 * theirs.max)
    expect(ours.within / ours.points).toBeGreaterThan(0.45)
    expect(ours.missed).toBe(0)
  })

  it('Feature aligned: Feature Details gives native’s counts, and the cage stays closed', () => {
    for (const [details, theirs] of [['low', 2079], ['balanced', 4375]] as const) {
      const r = runAutoFreeform(data.mesh, { algorithm: 'feature', quads: 2000, details })
      const t = euler(r.cage)
      console.info(`Auto Feature aligned Medium ${details}: ours ${r.quads} quads, ${((100 * r.irregular) / t.V).toFixed(2)} % irregular, rms ${r.deviation.rms.toFixed(3)}; native ${theirs} quads`)
      expect(Math.abs(r.quads - theirs) / theirs).toBeLessThan(0.06)
      expect(t.loose).toBe(0)
      expect(r.irregular / t.V).toBeLessThan(0.04)
    }
  })

  it('Refine to tolerance brings the surface nearer with more quads, and keeps the cage closed', () => {
    const plain = runAutoFreeform(data.mesh, { algorithm: 'basic', quads: 2000 })
    const refined = runAutoFreeform(data.mesh, { algorithm: 'basic', quads: 2000, refineTolerance: 0.1 })
    console.info(`Refine to 0.1: ${plain.quads} → ${refined.quads} quads, rms ${plain.deviation.rms.toFixed(3)} → ${refined.deviation.rms.toFixed(3)}, within 0.05 ${(plain.deviation.within / plain.deviation.points).toFixed(3)} → ${(refined.deviation.within / refined.deviation.points).toFixed(3)}`)
    expect(refined.quads).toBeGreaterThan(plain.quads)
    expect(refined.quads).toBeLessThanOrEqual(2 * plain.quads + 50)
    expect(refined.deviation.rms).toBeLessThan(0.85 * plain.deviation.rms)
    expect(refined.closed).toBe(true)
    expect(euler(refined.cage).loose).toBe(0)
  })

  it('converts to a closed, valid CAD solid of far fewer faces than quads', async () => {
    const k = await ReKernel.load()
    for (const [label, settings] of [['Basic Medium', { algorithm: 'basic', quads: 2000 }], ['Feature aligned Medium Balanced', { algorithm: 'feature', quads: 2000 }]] as const) {
      const r = runAutoFreeform(data.mesh, settings)
      const started = performance.now()
      const made = freeformBody(k, r.cage, { steps: AUTO_BUILD_STEPS, snap: false })
      try {
        console.info(`Auto ${label} convert: ${r.quads} quads → ${made.report.faces} faces in ${((performance.now() - started) / 1000).toFixed(1)} s, solid ${made.report.solid}, valid ${made.report.valid}, volume ${made.report.volume?.toFixed(0)}`)
        expect(made.report.solid, label).toBe(true)
        expect(made.report.valid, label).toBe(true)
        expect(made.report.volume ?? 0, label).toBeGreaterThan(0)
        expect(made.report.faces, label).toBeLessThan(r.quads / 3)
      } finally {
        k.release(made.shape)
      }
    }
  })
})
