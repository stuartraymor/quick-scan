// SPDX-License-Identifier: AGPL-3.0-only
// Auto Fillet the way a person uses it, on five scans.
//
// The user reported (2026-11-23) that Auto Fillet works about three times in
// four in Quick Scan and every time in QUICKSURFACE. The older stress tests
// passed: they used one scan (basic_part), always swept the same tidy
// stroke through the corner point, and accepted a result that waited for
// Accept. Here:
//
//  - the corners come from sections of five scans: basic_part (the user's)
//    and QUICKSURFACE's sample scans bearinghousing, machine_part, lego and
//    aerosol_knob (analysis/autofillet/<part>-sections.json, made by
//    scripts/dump-section-chains.mjs; kept out of the repository);
//  - each flat is brushed with Fit Line through the stores, over a random
//    stretch, with a brush of 10–30 screen pixels at a random zoom, and a
//    hand's wobble;
//  - the corner is painted the ways a person paints "over the corner point":
//    a stroke from one line through the corner point to the other, a dab on
//    the corner point, a stroke across the round out past the corner point,
//    and a scribble; the Corner Trim brush is 7 screen pixels, as in the app;
//  - a result that waits for Accept counts as a failure: in the app nothing
//    happens until the user finds the Accept button.
//
// What counts as working, as QUICKSURFACE works: with the corner point
// painted, a fillet whose radius matches the scan's round (or a sharp join
// where the scan corner is sharp), made at once, with nothing refused.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { SweepArea } from '../core/cornerSweep'
import { pointsUnderPath } from '../core/instantFit'
import { anchorPoint, cloneSketch, type Sketch, type SketchArc, type SketchLine } from '../core/sketch'
import { brushPoints, type BrushPoint } from '../core/sketchBrush'
import { useReverse } from '../state/reStore'
import { useSketchBrush } from '../state/sketchBrushStore'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'
import { cornersOf, type ScanCorner } from './scanCorners'
import { along, makeCase, type CarrierT } from './cornerCaseGenerator'

const XY = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], basisU: [1, 0, 0] as [number, number, number], basisV: [0, 1, 0] as [number, number, number] }
const sketchNow = (): Sketch => useReverse.getState().sketchDraft!.sketch
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
const segDist = (p: Vec2, a: Vec2, b: Vec2) => { const d = sub(b, a), l = dot(d, d), t = l > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l)) : 0; return dist(p, [a[0] + t * d[0], a[1] + t * d[1]]) }

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
}

function openSketch() {
  useReverse.getState().reset()
  useReverse.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
  useSketchBrush.setState({ primitive: 'line', instant: true, tolerance: 0.1, axisDegrees: 1, curvePoints: 8, selected: [], selectionOverflow: false, preview: null, message: null })
}

/** Fit Line or Fit Arc over the section points under a stroke, as on release. */
function brushPiece(kind: 'line' | 'arc', scan: readonly BrushPoint[], stroke: readonly Vec2[], radius: number): SketchLine | SketchArc | string {
  const selected = pointsUnderPath(scan, stroke, radius)
  if (!selected || selected.length < (kind === 'line' ? 2 : 3)) return 'too few points'
  const before = new Set(sketchNow().entities.map((e) => e.id))
  useSketchBrush.setState({ primitive: kind, selected, selectionOverflow: false })
  if (!useSketchBrush.getState().apply()) return useSketchBrush.getState().message ?? 'fit failed'
  const made = sketchNow().entities.find((e) => !before.has(e.id))
  return made?.kind === kind ? made : `the fit made a ${made?.kind ?? 'nothing'}`
}
const brushLine = (scan: readonly BrushPoint[], stroke: readonly Vec2[], radius: number) => brushPiece('line', scan, stroke, radius) as SketchLine | string

