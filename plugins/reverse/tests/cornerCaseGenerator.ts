// SPDX-License-Identifier: AGPL-3.0-only
// Corners built from their answer, shared by the fillet stress tests: a
// round of known radius, and two carriers (lines, or circles inside or
// outside which the round sits) tangent to it at random points. The section
// runs along one carrier, round the fillet and along the other, sampled as
// coarsely or finely as a mesh is, with or without noise.
import type { Vec2 } from '../../../src/core/flat/types'
import { addEntity, anchorPoint, emptySketch, entityOf } from '../core/sketch'

export const TAU = 2 * Math.PI
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
export const polar = (c: Vec2, r: number, a: number): Vec2 => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]
export const ang = (c: Vec2, p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0])

export function rng(seed: number) {
  let s = seed >>> 0
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

export type Carrier = { kind: 'line'; t: Vec2; d: Vec2 } | { kind: 'circle'; c: Vec2; R: number; s: 1 | -1 }

/** A point along a carrier from its tangent point, `u` along the kept way (mm). */
export function along(k: CarrierT, u: number): Vec2 {
  if (k.kind === 'line') return [k.t[0] + k.d[0] * u, k.t[1] + k.d[1] * u]
  return polar(k.c, k.R, ang(k.c, k.tp) + k.s * u / k.R)
}
export type CarrierT = Carrier & { tp: Vec2 }

function crossings(a: CarrierT, b: CarrierT): Vec2[] {
  // Dense search along both carriers near the round, refined by bisection on distance.
  const out: Vec2[] = []
  const span = 80, n = 1600
  const f = (u: number) => { const p = along(a, u); if (b.kind === 'line') return (p[0] - b.t[0]) * b.d[1] - (p[1] - b.t[1]) * b.d[0]; return dist(p, b.c) - b.R }
  let prev = f(-span)
  for (let i = 1; i <= n; i++) {
    const u = -span + 2 * span * i / n, v = f(u)
    if (Math.sign(v) !== Math.sign(prev)) {
      let lo = -span + 2 * span * (i - 1) / n, hi = u
      for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (Math.sign(f(m)) === Math.sign(f(lo))) lo = m; else hi = m }
      out.push(along(a, (lo + hi) / 2))
    }
    prev = v
  }
  return out
}

/** A built case: the sketch with its two pieces on the carriers, the
 *  section, and what it was built from: the carriers A and B with their
 *  tangent points, how far the section runs out along each (mm from the
 *  tangent point), and the round's centre. */
export interface BuiltCase { s: ReturnType<typeof emptySketch>; ids: [number, number]; chain: Vec2[]; corner: Vec2; nears: [Vec2, Vec2]; A: CarrierT; B: CarrierT; outA: number; outB: number; centre: Vec2; step: number }

export interface Case { id: string; r: number; noise: number; /** The round's turn, radians. */ phi: number; /** The section's sampling step, mm. */ step: number; build: () => BuiltCase | null }

