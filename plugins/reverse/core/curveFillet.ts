// SPDX-License-Identifier: AGPL-3.0-only
// Fillets where an arc meets a line or another arc: Corner Trim's Auto Fillet
// and Fixed Size Fillet beyond two straight lines. The two pieces are first
// joined at the crossing of their carriers (cornerJoin.ts); the round then
// goes into the corner between them, tangent to both. Its centre lies at the
// radius from each carrier: on a line's parallel, and on a circle of the
// arc's radius plus the round's (round outside the arc) or minus it (inside).
//
// Auto Fillet reads the radius off the scan section as it does between two
// lines (cornerProfile.ts): a least-squares round over the section's own
// points, found first on the whole piece-round-piece profile and then settled
// on the points the round spans, between its tangent points.
import type { Vec2 } from '../../../src/core/flat/types'
import { addConstraint, addEntity, arcPoint, entityOf, type Anchor, type Sketch, type SketchArc, type SketchLine } from './sketch'
import { runsNear } from './cornerProfile'

type End = 'a' | 'b'
const TAU = 2 * Math.PI
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
const norm = (a: Vec2): Vec2 => { const l = Math.hypot(a[0], a[1]); return [a[0] / l, a[1] / l] }
const wrap = (a: number) => ((a % TAU) + TAU) % TAU
const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

/** One piece of the corner, seen from the joint `j` where its near end now is. */
export interface FilletSide {
  id: number
  near: End
  piece: SketchLine | SketchArc
  /** Unit direction along the piece at the joint, towards its far end. */
  t: Vec2
  /** Unit normal at the joint, into the corner (towards the other piece). */
  n: Vec2
  /** How far the piece runs from the joint: length, or arc length. */
  length: number
}

function sideOf(piece: SketchLine | SketchArc, near: End, j: Vec2): Omit<FilletSide, 'n'> | null {
  if (piece.kind === 'line') {
    const far = near === 'a' ? piece.b : piece.a, length = dist(far, j)
    return length > 1e-9 ? { id: piece.id, near, piece, t: norm(sub(far, j)), length } : null
  }
  if (!(piece.r > 1e-9) || !(piece.sweep > 1e-9)) return null
  const at = near === 'a' ? piece.start : piece.start + piece.sweep
  // Counter-clockwise from the start: from end a the arc runs on CCW, from end b back CW.
  const t: Vec2 = near === 'a' ? [-Math.sin(at), Math.cos(at)] : [Math.sin(at), -Math.cos(at)]
  return { id: piece.id, near, piece, t, length: piece.r * piece.sweep }
}

/** Both sides of a joined corner, or why it has no corner to round. */
export function filletSides(a: SketchLine | SketchArc, nearA: End, b: SketchLine | SketchArc, nearB: End, j: Vec2): [FilletSide, FilletSide] | string {
  const sa = sideOf(a, nearA, j), sb = sideOf(b, nearB, j)
  if (!sa || !sb) return 'A piece ends on the corner itself — there is nothing of it to round into.'
  const turn = cross(sa.t, sb.t)
  if (Math.abs(turn) < 1e-6) return 'These pieces already run on smoothly at the corner — there is no corner to round.'
  const s = Math.sign(turn)
  return [{ ...sa, n: scale([-sa.t[1], sa.t[0]], s) }, { ...sb, n: scale([sb.t[1], -sb.t[0]], s) }]
}

/** The round's centre lies on this: a line's parallel or a circle round the arc's centre. */
type Offset = { kind: 'line'; p: Vec2; u: Vec2 } | { kind: 'circle'; c: Vec2; rho: number }

function offsetOf(side: FilletSide, j: Vec2, r: number): Offset | null {
  if (side.piece.kind === 'line') return { kind: 'line', p: add(j, scale(side.n, r)), u: side.t }
  const arc = side.piece
  // Into the corner towards the arc's centre: the round sits inside the circle.
  const inside = dot(side.n, sub(arc.c, j)) > 0
  const rho = inside ? arc.r - r : arc.r + r
  return rho > 1e-12 ? { kind: 'circle', c: arc.c, rho } : null
}