function crossing(a: SketchLine, b: SketchLine): Vec2 | null {
  const d1 = sub(a.b, a.a), d2 = sub(b.b, b.a), den = d1[0] * d2[1] - d1[1] * d2[0]
  if (Math.abs(den) < 1e-12 * Math.hypot(...d1) * Math.hypot(...d2)) return null
  const t = ((b.a[0] - a.a[0]) * d2[1] - (b.a[1] - a.a[1]) * d2[0]) / den
  return [a.a[0] + d1[0] * t, a.a[1] + d1[1] * t]
}

type Gesture = 'through' | 'dab' | 'across' | 'scribble' | 'round'
const GESTURES: Gesture[] = ['through', 'dab', 'across', 'scribble']

export interface UserRow {
  id: string; part: string; gesture: Gesture
  outcome: 'fillet' | 'sharp' | 'refused' | 'pending' | 'nothing' | 'unpainted'
  ok: boolean; problem?: string; message?: string | null
  radius?: number; ref?: number; gap?: number; exceeds?: boolean
}


/** Where two pieces' carriers (a line's whole line, an arc's whole circle) cross. */
function carrierCrossings(e: SketchLine | SketchArc, f: SketchLine | SketchArc): Vec2[] {
  if (e.kind === 'line' && f.kind === 'line') { const x = crossing(e, f); return x ? [x] : [] }
  const lineCircle = (l: SketchLine, c: Vec2, r: number): Vec2[] => {
    const d = sub(l.b, l.a), n = Math.hypot(...d), u: Vec2 = [d[0] / n, d[1] / n], t = dot(sub(c, l.a), u)
    const foot: Vec2 = [l.a[0] + u[0] * t, l.a[1] + u[1] * t], h2 = r * r - dist(foot, c) ** 2
    if (h2 < 0) return []
    const h = Math.sqrt(h2)
    return [[foot[0] + u[0] * h, foot[1] + u[1] * h], [foot[0] - u[0] * h, foot[1] - u[1] * h]]
  }
  if (e.kind === 'line' && f.kind === 'arc') return lineCircle(e, f.c, f.r)
  if (e.kind === 'arc' && f.kind === 'line') return lineCircle(f, e.c, e.r)
  const a = e as SketchArc, b = f as SketchArc, d = dist(a.c, b.c)
  if (!(d > 1e-12) || d > a.r + b.r || d < Math.abs(a.r - b.r)) return []
  const x = (a.r * a.r - b.r * b.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a.r * a.r - x * x))
  const u: Vec2 = [(b.c[0] - a.c[0]) / d, (b.c[1] - a.c[1]) / d], m: Vec2 = [a.c[0] + u[0] * x, a.c[1] + u[1] * x]
  return [[m[0] - u[1] * h, m[1] + u[0] * h], [m[0] + u[1] * h, m[1] - u[0] * h]]
}

/** What must hold after any corner, as in reFittedCornerStress: the two
 *  pieces keep their carriers and far ends, a fillet is tangent to both, an
 *  ordinary edit afterwards (a full solve) moves nothing, and Undo restores
 *  the sketch exactly. Returns a problem, or null. Leaves the sketch undone. */
