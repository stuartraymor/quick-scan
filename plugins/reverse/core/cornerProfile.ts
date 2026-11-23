// SPDX-License-Identifier: AGPL-3.0-only
// Auto Fillet from the scan, as QUICKSURFACE 8.0.128 makes it. Two lines
// fitted to the flat sides of a part stop short of (or run past) the corner
// between them; the slice chain the lines were fitted to still runs round
// that corner. This follows the chain from where it leaves one line to where
// it joins the other and fits the tangent round to it.
//
// The radius is QUICKSURFACE's: the least-squares tangent arc (centre on the
// bisector) over the section's own points — mesh vertices and edge crossings
// — that lie on the arc, between its two tangent points; points beyond them
// are not counted. On analysis/corner-sweep-2026-11-19's plate this reads
// R 5.004062 for the R5 round (native 5.004061) and R 4.565252 for the 3 × 9
// elliptical corner (native 4.565252): a corner that is not circular still
// gets the arc that fits it best, never a free curve or a chamfer. A corner
// with no round in the scan joins sharp (QUICKSURFACE leaves a near-zero
// fillet there, R 0.000134 mm).
import type { Vec2 } from '../../../src/core/flat/types'

/** The corner as the two lines' carriers see it: `dirA`/`dirB` run from the
 *  corner towards each line's far end, `reachA`/`reachB` are those far ends'
 *  distances from the corner. */
export interface CornerFrame {
  corner: Vec2
  dirA: Vec2
  dirB: Vec2
  reachA: number
  reachB: number
  /** Where each line starts, measured the same way from the corner: lines
   *  fitted to a stretch far from the corner start well out along it. The
   *  scan's noise is read only where each line was fitted. */
  startA?: number
  startB?: number
}

interface Shared {
  /** The scan points that decided the result (on the arc, for a round). */
  used: Vec2[]
  /** Robust noise of the scan along the two lines, sheet units. */
  sigma: number
  /** False when a large share of the scan points on the round was set aside
   *  as stray: the caller should show the result and ask. */
  confident: boolean
  /** Why the result is not confident. */
  doubt?: string
}

export type CornerProfile =
  | ({ kind: 'sharp' } & Shared)
  | ({ kind: 'arc'; radius: number; rms: number } & Shared)
  | { kind: 'none'; reason: string }

const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
const crossZ = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const rmsOf = (v: number[]) => v.length ? Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length) : Infinity

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy
  const t = len > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** The chains resampled evenly inside the disc round the corner, in runs
 *  that break wherever a chain leaves the disc. The section's own vertices
 *  are recorded in `original`: the round is fitted to those, as QUICKSURFACE
 *  does, so chord sag from resampling cannot bias the radius. */
export function runsNear(chains: readonly (readonly Vec2[])[], centre: Vec2, radius: number, step: number, original: WeakSet<Vec2>): Vec2[][] {
  const runs: Vec2[][] = []
  for (const raw of chains) {
    const chain = raw.filter((p) => p.length === 2 && p.every(Number.isFinite))
    if (chain.length < 2) continue
    const gaps: number[] = []
    for (let i = 1; i < chain.length; i++) gaps.push(dist(chain[i - 1], chain[i]))
    const closed = chain.length > 2 && dist(chain[0], chain[chain.length - 1]) <= Math.max(3 * median(gaps), 1e-12)
    let ring = closed && dist(chain[0], chain[chain.length - 1]) > 0 ? [...chain, chain[0]] : chain
    // Open a closed ring at a point outside the disc, so a run round the
    // corner is never cut where the list happens to start.
    if (closed) {
      const out = ring.findIndex((p) => dist(p, centre) > radius)
      if (out > 0) ring = [...ring.slice(out, ring.length - 1), ...ring.slice(0, out + 1)]
      else if (out < 0) ring = [...ring, ...ring.slice(1)]
    }
    let run: Vec2[] = []
    const flush = () => { if (run.length >= 2) runs.push(run); run = [] }
    for (let i = 1; i < ring.length; i++) {
      const p = ring[i - 1], q = ring[i]
      if (segmentDistance(centre, p, q) > radius) { flush(); continue }
      const n = Math.max(1, Math.ceil(dist(p, q) / step))
      for (let k = 0; k < n; k++) {
        const at: Vec2 = k === 0 ? [p[0], p[1]] : [p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]
        if (k === 0) original.add(at)
        if (dist(at, centre) <= radius) run.push(at)
        else flush()
      }
      if (i === ring.length - 1 && dist(q, centre) <= radius) { const end: Vec2 = [q[0], q[1]]; original.add(end); run.push(end) }
    }
    flush()
  }
  return runs
}