function meet(p: Offset, q: Offset): Vec2[] {
  if (p.kind === 'line' && q.kind === 'line') {
    const d = cross(p.u, q.u)
    if (Math.abs(d) < 1e-12) return []
    const s = cross(sub(q.p, p.p), q.u) / d
    return [add(p.p, scale(p.u, s))]
  }
  if (p.kind === 'circle' && q.kind === 'line') return meet(q, p)
  if (p.kind === 'line' && q.kind === 'circle') {
    const f = sub(p.p, q.c), b = dot(f, p.u), c = dot(f, f) - q.rho * q.rho, disc = b * b - c
    if (disc < 0) return []
    const r = Math.sqrt(disc)
    return [add(p.p, scale(p.u, -b - r)), add(p.p, scale(p.u, -b + r))]
  }
  if (p.kind === 'circle' && q.kind === 'circle') {
    const d = dist(p.c, q.c)
    if (!(d > 1e-12) || d > p.rho + q.rho || d < Math.abs(p.rho - q.rho)) return []
    const a = (p.rho * p.rho - q.rho * q.rho + d * d) / (2 * d), h = Math.sqrt(Math.max(0, p.rho * p.rho - a * a))
    const u = scale(sub(q.c, p.c), 1 / d), m = add(p.c, scale(u, a))
    return [add(m, scale([-u[1], u[0]], h)), add(m, scale([u[1], -u[0]], h))]
  }
  return []
}

/** Where the round touches a side, and how far along the piece from the
 *  joint that is (negative: past the joint, off the piece). */
function touch(side: FilletSide, j: Vec2, centre: Vec2): { p: Vec2; along: number } {
  if (side.piece.kind === 'line') {
    const along = dot(sub(centre, j), side.t)
    return { p: add(j, scale(side.t, along)), along }
  }
  const arc = side.piece, p = add(arc.c, scale(norm(sub(centre, arc.c)), arc.r))
  // Angle travelled from the joint along the arc towards its far end.
  const aj = Math.atan2(j[1] - arc.c[1], j[0] - arc.c[0]), ap = Math.atan2(p[1] - arc.c[1], p[0] - arc.c[0])
  let turn = side.near === 'a' ? wrap(ap - aj) : wrap(aj - ap)
  if (turn > Math.PI + arc.sweep / 2) turn -= TAU
  return { p, along: turn * arc.r }
}

export interface CurveRound { centre: Vec2; r: number; ta: Vec2; tb: Vec2; start: number; sweep: number }

/** The largest round a corner with a curve takes, per mm of its longer piece. */
export const MAX_ROUND_PER_LENGTH = 10

/** The round of radius r in the corner, or null when none fits on the pieces. */
export function curveRound(sides: readonly [FilletSide, FilletSide], j: Vec2, r: number, room = 0.95): CurveRound | null {
  const [A, B] = sides
  // Between curves almost any radius has a round somewhere: a huge one is a
  // near-straight bridge that cuts both arcs far back (a typed 1e6 did).
  // No round is taken larger than ten times the longer piece.
  if (!(r > 0) || !(r <= MAX_ROUND_PER_LENGTH * Math.max(A.length, B.length))) return null
  const oa = offsetOf(A, j, r), ob = offsetOf(B, j, r)
  if (!oa || !ob) return null
  let best: CurveRound | null = null, bestD = Infinity
  for (const centre of meet(oa, ob)) {
    const ta = touch(A, j, centre), tb = touch(B, j, centre)
    if (!(ta.along > 1e-9) || !(tb.along > 1e-9) || ta.along > room * A.length || tb.along > room * B.length) continue
    // The round's arc is the side facing the joint.
    const a1 = Math.atan2(ta.p[1] - centre[1], ta.p[0] - centre[0]), a2 = Math.atan2(tb.p[1] - centre[1], tb.p[0] - centre[0])
    const ccw = wrap(a2 - a1), mid = a1 + ccw / 2
    const toJoint = Math.atan2(j[1] - centre[1], j[0] - centre[0])
    const facing = Math.cos(toJoint - mid) >= Math.cos(toJoint - mid - Math.PI)
    const round: CurveRound = facing ? { centre, r, ta: ta.p, tb: tb.p, start: a1, sweep: ccw } : { centre, r, ta: ta.p, tb: tb.p, start: a2, sweep: TAU - ccw }
    if (!(round.sweep > 1e-9) || round.sweep >= Math.PI - 1e-9) continue
    // Of two centres, the round that touches the pieces nearest the joint:
    // the other lies round the far side of an arc.
    const d = ta.along + tb.along
    if (d < bestD) { bestD = d; best = round }
  }
  return best
}