function integrity(start: Sketch, history: number, ids: readonly number[]): string | null {
  const after = sketchNow()
  let problem: string | null = null
  const bad = (p: string) => { problem ??= p }
  const piece = (s: Sketch, id: number) => s.entities.find((e) => e.id === id) as SketchLine | SketchArc | undefined
  const changed = ids.filter((id) => JSON.stringify(piece(start, id)) !== JSON.stringify(piece(after, id)))
  for (const id of changed) {
    const p0 = piece(start, id), p1 = piece(after, id)
    if (!p0 || !p1 || p0.kind !== p1.kind) { bad(`piece ${id} changed kind`); continue }
    if (p0.kind === 'arc' && p1.kind === 'arc' && (dist(p0.c, p1.c) > 1e-9 || Math.abs(p0.r - p1.r) > 1e-9)) bad('an arc moved off its circle')
    if (p0.kind === 'line' && p1.kind === 'line') {
      const d = sub(p0.b, p0.a), l = Math.hypot(...d)
      const off = (q: Vec2) => Math.abs(((q[0] - p0.a[0]) * d[1] - (q[1] - p0.a[1]) * d[0]) / l)
      if (Math.max(off(p1.a), off(p1.b)) > 1e-9) bad('a line moved off its carrier')
    }
    const ends0 = [anchorPoint(p0, 'a'), anchorPoint(p0, 'b')], ends1 = [anchorPoint(p1, 'a'), anchorPoint(p1, 'b')]
    if (!ends0.some((q) => ends1.some((r) => dist(q, r) <= 1e-9))) bad('a far end moved')
  }
  const fillet = after.entities.find((e) => e.kind === 'arc' && !start.entities.some((b) => b.id === e.id)) as SketchArc | undefined
  if (fillet) {
    for (const id of ids) {
      const p1 = piece(after, id)
      if (!p1) continue
      const fe = [anchorPoint(fillet, 'a'), anchorPoint(fillet, 'b')]
      let best = Infinity, at = fe[0]
      for (const q of [anchorPoint(p1, 'a'), anchorPoint(p1, 'b')]) for (const r of fe) if (dist(q, r) < best) { best = dist(q, r); at = r }
      if (best > 1e-6) { bad(`a gap of ${best.toExponential(2)} at a tangent point`); continue }
      const radial: Vec2 = [(at[0] - fillet.c[0]) / fillet.r, (at[1] - fillet.c[1]) / fillet.r]
      const lean = p1.kind === 'line' ? (() => { const d = sub(p1.b, p1.a), l = Math.hypot(...d); return Math.abs((radial[0] * d[0] + radial[1] * d[1]) / l) })()
        : Math.abs(radial[0] * (at[1] - p1.c[1]) / p1.r - radial[1] * (at[0] - p1.c[0]) / p1.r)
      if (lean > 1e-6) bad(`not tangent (${lean.toExponential(2)})`)
    }
  }
  const settled = cloneSketch(after)
  useReverse.getState().setSketch(cloneSketch(settled))
  const later = sketchNow()
  for (const e of settled.entities) {
    const l = later.entities.find((x) => x.id === e.id)
    if (!l || (e.kind !== 'line' && e.kind !== 'arc')) continue
    const drift = Math.max(...(['a', 'b'] as const).map((k) => dist(anchorPoint(e, k), anchorPoint(l, k))))
    if (drift > 1e-4) { bad(`the next edit moved the sketch by ${drift.toExponential(2)}`); break }
  }
  while (useReverse.getState().sketchDraft!.history.length > history) useReverse.getState().undoSketch()
  if (JSON.stringify(sketchNow()) !== JSON.stringify(start)) bad('Undo did not restore the sketch')
  return problem
}

