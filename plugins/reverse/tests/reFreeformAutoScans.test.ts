// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform's acceptance on the real test scans (1.2.31), against what
// QUICKSURFACE 8.0.128 measured on the same files
// (analysis/quick-scan-v1.2.31/PLAN.md, section 5).
//
// The scans are the user's and third parties', kept outside the repository:
// QUICKSCAN_FIXTURES names the folder that holds lego/lego.stl,
// basic_part/basic_part.stl, aerosol_knob/aerosol_knob.stl,
// bearinghousing/bearinghousing.stl and machine_part/machine_part.stl. Each
// scan missing is skipped, and said so.
//
// Native, lego, Basic Medium: 2054 quads, one open piece of 22 rim edges,
// 6.5 % irregular; its CAD body 0.0594 mm rms and 0.642 mm at most from the
// scan; a first capture of the finished preview at 5.9 s.
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { fixture } from '../../../tests/fixtures'
import { featureDetailWeight } from '../core/freeform/autoFeatures'
import { loadAutoTools } from '../core/freeform/autoTools'
import { runAutoFreeform, type AutoOutcome, type AutoSettings } from '../core/freeform/autoFreeform'
import { mainPieces, meshArea, welded, withoutSlivers } from '../core/freeform/autoPrepare'

vi.setConfig({ testTimeout: 600_000 })

function readStl(path: string) {
  const b = readFileSync(path)
  const n = b.readUInt32LE(80)
  const positions = new Float32Array(n * 9)
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) positions[t * 9 + k] = b.readFloatLE(84 + t * 50 + 12 + k * 4)
  const indices = new Uint32Array(n * 3)
  for (let i = 0; i < indices.length; i++) indices[i] = i
  return welded({ positions, indices })
}

const record: Record<string, unknown>[] = []
const note = (scan: string, settings: AutoSettings, r: AutoOutcome, seconds: number) => {
  const inner = Math.max(1, r.vertices - r.boundaryEdges)
  const row = {
    scan, algorithm: settings.algorithm, target: settings.quads, details: settings.details, quads: r.quads, irregularPct: +((100 * r.irregular) / inner).toFixed(2), closed: r.closed, rimEdges: r.boundaryEdges,
    rms: +r.deviation.rms.toFixed(4), max: +r.deviation.max.toFixed(3), within005: +((100 * r.deviation.within) / r.deviation.points).toFixed(1), refined: r.refined, seconds: +seconds.toFixed(2),
    ms: Object.fromEntries(Object.entries(r.ms).map(([k, v]) => [k, Math.round(v)])),
  }
  record.push(row)
  console.info(JSON.stringify(row))
  if (process.env.AUTO_BENCH_OUT) writeFileSync(process.env.AUTO_BENCH_OUT, JSON.stringify(record, null, 2))
}

async function run(scan: string, mesh: ReturnType<typeof readStl>, settings: AutoSettings): Promise<{ r: AutoOutcome; seconds: number; longestGap: number }> {
  const tools = await loadAutoTools()
  let last = performance.now(), longestGap = 0
  const started = performance.now()
  const r = runAutoFreeform(mesh, settings, () => {
    const now = performance.now()
    longestGap = Math.max(longestGap, now - last)
    last = now
  }, tools)
  const seconds = (performance.now() - started) / 1000
  note(scan, settings, r, seconds)
  return { r, seconds, longestGap }
}

const LEGO = fixture('lego/lego.stl')
describe.skipIf(!LEGO.exists)('Auto Freeform on lego against QUICKSURFACE', () => {
  it('Basic Medium: an open cage like native’s, nearer the scan than native’s body, in a few seconds', async () => {
    const mesh = readStl(LEGO.path)
    const { r, seconds, longestGap } = await run('lego', mesh, { algorithm: 'basic', quads: 2000 })
    // Native 2054 quads, 22 rim edges, 6.5 % irregular.
    expect(Math.abs(r.quads - 2000) / 2000).toBeLessThan(0.05)
    expect(r.closed).toBe(false)
    expect(r.boundaryEdges).toBeGreaterThanOrEqual(16)
    expect(r.boundaryEdges).toBeLessThanOrEqual(60)
    expect(r.irregular / (r.vertices - r.boundaryEdges)).toBeLessThan(0.08)
    expect(r.pieces).toBeGreaterThan(1)
    expect(r.piecesKept).toBe(1)
    // Native's CAD body: 0.0594 mm rms, 0.642 mm at most.
    expect(r.deviation.rms).toBeLessThan(0.0594)
    expect(r.deviation.max).toBeLessThan(0.642)
    expect(r.deviation.within / r.deviation.points).toBeGreaterThan(0.85)
    // Native's preview: 5.9 s at most. Twice that is allowed for a machine busy with the rest of the suite.
    expect(seconds).toBeLessThan(12)
    // Progress comes often enough for a bar that moves.
    expect(longestGap).toBeLessThan(3000)
  })

  it('Refine to tolerance brings more of it within 0.05 mm', async () => {
    const mesh = readStl(LEGO.path)
    const { r } = await run('lego', mesh, { algorithm: 'basic', quads: 2000, refineTolerance: 0.05 })
    expect(r.refined).toBeGreaterThan(200)
    expect(r.quads).toBeLessThanOrEqual(4100)
    expect(r.deviation.within / r.deviation.points).toBeGreaterThan(0.95)
    expect(r.deviation.rms).toBeLessThan(0.03)
  })
})

for (const name of ['basic_part', 'aerosol_knob', 'bearinghousing', 'machine_part']) {
  const f = fixture(`${name}/${name}.stl`)
  describe.skipIf(!f.exists)(`Auto Freeform on ${name}`, () => {
    it('Basic and Feature aligned at Medium: all quads, a manifold cage near the target, fitted', async () => {
      const mesh = readStl(f.path)
      for (const settings of [{ algorithm: 'basic', quads: 2000 }, { algorithm: 'feature', quads: 2000 }] as AutoSettings[]) {
        const { r } = await run(name, mesh, settings)
        const kept = mainPieces(withoutSlivers(mesh)).mesh
        const want = settings.algorithm === 'basic' ? 2000 : 2000 * (1 + 1.19 * featureDetailWeight(kept, meshArea(kept)))
        expect(Math.abs(r.quads - want) / want, `${name} ${settings.algorithm}`).toBeLessThan(0.08)
        expect(r.cage.faces.every((q) => q.length === 4 && new Set(q).size === 4)).toBe(true)
        const edges = new Map<string, number>()
        for (const q of r.cage.faces) for (let k = 0; k < 4; k++) {
          const a = q[k], b = q[(k + 1) % 4]
          const key = a < b ? `${a},${b}` : `${b},${a}`
          edges.set(key, (edges.get(key) ?? 0) + 1)
        }
        expect([...edges.values()].every((n) => n <= 2)).toBe(true)
        expect(r.irregular / Math.max(1, r.vertices - r.boundaryEdges), `${name} ${settings.algorithm}`).toBeLessThan(0.12)
        expect(r.deviation.within / r.deviation.points, `${name} ${settings.algorithm}`).toBeGreaterThan(0.4)
      }
    })
  })
}
