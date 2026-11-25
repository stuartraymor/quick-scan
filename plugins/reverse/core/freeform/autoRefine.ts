// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform, Refine to tolerance: quads added where the fitted surface
// is still further from the scan than the tolerance asked for.
//
// A quad cage cannot be made finer at one quad alone and stay all quads
// with every vertex on four edges; what it can take is a new row of quads —
// a ring of edges split in two, the cut running from quad to quad through
// opposite edges until it closes on itself or meets the rim, as a modeller's
// "insert edge loop". Each round the surface is measured, each quad that is
// off is offered the two rings through it, the rings that mend the most
// error for the quads they add are split, and the cage is fitted again.
// It ends when every quad is within the tolerance, when a round no longer
// helps, or at the most quads allowed.
//
// Pure: a cage and the scan's projection in, a cage out.

import type { Vec3 } from '../../../../src/core/types'
import { type Cage } from './cage'
import { type FitStats, type ScanProject, fitCageToScan, surfaceDeviation } from './limitFit'

export interface RefineOptions {
  /** The most quads the cage may come to. */
  maxQuads: number
  /** Rounds of measuring, splitting and fitting; 6 unless given. */
  rounds?: number
  progress?: (fraction: number) => void
  /** What each round found and did, for a measurement. */
  log?: (line: string) => void
}

export interface RefineResult {
  cage: Cage
  rounds: number
  /** Quads still off at the end. */
  off: number
  stats?: FitStats
}

interface Ring {
  /** The faces the ring crosses, and for each the index (0 or 1) of the edge pair it enters by: edges k and k + 2. */
  faces: number[]
  pair: number[]
}

/** The distance to the scan over each quad of the cage, root mean square: the surface sampled sixteen sub-quads a quad. */
function faceErrors(c: Cage, project: ScanProject, reach: number): Float32Array {
  const d = surfaceDeviation(c, project, 0, 2, reach)
  const out = new Float32Array(c.faces.length)
  // Two subdivisions give each quad sixteen sub-quads, in the quad's order: triangles 32 a quad.
  const per = 32
  for (let f = 0; f < c.faces.length; f++) {
    // The root mean square over the quad's samples: one noisy point of the scan does not make a quad off.
    let sum = 0, n = 0
    for (let t = f * per; t < (f + 1) * per; t++) {
      for (let k = 0; k < 3; k++) {
        const v = d.distance[d.indices[t * 3 + k]]
        if (v === v) {
          sum += v * v
          n++
        }
      }
    }
    out[f] = n > 0 ? Math.sqrt(sum / n) : 0
  }
  return out
}

/** The share of the cage's quads further than `tolerance` from the scan. */
export function offShare(c: Cage, project: ScanProject, tolerance: number): number {
  const errors = faceErrors(c, project, Infinity)
  let off = 0
  for (let f = 0; f < errors.length; f++) if (errors[f] > tolerance) off++
  return errors.length > 0 ? off / errors.length : 0
}

function edgeFaces(c: Cage): Map<number, number[]> {
  const n = c.positions.length / 3
  const map = new Map<number, number[]>()
  c.faces.forEach((f, fi) => {
    for (let k = 0; k < 4; k++) {
      const a = f[k], b = f[(k + 1) % 4]
      const key = a < b ? a * n + b : b * n + a
      const had = map.get(key)
      if (had) had.push(fi)
      else map.set(key, [fi])
    }
  })
  return map
}

/** The ring through face `start` across its edges `pair` and `pair + 2`; null where it crosses a face twice. */
function ringThrough(c: Cage, edges: Map<number, number[]>, start: number, pair: number): Ring | null {
  const n = c.positions.length / 3
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a)
  const faces: number[] = [start]
  const pairs: number[] = [pair]
  const seen = new Set<number>([start])
  let closed = false
  // Out through edge `pair + 2` first, then, if the ring did not close, back out through edge `pair`.
  for (const side of [2, 0]) {
    if (closed) break
    let f = start
    let k = (pair + side) % 4
    for (;;) {
      const face = c.faces[f]
      const a = face[k], b = face[(k + 1) % 4]
      const across = edges.get(key(a, b))!
      const next = across.length === 2 ? (across[0] === f ? across[1] : across[0]) : -1
      if (next < 0) break
      if (next === start) {
        // Closed on itself — if it comes back by the edge it set out across; by the other pair it crosses itself there.
        const sf = c.faces[start]
        const back = pair % 4
        const sa = sf[back], sb = sf[(back + 1) % 4]
        if (!((sa === a && sb === b) || (sa === b && sb === a))) return null
        closed = true
        break
      }
      if (seen.has(next)) return null
      const nf = c.faces[next]
      // The edge it came in by, in the next face; it leaves by the opposite one.
      let inK = -1
      for (let j = 0; j < 4; j++) if ((nf[j] === a && nf[(j + 1) % 4] === b) || (nf[j] === b && nf[(j + 1) % 4] === a)) inK = j
      if (inK < 0) return null
      seen.add(next)
      if (side === 2) {
        faces.push(next)
        pairs.push(inK % 2)
      } else {
        faces.unshift(next)
        pairs.unshift(inK % 2)
      }
      f = next
      k = (inK + 2) % 4
    }
  }
  return { faces, pair: pairs }
}