/** One corner: two lines brushed, the corner painted, the result judged. */
function tryCorner(part: string, c: ScanCorner, chains: Vec2[][], scan: BrushPoint[], R: () => number, gesture: Gesture, tag: string): UserRow | null {
  openSketch()
  const span = c.A.length + c.B.length
  // A zoom at which the two flats fill 500 to 1400 screen pixels.
  const mmPerPx = span / (500 + 900 * R())
  const fitRadius = (10 + 20 * R()) * mmPerPx
  const ringRadius = 7 * mmPerPx
  const wobble = (p: Vec2, by: number): Vec2 => [p[0] + (R() - 0.5) * 2 * by, p[1] + (R() - 0.5) * 2 * by]
  // Each flat's corner end and direction away from the corner.
  const flatStroke = (f: ScanCorner['A'], cornerEnd: Vec2, farEnd: Vec2) => {
    const L = f.length, d: Vec2 = [(farEnd[0] - cornerEnd[0]) / L, (farEnd[1] - cornerEnd[1]) / L]
    // From near the corner (sometimes a little into the round) to somewhere along the flat.
    const from = R() < 0.15 ? -0.05 * L : (0.02 + 0.35 * R()) * L
    const to = Math.min(L, from + (0.25 + 0.6 * R()) * L)
    return Array.from({ length: 16 }, (_, i) => wobble([cornerEnd[0] + d[0] * (from + (to - from) * i / 15), cornerEnd[1] + d[1] * (from + (to - from) * i / 15)], 0.3 * fitRadius))
  }
  const la = brushLine(scan, flatStroke(c.A, c.A.b, c.A.a), fitRadius)
  const lb = brushLine(scan, flatStroke(c.B, c.B.a, c.B.b), fitRadius)
  if (typeof la === 'string' || typeof lb === 'string') return null
  const x = crossing(la, lb)
  if (!x) return null
  const near = (l: SketchLine) => dist(l.a, x) <= dist(l.b, x) ? l.a : l.b
  const far = (l: SketchLine) => dist(l.a, x) <= dist(l.b, x) ? l.b : l.a
  const nA = near(la), nB = near(lb)
  const dA: Vec2 = (() => { const v = sub(far(la), x), n = Math.hypot(...v); return [v[0] / n, v[1] / n] })()
  const dB: Vec2 = (() => { const v = sub(far(lb), x), n = Math.hypot(...v); return [v[0] / n, v[1] / n] })()
  const half = Math.acos(Math.max(-1, Math.min(1, dot(dA, dB)))) / 2
  // The scan's round: the section's nearest approach to the corner point.
  const between = c.chain.slice(Math.max(0, c.A.i), c.B.j + 1)
  let gap = Infinity, m: Vec2 = x
  for (let k = 1; k < between.length; k++) { const d = segDist(x, between[k - 1], between[k]); if (d < gap) { gap = d; m = between[k - 1] } }
  const factor = 1 / Math.sin(half) - 1
  const ref = factor > 1e-6 ? gap / factor : Infinity
  // Outwards from the round through the corner point.
  const out: Vec2 = gap > 1e-9 ? [(x[0] - m[0]) / Math.max(gap, 1e-9), (x[1] - m[1]) / Math.max(gap, 1e-9)] : [-(dA[0] + dB[0]) / 2, -(dA[1] + dB[1]) / 2]
  const ol = Math.hypot(...out), o: Vec2 = [out[0] / ol, out[1] / ol]
  const g = ringRadius
  let stroke: Vec2[]
  if (gesture === 'through') stroke = [wobble(nA, g), wobble(x, 0.6 * g), wobble(nB, g)]
  else if (gesture === 'dab') stroke = Array.from({ length: 9 }, (_, i) => wobble([x[0] + 1.2 * g * Math.cos(i * 0.8), x[1] + 1.2 * g * Math.sin(i * 0.8)], 0.3 * g))
  else if (gesture === 'across') { const inside = Math.max(2 * g, 0.5 * gap); stroke = [[m[0] - o[0] * inside, m[1] - o[1] * inside], wobble(x, 0.6 * g), [x[0] + o[0] * 2 * g, x[1] + o[1] * 2 * g]] }
  else if (gesture === 'scribble') stroke = [wobble(nA, g), wobble(m, g), wobble(x, 0.6 * g), wobble(m, g), wobble(nB, g)]
  else stroke = between.filter((p) => dist(p, x) <= 1.5 * gap + 4 * g)
  if (stroke.length < 1) return null
  const painted = new SweepArea({ path: stroke, radius: ringRadius }).distance(x) <= 0
  const id = `${part} ${tag} ${gesture} turn ${c.turn.toFixed(0)}° ref ${Number.isFinite(ref) ? ref.toFixed(3) : '∞'}`
  if (!painted && gesture !== 'round') return { id, part, gesture, outcome: 'unpainted', ok: true }
  const ct = useSketchCornerTrim
  ct.getState().setOpen(true)
  ct.setState({ mode: 'autoFillet', radiusMm: 1, addDimension: true })
  const before = sketchNow(), history = useReverse.getState().sketchDraft!.history.length
  const did = ct.getState().sweep(stroke, ringRadius, chains.flat(), chains)
  const s = ct.getState()
  const base = { id, part, gesture, ref, gap, message: s.message }
  if (!did && s.pending) { ct.getState().cancel(); return { ...base, outcome: 'pending', ok: false, problem: `waits for Accept: ${s.message}` } }
  if (!did) {
    ct.getState().cancel()
    return { ...base, outcome: sketchNow() === before ? 'refused' : 'nothing', ok: false, problem: `refused: ${s.message}` }
  }
  const after = sketchNow()
  const fillet = after.entities.find((e) => e.kind === 'arc' && !before.entities.some((b) => b.id === e.id)) as SketchArc | undefined
  const exceeds = Boolean(s.lastFit?.scanFit?.exceeds)
  ct.getState().cancel()
  const broken = integrity(before, history, [la.id, lb.id])
  if (broken) return { ...base, outcome: fillet ? 'fillet' : 'sharp', ok: false, problem: broken }
  // The round the scan shows: at least 0.15 mm, and deeper than the
  // section's gap from a sharp corner could be by noise.
  const rounded = Number.isFinite(ref) && ref > 0.15 && gap > 0.03
  if (!painted) return { ...base, outcome: fillet ? 'fillet' : 'sharp', ok: true, radius: fillet?.r, exceeds }
  // The scan's own round is seldom exactly circular, and the lines a hand
  // brushes are not exactly on its flats, so the gap's reading is only a
  // guide: a radius within 25 % of it passes, and so does one whose corner
  // (line, arc, line) lies on the scan no worse than a round of the gap's
  // radius would. A sharp join is judged as a round of radius 0: where a
  // hand brushed the lines into the round, their crossing lies on the scan,
  // and the tangent arc that fits best between them is next to nothing
  // (QUICKSURFACE leaves an R 0.000134 mm fillet there).
  const r = fillet?.r ?? 0
  const off = rounded ? Math.abs(r - ref) / ref : 0
  const bis: Vec2 = (() => { const v: Vec2 = [dA[0] + dB[0], dA[1] + dB[1]], n = Math.hypot(...v); return [v[0] / n, v[1] / n] })()
  const profile = (p: Vec2, r: number) => {
    const t = r / Math.tan(half), cc: Vec2 = [x[0] + bis[0] * r / Math.sin(half), x[1] + bis[1] * r / Math.sin(half)]
    const alongA = dot(sub(p, x), dA) - t, alongB = dot(sub(p, x), dB) - t
    const offA = Math.abs(dA[0] * (p[1] - x[1]) - dA[1] * (p[0] - x[0])), offB = Math.abs(dB[0] * (p[1] - x[1]) - dB[1] * (p[0] - x[0]))
    if (alongA > 0 || alongB > 0) return alongA > 0 && alongB > 0 ? Math.min(offA, offB) : alongA > 0 ? offA : offB
    return Math.abs(dist(p, cc) - r)
  }
  const zone = 1.5 * Math.max(r, ref) / Math.tan(half) + 2 * ringRadius
  const nearScan = c.chain.filter((p) => dist(p, x) <= zone)
  const rmsAt = (r: number) => Math.sqrt(nearScan.reduce((sum, p) => sum + profile(p, r) ** 2, 0) / Math.max(1, nearScan.length))
  const ours = rmsAt(r), theirs = rounded ? rmsAt(ref) : Infinity
  const ok = !rounded || off <= 0.25 || Math.abs(r - ref) <= 0.1 || ours <= 1.1 * theirs + 0.005
  if (!fillet) return { ...base, outcome: 'sharp', ok, ...(ok ? {} : { problem: `sharp join on a round of about ${ref.toFixed(3)} (scan rms ${ours.toFixed(3)} against ${theirs.toFixed(3)}): ${s.message}` }) }
  return { ...base, outcome: 'fillet', ok, radius: r, exceeds, ...(ok ? {} : { problem: `radius ${r.toFixed(3)} for a round of about ${ref.toFixed(3)} (scan rms ${ours.toFixed(3)} against ${theirs.toFixed(3)})` }) }
}

