// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform with Symmetry (F7 of audit-2026-11-07/FREEFORM_ROADMAP.md).
//
// Native, measured on 8.0.128 (analysis/freeform-2026-11-09, Feature aligned,
// Medium, Balanced, Symmetry OYZ on basic_part): the cage is exactly
// mirror-symmetric about x = 0 — all 4283 vertices of its main component have
// a partner at the mirror position to 0.0001 mm, 121 of them on the plane. The
// component is tests/fixtures/native-auto-feature-oyz-quads.obj.
// Compared here: that property, in native's cage and in ours, plus closure and
// counts. NOT claimed: native's feature-aligned layout (see FREEFORM_ROADMAP.md).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildMeshGraph } from '../../../src/core/geometry/buildGraph'
import { rigidApply } from '../../../src/core/deviation/rigid'
import { ScanPaths } from '../../../src/core/geometry/scanPath'
import { fixture } from '../../../tests/fixtures'
import { AutoError, autoCage, type AutoSymmetry } from '../core/freeform/auto'
import { parseQuadObj } from '../core/freeform/cageIO'
import { sphereScan } from './networkMeshes'

const PLANES: [AutoSymmetry, number][] = [['oyz', 0], ['oxz', 1], ['oxy', 2]]

/** The worst distance from a vertex's mirror image (about the plane normal to `axis` at 0) to the cage's nearest vertex, and the count on the plane. */
function mirrorError(positions: Float64Array, axis: number): { worst: number; onPlane: number } {
  const n = positions.length / 3
  const cell = (c: number) => Math.round(c / 3)
  const grid = new Map<string, number[]>()
  for (let v = 0; v < n; v++) {
    const k = [0, 1, 2].map((a) => cell(positions[v * 3 + a])).join(',')
    const l = grid.get(k)
    if (l) l.push(v)
    else grid.set(k, [v])
  }
  let worst = 0
  let onPlane = 0
  for (let v = 0; v < n; v++) {
    const m = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]
    if (Math.abs(m[axis]) < 1e-6) onPlane++
    m[axis] = -m[axis]
    const [a, b, c] = m.map(cell)
    let best = Infinity
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      for (const w of grid.get(`${a + i},${b + j},${c + k}`) ?? []) best = Math.min(best, Math.hypot(positions[w * 3] - m[0], positions[w * 3 + 1] - m[1], positions[w * 3 + 2] - m[2]))
    }
    worst = Math.max(worst, best)
  }
  return { worst, onPlane }
}

function loops(c: { faces: number[][] }): number {
  const edges = new Map<string, number>()
  for (const f of c.faces) for (let k = 0; k < f.length; k++) {
    const a = f[k], b = f[(k + 1) % f.length]
    const key = a < b ? `${a},${b}` : `${b},${a}`
    edges.set(key, (edges.get(key) ?? 0) + 1)
  }
  return [...edges.values()].filter((n) => n !== 2).length
}

describe('autoCage with symmetry', () => {
  const sphere = sphereScan(30, 0.01, 5)
  const scan = new ScanPaths(sphere.positions, sphere.indices)

  it.each(PLANES)('%s: the cage is closed, near the target, and exactly mirror-symmetric', (sym, axis) => {
    const r = autoCage(scan, 1000, 2, 0.5, sym)
    expect(Math.abs(r.quads - 1000) / 1000).toBeLessThan(0.06)
    expect(loops(r.cage)).toBe(0)
    expect(r.mirror?.axis).toBe(axis)
    const e = mirrorError(r.cage.positions, axis)
    expect(e.worst).toBeLessThan(1e-9)
    expect(e.onPlane).toBeGreaterThan(20)
    // Every vertex has a partner, a plane vertex is its own.
    expect(r.mirror!.partner.every((p) => p >= 0)).toBe(true)
    expect(r.mirror!.partner.filter((p, v) => p === v).length).toBe(e.onPlane)
  })

  it('no symmetry leaves the cage as it was, with no mirror', () => {
    const r = autoCage(scan, 1000)
    expect(r.mirror).toBeUndefined()
  })

  it('refuses a scan the plane does not cross, and an unknown plane', () => {
    const moved = Float32Array.from(sphere.positions)
    for (let i = 0; i < moved.length; i += 3) moved[i] += 100
    expect(() => autoCage(new ScanPaths(moved, sphere.indices), 500, 2, 0.5, 'oyz')).toThrow(AutoError)
    expect(() => autoCage(scan, 500, 2, 0.5, 'bogus' as AutoSymmetry)).toThrow(AutoError)
  })
})

const SCAN = fixture('basic_part-aligned.scanruler')

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

describe.skipIf(!SCAN.exists)('Symmetry OYZ on basic_part against QUICKSURFACE', () => {
  it('native’s cage is mirror-symmetric about x = 0; so is ours, with a comparable share on the plane', () => {
    const text = readFileSync(new URL('./fixtures/native-auto-feature-oyz-quads.obj', import.meta.url), 'utf8')
    const native = parseQuadObj(text)
    const theirs = mirrorError(native.positions, 0)
    expect(theirs.worst).toBeLessThan(1e-3)
    expect(theirs.onPlane).toBe(121)
    const g = loadScan(SCAN.path)
    const scan = new ScanPaths(g.positions, g.indices)
    const r = autoCage(scan, 4280, 2, 0.5, 'oyz')
    const ours = mirrorError(r.cage.positions, 0)
    console.info(`Symmetry OYZ: native ${native.positions.length / 3} vertices, ${theirs.onPlane} on the plane, mirror error ${theirs.worst.toExponential(1)}; ours ${r.cage.positions.length / 3} vertices (${r.quads} quads), ${ours.onPlane} on the plane, mirror error ${ours.worst.toExponential(1)}`)
    expect(ours.worst).toBeLessThan(1e-9)
    expect(loops(r.cage)).toBe(0)
    expect(Math.abs(r.quads - 4280) / 4280).toBeLessThan(0.03)
    // The plane's share of the vertices: native 2.8 %.
    const share = ours.onPlane / (r.cage.positions.length / 3)
    expect(share).toBeGreaterThan(0.015)
    expect(share).toBeLessThan(0.06)
  })
})