/** Distance from p to the corner's line-arc-line profile of radius r. */
function arcProfileDistance(f: CornerFrame, half: number, bis: Vec2, p: Vec2, r: number): { d: number; onArc: boolean } {
  const t = r / Math.tan(half), x = f.corner
  const c: Vec2 = [x[0] + bis[0] * r / Math.sin(half), x[1] + bis[1] * r / Math.sin(half)]
  const ta: Vec2 = [x[0] + f.dirA[0] * t, x[1] + f.dirA[1] * t], tb: Vec2 = [x[0] + f.dirB[0] * t, x[1] + f.dirB[1] * t]
  const alongA = dot(sub(p, ta), f.dirA), alongB = dot(sub(p, tb), f.dirB)
  if (alongA > 0 || alongB > 0) {
    const da = Math.abs(crossZ(f.dirA, sub(p, x))), db = Math.abs(crossZ(f.dirB, sub(p, x)))
    return { d: alongA > 0 && alongB > 0 ? Math.min(da, db) : alongA > 0 ? da : db, onArc: false }
  }
  return { d: dist(p, c) - r, onArc: true }
}

/** Read the corner between two lines off the slice chains. */
export function analyseCornerProfile(f: CornerFrame, chains: readonly (readonly Vec2[])[]): CornerProfile {
  const x = f.corner
  const cosine = Math.max(-1, Math.min(1, dot(f.dirA, f.dirB)))
  const half = Math.acos(cosine) / 2
  const bl = Math.hypot(f.dirA[0] + f.dirB[0], f.dirA[1] + f.dirB[1])
  if (!(Math.sin(half) > 1e-6) || !(Math.tan(half) > 1e-6) || !(bl > 1e-6)) return { kind: 'none', reason: 'These lines do not form a corner that can be rounded.' }
  const bis: Vec2 = [(f.dirA[0] + f.dirB[0]) / bl, (f.dirA[1] + f.dirB[1]) / bl]
  const reach = Math.min(f.reachA, f.reachB)
  if (!(reach > 0) || !Number.isFinite(reach)) return { kind: 'none', reason: 'There is no room for a fillet on these lines.' }
  if (!chains.length) return { kind: 'none', reason: 'Auto Fillet reads the corner from the scan section, and this sketch has none. Use Fixed Size Fillet.' }
  // The section is read out to the farther line end: a line fitted far from
  // the corner on one side still finds its stretch of the section.
  const outer = Math.max(f.reachA, f.reachB)
  const step = Math.max(reach / 400, outer / 4000)
  const original = new WeakSet<Vec2>()
  const runs = runsNear(chains, x, outer, step, original)
  if (!runs.length) return { kind: 'none', reason: 'No scan section passes near this corner. Use Fixed Size Fillet, or fit the lines to the section first.' }

  // The scan's own noise, read where each line lies on the section (between
  // its ends): a line fitted to a short stretch far from the corner may
  // drift off the flat towards the corner, and that drift is not noise.
  const along = (p: Vec2, d: Vec2) => dot(sub(p, x), d)
  const off = (p: Vec2, d: Vec2) => crossZ(d, sub(p, x))
  const flank = (d: Vec2, start: number, far: number) => {
    const from = Math.max(start, 0.35 * reach, 0), band = 0.08 * reach
    const lo = from < far ? from : Math.max(0, start), hi = far
    return runs.flat().filter((p) => { const s = along(p, d); return s >= lo && s <= hi && Math.abs(off(p, d)) <= band }).map((p) => off(p, d))
  }
  const ra = flank(f.dirA, f.startA ?? 0, f.reachA), rb = flank(f.dirB, f.startB ?? 0, f.reachB)
  const ma = median(ra), mb = median(rb)
  const sa = ra.length >= 5 ? 1.4826 * median(ra.map((v) => Math.abs(v - ma))) : 0
  const sb = rb.length >= 5 ? 1.4826 * median(rb.map((v) => Math.abs(v - mb))) : 0
  const sigma = Math.max(sa, sb)
  const tau = Math.max(4 * sigma, 2e-4 * reach)
  // A real flat is seldom quite straight: where a line is carried on towards
  // the corner past the stretch it was fitted to, the section may wander off
  // it by a little more than the noise. The slack starts at about 0.6° of the
  // distance and is widened (below) when the section bends further.
  let slope = 0.01
  const slack = (p: Vec2, d: Vec2, start: number) => tau + slope * Math.max(0, start - along(p, d))
  const tolA = (p: Vec2) => slack(p, f.dirA, f.startA ?? 0), tolB = (p: Vec2) => slack(p, f.dirB, f.startB ?? 0)
  const label = (p: Vec2): 'A' | 'B' | 'AB' | '' => {
    const a = Math.abs(off(p, f.dirA) - ma) <= tolA(p) && along(p, f.dirA) > -tau && along(p, f.dirA) <= f.reachA + tau
    const b = Math.abs(off(p, f.dirB) - mb) <= tolB(p) && along(p, f.dirB) > -tau && along(p, f.dirB) <= f.reachB + tau
    return a && b ? 'AB' : a ? 'A' : b ? 'B' : ''
  }
  const inWedge = (p: Vec2) => {
    const v = sub(p, x), turn = crossZ(f.dirA, f.dirB)
    return crossZ(f.dirA, v) * turn >= -tolA(p) * Math.abs(turn) && crossZ(v, f.dirB) * turn >= -tolB(p) * Math.abs(turn)
  }

  // Every place a run leaves one line and next touches the other.
  type Transition = { run: Vec2[]; i: number; j: number; first: 'A' | 'B'; score: number }
  let best: Transition | null = null
  let sawA = false, sawB = false
  for (const tried of [0.01, 0.03, 0.08]) {
  if (best) break
  slope = tried
  for (const run of runs) {
    const labels = run.map(label)
    let last: { at: number; is: 'A' | 'B' } | null = null
    for (let k = 0; k < run.length; k++) {
      const l = labels[k]
      if (l === 'A') sawA = true
      if (l === 'B') sawB = true
      if (l !== 'A' && l !== 'B') continue
      if (last && last.is !== l) {
        const i = last.at, j = k, gap = run.slice(i + 1, j)
        let length = 0
        for (let m = i + 1; m <= j; m++) length += dist(run[m - 1], run[m])
        const span = dist(run[i], x) + dist(run[j], x)
        const wedge = gap.length ? gap.filter(inWedge).length / gap.length : 1
        if (length <= 1.7 * span + 4 * step && wedge >= 0.6) {
          const score = span
          if (!best || score < best.score) best = { run, i, j, first: last.is, score }
        }
      }
      last = { at: k, is: l }
    }
  }
  }
  if (!best) {
      if (sawA && sawB) return { kind: 'none', reason: 'The scan section does not run continuously from one line to the other near this corner. Use Fixed Size Fillet.' }
    return { kind: 'none', reason: 'The scan section near this corner does not follow these lines. Check that the lines were fitted to this section.' }
  }
  // Orient the transition from line A to line B.
  let seq = best.run.slice(best.i, best.j + 1)
  if (best.first === 'B') seq = seq.reverse()
  const gap = seq.slice(1, -1)
  const rays = (p: Vec2) => Math.min(
    along(p, f.dirA) >= 0 ? Math.abs(off(p, f.dirA)) : dist(p, x),
    along(p, f.dirB) >= 0 ? Math.abs(off(p, f.dirB)) : dist(p, x))
  // The section's own vertices between the lines, where it has them.
  const gapOriginal = gap.filter((p) => original.has(p))
  const used = gapOriginal.length >= 3 ? gapOriginal : gap.length > 400 ? gap.filter((_, k) => k % Math.ceil(gap.length / 400) === 0) : gap
  // A corner whose section never leaves the lines is sharp at once; any
  // other is fitted, and called sharp only when the best round is no deeper
  // than the scan's noise (below).
  if (gap.length && gap.every((p) => rays(p) <= 2e-4 * reach)) return { kind: 'sharp', used, sigma, confident: true }

  // Flank points either side, so the arc's tangent points can move along the
  // lines while the radius is searched.
  // Generous flanks: near the corner a shallow round may still lie within
  // the lines' slack, and the fit must see it.
  const flankCount = Math.max(60, Math.min(400, 2 * gap.length))
  const run = best.first === 'A' ? best.run : [...best.run].reverse()
  const i0 = best.first === 'A' ? best.i : best.run.length - 1 - best.i, j0 = best.first === 'A' ? best.j : best.run.length - 1 - best.j
  const before: Vec2[] = [], after: Vec2[] = []
  for (let k = i0; k >= 0 && before.length < flankCount; k--) { const l = label(run[k]); if (l === 'A' || l === 'AB') before.push(run[k]); else break }
  for (let k = j0; k < run.length && after.length < flankCount; k++) { const l = label(run[k]); if (l === 'B' || l === 'AB') after.push(run[k]); else break }
  const resampled = [...before, ...gap, ...after]
  // The section's own points when it has enough of them round the corner;
  // the resampled run otherwise (a sparse or synthetic chain).
  const own = resampled.filter((p) => original.has(p))
  const fitSet = own.length >= 5 && (gapOriginal.length >= 3 || own.length >= 12) ? own : resampled

  // Two losses for radius r. The profile loss is the mean squared distance
  // of every point from the line-round-line profile: it cannot be fooled by
  // a tiny round that only a few points reach, so it finds the round on a
  // shallow or noisy corner. The arc loss is QUICKSURFACE's: the mean squared
  // distance from the circle of the points on the arc, between its tangent
  // points; it settles the radius near the profile's answer, which gives
  // exactly the native radius on a clean or elliptical round. 
  const tan = Math.tan(half)
  const rMax = 0.94 * reach * tan, rMin = rMax * 1e-5
  // `cap` > 0 caps each squared distance (a truncated least squares): a spike
  // costs no more than a point the round misses by `cap`, while every scan
  // point on the round still counts, however many lie on the lines.
  const cap = Math.max(3 * tau, 0.01 * reach)
  const loss = (set: readonly Vec2[], r: number, capped: boolean, arcOnly: boolean) => {
    let sum = 0, n = 0
    for (const p of set) {
      const q = arcProfileDistance(f, half, bis, p, r)
      if (arcOnly && !q.onArc) continue
      sum += capped ? Math.min(q.d * q.d, cap * cap) : q.d * q.d; n++
    }
    return n < 3 ? Infinity : sum / n
  }
  const search = (set: readonly Vec2[], capped: boolean, arcOnly: boolean, from = rMin, to = rMax): number | null => {
    const radii = Array.from({ length: 257 }, (_, i) => from * Math.pow(to / from, i / 256))
    let bi = -1, bl = Infinity
    for (let i = 0; i < radii.length; i++) { const l = loss(set, radii[i], capped, arcOnly); if (l < bl) { bl = l; bi = i } }
    if (bi < 0) return null
    let lo = radii[Math.max(0, bi - 1)], hi = radii[Math.min(radii.length - 1, bi + 1)]
    for (let i = 0; i < 100; i++) { const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3; if (loss(set, a, capped, arcOnly) < loss(set, b, capped, arcOnly)) hi = b; else lo = a }
    return (lo + hi) / 2
  }
  const first = search(fitSet, true, false)
  if (first === null) return { kind: 'none', reason: 'Too few scan points lie on a round between these lines. Use Fixed Size Fillet.' }
  // Only clear strays are set aside before the least-squares fits, so a
  // clean section gives exactly QUICKSURFACE's radius.
  const firstRes = fitSet.map((p) => arcProfileDistance(f, half, bis, p, first))
  // The spread is read on the round itself: the flats would make it look
  // smaller than it is and set aside the round of a corner that is not circular.
  const onFirst = firstRes.filter((q) => q.onArc)
  const limit = Math.max(5 * 1.4826 * median((onFirst.length >= 3 ? onFirst : firstRes).map((q) => Math.abs(q.d))), tau)
  const kept = fitSet.filter((_, k) => Math.abs(firstRes[k].d) <= limit)
  const profileRadius = search(kept, false, false) ?? first
  // The round is no deeper than the noise: the corner is sharp. The noise is
  // read on the cleaner flat: a line brushed partly over the round, or a flat
  // that bends, looks noisier than the scan is, and QUICKSURFACE rounds every
  // corner it can (it leaves an R 0.000134 mm fillet even on a sharp one).
  const quiet = sa > 0 && sb > 0 ? Math.min(sa, sb) : sigma
  if (profileRadius * (1 - Math.sin(half)) <= 2 * quiet) return { kind: 'sharp', used, sigma, confident: true }
  // QUICKSURFACE's radius uses every section point on the arc, wherever the
  // lines' slack put the split between flat and round: all of this run's
  // own points (strays aside) that the arc spans.
  const runPoints = fitSet === own ? best.run.filter((p) => original.has(p)) : best.run.filter((_, k) => k % Math.max(1, Math.ceil(best!.run.length / 2000)) === 0)
  const arcSet = runPoints.filter((p) => Math.abs(arcProfileDistance(f, half, bis, p, profileRadius).d) <= limit)
  const radius = search(arcSet, false, true, Math.max(rMin, profileRadius / 1.35), Math.min(rMax, profileRadius * 1.35)) ?? profileRadius
  const res = runPoints.map((p) => ({ p, q: arcProfileDistance(f, half, bis, p, radius) })).filter((v) => v.q.onArc)
  const inliers = res.filter((v) => Math.abs(v.q.d) <= limit)
  const share = res.length ? inliers.length / res.length : 1
  const rms = rmsOf(inliers.map((v) => v.q.d))
  const base = { used: inliers.map((v) => v.p), sigma }
  if (share < 0.85) return { kind: 'arc', radius, rms, ...base, confident: false, doubt: `${Math.round((1 - share) * 100)} % of the scan points on the round were set aside as stray` }
  return { kind: 'arc', radius, rms, ...base, confident: true }
}