/** A corner built from its answer (line–arc, arc–line, arc–arc and
 *  line–line), both pieces brushed short of the round, the corner point
 *  painted. Clean, finely sampled rounds must come back at their radius. */
function tryBuilt(seed: number, gesture: Gesture): UserRow | null {
  const k = makeCase(seed), g = k.build()
  if (!g) return null
  const R = rng(seed * 7919 + GESTURES.indexOf(gesture) * 131)
  const stretch = (c: CarrierT, out: number): Vec2[] | null => {
    const most = c.kind === 'circle' ? Math.min(out, 1.2 * Math.PI * c.R) : out
    const from = 0.15 + R() * 0.3 * most
    const least = c.kind === 'circle' ? Math.max(3, 0.35 * c.R) : 3
    if (most - from < least) return null
    const to = from + least + R() * (most - from - least)
    return Array.from({ length: 41 }, (_, i) => along(c, from + (to - from) * i / 40))
  }
  const sa = stretch(g.A, g.outA), sb = stretch(g.B, g.outB)
  if (!sa || !sb) return null
  openSketch()
  const chains = [g.chain], scan = brushPoints(chains)
  const mmPerPx = (g.outA + g.outB) / (500 + 900 * R())
  const ringRadius = 7 * mmPerPx, fitR = Math.max(0.6 * g.step, (10 + 10 * R()) * mmPerPx)
  const a = brushPiece(g.A.kind === 'line' ? 'line' : 'arc', scan, sa, fitR), b = brushPiece(g.B.kind === 'line' ? 'line' : 'arc', scan, sb, fitR)
  if (typeof a === 'string' || typeof b === 'string') return null
  // The corner point of the brushed pieces (where their carriers cross),
  // nearest the true one: that is the point a person paints over.
  const xs = carrierCrossings(a, b).sort((p, q) => dist(p, g.corner) - dist(q, g.corner))
  if (!xs.length) return null
  const x = xs[0], mid = g.chain.reduce((best, p) => dist(p, x) < dist(best, x) ? p : best, g.chain[0])
  const o: Vec2 = (() => { const v = sub(x, mid), n = Math.hypot(...v) || 1; return [v[0] / n, v[1] / n] })()
  const near = (e: SketchLine | SketchArc) => { const p = anchorPoint(e, 'a'), q = anchorPoint(e, 'b'); return dist(p, x) <= dist(q, x) ? p : q }
  const r0 = ringRadius
  const stroke: Vec2[] = gesture === 'through' ? [near(a), x, near(b)]
    : gesture === 'dab' ? Array.from({ length: 9 }, (_, i) => [x[0] + 1.2 * r0 * Math.cos(i * 0.8), x[1] + 1.2 * r0 * Math.sin(i * 0.8)] as Vec2)
    : gesture === 'across' ? [[mid[0] - o[0] * 2 * r0, mid[1] - o[1] * 2 * r0], x, [x[0] + o[0] * 2 * r0, x[1] + o[1] * 2 * r0]]
    : [near(a), mid, x, mid, near(b)]
  const id = `built ${k.id} ${gesture}`
  if (process.env.USER_CAPTURE) {
    fs.mkdirSync(process.env.USER_CAPTURE,{recursive:true})
    fs.writeFileSync(path.join(process.env.USER_CAPTURE,`${seed}-${gesture}.json`),JSON.stringify({seed,gesture,reference:k.r,geometry:cloneSketch(sketchNow()),chains,stroke,ringRadius,corner:x},null,2))
  }

  if (new SweepArea({ path: stroke, radius: ringRadius }).distance(x) > 0) return { id, part: 'built', gesture, outcome: 'unpainted', ok: true }
  const ct = useSketchCornerTrim
  ct.getState().setOpen(true)
  ct.setState({ mode: 'autoFillet', radiusMm: 1, addDimension: true })
  const before = sketchNow(), history = useReverse.getState().sketchDraft!.history.length
  const did = ct.getState().sweep(stroke, ringRadius, chains.flat(), chains)
  const msg = ct.getState().message
  ct.getState().cancel()
  const base = { id, part: 'built', gesture, ref: k.r, message: msg }
  if (!did) return { ...base, outcome: 'refused', ok: false, problem: `refused: ${msg}` }
  const fillet = sketchNow().entities.find((e) => e.kind === 'arc' && !before.entities.some((q) => q.id === e.id)) as SketchArc | undefined
  const broken = integrity(before, history, [a.id, b.id])
  if (broken) return { ...base, outcome: fillet ? 'fillet' : 'sharp', ok: false, problem: broken }
  if (!fillet) return { ...base, outcome: 'sharp', ok: k.r < 0.3, ...(k.r < 0.3 ? {} : { problem: `sharp join on a round of ${k.r.toFixed(3)}: ${msg}` }) }
  // How far a brushed piece's carrier lies from the true one: a wide brush
  // takes in points of the round, and the corner is then built on other
  // carriers, where the true radius is no longer the answer.
  const carrierError = (e: SketchLine | SketchArc, c: CarrierT) => {
    if (e.kind === 'arc' && c.kind === 'circle') return dist(e.c, c.c) + Math.abs(e.r - c.R)
    if (e.kind === 'line' && c.kind === 'line') return Math.max(...[e.a, e.b].map((p) => Math.abs(c.d[0] * (p[1] - c.t[1]) - c.d[1] * (p[0] - c.t[0]))))
    return Infinity
  }
  const onCarriers = Math.max(carrierError(a, g.A), carrierError(b, g.B)) <= 1e-3
  const clean = k.noise === 0 && k.phi * k.r / k.step >= 5 && onCarriers
  const ok = clean ? Math.abs(fillet.r - k.r) <= 0.02 * k.r + 0.002 : Math.abs(fillet.r - k.r) <= 0.25 * k.r + 0.01
  return { ...base, outcome: 'fillet', ok, radius: fillet.r, ...(ok ? {} : { problem: `radius ${fillet.r.toFixed(4)} for a round of ${k.r.toFixed(4)}` }) }
}