/** The largest radius whose round still fits on both pieces, by bisection. */
export function largestRound(sides: readonly [FilletSide, FilletSide], j: Vec2): number {
  let lo = 0, hi = Math.min(sides[0].length, sides[1].length) * 4
  if (curveRound(sides, j, hi)) return hi
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (curveRound(sides, j, m)) lo = m; else hi = m }
  return lo
}

/** Cut the two joined pieces back to the round of radius r and put it in,
 *  held by two coincidences, two tangencies and a radius dimension. */
export function filletCurves(sketch: Sketch, sides: readonly [FilletSide, FilletSide], j: Vec2, r: number): { arc: number; dimension: number; radius: number } | string {
  const round = curveRound(sides, j, r)
  if (!round) return 'That radius does not fit on these pieces. Enter a smaller radius.'
  const endA: Anchor = { entity: sides[0].id, at: sides[0].near }, endB: Anchor = { entity: sides[1].id, at: sides[1].near }
  const same = (p: Anchor, q: Anchor) => p.entity === q.entity && p.at === q.at
  sketch.constraints = sketch.constraints.filter((c) => !(c.kind === 'coincident' && ((same(c.p, endA) && same(c.q, endB)) || (same(c.p, endB) && same(c.q, endA)))))
  for (const [side, p] of [[sides[0], round.ta], [sides[1], round.tb]] as const) {
    const e = entityOf(sketch, side.id)
    if (!e) return 'A piece of the corner is missing.'
    if (e.kind === 'line') e[side.near] = [p[0], p[1]]
    else if (e.kind === 'arc') {
      const ap = Math.atan2(p[1] - e.c[1], p[0] - e.c[0])
      if (side.near === 'b') e.sweep = wrap(ap - e.start) || TAU
      else { const end = e.start + e.sweep; e.sweep = wrap(end - ap) || TAU; e.start = end - e.sweep }
      delete e.gripT
    }
  }
  const startsAtA = dist(arcPoint({ c: round.centre, r }, round.start), round.ta) < dist(arcPoint({ c: round.centre, r }, round.start), round.tb)
  const arc = addEntity(sketch, { kind: 'arc', c: round.centre, r, start: round.start, sweep: round.sweep })
  addConstraint(sketch, { kind: 'coincident', p: endA, q: { entity: arc, at: startsAtA ? 'a' : 'b' } })
  addConstraint(sketch, { kind: 'coincident', p: endB, q: { entity: arc, at: startsAtA ? 'b' : 'a' } })
  addConstraint(sketch, { kind: 'tangent', a: sides[0].id, b: arc })
  addConstraint(sketch, { kind: 'tangent', a: sides[1].id, b: arc })
  const dimension = addConstraint(sketch, { kind: 'radius', entity: arc, value: r })
  return { arc, dimension, radius: r }
}

export type CurveProfile =
  | { kind: 'sharp'; used: Vec2[]; sigma: number; confident: true }
  | { kind: 'arc'; radius: number; rms: number; used: Vec2[]; sigma: number; confident: boolean; doubt?: string }
  | { kind: 'none'; reason: string }

/** Distance from a point to a side's carrier (its line, or its arc's circle). */
function carrierDistance(side: FilletSide, j: Vec2, p: Vec2): number {
  if (side.piece.kind === 'line') return Math.abs(cross(side.t, sub(p, j)))
  return Math.abs(dist(p, side.piece.c) - side.piece.r)
}

