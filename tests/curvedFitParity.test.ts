// SPDX-License-Identifier: AGPL-3.0-only
// Curved fits on a marked area against QUICKSURFACE 8.0.128, measured
// 2026-11-04 (analysis/fit-accuracy-2026-11-04). The mesh is rebuilt here
// exactly as make-shapes2.mjs wrote it for QUICKSURFACE: a 150° wall of a
// Ø100 cylinder, half of it meshed 8× denser and standing 0.03 mm proud, with
// 0.01 mm of noise. QUICKSURFACE, fitting it whole ("Select all connected
// triangles"), counted every vertex once, so the dense half pulls its fit;
// Quick Scan's selection fit must land on the same cylinder.
import { describe, expect, it } from 'vitest'
import { buildMeshGraph } from '../src/core/geometry/buildGraph'
import { fitCylinderOnSelection } from '../src/core/fit/fitCylinderFromSeed'
import { fitLineOnSelection } from '../src/core/fit/fitLineOnSelection'

const deg = Math.PI / 180
let seed = 12345
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())
function nodes(a: number, b: number, split: number, fine: number, coarse: number): number[] {
  const out: number[] = []
  for (let x = a; x < split - 1e-9; x += fine) out.push(x)
  for (let x = split; x < b + 1e-9; x += coarse) out.push(Math.min(x, b))
  return out
}

/** make-shapes2.mjs's cyl-dense-small, triangle for triangle. */
function denseCylinder(): Float32Array {
  const R = 50, L = 100, step = 2
  const thetas = nodes(0, 150, 75, 0.25, 2)
  const zs = nodes(0, L, L + 1, step, step)
  const P = thetas.map((th) => zs.map((z) => {
    const d = (th < 75 ? 0.03 : 0) + 0.01 * gauss()
    const c = Math.cos((th + 200) * deg), s = Math.sin((th + 200) * deg)
    return [R * c + d * c, R * s + d * s, z]
  }))
  const out: number[] = []
  for (let i = 0; i + 1 < thetas.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
    const a = P[i][j], b = P[i + 1][j], c = P[i + 1][j + 1], d = P[i][j + 1]
    out.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  // Rounded to the binary STL's single precision, as QUICKSURFACE read it.
  return new Float32Array(out)
}

/** make-lines.mjs's line-ridge: a 100 mm fold, two 2 mm faces 15° down
 *  either side of the crest, along unit(1, 0.3, 0.1) through (0, 24, 0). */
function ridge(): Float32Array {
  const unit = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l) }
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const U = unit([1, 0.3, 0.1]), V = unit(cross([0, 0, 1], U)), N = unit(cross(U, V))
  const range = (a: number, b: number, s: number) => { const o: number[] = []; for (let x = a; x < b - 1e-9; x += s) o.push(x); o.push(b); return o }
  const drop = Math.tan(15 * deg)
  const at = (u: number, v: number) => { const w = -drop * Math.abs(v); return [0, 1, 2].map((k) => [0, 24, 0][k] + u * U[k] + v * V[k] + w * N[k]) }
  const us = range(-50, 50, 0.5), vs = range(-2, 2, 0.25)
  const out: number[] = []
  for (let i = 0; i + 1 < us.length; i++) for (let j = 0; j + 1 < vs.length; j++) {
    const a = at(us[i], vs[j]), b = at(us[i + 1], vs[j]), c = at(us[i + 1], vs[j + 1]), d = at(us[i], vs[j + 1])
    out.push(...a, ...b, ...c, ...a, ...c, ...d)
  }
  return new Float32Array(out)
}

describe('line on a marked area, against QUICKSURFACE', () => {
  it('lies where QUICKSURFACE puts it on a folded edge, nearer the crest than least squares', () => {
    const g = buildMeshGraph({ kind: 'soup', positions: ridge() })
    const all = new Uint32Array(g.vertexCount).map((_, i) => i)
    const f = fitLineOnSelection(g, all, { method: 'gaussian', sigma: 0 })
    // QUICKSURFACE's Line dialog: start and end points, six decimals.
    for (const q of [[-47.659264, 9.70221, -4.918433], [47.686993, 38.306106, 4.616183]]) {
      const d = q.map((x, k) => x - f.center[k])
      const t = d[0] * f.dir[0] + d[1] * f.dir[1] + d[2] * f.dir[2]
      expect(Math.hypot(d[0] - t * f.dir[0], d[1] - t * f.dir[1], d[2] - t * f.dir[2])).toBeLessThan(5e-5)
    }
    expect(f.length).toBeCloseTo(100, 4)
  })
})

describe('curved fit on a marked area, against QUICKSURFACE', () => {
  it('fits the dense-half cylinder where QUICKSURFACE did', () => {
    const g = buildMeshGraph({ kind: 'soup', positions: denseCylinder() })
    const all = new Uint32Array(g.vertexCount).map((_, i) => i)
    const f = fitCylinderOnSelection(g, all, { method: 'gaussian', sigma: 0 })
    // QUICKSURFACE's Cylinder dialog: Ø100.007954, axis (−2.2e−6, 0, 1)
    // through (−0.018341, −0.020339, −55.000224) — its fields carry six decimals.
    expect(2 * f.radius).toBeCloseTo(100.007954, 4)
    const a = f.axis[2] < 0 ? f.axis.map((x) => -x) : f.axis
    expect(Math.acos(Math.min(1, a[2])) / deg).toBeLessThan(0.001)
    // Where the axis crosses QUICKSURFACE's base point's height.
    const t = (-55.000224 - f.center[2]) / a[2]
    expect(f.center[0] + t * a[0]).toBeCloseTo(-0.018341, 4)
    expect(f.center[1] + t * a[1]).toBeCloseTo(-0.020339, 4)
  })
})