describe('Auto Fillet radius regressions', () => {
  it.each([[44,'through'],[44,'scribble'],[155,'through'],[172,'through'],[172,'scribble'],[193,'across'],[320,'dab']] as const)('built #%i, %s', (seed,gesture) => {
    const row=tryBuilt(seed,gesture)
    console.log('radius regression',JSON.stringify(row))
    expect(row).not.toBeNull()
    expect(row!.ok,row!.problem).toBe(true)
  })
})

describe('Auto Fillet as a person uses it, on corners built from their answer', () => {
  it('line–arc, arc–line, arc–arc: brushed short of the round, the corner point painted', async () => {
    const rows: UserRow[] = []
    let built = 0
    for (let seed = 1; built < Number(process.env.USER_BUILT ?? 200) && seed < 5000; seed++) {
      let any = false
      for (const gesture of GESTURES) {
        const row = tryBuilt(seed, gesture)
        if (row) { rows.push(row); any = true }
      }
      if (any) built++
      if (built % 10 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    const { tried, bad, kinds } = summarise(rows)
    const outcomes = new Map<string, number>()
    for (const r of tried) outcomes.set(r.outcome, (outcomes.get(r.outcome) ?? 0) + 1)
    console.log(`Built corners, corner point painted: ${tried.length} tries over ${built} corners, ${bad.length} failed; outcomes ${JSON.stringify(Object.fromEntries(outcomes))}; missed the corner point ${rows.filter((r) => r.outcome === 'unpainted').length}`)
    for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${k}`)
    for (const r of bad.slice(0, Number(process.env.USER_SHOW ?? 30))) console.log('  ✗', r.id, '—', r.problem)
    // 1.2.29: 7 of 775, radii read on hard corners (pieces brushed off their
    // carriers, a 0.5 mm round sampled every 0.9 mm); 1.2.28's code failed 392.
    expect(built).toBeGreaterThanOrEqual(150)
    expect(bad.length).toBeLessThanOrEqual(Number(process.env.USER_MAX_FAIL_BUILT ?? Math.ceil(0.02 * tried.length)))
  }, 1_800_000)
})

const dir = path.resolve(__dirname, '../../../analysis/autofillet')
const PARTS = ['basic_part', 'bearinghousing', 'machine_part', 'lego', 'aerosol_knob']
const files = PARTS.map((p) => ({ part: p, file: path.join(dir, `${p}-sections.json`) })).filter((f) => fs.existsSync(f.file))

export function summarise(rows: readonly UserRow[]) {
  const tried = rows.filter((r) => r.outcome !== 'unpainted' && r.gesture !== 'round')
  const bad = tried.filter((r) => !r.ok)
  const kinds = new Map<string, number>()
  for (const r of bad) { const k = `${r.part}: ${(r.problem ?? '').replace(/[-\d.e+]+/g, '#').slice(0, 110)}`; kinds.set(k, (kinds.get(k) ?? 0) + 1) }
  return { tried, bad, kinds }
}

describe.skipIf(!files.length)('Auto Fillet as a person uses it, on five scans', () => {
  it('brushed lines, the corner point painted four ways', async () => {
    const rows: UserRow[] = []
    const perPart = Number(process.env.USER_CORNERS ?? 40)
    for (const { part, file } of files) {
      const sections = (JSON.parse(fs.readFileSync(file, 'utf8')) as { sections: { axis: string; offset: number; chains: Vec2[][] }[] }).sections
      const corners = sections.flatMap((s) => cornersOf(s).map((c) => ({ c, chains: s.chains })))
      // An even spread of the part's corners.
      const step = Math.max(1, corners.length / perPart)
      for (let k = 0; k < corners.length && k / step < perPart; k = Math.floor(k + step) === k ? k + 1 : Math.floor(k + step)) {
        const { c, chains } = corners[k]
        const scan = brushPoints(chains)
        for (const [gi, gesture] of [...GESTURES, 'round' as const].entries()) {
          await new Promise((r) => setTimeout(r, 0))
          const R = rng(k * 7919 + gi * 104729 + part.length * 31)
          const row = tryCorner(part, c, chains, scan, R, gesture, `${c.section}#${k}`)
          if (row) rows.push(row)
        }
      }
    }
    const { tried, bad, kinds } = summarise(rows)
    const byPart = new Map<string, { n: number; bad: number }>()
    for (const r of tried) { const e = byPart.get(r.part) ?? { n: 0, bad: 0 }; e.n++; if (!r.ok) e.bad++; byPart.set(r.part, e) }
    console.log(`Auto Fillet, corner point painted: ${tried.length} tries, ${bad.length} failed (${(100 * bad.length / Math.max(1, tried.length)).toFixed(1)} %)`)
    for (const [p, e] of byPart) console.log(`  ${p}: ${e.n} tries, ${e.bad} failed`)
    const outcomes = new Map<string, number>()
    for (const r of tried) outcomes.set(r.outcome, (outcomes.get(r.outcome) ?? 0) + 1)
    console.log('  outcomes', JSON.stringify(Object.fromEntries(outcomes)))
    const unpainted = rows.filter((r) => r.outcome === 'unpainted').length
    console.log(`  gestures that missed the corner point (not tried): ${unpainted}`)
    const round = rows.filter((r) => r.gesture === 'round')
    console.log(`  the round alone painted: ${round.length}, fillets ${round.filter((r) => r.outcome === 'fillet').length}, sharp ${round.filter((r) => r.outcome === 'sharp').length}`)
    for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${k}`)
    for (const r of bad.slice(0, Number(process.env.USER_SHOW ?? 30))) console.log('  ✗', r.id, '—', r.problem)
    fs.writeFileSync(path.join(dir, 'user-autofillet-report.json'), JSON.stringify({ tried: tried.length, failed: bad.length, rows }, null, 1))
    // 1.2.29: 2 of 889 (line ends more than 200 brush rings, 1400 px, from
    // the corner point); 1.2.28's code failed 546.
    expect(bad.length).toBeLessThanOrEqual(Number(process.env.USER_MAX_FAIL ?? Math.ceil(0.01 * tried.length)))
  }, 1_800_000)
})