export function makeCase(seed: number): Case {
  const R = rng(seed)
  const kinds = (['line-arc', 'arc-line', 'arc-arc'] as const)[Math.floor(R() * 3)]
  const r = 0.5 + R() * 7.5
  const phi = (25 + R() * 125) * Math.PI / 180
  const a1 = R() * TAU, a2 = a1 + phi
  const P: Vec2 = [R() * 100 - 50, R() * 100 - 50]
  const noise = [0, 0, 0.005, 0.02][Math.floor(R() * 4)]
  const step = [0.1, 0.25, 0.5, 0.9][Math.floor(R() * 4)]
  const id = `#${seed} ${kinds} r${r.toFixed(2)} φ${(phi * 180 / Math.PI).toFixed(0)} noise${noise} step${step}`
  const carrier = (isLine: boolean, at: number, away: 1 | -1): CarrierT => {
    const tp = polar(P, r, at)
    // Kept way: tangent to the round at tp, heading away from the round's other end.
    const d: Vec2 = [-Math.sin(at) * away, Math.cos(at) * away]
    if (isLine) return { kind: 'line', t: tp, d, tp }
    const inside = R() < 0.6
    const Rc = inside ? r * (2 + R() * 10) : r * (0.6 + R() * 10)
    const n: Vec2 = [(P[0] - tp[0]) / r, (P[1] - tp[1]) / r]
    const c: Vec2 = inside ? [tp[0] + n[0] * Rc, tp[1] + n[1] * Rc] : [tp[0] - n[0] * Rc, tp[1] - n[1] * Rc]
    // Direction of increasing angle at tp is perp(tp - c); match the kept way.
    const inc: Vec2 = [-(tp[1] - c[1]), tp[0] - c[0]]
    return { kind: 'circle', c, R: Rc, s: dot(inc, d) > 0 ? 1 : -1, tp }
  }
  return {
    id, r, noise, phi, step,
    build: () => {
      const A = carrier(kinds !== 'arc-line' && kinds !== 'arc-arc', a1, -1)
      const B = carrier(kinds === 'arc-line', a2, 1)
      // The corner: the carriers' crossing nearest the round's middle, outside it.
      const mid = polar(P, r, (a1 + a2) / 2)
      const xs = crossings(A, B).filter((x) => dist(x, P) > r * 1.0001).sort((p, q) => dist(p, mid) - dist(q, mid))
      if (!xs.length) return null
      const corner = xs[0]
      if (dist(corner, mid) > 4 * r + 2) return null
      // How far each tangent point is from the corner along its carrier.
      const tA = dist(A.tp, corner), tB = dist(B.tp, corner)
      // Pieces: from a near point (past the corner, at it, or far short) to a far point.
      const nearA = (R() * 3.5 - 1) * tA, nearB = (R() * 3.5 - 1) * tB
      // Each piece runs on past its tangent point (else no round of this
      // radius fits on it, and a refusal is right).
      const lenA = Math.max(4 + R() * 25, tA * 1.3 - nearA + 0.5), lenB = Math.max(4 + R() * 25, tB * 1.3 - nearB + 0.5)
      // u measured from the tangent point on the kept way; the corner is at about -t.
      const uNearA = nearA - tA, uNearB = nearB - tB
      const s = emptySketch()
      const piece = (k: CarrierT, u0: number, u1: number): number => {
        if (k.kind === 'line') return addEntity(s, { kind: 'line', a: along(k, u0), b: along(k, u1) })
        const t0 = ang(k.c, along(k, u0)), sweep = (u1 - u0) / k.R
        // A sketch arc of up to three quarters of a turn.
        if (sweep > 1.5 * Math.PI) return -1
        // Counter-clockwise from start: whichever end lies at the smaller angle along +s.
        return k.s > 0 ? addEntity(s, { kind: 'arc', c: k.c, r: k.R, start: t0, sweep }) : addEntity(s, { kind: 'arc', c: k.c, r: k.R, start: t0 - sweep, sweep })
      }
      const ia = piece(A, uNearA, uNearA + lenA), ib = piece(B, uNearB, uNearB + lenB)
      if (ia < 0 || ib < 0) return null
      // The section: along A from far to its tangent point, round the fillet, along B.
      const chain: Vec2[] = []
      let k = 0
      const w = () => noise ? noise * Math.sin(k++ * 2.71) : 0
      // A section never runs more than once round a circle: it runs on 3 mm
      // past each piece, to at most 300° from the round.
      const most = (k: CarrierT) => k.kind === 'circle' ? (300 * Math.PI / 180) * k.R : Infinity
      const outA = Math.min(Math.max(uNearA + lenA, 0) + 3, most(A)), outB = Math.min(Math.max(uNearB + lenB, 0) + 3, most(B))
      if (outA < uNearA + lenA || outB < uNearB + lenB) return null
      const nA = Math.ceil(outA / step)
      for (let i = nA; i > 0; i--) { const p = along(A, i * outA / nA), q = along(A, i * outA / nA + 1e-3), d = sub(q, p), l = Math.hypot(...d), e = w(); chain.push([p[0] - d[1] / l * e, p[1] + d[0] / l * e]) }
      const nF = Math.max(3, Math.ceil(phi * r / step))
      for (let i = 0; i <= nF; i++) { const t = a1 + phi * i / nF, e = w(); chain.push(polar(P, r + e, t)) }
      const nB = Math.ceil(outB / step)
      for (let i = 1; i <= nB; i++) { const p = along(B, i * outB / nB), q = along(B, i * outB / nB + 1e-3), d = sub(q, p), l = Math.hypot(...d), e = w(); chain.push([p[0] - d[1] / l * e, p[1] + d[0] / l * e]) }
      const ea = entityOf(s, ia)!, eb = entityOf(s, ib)!
      const endNear = (e: typeof ea, u: number, k: CarrierT) => { const p = along(k, u); return dist(anchorPoint(e, 'a'), p) < dist(anchorPoint(e, 'b'), p) ? anchorPoint(e, 'a') : anchorPoint(e, 'b') }
      return { s, ids: [ia, ib], chain, corner, nears: [endNear(ea, uNearA, A), endNear(eb, uNearB, B)], A, B, outA, outB, centre: P, step }
    },
  }
}