/** The cage with each ring's edges split at their middles and its quads cut in two. The rings share no face. */
function splitRings(c: Cage, rings: Ring[]): Cage {
  const n = c.positions.length / 3
  const pos = Array.from(c.positions)
  const mids = new Map<number, number>()
  const key = (a: number, b: number) => (a < b ? a * n + b : b * n + a)
  const mid = (a: number, b: number): number => {
    const k = key(a, b)
    let m = mids.get(k)
    if (m === undefined) {
      m = pos.length / 3
      for (let i = 0; i < 3; i++) pos.push((c.positions[a * 3 + i] + c.positions[b * 3 + i]) / 2)
      mids.set(k, m)
    }
    return m
  }
  const cut = new Map<number, number>()
  for (const r of rings) r.faces.forEach((f, i) => cut.set(f, r.pair[i]))
  const faces: number[][] = []
  c.faces.forEach((f, fi) => {
    const p = cut.get(fi)
    if (p === undefined) {
      faces.push(f)
      return
    }
    // Edges p and p + 2 are split: (v_p, v_p+1) and (v_p+2, v_p+3).
    const a = f[p], b = f[(p + 1) % 4], d = f[(p + 2) % 4], e = f[(p + 3) % 4]
    const m1 = mid(a, b), m2 = mid(d, e)
    faces.push([a, m1, m2, e], [m1, b, d, m2])
  })
  // A crease along a split edge becomes its two halves.
  const creases: [number, number][] = []
  for (const [a, b] of c.creases) {
    const m = mids.get(key(a, b))
    if (m === undefined) creases.push([a, b])
    else creases.push([a, m], [m, b])
  }
  return { positions: Float64Array.from(pos), faces, creases }
}

/** Quads added where the surface is off by more than `tolerance`: see the head of the file. */
export function refineToTolerance(c: Cage, project: ScanProject, tolerance: number, options: RefineOptions): RefineResult {
  const rounds = Math.max(1, options.rounds ?? 6)
  let cage = c
  let stats: FitStats | undefined
  let off = 0
  let done = 0
  const reach = Infinity
  let offBefore = Infinity
  let rmsBefore = Infinity
  let previous: { cage: Cage; stats: FitStats | undefined; off: number } | null = null
  for (let round = 0; round < rounds; round++) {
    options.progress?.(round / rounds)
    const errors = faceErrors(cage, project, reach)
    const bad: number[] = []
    for (let f = 0; f < errors.length; f++) if (errors[f] > tolerance) bad.push(f)
    off = bad.length
    let square = 0
    for (let f = 0; f < errors.length; f++) square += errors[f] * errors[f]
    const rms = errors.length > 0 ? Math.sqrt(square / errors.length) : 0
    // A round that neither brought quads within the tolerance nor the surface nearer was spent on what quads cannot mend (the scan's own roughness): it is taken back, and that is the end.
    const share = errors.length > 0 ? off / errors.length : 0
    options.log?.(`round ${round}: ${cage.faces.length} quads, ${off} off, rms ${rms.toFixed(5)}`)
    if (previous && share > 0.97 * offBefore && rms > 0.98 * rmsBefore) {
      cage = previous.cage
      stats = previous.stats
      off = previous.off
      done = round - 1
      break
    }
    offBefore = share
    rmsBefore = rms
    if (bad.length === 0 || cage.faces.length >= options.maxQuads) break
    previous = { cage, stats, off }
    options.progress?.((round + 0.3) / rounds)
    const edges = edgeFaces(cage)
    const p = cage.positions
    // How far the scan bows off the straight line between two vertices' places on it: the bend a split of that edge would take up.
    const onScan = new Map<number, Vec3>()
    const place = (v: number): Vec3 => {
      let q = onScan.get(v)
      if (!q) {
        const at: Vec3 = [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]]
        q = project(at, [0, 0, 0])?.point ?? at
        onScan.set(v, q)
      }
      return q
    }
    const sag = (a: number, b: number): number => {
      const qa = place(a), qb = place(b)
      return project([(qa[0] + qb[0]) / 2, (qa[1] + qb[1]) / 2, (qa[2] + qb[2]) / 2], [0, 0, 0])?.distance ?? 0
    }
    // Each bad quad offers the ring that splits the edges the scan bends along most.
    const offers: { ring: Ring; gain: number }[] = []
    const offered = new Set<string>()
    for (const f of bad) {
      const face = cage.faces[f]
      const l0 = sag(face[0], face[1]) + sag(face[2], face[3])
      const l1 = sag(face[1], face[2]) + sag(face[3], face[0])
      const pair = l0 >= l1 ? 0 : 1
      const ring = ringThrough(cage, edges, f, pair) ?? ringThrough(cage, edges, f, 1 - pair)
      if (!ring) continue
      const id = `${Math.min(...ring.faces)}:${ring.faces.length}:${ring.pair[ring.faces.indexOf(Math.min(...ring.faces))]}`
      if (offered.has(id)) continue
      offered.add(id)
      let gain = 0
      for (const g of ring.faces) gain += Math.max(0, errors[g] - tolerance)
      offers.push({ ring, gain: gain / ring.faces.length })
    }
    offers.sort((a, b) => b.gain - a.gain)
    const used = new Set<number>()
    const chosen: Ring[] = []
    let added = 0
    for (const o of offers) {
      if (cage.faces.length + added + o.ring.faces.length > options.maxQuads) continue
      if (o.ring.faces.some((f) => used.has(f))) continue
      for (const f of o.ring.faces) used.add(f)
      chosen.push(o.ring)
      added += o.ring.faces.length
    }
    options.log?.(`  ${offers.length} rings offered, ${chosen.length} split, ${added} quads added`)
    if (chosen.length === 0) break
    options.progress?.((round + 0.5) / rounds)
    const fitted = fitCageToScan(splitRings(cage, chosen), project, { iterations: 3, progress: (f) => options.progress?.((round + 0.5 + 0.5 * f) / rounds) })
    cage = fitted.cage
    stats = fitted.stats
    done = round + 1
  }
  options.progress?.(1)
  return { cage, rounds: done, off, stats }
}
