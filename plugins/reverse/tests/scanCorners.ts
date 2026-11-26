// SPDX-License-Identifier: AGPL-3.0-only
// Corners between two flats of a scan section, found by simplifying each
// slice chain (as reAutoFilletStress.test.ts does) for tests that brush and
// fillet them.
import type { Vec2 } from '../../../src/core/flat/types'

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
const lineDist = (p: Vec2, a: Vec2, b: Vec2) => { const d = sub(b, a), l = Math.hypot(d[0], d[1]); return Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / l }

/** Douglas–Peucker vertex indices of a chain (closed or open). */
function simplify(chain: Vec2[], tol: number): number[] {
  const keep = new Set([0, chain.length - 1])
  const rec = (i: number, j: number) => {
    let best = -1, bd = tol
    for (let k = i + 1; k < j; k++) { const d = dist(chain[i], chain[j]) > 1e-9 ? lineDist(chain[k], chain[i], chain[j]) : dist(chain[k], chain[i]); if (d > bd) { bd = d; best = k } }
    if (best >= 0) { keep.add(best); rec(i, best); rec(best, j) }
  }
  let far = 0
  for (let k = 1; k < chain.length; k++) if (dist(chain[k], chain[0]) > dist(chain[far], chain[0])) far = k
  keep.add(far); rec(0, far); rec(far, chain.length - 1)
  return [...keep].sort((a, b) => a - b)
}

/** A straight stretch of a chain: chain indices i..j, ends a and b. */
export interface Flat { i: number; j: number; a: Vec2; b: Vec2; length: number }
/** Two neighbouring flats, A ending (at A.b) where the corner starts and B
 *  starting (at B.a) after it. */
export interface ScanCorner { section: string; A: Flat; B: Flat; chain: Vec2[]; chainIndex: number; turn: number }

/** Corners between flats at least `minFlat` long that turn 20° to 160°.
 *  The flats' scale follows the section's size, so small parts count too. */
export function cornersOf(section: { axis: string; offset: number; chains: Vec2[][] }, options: { minFlat?: number; tol?: number } = {}): ScanCorner[] {
  const out: ScanCorner[] = []
  const all = section.chains.flat()
  if (!all.length) return out
  const size = Math.max(Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1])))
  const minFlat = options.minFlat ?? Math.min(8, Math.max(1.5, 0.06 * size))
  const tol = options.tol ?? Math.min(0.25, Math.max(0.02, minFlat / 32))
  section.chains.forEach((chain, chainIndex) => {
    if (chain.length < 20) return
    const v = simplify(chain, tol)
    const flats: Flat[] = []
    for (let k = 1; k < v.length; k++) {
      const a = chain[v[k - 1]], b = chain[v[k]], length = dist(a, b)
      if (length < minFlat) continue
      let ok = true
      for (let m = v[k - 1]; m <= v[k]; m++) if (lineDist(chain[m], a, b) > 1.2 * tol) { ok = false; break }
      if (ok) flats.push({ i: v[k - 1], j: v[k], a, b, length })
    }
    for (let k = 1; k < flats.length; k++) {
      const A = flats[k - 1], B = flats[k]
      let between = 0
      for (let m = A.j + 1; m <= B.i; m++) between += dist(chain[m - 1], chain[m])
      if (between > 0.6 * Math.min(A.length, B.length) + 2 * minFlat) continue
      const da = sub(A.b, A.a), db = sub(B.b, B.a)
      const turn = Math.acos(Math.max(-1, Math.min(1, dot(da, db) / Math.hypot(...da) / Math.hypot(...db)))) * 180 / Math.PI
      if (turn < 20 || turn > 160) continue
      out.push({ section: `${section.axis}${section.offset}`, A, B, chain, chainIndex, turn })
    }
  })
  return out
}
