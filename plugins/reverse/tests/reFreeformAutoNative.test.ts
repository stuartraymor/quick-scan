// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform, Basic on the real scan, against QUICKSURFACE 8.0.128's own
// (F6 of audit-2026-11-07/FREEFORM_ROADMAP.md).
//
// Native, measured on basic_part (analysis/freeform-2026-11-09): Medium (target
// 2000) gives exactly 2000 quads, Fine (4000) 4014; each a closed genus-0 quad
// mesh with 2.6 % / 2.3 % of its vertices not of four edges, the mean edge
// 7.74 mm (Medium) and 5.40 mm (Fine), covering the whole part. The Medium cage
// is tests/fixtures/native-auto-basic-medium-quads.obj (the last 2000 faces;
// the 84 before are other freeforms of that document).
// Compared here: the counts, the topology, the mean edge, the box, and how
// far the surface of each cage — ours, and native's through the same snap —
// lies from the scan.
// NOT claimed: the same quads (native's layout is its own), the same share of
// irregular vertices (ours, from cubes, has about three times as many), or
// the same worst deviation (native's is 1.7 mm after the snap, ours several), or a cage box like native's, whose control cage overshoots the scan by up to 5.6 mm.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { rigidApply } from '../../../src/core/deviation/rigid'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import { fixture } from '../../../tests/fixtures'
import type { Cage } from '../core/freeform/cage'
import { autoCage } from '../core/freeform/auto'
import { parseQuadObj } from '../core/freeform/cageIO'
import { deviation, snapCage } from '../core/freeform/edit'
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

describe.skipIf(!SCAN.exists)('Auto Freeform, Basic on basic_part against QUICKSURFACE', () => {
  const g = loadScan(SCAN.path)
  const scan = new ScanPaths(g.positions, g.indices)
  const closest = (p: [number, number, number]) => {
    const c = scan.closest(p)
    return c ? { point: c.point, distance: c.distance } : null
  }
  const native = nativeMedium()

  it('Medium: about 2000 quads, a closed sphere-like mesh, edge and box like native’s', () => {
    const r = autoCage(scan, 2000)
    const t = euler(r.cage)
    expect(Math.abs(r.quads - 2000) / 2000).toBeLessThan(0.02)
    expect(t.loose).toBe(0)
    expect(t.V - t.E + t.F).toBe(2)
    expect(r.edge / 7.74).toBeGreaterThan(0.85)
    expect(r.edge / 7.74).toBeLessThan(1.15)
    // Mostly of four edges, though not as nearly all as native's 97.4 %.
    expect(r.irregular / t.V).toBeLessThan(0.12)
    // The box of the scan: ours lies on it to within a millimetre; native's control cage lies outside it by up to 5.6 mm (its limit surface, not the cage, is what meets the scan).
    const ours = boxOf(r.cage)
    const sb = boxOf({ positions: Float64Array.from(scan.positions), faces: [], creases: [] })
    const theirs = boxOf(native)
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(ours.min[k] - sb.min[k])).toBeLessThan(1)
      expect(Math.abs(ours.max[k] - sb.max[k])).toBeLessThan(1)
      expect(theirs.min[k]).toBeLessThanOrEqual(sb.min[k] + 0.5)
      expect(theirs.max[k]).toBeGreaterThanOrEqual(sb.max[k] - 0.5)
    }
  })

  it('Fine: about 4000 quads, edge like native’s 5.40 mm', () => {
    const r = autoCage(scan, 4000)
    const t = euler(r.cage)
    expect(Math.abs(r.quads - 4014) / 4014).toBeLessThan(0.03)
    expect(t.loose).toBe(0)
    expect(t.V - t.E + t.F).toBe(2)
    expect(r.edge / 5.4).toBeGreaterThan(0.85)
    expect(r.edge / 5.4).toBeLessThan(1.15)
  })

  it('snapped, its surface lies as near the scan as native’s does (rms within twice, most points near)', () => {
    const r = autoCage(scan, 2000)
    const ours = deviation(snapCage(r.cage, closest, 8, 0.01).cage, closest, 0.05, 2)
    const theirs = deviation(snapCage(native, closest, 8, 0.01).cage, closest, 0.05, 2)
    console.info(`Auto Basic Medium, snapped: ours rms ${ours.rms.toFixed(3)} max ${ours.max.toFixed(2)} within 0.05 ${(ours.within / ours.points).toFixed(3)}; native rms ${theirs.rms.toFixed(3)} max ${theirs.max.toFixed(2)} within 0.05 ${(theirs.within / theirs.points).toFixed(3)}`)
    expect(ours.rms).toBeLessThan(2 * theirs.rms)
    expect(ours.within / ours.points).toBeGreaterThan(0.5)
    expect(ours.missed).toBe(0)
  })

  it('converts to a closed, valid CAD solid (sewn at 0.05 mm, not a micron; native’s own Medium cage does the same, as one face a quad, which takes half a minute and is measured, not run here)', async () => {
    const k = await ReKernel.load()
    for (const [label, cage] of [['ours', autoCage(scan, 2000).cage]] as [string, Cage][]) {
      const made = freeformBody(k, cage, { steps: 2, snap: false })
      try {
        console.info(`Auto Basic Medium convert (${label}): ${made.report.faces} faces, solid ${made.report.solid}, valid ${made.report.valid}, volume ${made.report.volume?.toFixed(0)}`)
        expect(made.report.solid, label).toBe(true)
        expect(made.report.valid, label).toBe(true)
        expect(made.report.volume ?? 0, label).toBeGreaterThan(0)
      } finally {
        k.release(made.shape)
      }
    }
  })
})