/** How far along a side, from the joint, a point lies (by its foot on the carrier). */
function alongSide(side: FilletSide, j: Vec2, p: Vec2): number {
  if (side.piece.kind === 'line') return dot(sub(p, j), side.t)
  const arc = side.piece
  const aj = Math.atan2(j[1] - arc.c[1], j[0] - arc.c[0]), ap = Math.atan2(p[1] - arc.c[1], p[0] - arc.c[0])
  let turn = side.near === 'a' ? wrap(ap - aj) : wrap(aj - ap)
  // Past the far end, the rest of the circle counts as before the joint.
  if (turn > Math.PI + arc.sweep / 2) turn -= TAU
  return turn * arc.r
}

/** Read the round between a line and an arc, or two arcs, off the slice chains. */
export function analyseCurveCorner(sides: readonly [FilletSide, FilletSide], j: Vec2, chains: readonly (readonly Vec2[])[]): CurveProfile {
  if (!chains.length) return { kind: 'none', reason: 'Auto Fillet reads the corner from the scan section, and this sketch has none. Use Fixed Size Fillet.' }
  const [A, B] = sides
  const reach = Math.min(A.length, B.length)
  const rMax = largestRound(sides, j)
  if (!(rMax > 0)) return { kind: 'none', reason: 'There is no room for a fillet on these pieces.' }
  const original = new WeakSet<Vec2>()
  const step = reach / 400
  const runs = runsNear(chains, j, Math.max(A.length, B.length), step, original)
  if (!runs.length) return { kind: 'none', reason: 'No scan section passes near this corner. Use Fixed Size Fillet, or fit the pieces to the section first.' }
  // The run that passes closest to the joint is this corner's section.
  let run = runs[0], closest = Infinity
  for (const r of runs) for (const p of r) { const d = dist(p, j); if (d < closest) { closest = d; run = r } }

  // Noise, where each piece lies on the section away from the corner.
  const flank = (side: FilletSide) => run.filter((p) => { const s = alongSide(side, j, p); return s >= 0.35 * reach && s <= side.length && carrierDistance(side, j, p) <= 0.08 * reach }).map((p) => carrierDistance(side, j, p))
  const fa = flank(A), fb = flank(B)
  const mad = (v: number[]) => v.length >= 5 ? 1.4826 * median(v) : 0
  const sa = mad(fa), sb = mad(fb), sigma = Math.max(sa, sb)
  const tau = Math.max(4 * sigma, 2e-4 * reach)
  const quiet = sa > 0 && sb > 0 ? Math.min(sa, sb) : sigma
  // The section near the corner: the run's own vertices when it has enough, inside the reach.
  const near = run.filter((p) => dist(p, j) <= 0.95 * reach)
  const own = near.filter((p) => original.has(p))
  const set = own.length >= 8 ? own : near
  if (set.length < 5) return { kind: 'none', reason: 'Too few scan points lie near this corner. Use Fixed Size Fillet.' }

  // A point's distance from the piece-round-piece profile. A piece counts
  // only on its kept side of the joint, and a point in the round's sector
  // belongs to the round only when it is nearer the round than the pieces:
  // an arc that curves on round the corner passes through that sector too.
  // How far along the section each point lies from the point nearest the
  // joint: a round's points are all within its own arc length of there, so a
  // piece that curves back past the corner is never taken for the round.
  const cum = new Map<Vec2, number>()
  let walked = 0, k0 = 0
  for (let k = 0; k < run.length; k++) { if (k) walked += dist(run[k - 1], run[k]); cum.set(run[k], walked); if (dist(run[k], j) < dist(run[k0], j)) k0 = k }
  const origin = cum.get(run[k0])!
  const fromCorner = (p: Vec2) => Math.abs((cum.get(p) ?? origin) - origin)
  const pieceDistance = (side: FilletSide, p: Vec2) => alongSide(side, j, p) >= -0.05 * reach ? carrierDistance(side, j, p) : Infinity
  const residual = (p: Vec2, round: CurveRound) => {
    const a1 = Math.atan2(p[1] - round.centre[1], p[0] - round.centre[0])
    const onPieces = Math.min(pieceDistance(A, p), pieceDistance(B, p))
    const toRound = dist(p, round.centre) - round.r
    const onArc = wrap(a1 - round.start) <= round.sweep && fromCorner(p) <= Math.PI * round.r + closest + 4 * step
    return onArc ? { d: toRound, onArc } : { d: Number.isFinite(onPieces) ? onPieces : Math.abs(toRound), onArc }
  }
  const cap = Math.max(3 * tau, 0.01 * reach)
  const loss = (pts: readonly Vec2[], r: number, capped: boolean, arcOnly: boolean) => {
    const round = curveRound(sides, j, r)
    if (!round) return Infinity
    let sum = 0, n = 0
    for (const p of pts) { const q = residual(p, round); if (arcOnly && !q.onArc) continue; sum += capped ? Math.min(q.d * q.d, cap * cap) : q.d * q.d; n++ }
    return n < 3 ? Infinity : sum / n
  }
  const rMin = rMax * 1e-5
  const search = (pts: readonly Vec2[], capped: boolean, arcOnly: boolean, from = rMin, to = rMax): number | null => {
    const radii = Array.from({ length: 257 }, (_, i) => from * Math.pow(to / from, i / 256))
    let bi = -1, bl = Infinity
    for (let i = 0; i < radii.length; i++) { const l = loss(pts, radii[i], capped, arcOnly); if (l < bl) { bl = l; bi = i } }
    if (bi < 0) return null
    let lo = radii[Math.max(0, bi - 1)], hi = radii[Math.min(radii.length - 1, bi + 1)]
    for (let i = 0; i < 100; i++) { const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3; if (loss(pts, a, capped, arcOnly) < loss(pts, b, capped, arcOnly)) hi = b; else lo = a }
    return (lo + hi) / 2
  }
  const first = search(set, true, false)
  if (first === null) return { kind: 'none', reason: 'Too few scan points lie on a round between these pieces. Use Fixed Size Fillet.' }
  const firstRound = curveRound(sides, j, first)!
  const firstRes = set.map((p) => residual(p, firstRound))
  const onFirst = firstRes.filter((q) => q.onArc)
  const limit = Math.max(5 * 1.4826 * median((onFirst.length >= 3 ? onFirst : firstRes).map((q) => Math.abs(q.d))), tau)
  const kept = set.filter((_, k) => Math.abs(firstRes[k].d) <= limit)
  const profileRadius = search(kept, false, false) ?? first
  const profileRound = curveRound(sides, j, profileRadius)!
  // The round is no deeper than the noise: the pieces are left joined sharp.
  const mid = arcPoint({ c: profileRound.centre, r: profileRadius }, profileRound.start + profileRound.sweep / 2)
  const used = kept
  if (Math.min(carrierDistance(A, j, mid), carrierDistance(B, j, mid)) <= 2 * quiet) return { kind: 'sharp', used, sigma, confident: true }
  const radius = search(kept, false, true, Math.max(rMin, profileRadius / 1.35), Math.min(rMax, profileRadius * 1.35)) ?? profileRadius
  const round = curveRound(sides, j, radius)!
  const res = set.map((p) => ({ p, q: residual(p, round) })).filter((v) => v.q.onArc)
  const inliers = res.filter((v) => Math.abs(v.q.d) <= limit)
  const share = res.length ? inliers.length / res.length : 1
  const rms = inliers.length ? Math.sqrt(inliers.reduce((s, v) => s + v.q.d * v.q.d, 0) / inliers.length) : 0
  const base = { radius, rms, used: inliers.map((v) => v.p), sigma }
  if (share < 0.85) return { kind: 'arc', ...base, confident: false, doubt: `${Math.round((1 - share) * 100)} % of the scan points on the round were set aside as stray` }
  return { kind: 'arc', ...base, confident: true }
}
