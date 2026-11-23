// SPDX-License-Identifier: AGPL-3.0-only
// Seeded random-workflow fuzz of the 2D Sketch MODIFY tools, driven through
// the stores the GUI calls (never the core directly where the GUI goes
// through a store):
//  - Corner Trim in its three modes (Trim / Auto Fillet / Fixed Size Fillet),
//    a swept area released as SketchCornerTrimOverlay releases it:
//    sweep(path, 7 px brush ring in sheet mm, chains.flat(), chains), a
//    weakly supported result accepted as Enter accepts it;
//  - the last fillet's radius (previewFilletRadius / setFilletRadius);
//  - filletSelected, chamferSelected, sharpenSelected, joinSelected,
//    deleteSelected, openSketchPattern/applySketchPattern (useReverse),
//    trimSketchAt, offsetSketchSelection, duplicateSketchSelection,
//    Mirror (useSketchMirror start/pick/accept), Pattern (useSketchPattern);
//  - Fit Line / Fit Arc brushing (useSketchBrush) on synthetic sections and
//    on QUICKSURFACE's basic_part scan sections;
//  - Undo / Redo.
// Corners: line–line at 5°–175° (90° often), drawn as a polyline (joined)
// or as separate lines short of, overlapping or crossing the corner, line–
// arc, arc–arc, rectangles, with and without H/V, dimensions, Fix, other
// geometry near the corner, short pieces, and brushed (fitted) pieces.
// Sweeps: over the corner point, round it, along the ends only, a box, a
// tap, a scribble; from either piece; slow and fast pointer rates.
//
// Every step is checked: no exception, finite numbers, far ends and carriers
// held, fillets tangent (1e-6) and Fixed radii exact, a refusal leaves the
// sketch identical with a readable message, Undo restores exactly and Redo
// re-applies exactly, the panel state follows Undo/Redo, and brushed pieces
// stay where fitted through the next edit. Failures are grouped by
// signature and the first of each is shrunk to a minimal reproduction.
//
// FUZZ_N (default 2000) workflows from FUZZ_SEED (default 20261120);
// FUZZ_REPORT=<file> writes the full report as JSON.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { fixture } from '../../../tests/fixtures'
import { SweepArea, piecesInSweep } from '../core/cornerSweep'
import { lineIntersection } from '../core/corners'
import { pointsUnderPath } from '../core/instantFit'
import { mirrorAxisChoices } from '../core/mirrorAxes'
import { addConstraint, addEntity, addRectangle, anchorPoint, cloneSketch, emptySketch, entityOf, entityPolyline, type Constraint, type Sketch, type SketchArc, type SketchEntity, type SketchLine } from '../core/sketch'
import { brushPoints, type BrushPoint } from '../core/sketchBrush'
import { sweptCandidates, type CornerTrimMode } from '../core/sketchCornerTrim'
import { useReverse } from '../state/reStore'
import { useSketchAnalysis } from '../state/sketchAnalysisStore'
import { useSketchBrush } from '../state/sketchBrushStore'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'
import { duplicateSketchSelection, offsetSketchSelection, trimSketchAt } from '../state/sketchExtraTools'
import { useSketchMirror } from '../state/sketchMirrorStore'
import { useSketchPattern } from '../state/sketchPatternStore'
import { closeSketchToolOverlays } from '../state/sketchToolActions'
import { along, makeCase, rng, type CarrierT } from './cornerCaseGenerator'
import { XY } from './reKit'

type Piece = SketchLine | SketchArc
type Rand = () => number
const ct = useSketchCornerTrim
const re = () => useReverse.getState()
const draft = () => re().sketchDraft!
const sketchNow = (): Sketch => draft().sketch
const hist = () => draft().history.length
const keyOf = (s: Sketch) => JSON.stringify(s)

// ---- geometry ---------------------------------------------------------------
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
const unit = (a: Vec2): Vec2 => { const l = Math.hypot(a[0], a[1]); return l > 0 ? [a[0] / l, a[1] / l] : [1, 0] }
const dirAt = (t: number): Vec2 => [Math.cos(t), Math.sin(t)]
const ends = (e: Piece): [Vec2, Vec2] => [anchorPoint(e, 'a'), anchorPoint(e, 'b')]
const pieceOf = (s: Sketch, id: number) => entityOf(s, id) as Piece | undefined
const U = (R: Rand, a: number, b: number) => a + (b - a) * R()
const pick = <T,>(R: Rand, xs: readonly T[]): T => xs[Math.floor(R() * xs.length)]
const r4 = (v: number) => Math.round(v * 1e4) / 1e4

/** How far a carrier moved: a line's direction and offset, an arc's circle. */
function carrierMoved(a: Piece, b: Piece): number {
  if (a.kind === 'arc' && b.kind === 'arc') return Math.max(dist(a.c, b.c), Math.abs(a.r - b.r))
  if (a.kind === 'line' && b.kind === 'line') {
    const d = sub(a.b, a.a), l = Math.hypot(d[0], d[1])
    const off = (p: Vec2) => Math.abs(((p[0] - a.a[0]) * d[1] - (p[1] - a.a[1]) * d[0]) / l)
    return Math.max(off(b.a), off(b.b))
  }
  return Infinity
}
/** Crossings of two pieces' carriers. */
function crossingsOf(a: Piece, b: Piece): Vec2[] {
  const lineCircle = (l: SketchLine, c: Vec2, r: number): Vec2[] => {
    const u = unit(sub(l.b, l.a)), t = dot(sub(c, l.a), u), foot = add(l.a, mul(u, t)), h2 = r * r - dist(foot, c) ** 2
    if (h2 < 0) return []
    const h = Math.sqrt(h2)
    return [add(foot, mul(u, h)), sub(foot, mul(u, h))]
  }
  if (a.kind === 'line' && b.kind === 'arc') return lineCircle(a, b.c, b.r)
  if (a.kind === 'arc' && b.kind === 'line') return lineCircle(b, a.c, a.r)
  if (a.kind === 'arc' && b.kind === 'arc') {
    const d = dist(a.c, b.c)
    if (d > a.r + b.r || d < Math.abs(a.r - b.r) || d < 1e-12) return []
    const x = (a.r * a.r - b.r * b.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a.r * a.r - x * x)), u = unit(sub(b.c, a.c)), m = add(a.c, mul(u, x))
    return [[m[0] - u[1] * h, m[1] + u[0] * h], [m[0] + u[1] * h, m[1] - u[0] * h]]
  }
  const x = lineIntersection(a as SketchLine, b as SketchLine)
  return x ? [x] : []
}
function offTangent(fillet: SketchArc, piece: Piece, at: Vec2): number {
  const radial = mul(sub(at, fillet.c), 1 / fillet.r)
  if (piece.kind === 'line') { const d = unit(sub(piece.b, piece.a)); return Math.abs(dot(radial, d)) }
  const other = mul(sub(at, piece.c), 1 / piece.r)
  return Math.abs(radial[0] * other[1] - radial[1] * other[0])
}
/** Every number in the sketch is finite. */
function finiteSketch(s: Sketch): boolean {
  const ok = (x: unknown): boolean => typeof x === 'number' ? Number.isFinite(x) : Array.isArray(x) ? x.every(ok) : x && typeof x === 'object' ? Object.values(x).every(ok) : true
  return ok(s.entities) && ok(s.constraints)
}
/** Largest move of any entity's defining numbers between two sketches (entities by id). */
function moved(a: SketchEntity, b: SketchEntity): number {
  const nums = (e: SketchEntity): number[] => e.kind === 'line' ? [...e.a, ...e.b] : e.kind === 'arc' ? [...e.c, e.r, ...anchorPoint(e, 'a'), ...anchorPoint(e, 'b')] : e.kind === 'circle' ? [...e.c, e.r] : e.kind === 'point' ? [...e.p] : e.pts.flat()
  if (a.kind !== b.kind) return Infinity
  const x = nums(a), y = nums(b)
  if (x.length !== y.length) return Infinity
  return Math.max(0, ...x.map((v, i) => Math.abs(v - y[i])))
}
/** What differs between two sketches: the largest move of a piece, pieces
 *  and relations added or removed, relations changed. */
function sketchDiff(a: Sketch, b: Sketch): string {
  let mv = 0, which = ''
  for (const e of a.entities) { const f = entityOf(b, e.id); if (f) { const m = moved(e, f); if (m > mv) { mv = m; which = `${e.kind} ${e.id}` } } }
  const gone = a.entities.filter((e) => !entityOf(b, e.id)).length, made = b.entities.filter((e) => !entityOf(a, e.id)).length
  const ka = new Set(a.constraints.map((c) => JSON.stringify(c))), kb = new Set(b.constraints.map((c) => JSON.stringify(c)))
  const cGone = [...ka].filter((k) => !kb.has(k)).length, cMade = [...kb].filter((k) => !ka.has(k)).length
  return `max move ${mv.toExponential(2)}${which ? ` (${which})` : ''}; pieces -${gone}/+${made}; relations -${cGone}/+${cMade}${a.nextId !== b.nextId ? `; nextId ${a.nextId}→${b.nextId}` : ''}`
}
/** Pieces of `b` that are degenerate (a line under 1 µm, an arc of under
 *  1 µm radius or a sweep under 1e-5 rad) and were not so in `a`. */
function newlyDegenerate(a: Sketch, b: Sketch): string[] {
  const bad = (e: SketchEntity) => e.kind === 'line' ? dist(e.a, e.b) < 1e-3 : e.kind === 'arc' ? e.r < 1e-3 || Math.abs(e.sweep) < 1e-5 : e.kind === 'circle' ? e.r < 1e-3 : false
  return b.entities.filter((e) => bad(e) && !(entityOf(a, e.id) && bad(entityOf(a, e.id)!))).map((e) => `${e.kind} ${e.id} (${e.kind === 'line' ? `length ${dist(e.a, e.b).toExponential(2)}` : e.kind === 'arc' ? `r ${e.r.toExponential(2)} sweep ${e.sweep.toExponential(2)}` : ''})`)
}
/** A readable message: a sentence, no programming leftovers. */
const readable = (m: unknown): boolean => typeof m === 'string' && m.trim().length >= 8 && !/undefined|NaN|\[object|null|Infinity|function/.test(m) && /^[A-Z‘"]/.test(m.trim())

// ---- sections ---------------------------------------------------------------
/** A polyline with each interior vertex rounded (radius 0 keeps it sharp),
 *  sampled every `step` mm, optional normal noise: a scan section. */
function roundedChain(pts: Vec2[], radii: number[], closed: boolean, step: number, noise: number): Vec2[] {
  const n = pts.length
  const corner = (i: number): { tin: Vec2; tout: Vec2; arc: Vec2[] } => {
    const V = pts[i], prev = pts[(i - 1 + n) % n], next = pts[(i + 1) % n], r = radii[i] ?? 0
    const u = unit(sub(V, prev)), w = unit(sub(next, V)), dA = mul(u, -1), dB = w
    const half = Math.acos(Math.max(-1, Math.min(1, dot(dA, dB)))) / 2
    if (!(r > 0) || !(Math.tan(half) > 1e-6) || half > Math.PI / 2 - 1e-6) return { tin: V, tout: V, arc: [V] }
    const t = r / Math.tan(half), tin = sub(V, mul(u, t)), tout = add(V, mul(w, t))
    const C = add(V, mul(unit(add(dA, dB)), r / Math.sin(half)))
    const a0 = Math.atan2(tin[1] - C[1], tin[0] - C[0])
    let sw = Math.atan2(tout[1] - C[1], tout[0] - C[0]) - a0
    while (sw > Math.PI) sw -= 2 * Math.PI
    while (sw <= -Math.PI) sw += 2 * Math.PI
    const m = Math.max(3, Math.ceil(Math.abs(sw) * r / step))
    return { tin, tout, arc: Array.from({ length: m + 1 }, (_, k) => add(C, mul(dirAt(a0 + sw * k / m), r))) }
  }
  const straight = (x: Vec2, y: Vec2) => { const m = Math.max(1, Math.ceil(dist(x, y) / step)); return Array.from({ length: m }, (_, k) => add(x, mul(sub(y, x), k / m))) }
  const out: Vec2[] = []
  if (closed) {
    const cs = pts.map((_, i) => corner(i))
    for (let i = 0; i < n; i++) { out.push(...cs[i].arc); out.push(...straight(cs[i].tout, cs[(i + 1) % n].tin).slice(1)) }
  } else {
    let from = pts[0]
    for (let i = 1; i < n - 1; i++) { const c = corner(i); out.push(...straight(from, c.tin)); out.push(...c.arc.slice(0, -1)); from = c.tout }
    out.push(...straight(from, pts[n - 1]), pts[n - 1])
  }
  if (noise > 0) return out.map((p, i) => { const d = unit(sub(out[Math.min(out.length - 1, i + 1)], out[Math.max(0, i - 1)])); return add(p, mul([-d[1], d[0]], noise * Math.sin(i * 2.71))) })
  return out
}

// ---- the real scan (basic_part), corners between flats -----------------------
interface Flat { i: number; j: number; a: Vec2; b: Vec2; length: number }
interface RealCorner { section: string; A: Flat; B: Flat; chain: Vec2[]; chainIndex: number; turn: number; chains: Vec2[][] }
const lineDist = (p: Vec2, a: Vec2, b: Vec2) => { const d = sub(b, a); return Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / Math.hypot(d[0], d[1]) }
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
function realCorners(section: { axis: string; offset: number; chains: Vec2[][] }): RealCorner[] {
  const out: RealCorner[] = []
  section.chains.forEach((chain, chainIndex) => {
    if (chain.length < 20) return
    const v = simplify(chain, 0.25), flats: Flat[] = []
    for (let k = 1; k < v.length; k++) {
      const a = chain[v[k - 1]], b = chain[v[k]], length = dist(a, b)
      if (length < 8) continue
      let ok = true
      for (let m = v[k - 1]; m <= v[k]; m++) if (lineDist(chain[m], a, b) > 0.3) { ok = false; break }
      if (ok) flats.push({ i: v[k - 1], j: v[k], a, b, length })
    }
    for (let k = 1; k < flats.length; k++) {
      const A = flats[k - 1], B = flats[k]
      let between = 0
      for (let m = A.j + 1; m <= B.i; m++) between += dist(chain[m - 1], chain[m])
      if (between > 0.6 * Math.min(A.length, B.length) + 15) continue
      const turn = Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(A.b, A.a)), unit(sub(B.b, B.a)))))) * 180 / Math.PI
      if (turn < 15 || turn > 165) continue
      out.push({ section: `${section.axis}${section.offset}`, A, B, chain, chainIndex, turn, chains: section.chains })
    }
  })
  return out
}
const realData = fixture('analysis/autofillet/basic_part-sections.json')
const REAL: RealCorner[] = realData.exists ? (JSON.parse(fs.readFileSync(realData.path, 'utf8')).sections as { axis: string; offset: number; chains: Vec2[][] }[]).flatMap(realCorners) : []

// ---- bookkeeping -------------------------------------------------------------
interface Issue { sig: string; detail: string }
interface Replay { pre: Sketch; spec: CornerSpec; mode: CornerTrimMode; radiusMm: number; addDimension: boolean; path: Vec2[]; ring: number; fits: 'yes' | 'no' | 'maybe' }
interface Fail extends Issue { wf: string; replay?: Replay; opReplay?: { pre: Sketch; op: OpRun }; step: string }
const fails: Fail[] = []
const notes = new Map<string, { n: number; example: string }>()
const tally = new Map<string, number>()
let stepCount = 0
const count = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1)
const normal = (s: string) => s.replace(/-?\d+(\.\d+)?(e[-+]?\d+)?/g, '#').slice(0, 140)
function note(sig: string, example: string) { const n = notes.get(sig); if (n) n.n++; else notes.set(sig, { n: 1, example }) }

/** Opens an empty sketch on XY with the Fit and Corner Trim panels as they start. */
function openSketch() {
  closeSketchToolOverlays()
  re().reset()
  re().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
  useSketchBrush.setState({ primitive: 'line', instant: true, tolerance: 0.1, axisDegrees: 1, curvePoints: 8, selected: [], selectionOverflow: false, preview: null, message: null })
  useSketchAnalysis.getState().setToleranceMm(0.1)
}
const select = (ids: readonly number[]) => useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, selection: [...ids] } } : {}))

/** One Fit Line / Fit Arc stroke, released as the brush overlay releases it. */
function brush(kind: 'line' | 'arc', scan: readonly BrushPoint[], stroke: readonly Vec2[], radius: number): Piece | string {
  const selected = pointsUnderPath(scan, stroke, radius)
  if (!selected || selected.length < (kind === 'line' ? 2 : 3)) return 'nothing under the brush'
  const before = new Set(sketchNow().entities.map((e) => e.id))
  useSketchBrush.setState({ primitive: kind, selected, selectionOverflow: false })
  if (!useSketchBrush.getState().apply()) return `fit refused: ${useSketchBrush.getState().message}`
  const made = sketchNow().entities.find((e) => !before.has(e.id))
  if (!made || (made.kind !== 'line' && made.kind !== 'arc')) return `fit made ${made?.kind ?? 'nothing'}`
  return made
}

// ---- scenarios ---------------------------------------------------------------
/** A corner the workflow means to sweep, and what the scan says of it. */
interface CornerSpec {
  A: number; B: number; P0: Vec2
  chains: Vec2[][]; chainsDesc: string
  /** The scan's round there: radius, or 0 for sharp; undefined when unknown. */
  truthR?: number
  /** The section is clean and fine enough that Auto must read truthR closely. */
  truthExact?: boolean
  /** Why a refusal is right whatever the sweep: a length dimension, a Fix. */
  block: string | null
  curve: boolean
  brushed: boolean
  nearby: number | null
}
interface Scenario { tag: string; kind: string; corners: CornerSpec[]; extent: number; brushedIds: number[] }

function lineLineScenario(R: Rand, tag: string): Scenario | null {
  const P: Vec2 = [r4(U(R, -30, 30)), r4(U(R, -30, 30))]
  const axis = R() < 0.3
  const alpha = axis ? pick(R, [0, Math.PI / 2, Math.PI, -Math.PI / 2]) : U(R, 0, 2 * Math.PI)
  const u = R()
  const thetaDeg = u < 0.15 ? 90 : u < 0.22 ? U(R, 5, 9) : u < 0.29 ? U(R, 171, 175) : U(R, 5, 175)
  const sgn = R() < 0.5 ? 1 : -1
  const theta = thetaDeg * Math.PI / 180
  const dA = dirAt(alpha), dB = dirAt(alpha + sgn * theta)
  const short = R() < 0.12
  const LA = short && R() < 0.5 ? U(R, 0.4, 2) : U(R, 6, 40), LB = short && LA > 2 ? U(R, 0.4, 2) : U(R, 6, 40)
  const layout = pick(R, ['polyline', 'polyline', 'gap', 'gap', 'gap', 'overlap', 'cross', 'tinyOverlap', 'tinyCross'] as const)
  // A tiny overshoot is what a fitted or hand-drawn line leaves past the corner.
  const tiny = layout === 'tinyOverlap' || layout === 'tinyCross'
  const near = (d: Vec2, L: number, how: 'at' | 'gap' | 'past'): Vec2 => how === 'at' ? P : how === 'gap' ? add(P, mul(d, U(R, 0.03, 0.4) * L)) : sub(P, mul(d, tiny ? Math.min(U(R, 0.005, 0.3), 0.05 * L) : U(R, 0.02, 0.25) * L))
  const swapOverlap = R() < 0.5
  const howA = layout === 'polyline' ? 'at' : layout === 'gap' ? 'gap' : layout === 'cross' || layout === 'tinyCross' ? 'past' : swapOverlap ? 'gap' : 'past'
  const howB = layout === 'polyline' ? 'at' : layout === 'gap' ? 'gap' : layout === 'cross' || layout === 'tinyCross' ? 'past' : swapOverlap ? 'past' : 'gap'
  const nA = near(dA, LA, howA), nB = near(dB, LB, howB), fA = add(P, mul(dA, LA)), fB = add(P, mul(dB, LB))
  const s = emptySketch()
  const construction = R() < 0.05
  const A = layout === 'polyline' ? addEntity(s, { kind: 'line', a: fA, b: nA, ...(construction ? { construction: true } : {}) }) : addEntity(s, R() < 0.5 ? { kind: 'line', a: nA, b: fA, ...(construction ? { construction: true } : {}) } : { kind: 'line', a: fA, b: nA, ...(construction ? { construction: true } : {}) })
  const B = layout === 'polyline' ? addEntity(s, { kind: 'line', a: nB, b: fB, ...(construction ? { construction: true } : {}) }) : addEntity(s, R() < 0.5 ? { kind: 'line', a: nB, b: fB, ...(construction ? { construction: true } : {}) } : { kind: 'line', a: fB, b: nB, ...(construction ? { construction: true } : {}) })
  if (layout === 'polyline') addConstraint(s, { kind: 'coincident', p: { entity: A, at: 'b' }, q: { entity: B, at: 'a' }, inferred: true })
  const hv = (id: number, d: Vec2) => { if (Math.abs(d[1]) < 1e-12) addConstraint(s, { kind: 'horizontal', entity: id, inferred: true }); else if (Math.abs(d[0]) < 1e-12) addConstraint(s, { kind: 'vertical', entity: id, inferred: true }) }
  if (axis) {
    // An exact axis direction (cos(π/2) is not exactly zero).
    const snap = (d: Vec2): Vec2 => [Math.round(d[0] * 1e12) / 1e12, Math.round(d[1] * 1e12) / 1e12]
    for (const [id, d] of [[A, snap(dA)], [B, snap(dB)]] as const) {
      const e = entityOf(s, id) as SketchLine
      if (Math.abs(d[0]) < 1e-9 || Math.abs(d[1]) < 1e-9) {
        // Put both ends exactly on the axis line through P.
        const fix = (p: Vec2): Vec2 => Math.abs(d[1]) < 1e-9 ? [p[0], P[1]] : [P[0], p[1]]
        e.a = fix(e.a); e.b = fix(e.b)
        hv(id, d)
      }
    }
  } else if (thetaDeg === 90 && R() < 0.3) addConstraint(s, { kind: 'perpendicular', a: A, b: B })
  let block: string | null = null
  const ub = R()
  if (ub < 0.05) { const e = entityOf(s, A) as SketchLine; addConstraint(s, { kind: 'length', entity: A, value: dist(e.a, e.b) }); block = 'length' }
  else if (ub < 0.08) { entityOf(s, A)!.fixed = true; block = 'fixed' }
  let nearby: number | null = null
  if (R() < 0.2) {
    const bis = unit(add(dA, dB)), off = add(P, mul(bis, pick(R, [-1, 1]) * U(R, 0.3, 4)))
    const k = pick(R, ['line', 'circle', 'point'] as const)
    if (k === 'line') { const d = dirAt(U(R, 0, Math.PI)), l = U(R, 1, 8); nearby = addEntity(s, { kind: 'line', a: sub(off, mul(d, l / 2)), b: add(off, mul(d, l / 2)) }) }
    else if (k === 'circle') nearby = addEntity(s, { kind: 'circle', c: off, r: U(R, 0.2, 1.5) })
    else nearby = addEntity(s, { kind: 'point', p: off })
  }
  // The section the lines were drawn on: their flats and a round (or none).
  const half = theta / 2
  const rMax = 0.9 * Math.min(LA, LB) * Math.tan(half)
  const truthR = R() < 0.15 ? 0 : U(R, 0.05, 0.7) * rMax
  const step = pick(R, [0.05, 0.1, 0.25, 0.5]), noise = pick(R, [0, 0, 0.005, 0.02])
  const hasSection = R() < 0.85
  const chains = hasSection ? [roundedChain([add(fA, mul(dA, 3)), P, add(fB, mul(dB, 3))], [0, truthR, 0], false, step, noise)] : []
  const fine = truthR > 0 && (Math.PI - theta) * truthR / step >= 5
  return {
    tag: `${tag} LL ${layout} θ${thetaDeg.toFixed(1)} L${LA.toFixed(1)}/${LB.toFixed(1)}${axis ? ' HV' : ''}${block ? ` ${block}` : ''}${nearby ? ' nearby' : ''}${construction ? ' constr' : ''}`,
    kind: 'LL', extent: Math.max(LA, LB), brushedIds: [], corners: [{ A, B, P0: P, chains, chainsDesc: hasSection ? `roundedChain([fA+3dA, P, fB+3dB], [0, ${truthR}, 0], open, step ${step}, noise ${noise})` : 'none', truthR, truthExact: noise === 0 && fine, block, curve: false, brushed: false, nearby }],
    // The sketch is seeded by the caller.
    ...{ seed: s },
  } as Scenario & { seed: Sketch }
}

function rectScenario(R: Rand, tag: string): Scenario & { seed: Sketch } {
  const s = emptySketch()
  const p: Vec2 = [r4(U(R, -30, 10)), r4(U(R, -30, 10))], q: Vec2 = [r4(p[0] + U(R, 4, 40)), r4(p[1] + U(R, 4, 40))]
  addRectangle(s, p, q)
  const verts: Vec2[] = [p, [q[0], p[1]], q, [p[0], q[1]]]
  const minSide = Math.min(q[0] - p[0], q[1] - p[1])
  const radii = verts.map(() => R() < 0.2 ? 0 : U(R, 0.05, 0.4) * minSide)
  const step = pick(R, [0.1, 0.25, 0.5]), noise = pick(R, [0, 0, 0.01])
  const chains = [roundedChain(verts, radii, true, step, noise)]
  const corners: CornerSpec[] = []
  for (const c of s.constraints) {
    if (c.kind !== 'coincident') continue
    const P = anchorPoint(entityOf(s, c.p.entity)!, c.p.at)
    const vi = verts.findIndex((v) => dist(v, P) < 1e-9)
    corners.push({ A: c.p.entity, B: c.q.entity, P0: P, chains, chainsDesc: `rounded rectangle ${JSON.stringify(verts)} radii ${JSON.stringify(radii.map(r4))} step ${step} noise ${noise}`, truthR: radii[vi], truthExact: noise === 0 && radii[vi] * Math.PI / 2 / step >= 5, block: null, curve: false, brushed: false, nearby: null })
  }
  return { tag: `${tag} rect ${(q[0] - p[0]).toFixed(1)}x${(q[1] - p[1]).toFixed(1)}`, kind: 'rect', extent: Math.max(q[0] - p[0], q[1] - p[1]), brushedIds: [], corners, seed: s }
}

function curveScenario(R: Rand, tag: string, seed: number): (Scenario & { seed: Sketch }) | null {
  const k = makeCase(seed), g = k.build()
  if (!g) return null
  const s = g.s
  if (R() < 0.15) for (const id of g.ids) { const e = entityOf(s, id); if (e?.kind === 'arc') addConstraint(s, { kind: 'radius', entity: id, value: e.r }) }
  const fine = k.phi * k.r / k.step >= 5
  return { tag: `${tag} ${k.id}`, kind: 'curve', extent: 30, brushedIds: [], seed: s, corners: [{ A: g.ids[0], B: g.ids[1], P0: g.corner, chains: [g.chain], chainsDesc: `makeCase(${seed}).build().chain`, truthR: k.r, truthExact: k.noise === 0 && fine, block: null, curve: true, brushed: false, nearby: null }] }
}

/** Pieces brushed with Fit Line / Fit Arc on a makeCase section, in the open sketch. */
function brushedCurveScenario(R: Rand, tag: string, seed: number): Scenario | null | string {
  const k = makeCase(seed), g = k.build()
  if (!g) return null
  const sloppy = R() < 0.3
  const stretch = (c: CarrierT, out: number): Vec2[] | null => {
    const most = c.kind === 'circle' ? Math.min(out, 1.2 * Math.PI * c.R) : out
    const from = sloppy ? -0.3 * k.r : 0.15 + R() * 0.3 * most
    const least = c.kind === 'circle' ? Math.max(3, 0.35 * c.R) : 3
    if (most - Math.max(from, 0) < least) return null
    const to = Math.max(from, 0) + least + R() * (most - Math.max(from, 0) - least)
    return Array.from({ length: 41 }, (_, i) => along(c, from + (to - from) * i / 40))
  }
  const sa = stretch(g.A, g.outA), sb = stretch(g.B, g.outB)
  if (!sa || !sb) return null
  const scan = brushPoints([g.chain]), brushR = sloppy ? Math.max(1, 0.4 * k.r) : Math.max(0.3, 0.6 * g.step)
  const a = brush(g.A.kind === 'line' ? 'line' : 'arc', scan, sa, brushR)
  if (typeof a === 'string') return a
  const b = brush(g.B.kind === 'line' ? 'line' : 'arc', scan, sb, brushR)
  if (typeof b === 'string') return b
  const snapped = sketchNow().constraints.some((c) => c.kind === 'horizontal' || c.kind === 'vertical')
  const fine = k.phi * k.r / k.step >= 5
  return { tag: `${tag} brushed ${k.id} ${sloppy ? 'sloppy' : 'tidy'}`, kind: 'brushedCurve', extent: 30, brushedIds: [a.id, b.id], corners: [{ A: a.id, B: b.id, P0: g.corner, chains: [g.chain], chainsDesc: `makeCase(${seed}).build().chain`, truthR: k.r, truthExact: k.noise === 0 && !sloppy && !snapped && fine, block: null, curve: a.kind === 'arc' || b.kind === 'arc', brushed: true, nearby: null }] }
}

/** Two flats of a basic_part section brushed with Fit Line, in the open sketch. */
function realScenario(R: Rand, tag: string): Scenario | null | string {
  if (!REAL.length) return null
  const c = pick(R, REAL)
  const scan = brushPoints(c.chains)
  const stretches: [number, number][] = [[0.05, 0.95], [0.05, 0.5], [0.5, 0.95], [0.7, 0.92], [-0.1, 0.9]]
  const stroke = (f: Flat, atCorner: 'a' | 'b'): Vec2[] => {
    const [s0, s1] = pick(R, stretches), start = atCorner === 'a' ? f.a : f.b, end = atCorner === 'a' ? f.b : f.a
    return Array.from({ length: 21 }, (_, i) => add(start, mul(sub(end, start), s0 + (s1 - s0) * i / 20)))
  }
  const brushR = pick(R, [0.6, 1.5, 3])
  const a = brush('line', scan, stroke(c.A, 'b'), brushR)
  if (typeof a === 'string') return a
  const b = brush('line', scan, stroke(c.B, 'a'), brushR)
  if (typeof b === 'string') return b
  const x = lineIntersection(a as SketchLine, b as SketchLine)
  if (!x) return 'fitted lines parallel'
  // The scan's round, read independently off the gap between the lines'
  // crossing and the section (r = d / (1/sin(half) − 1)).
  const span = c.chain.slice(Math.max(0, c.A.i), c.B.j + 1)
  let gap = Infinity
  for (let k = 1; k < span.length; k++) { const p = span[k - 1], q = span[k], d = sub(q, p), l = dot(d, d), t = l > 0 ? Math.max(0, Math.min(1, dot(sub(x, p), d) / l)) : 0; gap = Math.min(gap, dist(x, add(p, mul(d, t)))) }
  const half = (Math.PI - c.turn * Math.PI / 180) / 2
  const truthR = gap < 0.05 ? 0 : gap / (1 / Math.sin(half) - 1)
  return { tag: `${tag} real ${c.section}#${c.chainIndex} ${c.turn.toFixed(0)}° brush${brushR}`, kind: 'real', extent: Math.max(c.A.length, c.B.length), brushedIds: [a.id, b.id], corners: [{ A: a.id, B: b.id, P0: x, chains: c.chains, chainsDesc: `basic_part-sections.json section ${c.section} (all chains)`, truthR, truthExact: false, block: null, curve: false, brushed: true, nearby: null }] }
}

// ---- the sweep ---------------------------------------------------------------
/** A point `d` along a piece from its end nearest `P`. */
function pointAlong(e: Piece, P: Vec2, d: number): Vec2 {
  let line = entityPolyline(e, 192)
  if (dist(line[0], P) > dist(line[line.length - 1], P)) line = [...line].reverse()
  let left = d
  for (let i = 1; i < line.length; i++) { const s = dist(line[i - 1], line[i]); if (left <= s) return add(line[i - 1], mul(sub(line[i], line[i - 1]), left / s)); left -= s }
  return line[line.length - 1]
}
type How = 'through' | 'fan' | 'box' | 'ends' | 'inside' | 'tap' | 'scribble'
function makePath(R: Rand, a: Piece, b: Piece, P: Vec2, ring: number, upp: number): { path: Vec2[]; how: How; speed: string; reversed: boolean } {
  const lengthOf = (e: Piece) => entityPolyline(e, 96).reduce((s, p, i, xs) => s + (i ? dist(xs[i - 1], p) : 0), 0)
  const near = (e: Piece) => ends(e).sort((p, q) => dist(p, P) - dist(q, P))[0]
  // Where the hand starts on each piece: its near end, or a little way in
  // from the corner when that end is at the corner.
  const start = (e: Piece) => { const n = near(e); return dist(n, P) > 2 * ring ? n : pointAlong(e, P, Math.min(0.8 * lengthOf(e), U(R, 1.5, 5) * ring)) }
  const oA = start(a), oB = start(b)
  const inward = unit(add(unit(sub(oA, P)), unit(sub(oB, P))))
  const how = pick(R, ['through', 'through', 'through', 'fan', 'box', 'ends', 'ends', 'inside', 'tap', 'scribble'] as const)
  const jit = (p: Vec2): Vec2 => add(p, [U(R, -0.3, 0.3) * ring, U(R, -0.3, 0.3) * ring])
  let ctrl: Vec2[]
  switch (how) {
    case 'through': ctrl = [oA, P, oB]; break
    case 'fan': ctrl = [oA, sub(P, mul(inward, U(R, 1, 4) * ring)), oB]; break
    case 'box': {
      const xs = [oA, P, oB].map((p) => p[0]), ys = [oA, P, oB].map((p) => p[1]), m = U(R, 1, 3) * ring
      const lo: Vec2 = [Math.min(...xs) - m, Math.min(...ys) - m], hi: Vec2 = [Math.max(...xs) + m, Math.max(...ys) + m]
      ctrl = [lo, [hi[0], lo[1]], hi, [lo[0], hi[1]], lo]; break
    }
    case 'ends': ctrl = [oA, oB]; break
    case 'inside': ctrl = [oA, add(P, mul(inward, U(R, 2, 6) * ring)), oB]; break
    case 'tap': ctrl = [P]; break
    default: ctrl = Array.from({ length: 6 + Math.floor(R() * 6) }, () => add(P, [U(R, -2, 2) * ring, U(R, -2, 2) * ring]))
  }
  ctrl = ctrl.map(jit)
  const reversed = R() < 0.5
  if (reversed) ctrl.reverse()
  const slow = R() < 0.6, step = (slow ? U(R, 0.5, 2) : U(R, 15, 60)) * upp
  const path: Vec2[] = [ctrl[0]]
  for (let i = 1; i < ctrl.length; i++) {
    const n = Math.max(1, Math.ceil(dist(ctrl[i - 1], ctrl[i]) / step))
    for (let k = 1; k <= n; k++) path.push(add(ctrl[i - 1], mul(sub(ctrl[i], ctrl[i - 1]), k / n)))
  }
  // The overlay drops steps under half a screen pixel.
  const kept: Vec2[] = []
  for (const p of path) if (!kept.length || dist(p, kept[kept.length - 1]) >= 0.5 * upp) kept.push(p)
  return { path: kept, how, speed: slow ? 'slow' : 'fast', reversed }
}

/** The Fixed radius a corner of two lines takes at most (filletLines' room). */
function lineRoom(a: SketchLine, b: SketchLine, P: Vec2): number {
  const fa = ends(a).sort((p, q) => dist(q, P) - dist(p, P))[0], fb = ends(b).sort((p, q) => dist(q, P) - dist(p, P))[0]
  const da = unit(sub(fa, P)), db = unit(sub(fb, P)), half = Math.acos(Math.max(-1, Math.min(1, dot(da, db)))) / 2
  return 0.95 * Math.min(dist(fa, P), dist(fb, P)) * Math.tan(half)
}

interface SweepChoice { mode: CornerTrimMode; radiusMm: number; addDimension: boolean; path: Vec2[]; ring: number; label: string; fits: 'yes' | 'no' | 'maybe' }

/** Picks the mode, radius and stroke for a corner as it stands now. */
function chooseSweep(R: Rand, spec: CornerSpec, extent: number): SweepChoice | null {
  const s = sketchNow(), a = pieceOf(s, spec.A), b = pieceOf(s, spec.B)
  if (!a || !b) return null
  const P = crossingsOf(a, b).sort((p, q) => dist(p, spec.P0) - dist(q, spec.P0))[0] ?? spec.P0
  const upp = extent / U(R, 300, 2500), ring = 7 * upp
  const mode = pick(R, ['trim', 'autoFillet', 'autoFillet', 'fixedFillet', 'fixedFillet'] as const)
  let radiusMm = pick(R, [1, 2, 5])
  let fits: SweepChoice['fits'] = 'maybe'
  if (mode === 'fixedFillet') {
    if (a.kind === 'line' && b.kind === 'line') {
      const room = lineRoom(a, b, P)
      if (R() < 0.08) { radiusMm = r4(U(R, 1.1, 3) * room); fits = 'no' } else { radiusMm = Math.max(1e-3, U(R, 0.03, 0.85) * room); fits = 'yes' }
    } else { radiusMm = Math.max(0.2, 0.7 * (spec.truthR ?? 1)); fits = 'maybe' }
  }
  const { path, how, speed, reversed } = makePath(R, a, b, P, ring, upp)
  return { mode, radiusMm, addDimension: R() < 0.5, path, ring, fits, label: `${mode}${mode === 'fixedFillet' ? ` R${radiusMm.toPrecision(4)}` : ''} ${how} ${speed}${reversed ? ' from B' : ''}` }
}

interface SweepOutcome { issues: Issue[]; outcome: string; fillet: SketchArc | null; ok: boolean }

/** Sweeps the corner through the store and checks the result. Leaves the
 *  result in place (or the sketch unchanged on a refusal). */
function sweepCorner(spec: CornerSpec, ch: SweepChoice): SweepOutcome {
  const issues: Issue[] = []
  const bad = (sig: string, detail = '') => issues.push({ sig, detail })
  const pre = cloneSketch(sketchNow()), preKey = keyOf(pre), h0 = hist()
  const a0 = pieceOf(pre, spec.A)!, b0 = pieceOf(pre, spec.B)!
  const cross = crossingsOf(a0, b0).sort((p, q) => dist(p, spec.P0) - dist(q, spec.P0))
  const P = cross[0] ?? null
  const isLL = a0.kind === 'line' && b0.kind === 'line'
  const turnDeg = isLL ? Math.acos(Math.abs(dot(unit(sub(a0.b, a0.a)), unit(sub(b0.b, b0.a))))) * 180 / Math.PI : 90
  const nearParallel = isLL && turnDeg < 5.2
  const area = new SweepArea({ path: ch.path, radius: ch.ring })
  const coverP = P !== null && area.distance(P) <= 0
  const farOf = (e: Piece) => P ? ends(e).sort((p, q) => dist(q, P) - dist(p, P))[0] : anchorPoint(e, 'b')
  const fA = farOf(a0), fB = farOf(b0)
  // A sweep that paints over a far end does not say which side to keep: by
  // the rule measured in QUICKSURFACE the end nearer the swept area moves,
  // so on a 1 mm piece swept along its length the far end may be that end.
  // Likewise a line crossing the other, painted on its far side of the
  // corner only: Corner Trim cuts the side painted, so that side goes.
  const touches = (p: Vec2, q: Vec2) => Array.from({ length: 40 }, (_, i) => (i + 1) / 40).some((u) => area.distance([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]) <= 0)
  const farSideOnly = (e: Piece, far: Vec2) => { if (e.kind !== 'line' || !P) return false; const near = dist(e.a, far) < dist(e.b, far) ? e.b : e.a; return dist(near, P) > 1e-6 && dist(near, far) > dist(P, far) && touches(P, far) && !touches(P, near) }
  const paintsFar = area.distance(fA) <= 0 || area.distance(fB) <= 0 || farSideOnly(a0, fA) || farSideOnly(b0, fB)
  const joined = P !== null && pre.constraints.some((c) => c.kind === 'coincident' && ((c.p.entity === spec.A && c.q.entity === spec.B) || (c.p.entity === spec.B && c.q.entity === spec.A))) && ends(a0).some((p) => dist(p, P) < 1e-9) && ends(b0).some((p) => dist(p, P) < 1e-9)
  // Other pieces the area touches make the reading ambiguous.
  const touched = piecesInSweep(pre, area).map((p) => p.id)
  const others = touched.filter((id) => id !== spec.A && id !== spec.B)
  const pairTouched = touched.includes(spec.A) && touched.includes(spec.B)
  const st = ct.getState()
  if (!st.open) st.setOpen(true)
  ct.getState().setMode(ch.mode); ct.getState().setRadiusMm(ch.radiusMm); ct.getState().setAddDimension(ch.addDimension)
  let ok = false, pending = false
  try {
    ok = ct.getState().sweep(ch.path, ch.ring, spec.chains.flat(), spec.chains)
    if (!ok && ct.getState().pending) { pending = true; ok = ct.getState().acceptPending() }
  } catch (e) { bad('exception in sweep', (e as Error).stack?.split('\n').slice(0, 3).join(' | ') ?? String(e)); return { issues, outcome: 'exception', fillet: null, ok: false } }
  const msg = ct.getState().message
  const post = sketchNow(), postKey = keyOf(post), steps = hist() - h0
  if (!finiteSketch(post)) bad('non-finite number in sketch after sweep')
  { const dg = newlyDegenerate(pre, post); if (dg.length) bad('Corner Trim left a degenerate piece', dg.join(', ')) }
  if (!readable(msg)) bad(`unreadable or missing panel message after sweep`, String(msg))
  if (!ok) {
    if (postKey !== preKey || steps !== 0) bad('refusal changed the sketch', `steps ${steps}`)
    // Was the refusal right?
    const why = normal(msg ?? '')
    const expected = spec.block !== null || (ch.mode === 'fixedFillet' && ch.fits === 'no') || (ch.mode === 'autoFillet' && !spec.chains.length)
      || (joined && (ch.mode === 'trim' || !coverP || (ch.mode === 'autoFillet' && spec.truthR === 0)))
      || !pairTouched || P === null
    const doubtful = nearParallel || paintsFar || others.length > 0 || ch.fits === 'maybe' || (ch.mode === 'autoFillet' && spec.truthExact !== true) || spec.curve
    if (!expected) {
      if (doubtful) note(`refused (doubtful case): ${why}`, `${ch.label} msg=${msg}`)
      else bad(`valid sweep over a valid corner refused: ${why}`, `${ch.label}; coverP ${coverP}; turn ${turnDeg.toFixed(1)}°`)
    }
    return { issues, outcome: `refused: ${why}`, fillet: null, ok: false }
  }
  // Committed.
  if (pending) count('needed Accept')
  if (spec.block === 'fixed') bad('a Fixed piece was trimmed')
  const a1 = pieceOf(post, spec.A), b1 = pieceOf(post, spec.B)
  if (!a1 || !b1) { bad('a swept piece disappeared'); return { issues, outcome: 'lost piece', fillet: null, ok } }
  const made = post.entities.filter((e) => !pre.entities.some((x) => x.id === e.id))
  const fillet = (made.find((e) => e.kind === 'arc') as SketchArc | undefined) ?? null
  if (made.length > (fillet ? 1 : 0)) bad('more pieces made than one fillet', made.map((e) => e.kind).join(','))
  // Which pieces it changed: the meant pair, or (an ambiguous sweep) another.
  const changed = pre.entities.filter((e) => { const now = entityOf(post, e.id); return !now || moved(e, now) > 1e-9 }).map((e) => e.id)
  const outside = changed.filter((id) => id !== spec.A && id !== spec.B)
  if (outside.length) {
    const firstPair = sweptCandidates(pre, area).pairs[0]?.ids ?? []
    const meantFirst = firstPair.includes(spec.A) && firstPair.includes(spec.B)
    const removed = outside.filter((id) => !entityOf(post, id))
    if (removed.length) bad('a piece was removed by Corner Trim', `piece ${removed.join(',')}`)
    if (!others.length) bad('a piece the sweep never touched was changed', `piece ${outside.join(',')}`)
    else if (meantFirst && pairTouched) bad('the meant pair (ranked first) was refused and another swept pair was joined instead', `changed ${changed.join(',')}; ${ch.label}`)
    else note('ambiguous sweep (other pieces touched) read as another pair', `${ch.label} changed ${changed.join(',')}`)
    // Whatever pair it took: the fillet, if any, joins it tangent without a gap.
    if (fillet) {
      const joinedTo = post.constraints.filter((c): c is Extract<Constraint, { kind: 'coincident' }> => c.kind === 'coincident' && (c.p.entity === fillet.id || c.q.entity === fillet.id)).map((c) => c.p.entity === fillet.id ? c.q.entity : c.p.entity)
      for (const id of joinedTo) {
        const p = pieceOf(post, id)
        if (!p) continue
        let best = Infinity, at = ends(fillet)[0]
        for (const x of ends(p)) for (const y of ends(fillet)) if (dist(x, y) < best) { best = dist(x, y); at = y }
        if (best > 1e-6) bad('gap between fillet and piece', best.toExponential(2))
        if (offTangent(fillet, p, at) > 1e-6) bad('fillet not tangent', offTangent(fillet, p, at).toExponential(2))
      }
    }
    return { issues, outcome: fillet ? 'fillet (other pair)' : 'sharp (other pair)', fillet: null, ok }
  }
  // Carriers and far ends held.
  const cm = Math.max(carrierMoved(a0, a1), carrierMoved(b0, b1))
  if (cm > 1e-7) bad('a swept piece moved off its carrier', `by ${cm.toExponential(2)}`)
  const farMove = Math.max(Math.min(...ends(a1).map((p) => dist(p, fA))), Math.min(...ends(b1).map((p) => dist(p, fB))))
  if (farMove > 1e-7) { if (paintsFar) note('sweep painted over a far end, or only the far side of a crossing, which moved (the painted side is cut)', `${ch.label} by ${farMove.toExponential(2)}`); else bad('a far end moved', `by ${farMove.toExponential(2)}`) }
  const wantFillet = ch.mode !== 'trim' && coverP
  // The scan's round lies on the pieces (its tangent points within both).
  const truthFits = !isLL || spec.truthR === undefined || P === null ? true : (() => { const da = unit(sub(fA, P)), db = unit(sub(fB, P)), half = Math.acos(Math.max(-1, Math.min(1, dot(da, db)))) / 2; return spec.truthR! / Math.tan(half) < 0.9 * Math.min(dist(fA, P), dist(fB, P)) })()
  const lf = ct.getState().lastFillet, lfit = ct.getState().lastFit
  if (!fillet) {
    if (P && (Math.min(...ends(a1).map((p) => dist(p, P))) > 1e-7 || Math.min(...ends(b1).map((p) => dist(p, P))) > 1e-7)) bad('a sharp join does not meet at the corner point')
    if (steps !== 1) bad(`a sharp join took ${steps} undo steps`)
    if (ch.mode === 'fixedFillet' && wantFillet) bad('Fixed Size Fillet over the corner point made no fillet', msg ?? '')
    if (ch.mode === 'autoFillet' && wantFillet && (spec.truthR ?? 0) > 0.5 && spec.truthExact && truthFits) bad(`Auto Fillet left a clean round of R${spec.truthR!.toFixed(3)} sharp`, msg ?? '')
    if (ch.mode !== 'trim' && !coverP && !(lfit?.unswept)) bad('sharp join for an unswept corner point not reported as such', msg ?? '')
    if (lf) bad('panel keeps a lastFillet after a sharp join')
    if (ch.mode === 'trim' && joined && postKey !== preKey) {
      const mv = Math.max(moved(a0, a1), moved(b0, b1))
      if (mv < 1e-9) note('Corner Trim on an already joined corner made a no-op undo step', `${currentTag} ${ch.label}; moved ${mv.toExponential(2)}; gone ${JSON.stringify(pre.constraints.filter((c) => !post.constraints.some((d) => JSON.stringify(d) === JSON.stringify(c))))} new ${JSON.stringify(post.constraints.filter((c) => !pre.constraints.some((d) => JSON.stringify(d) === JSON.stringify(c))))}`)
    }
  } else {
    if (!wantFillet) bad(ch.mode === 'trim' ? 'Corner Trim made a fillet' : 'filleted although the corner point was not swept')
    let gap = 0, lean = 0
    const fe = ends(fillet)
    for (const p of [a1, b1]) {
      let best = Infinity, at = fe[0]
      for (const x of ends(p)) for (const y of fe) if (dist(x, y) < best) { best = dist(x, y); at = y }
      gap = Math.max(gap, best); lean = Math.max(lean, offTangent(fillet, p, at))
    }
    if (gap > 1e-6) bad('gap between fillet and piece', gap.toExponential(2))
    if (lean > 1e-6) bad('fillet not tangent', lean.toExponential(2))
    const wantSteps = joined ? 1 : 2
    if (steps !== wantSteps) bad(`a fillet took ${steps} undo steps (expected ${wantSteps})`)
    if (ch.mode === 'fixedFillet' && Math.abs(fillet.r - ch.radiusMm) > 1e-9) bad('Fixed Size Fillet radius not met', `${fillet.r} for ${ch.radiusMm}`)
    if (ch.mode === 'fixedFillet' && ch.fits === 'no') bad('Fixed fillet accepted a radius that cannot fit', `${ch.radiusMm}`)
    if (ch.mode === 'autoFillet' && spec.truthR !== undefined) {
      if (spec.truthR === 0 && fillet.r > 0.3 && spec.truthExact !== false) note('Auto Fillet rounded a sharp scan corner', `R${fillet.r.toFixed(3)} ${ch.label}`)
      else if (spec.truthR > 0 && spec.truthExact && truthFits && Math.abs(fillet.r - spec.truthR) > 0.03 * spec.truthR + 0.01) bad('Auto Fillet radius off a clean scan round', `R${fillet.r.toFixed(4)} for ${spec.truthR.toFixed(4)}`)
    }
    if (ch.addDimension !== post.constraints.some((c) => c.kind === 'radius' && c.entity === fillet.id)) bad('"Automatically add dimension" not honoured')
    if (!lf) bad('panel has no lastFillet after a fillet')
    else {
      if (lf.arcId !== fillet.id) bad('panel lastFillet names another arc')
      if (lf.madeKey !== postKey) bad('panel lastFillet madeKey is not the sketch made')
      if (Math.abs(lf.radiusMm - fillet.r) > 1e-9) bad('panel lastFillet radius differs from the arc', `${lf.radiusMm} vs ${fillet.r}`)
      if (ct.getState().trail.length !== 1) bad('panel trail not reset to the new fillet')
    }
    if (!/^Fillet created/.test(msg ?? '')) bad('fillet message does not say a fillet was made', msg ?? '')
  }
  if (ch.mode === 'trim' && !/joined/i.test(msg ?? '')) bad('trim message does not say joined', msg ?? '')
  return { issues, outcome: fillet ? 'fillet' : 'sharp', fillet, ok }
}

/** Undo every step since `h0` (checking each state on the way back), then
 *  Redo them all, then compare; also the panel after each. */
function undoRedoCheck(R: Rand, h0: number, startKey: string, issues: Issue[], filletLive: boolean) {
  const endKey = keyOf(sketchNow()), n = hist() - h0, endSketch = cloneSketch(sketchNow())
  const trail: string[] = [endKey]
  const useCt = R() < 0.5
  for (let i = 0; i < n; i++) {
    if (useCt && ct.getState().open) ct.getState().undo(); else re().undoSketch()
    trail.push(keyOf(sketchNow()))
    const lf = ct.getState().lastFillet
    if (lf && lf.madeKey !== trail[trail.length - 1]) issues.push({ sig: 'panel lastFillet stale after Undo', detail: '' })
  }
  if (trail[trail.length - 1] !== startKey) issues.push({ sig: 'Undo did not restore the sketch exactly', detail: `${n} steps; ${sketchDiff(JSON.parse(startKey), sketchNow())}` })
  for (let i = n - 1; i >= 0; i--) {
    re().redoSketch()
    if (keyOf(sketchNow()) !== trail[i]) { issues.push({ sig: 'Redo did not re-apply exactly', detail: `step ${n - i} of ${n}; ${sketchDiff(JSON.parse(trail[i]), sketchNow())}` }); break }
  }
  if (keyOf(sketchNow()) !== endKey) issues.push({ sig: 'Redo did not end where the edits ended', detail: sketchDiff(endSketch, sketchNow()) })
  if (filletLive && ct.getState().open) {
    const lf = ct.getState().lastFillet
    if (!lf) issues.push({ sig: 'panel lost the fillet after Undo then Redo', detail: '' })
    else if (lf.madeKey !== endKey) issues.push({ sig: 'panel fillet after Redo is not the sketch', detail: '' })
  }
}

/** A plain later edit (a full solve, as any drag or dimension runs) moves nothing. */
function nextEditCheck(issues: Issue[], label: string) {
  const settled = cloneSketch(sketchNow()), h = hist()
  re().setSketch(cloneSketch(settled))
  let drift = 0
  for (const e of settled.entities) { const now = entityOf(sketchNow(), e.id); drift = Math.max(drift, now ? moved(e, now) : Infinity) }
  if (drift > 1e-6) issues.push({ sig: `the next edit (full solve) moved the sketch${label}`, detail: drift.toExponential(2) })
  if (hist() > h) re().undoSketch()
  if (keyOf(sketchNow()) !== keyOf(settled)) issues.push({ sig: 'Undo of the next edit did not restore', detail: '' })
}

/** The last fillet's radius: preview, then a typed radius (valid or not). */
function radiusEdit(R: Rand, spec: CornerSpec, fillet: SketchArc, issues: Issue[]): string {
  const pre = cloneSketch(sketchNow()), preKey = keyOf(pre), h0 = hist()
  const a0 = pieceOf(pre, spec.A)!, b0 = pieceOf(pre, spec.B)!
  const lf = ct.getState().lastFillet
  if (!lf) return 'no fillet'
  const room = a0.kind === 'line' && b0.kind === 'line' ? lineRoom(entityOf(lf.base, spec.A) as SketchLine, entityOf(lf.base, spec.B) as SketchLine, lf.corner) : fillet.r * 1.3
  const invalid = R() < 0.2
  const r = invalid ? pick(R, [-1, 0, NaN, Infinity, 1e6]) : Math.max(1e-3, U(R, 0.2, 0.95) * room)
  // The handle's preview changes nothing.
  const pv = ct.getState().previewFilletRadius(r)
  if (keyOf(sketchNow()) !== preKey) issues.push({ sig: 'radius preview changed the sketch', detail: '' })
  if (pv && ct.getState().radiusPreview?.radiusMm !== r) issues.push({ sig: 'radius preview holds another radius', detail: '' })
  if (pv && invalid) issues.push({ sig: 'radius preview accepted an invalid radius', detail: String(r) })
  ct.getState().previewFilletRadius(null)
  const done = ct.getState().setFilletRadius(r)
  const msg = ct.getState().message
  if (!readable(msg)) issues.push({ sig: 'unreadable or missing message after radius edit', detail: String(msg) })
  if (!done) {
    if (keyOf(sketchNow()) !== preKey || hist() !== h0) issues.push({ sig: 'refused radius edit changed the sketch', detail: '' })
    if (!invalid && a0.kind === 'line' && b0.kind === 'line') issues.push({ sig: `valid radius edit refused: ${normal(msg ?? '')}`, detail: `R ${r} room ${room}` })
    return `radius ${invalid ? 'invalid' : 'valid'} refused`
  }
  if (invalid) issues.push({ sig: 'invalid radius accepted', detail: String(r) })
  if (hist() - h0 !== 1) issues.push({ sig: `radius edit took ${hist() - h0} undo steps`, detail: '' })
  const post = sketchNow(), arc = entityOf(post, lf.arcId) as SketchArc | undefined
  if (!arc || arc.kind !== 'arc') { issues.push({ sig: 'radius edit lost the fillet arc', detail: '' }); return 'lost' }
  if (Math.abs(arc.r - r) > 1e-9) issues.push({ sig: 'radius edit radius not met', detail: `${arc.r} for ${r}` })
  const a1 = pieceOf(post, spec.A)!, b1 = pieceOf(post, spec.B)!
  for (const p of [a1, b1]) {
    let best = Infinity, at = ends(arc)[0]
    for (const x of ends(p)) for (const y of ends(arc)) if (dist(x, y) < best) { best = dist(x, y); at = y }
    if (best > 1e-6) issues.push({ sig: 'radius edit left a gap', detail: best.toExponential(2) })
    if (offTangent(arc, p, at) > 1e-6) issues.push({ sig: 'radius edit not tangent', detail: offTangent(arc, p, at).toExponential(2) })
  }
  if (Math.max(carrierMoved(a0, a1), carrierMoved(b0, b1)) > 1e-7) issues.push({ sig: 'radius edit moved a carrier', detail: '' })
  for (const e of pre.entities) if (e.id !== spec.A && e.id !== spec.B && e.id !== lf.arcId) { const now = entityOf(post, e.id); if (!now || moved(e, now) > 1e-9) issues.push({ sig: 'radius edit moved an unrelated piece', detail: '' }) }
  const nf = ct.getState().lastFillet
  if (!nf || nf.madeKey !== keyOf(post) || Math.abs(nf.radiusMm - r) > 1e-12) issues.push({ sig: 'panel lastFillet not updated by radius edit', detail: '' })
  // Undo goes back to the previous radius, which the panel edits again.
  re().undoSketch()
  if (keyOf(sketchNow()) !== preKey) issues.push({ sig: 'Undo of a radius edit did not restore', detail: '' })
  const back = ct.getState().lastFillet
  if (!back || back.madeKey !== preKey || Math.abs(back.radiusMm - lf.radiusMm) > 1e-12) issues.push({ sig: 'panel did not return to the previous radius on Undo', detail: '' })
  re().redoSketch()
  if (keyOf(sketchNow()) !== keyOf(post)) issues.push({ sig: 'Redo of a radius edit not exact', detail: '' })
  const fwd = ct.getState().lastFillet
  if (!fwd || Math.abs(fwd.radiusMm - r) > 1e-12) issues.push({ sig: 'panel radius not restored on Redo of a radius edit', detail: '' })
  return 'radius changed'
}

// ---- other modify tools ------------------------------------------------------
interface OpRun { name: string; ids: number[]; addOnly: boolean; act: () => unknown; message: () => string | null | undefined; carriersMayMove?: boolean }
function linesOf(s: Sketch) { return s.entities.filter((e): e is SketchLine => e.kind === 'line') }
/** Two lines that meet at a coincident end, else any two lines. */
function cornerPair(R: Rand, s: Sketch): number[] {
  const ls = new Set(linesOf(s).map((l) => l.id))
  const joined = s.constraints.filter((c): c is Extract<Constraint, { kind: 'coincident' }> => c.kind === 'coincident' && ls.has(c.p.entity) && ls.has(c.q.entity) && c.p.entity !== c.q.entity)
  if (joined.length && R() < 0.8) { const c = pick(R, joined); return [c.p.entity, c.q.entity] }
  const l = linesOf(s)
  if (l.length < 2) return []
  const i = Math.floor(R() * l.length); let j = Math.floor(R() * (l.length - 1)); if (j >= i) j++
  return [l[i].id, l[j].id]
}
function chooseOp(R: Rand): OpRun | null {
  const s = sketchNow()
  const ids = s.entities.map((e) => e.id)
  if (!ids.length) return null
  const some = (n: number) => [...ids].sort(() => R() - 0.5).slice(0, Math.max(1, Math.min(ids.length, n)))
  const errOf = () => draft().error
  const kind = pick(R, ['fillet', 'chamfer', 'sharpen', 'join', 'trim', 'offset', 'mirror', 'mirrorPanel', 'pattern', 'patternPanel', 'duplicate', 'delete', 'undo', 'redo'] as const)
  switch (kind) {
    case 'fillet': { const p = cornerPair(R, s); return { name: 'filletSelected', ids: p, addOnly: false, act: () => re().filletSelected(), message: errOf } }
    case 'chamfer': { const p = cornerPair(R, s); return { name: 'chamferSelected', ids: p, addOnly: false, act: () => re().chamferSelected(), message: errOf } }
    case 'sharpen': { const arcs = s.entities.filter((e) => e.kind === 'arc'); const one = arcs.length ? [pick(R, arcs).id] : some(1); return { name: 'sharpenSelected', ids: one, addOnly: false, act: () => re().sharpenSelected(), message: errOf } }
    case 'join': return { name: 'joinSelected', ids: some(2), addOnly: false, act: () => re().joinSelected(), message: errOf, carriersMayMove: true }
    case 'trim': {
      const e = pick(R, s.entities)
      const poly = e.kind === 'line' || e.kind === 'arc' || e.kind === 'circle' ? entityPolyline(e, 96) : null
      const at: Vec2 = poly ? poly[Math.floor(R() * poly.length)] : [0, 0]
      return { name: `trimSketchAt(${e.id}, ${JSON.stringify(at)})`, ids: [], addOnly: false, act: () => trimSketchAt(e.id, at), message: errOf, carriersMayMove: true }
    }
    case 'offset': { const d = pick(R, [-1, 1]) * U(R, 0.3, 5); return { name: `offsetSketchSelection(${d.toFixed(2)})`, ids: some(1 + Math.floor(R() * 3)), addOnly: true, act: () => offsetSketchSelection(d), message: errOf } }
    case 'mirror': {
      const sel = some(1 + Math.floor(R() * 3))
      const axis = pick(R, mirrorAxisChoices(s, [], sel))
      return { name: `Mirror (panel) about ${axis.label}`, ids: sel, addOnly: true, message: () => useSketchMirror.getState().message ?? errOf(), act: () => {
        useSketchMirror.getState().start(sel)
        useSketchMirror.getState().pick(axis)
        return useSketchMirror.getState().accept()
      } }
    }
    case 'mirrorPanel': return null
    case 'pattern': {
      const sel = some(1 + Math.floor(R() * 2)), mode = pick(R, ['linear', 'circular', 'angular'] as const)
      return { name: `Pattern ${mode} (panel)`, ids: sel, addOnly: true, message: () => useSketchPattern.getState().message ?? errOf(), act: () => { useSketchPattern.getState().start(sel, mode); return useSketchPattern.getState().accept() } }
    }
    case 'patternPanel': { const sel = some(1 + Math.floor(R() * 2)); return { name: 'openSketchPattern/applySketchPattern', ids: sel, addOnly: true, message: errOf, act: () => { re().openSketchPattern(); re().applySketchPattern() } } }
    case 'duplicate': { const d: Vec2 = [U(R, -20, 20), U(R, -20, 20)]; return { name: 'duplicateSketchSelection', ids: some(1 + Math.floor(R() * 3)), addOnly: true, act: () => duplicateSketchSelection(d), message: errOf } }
    case 'delete': return { name: 'deleteSelected', ids: some(1), addOnly: false, act: () => re().deleteSelected(), message: errOf }
    // Never past the seed: brushing the seed took undo steps of its own, and
    // undoing those changes the scenario under the checks (wf1181).
    case 'undo': return { name: 'undoSketch', ids: [], addOnly: false, act: () => { if (hist() > seedFloor) re().undoSketch() }, message: () => null, carriersMayMove: true }
    case 'redo': return { name: 'redoSketch', ids: [], addOnly: false, act: () => re().redoSketch(), message: () => null, carriersMayMove: true }
  }
}

/** Runs one modify tool as its button does (overlays closed first) and checks it. */
function runOp(R: Rand, op: OpRun, issues: Issue[]): string {
  closeSketchToolOverlays()
  select(op.ids)
  const pre = cloneSketch(sketchNow()), preKey = keyOf(pre), h0 = hist()
  const sayUndo = R() < 0.7
  try { op.act() } catch (e) { issues.push({ sig: `exception in ${op.name.replace(/\(.*/, '')}`, detail: (e as Error).stack?.split('\n').slice(0, 3).join(' | ') ?? String(e) }); return 'exception' }
  const post = sketchNow(), postKey = keyOf(post), steps = hist() - h0
  if (!finiteSketch(post)) issues.push({ sig: `non-finite number after ${op.name.replace(/\(.*/, '')}`, detail: '' })
  const base = op.name.replace(/\(.*/, '')
  { const dg = newlyDegenerate(pre, post); if (dg.length && base !== 'undoSketch' && base !== 'redoSketch') issues.push({ sig: `${base} left a degenerate piece`, detail: dg.join(', ') }) }
  if (op.name === 'undoSketch' || op.name === 'redoSketch') return postKey === preKey ? 'nothing to undo/redo' : 'done'
  if (steps === 0) {
    if (postKey !== preKey) issues.push({ sig: `${base} changed the sketch without an undo step`, detail: '' })
    const m = op.message()
    if (!m) note(`silent no-op: ${base}`, `selection ${JSON.stringify(op.ids)} kinds ${op.ids.map((id) => entityOf(pre, id)?.kind).join(',')}`)
    else if (!readable(m)) issues.push({ sig: `unreadable message from ${base}`, detail: m })
    else count(`refused ${base}: ${normal(m)}`)
    return 'refused'
  }
  if (steps !== 1) issues.push({ sig: `${base} took ${steps} undo steps`, detail: '' })
  // An added copy re-solves the sketch, which can settle an existing piece
  // by a hair (seen: 1.7e-9 to 6e-7 mm): a note under 1e-6 mm, a failure above.
  if (op.addOnly) for (const e of pre.entities) { const now = entityOf(post, e.id); if (now && moved(e, now) > 1e-9 && moved(e, now) < 1e-6) { note(`${base} settled an existing piece by under 1e-6 mm`, `${e.kind} ${e.id} by ${moved(e, now).toExponential(2)}`); break } if (!now || moved(e, now) > 1e-9) { issues.push({ sig: `${base} moved or removed an existing piece`, detail: `${e.kind} ${e.id} ${now ? moved(e, now).toExponential(2) : 'removed'}${'points' in e && e.points ? ' (brushed)' : ''}` }); break } }
  if (!op.carriersMayMove) for (const e of pre.entities) {
    const now = entityOf(post, e.id)
    if (!now || (e.kind !== 'line' && e.kind !== 'arc') || now.kind !== e.kind) continue
    const cm = carrierMoved(e, now as Piece)
    if (cm > 1e-6) { issues.push({ sig: `${base} moved a piece off its carrier${'points' in e && e.points ? ' (brushed)' : ''}`, detail: `${e.kind} ${e.id} by ${cm.toExponential(2)}` }); break }
    if (cm > 1e-9) { note(`${base} moved a piece off its carrier by under 1e-6 mm${'points' in e && e.points ? ' (brushed)' : ''}`, `${e.kind} ${e.id} by ${cm.toExponential(2)}`); break }
  }
  // Undo and Redo of the tool.
  if (sayUndo) {
    const made = cloneSketch(post)
    re().undoSketch()
    if (keyOf(sketchNow()) !== preKey) issues.push({ sig: `Undo of ${base} did not restore exactly`, detail: sketchDiff(pre, sketchNow()) })
    re().redoSketch()
    if (keyOf(sketchNow()) !== postKey) issues.push({ sig: `Redo of ${base} not exact`, detail: sketchDiff(made, sketchNow()) })
  }
  return 'done'
}
interface OpReplay { pre: Sketch; op: OpRun }
function replayOp(r: OpReplay): string[] {
  openSketch()
  re().setSketch(cloneSketch(r.pre), undefined, true)
  const iss: Issue[] = []
  runOp(() => 0, r.op, iss)
  return iss.map((i) => i.sig)
}
function shrinkOp(r: OpReplay, sig: string): OpReplay {
  let cur = r
  const still = (c: OpReplay) => { try { return replayOp(c).includes(sig) } catch { return false } }
  if (!still(cur)) return cur
  const keep = new Set([...r.op.ids, ...[...r.op.name.matchAll(/trimSketchAt\((\d+)/g)].map((m) => Number(m[1]))])
  for (const e of [...cur.pre.entities]) {
    if (keep.has(e.id)) continue
    const pre = cloneSketch(cur.pre); pre.entities = pre.entities.filter((x) => x.id !== e.id); pre.constraints = pre.constraints.filter((c) => !JSON.stringify(c).includes(`"entity":${e.id}`) && !('a' in c && (c.a === e.id || c.b === e.id)) && !('line' in c && c.line === e.id))
    const c = { ...cur, pre }; if (still(c)) cur = c
  }
  for (const k of [...cur.pre.constraints]) { const pre = cloneSketch(cur.pre); pre.constraints = pre.constraints.filter((x) => x.id !== k.id); const c = { ...cur, pre }; if (still(c)) cur = c }
  { const pre = cloneSketch(cur.pre); for (const e of pre.entities) { const g = e as unknown as Record<string, unknown>; delete g.points; delete g.pointWeights; delete g.scatter } const c = { ...cur, pre }; if (still(c)) cur = c }
  { const pre = JSON.parse(JSON.stringify(cur.pre, (_k, v) => typeof v === 'number' ? r4(v) : v)) as Sketch; const c = { ...cur, pre }; if (still(c)) cur = c }
  return cur
}
function opReproText(r: OpReplay): string {
  const s = { ...r.pre, entities: r.pre.entities.map((e) => { const g = { ...e } as Record<string, unknown>; if (Array.isArray(g.points)) g.points = `[${(g.points as unknown[]).length} scan points]`; delete g.pointWeights; return g }) }
  return [
    `openSketch()  // reset(); startSketch(world z, XY)`,
    `useReverse.getState().setSketch(${JSON.stringify(s)}, undefined, true)`,
    `closeSketchToolOverlays(); select(${JSON.stringify(r.op.ids)})  // sketchDraft.selection`,
    `${r.op.name}  // then undoSketch(); redoSketch()`,
  ].join('\n')
}

// ---- shrinking ---------------------------------------------------------------
/** Re-runs a sweep on a fresh sketch: the issue signatures it gives. */
function replaySigs(r: Replay): string[] {
  openSketch()
  re().setSketch(cloneSketch(r.pre), undefined, true)
  ct.getState().setOpen(true)
  const out = sweepCorner(r.spec, { mode: r.mode, radiusMm: r.radiusMm, addDimension: r.addDimension, path: r.path, ring: r.ring, label: 'replay', fits: r.fits })
  ct.getState().cancel()
  return out.issues.map((i) => i.sig)
}
function shrink(r: Replay, sig: string): Replay {
  let cur = r
  const still = (c: Replay) => { try { return replaySigs(c).includes(sig) } catch { return false } }
  if (!still(cur)) return cur
  let tries = 0
  // Fewer path points.
  for (let chunk = Math.ceil(cur.path.length / 2); chunk >= 1; chunk = Math.floor(chunk / 2)) {
    for (let i = 0; i < cur.path.length && cur.path.length > 1 && tries < 250; ) { tries++; const c = { ...cur, path: cur.path.filter((_, k) => k < i || k >= i + chunk) }; if (c.path.length && still(c)) cur = c; else i += chunk }
  }
  // Fewer pieces and relations.
  for (const e of [...cur.pre.entities]) {
    if (e.id === cur.spec.A || e.id === cur.spec.B) continue
    const pre = cloneSketch(cur.pre); pre.entities = pre.entities.filter((x) => x.id !== e.id); pre.constraints = pre.constraints.filter((c) => !JSON.stringify(c).includes(`"entity":${e.id}`) && !('a' in c && (c.a === e.id || c.b === e.id)))
    const c = { ...cur, pre }; if (still(c)) cur = c
  }
  for (const k of [...cur.pre.constraints]) { const pre = cloneSketch(cur.pre); pre.constraints = pre.constraints.filter((x) => x.id !== k.id); const c = { ...cur, pre }; if (still(c)) cur = c }
  // Scan points the pieces were fitted to, and the section itself.
  { const pre = cloneSketch(cur.pre); for (const e of pre.entities) { const g = e as unknown as Record<string, unknown>; delete g.points; delete g.pointWeights; delete g.scatter } const c = { ...cur, pre }; if (still(c)) cur = c }
  if (cur.spec.chains.length) { const c = { ...cur, spec: { ...cur.spec, chains: [], chainsDesc: 'none' } }; if (still(c)) cur = c }
  // Rounded numbers.
  { const pre = JSON.parse(JSON.stringify(cur.pre, (_k, v) => typeof v === 'number' ? r4(v) : v)) as Sketch; const c = { ...cur, pre, path: cur.path.map((p) => p.map(r4) as Vec2), ring: r4(cur.ring) || cur.ring }; if (still(c)) cur = c }
  return cur
}
function reproText(r: Replay): string {
  const s = { ...r.pre, entities: r.pre.entities.map((e) => { const g = { ...e } as Record<string, unknown>; if (Array.isArray(g.points)) g.points = `[${(g.points as unknown[]).length} scan points]`; delete g.pointWeights; return g }) }
  return [
    `openSketch()  // reset(); startSketch(world z, XY)`,
    `useReverse.getState().setSketch(${JSON.stringify(s)}, undefined, true)`,
    `const ct = useSketchCornerTrim.getState(); ct.setOpen(true); ct.setMode('${r.mode}'); ct.setRadiusMm(${r.radiusMm}); ct.setAddDimension(${r.addDimension})`,
    `useSketchCornerTrim.getState().sweep(${JSON.stringify(r.path)}, ${r.ring}, chains.flat(), chains)  // chains: ${r.spec.chainsDesc}; pair ${r.spec.A}/${r.spec.B}`,
  ].join('\n')
}

// ---- the workflows -----------------------------------------------------------
let seedFloor = 0, currentTag = ''
const N = Number(process.env.FUZZ_N ?? 2000), SEED = Number(process.env.FUZZ_SEED ?? 20261120)

describe('2D Sketch modify tools: seeded random workflows through the stores', () => {
  it(`${N} workflows`, async () => {
    let done = 0, skipped = 0
    const skipWhy = new Map<string, number>()
    const t0 = Date.now()
    for (let w = 0; done < N && w < 4 * N; w++) {
      if (w % 4 === 0) await new Promise((r) => setTimeout(r, 0))
      const R = rng(SEED + w * 7919)
      const tag = `wf${w}`
      if (process.env.FUZZ_ONLY && !process.env.FUZZ_ONLY.split(',').includes(tag)) continue
      currentTag = tag
      openSketch()
      const u = R()
      let sc: Scenario | null | string
      try {
        if (u < 0.38) { const x = lineLineScenario(R, tag); if (x) re().setSketch((x as Scenario & { seed: Sketch }).seed); sc = x }
        else if (u < 0.48) { const x = rectScenario(R, tag); re().setSketch(x.seed); sc = x }
        else if (u < 0.62) { const x = curveScenario(R, tag, 1 + Math.floor(R() * 4000)); if (x) re().setSketch(x.seed); sc = x }
        else if (u < 0.8) sc = brushedCurveScenario(R, tag, 1 + Math.floor(R() * 4000))
        else sc = realScenario(R, tag)
      } catch (e) { fails.push({ wf: tag, step: 'seed', sig: 'exception while building the scenario', detail: String((e as Error).stack).split('\n').slice(0, 3).join(' | ') }); continue }
      if (!sc || typeof sc === 'string') { skipped++; const k = sc ? normal(sc) : 'no case'; skipWhy.set(k, (skipWhy.get(k) ?? 0) + 1); continue }
      done++
      count(`scenario ${sc.kind}`)
      const seedKey = keyOf(sketchNow()), seedHist = hist()
      seedFloor = seedHist
      // The seed must be what was asked for (a plain solve of the drawing).
      const brushedAt = new Map(sc.brushedIds.map((id) => [id, cloneSketch(sketchNow()).entities.find((e) => e.id === id)! as Piece]))
      const tracing = process.env.FUZZ_TRACE === tag
      const trace = (what: string) => { if (tracing) console.log(`${tag} ${what}
   ${JSON.stringify(sketchNow().entities.map((e) => ({ ...e, points: undefined, pointWeights: undefined })))}
   ${JSON.stringify(sketchNow().constraints)}`) }
      trace(`seeded ${sc.tag}`)
      const record = (step: string, issues: Issue[], replay?: Replay, opReplay?: { pre: Sketch; op: OpRun }) => { trace(`${step} → ${issues.map((i) => i.sig).join('; ') || 'ok'}`); for (const i of issues) fails.push({ ...i, wf: `${sc.tag}`, step, ...(replay ? { replay } : {}), ...(opReplay ? { opReplay } : {}) }) }
      // Sweep the corner(s) with Corner Trim open.
      closeSketchToolOverlays()
      ct.getState().setOpen(true)
      const corners = sc.kind === 'rect' ? [...sc.corners].sort(() => R() - 0.5).slice(0, 1 + Math.floor(R() * 4)) : sc.corners
      for (const spec of corners) {
        const ch = chooseSweep(R, spec, sc.extent)
        if (!ch) continue
        stepCount++
        const pre = cloneSketch(sketchNow()), preKey = keyOf(pre), h0 = hist()
        const replay: Replay = { pre, spec, mode: ch.mode, radiusMm: ch.radiusMm, addDimension: ch.addDimension, path: ch.path, ring: ch.ring, fits: ch.fits }
        const out = sweepCorner(spec, ch)
        count(`${ch.mode} → ${out.outcome.replace(/: .*/, '')}`)
        if (out.outcome.startsWith('refused')) count(`${ch.mode} ${out.outcome}`)
        record(`sweep ${ch.label}`, out.issues, replay)
        if (!out.ok) continue
        // The fillet's radius, sometimes.
        if (out.fillet && R() < 0.5) { stepCount++; const iss: Issue[] = []; count(radiusEdit(R, spec, out.fillet, iss)); record('radius edit', iss) }
        // Undo all, Redo all.
        if (R() < 0.8) { stepCount++; const iss: Issue[] = []; undoRedoCheck(R, h0, preKey, iss, !!ct.getState().lastFillet); record('undo/redo', iss) }
        // The next edit leaves brushed pieces where they are.
        if (R() < 0.5) { stepCount++; const iss: Issue[] = []; nextEditCheck(iss, sc.brushedIds.length ? ' (brushed pieces)' : ''); record('next edit', iss) }
        // Sweep the finished corner again, sometimes.
        if (R() < 0.12) {
          stepCount++
          const again = chooseSweep(R, spec, sc.extent)
          if (again) {
            const hh = hist(), kk = keyOf(sketchNow())
            let threw = false
            try { ct.getState().setMode(again.mode); ct.getState().setRadiusMm(again.radiusMm); let ok = ct.getState().sweep(again.path, again.ring, spec.chains.flat(), spec.chains); if (!ok && ct.getState().pending) ok = ct.getState().acceptPending(); count(`re-sweep of a finished corner → ${ok ? 'changed' : `refused: ${normal(ct.getState().message ?? '')}`}`) } catch (e) { threw = true; record('re-sweep', [{ sig: 'exception in re-sweep of a finished corner', detail: String(e) }]) }
            const iss: Issue[] = []
            if (!threw && !finiteSketch(sketchNow())) iss.push({ sig: 'non-finite after re-sweep', detail: '' })
            if (!threw && hist() > hh) { const n = hist() - hh, end = keyOf(sketchNow()); for (let i = 0; i < n; i++) re().undoSketch(); if (keyOf(sketchNow()) !== kk) iss.push({ sig: 'Undo of a re-sweep did not restore', detail: '' }); for (let i = 0; i < n; i++) re().redoSketch(); if (keyOf(sketchNow()) !== end) iss.push({ sig: 'Redo of a re-sweep not exact', detail: '' }) }
            record('re-sweep', iss)
          }
        }
      }
      // Other modify tools.
      const nOps = Math.floor(R() * 4)
      for (let k = 0; k < nOps; k++) {
        const op = chooseOp(R)
        if (!op) continue
        stepCount++
        const iss: Issue[] = [], opPre = cloneSketch(sketchNow())
        count(`${op.name.replace(/\(.*/, '')} → ${runOp(R, op, iss)}`)
        record(op.name, iss, undefined, { pre: opPre, op })
      }
      // Brushed pieces stay on their carriers through everything but a join or a trim.
      for (const [id, was] of brushedAt) {
        const now = pieceOf(sketchNow(), id)
        if (now && now.kind === was.kind && carrierMoved(was, now) > 1e-6 && !tally.has('__never')) {
          // Only meaningful when no join/trim ran: re-check with the op log is costly, so report as a note.
          note('a brushed piece left its carrier over the workflow', `${sc.tag} piece ${id} by ${carrierMoved(was, now).toExponential(2)}`)
        }
      }
      // Undo everything back to the seed.
      closeSketchToolOverlays()
      let guard = 0
      while (hist() > seedHist && guard++ < 60) re().undoSketch()
      if (hist() === seedHist && keyOf(sketchNow()) !== seedKey) {
        const was = JSON.parse(seedKey) as Sketch, now = sketchNow()
        const off = was.entities.map((e) => { const x = entityOf(now, e.id); return x ? `${e.kind} ${e.id} ${moved(e, x).toExponential(2)}` : `${e.kind} ${e.id} gone` }).filter((t) => !t.endsWith(' 0.00e+0'))
        record('undo all', [{ sig: 'Undo all did not return to the seeded sketch', detail: `entities ${was.entities.length}->${now.entities.length}, constraints ${was.constraints.length}->${now.constraints.length}; ${off.join(', ')}` }])
      }
    }
    const secs = (Date.now() - t0) / 1000
    // Group by signature; shrink the first of each sweep failure.
    const groups = new Map<string, Fail[]>()
    for (const f of fails) { const k = normal(f.sig); groups.set(k, [...(groups.get(k) ?? []), f]) }
    const report: Record<string, unknown>[] = []
    for (const [sig, fs_] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      const first = fs_.find((f) => f.replay) ?? fs_[0]
      let repro = ''
      if (first.replay) { const small = shrink(first.replay, first.sig); repro = reproText(small) + `\n// replayed: ${replaySigs(small).join('; ') || 'NOT REPRODUCED in isolation'}` }
      else if (first.opReplay) { const small = shrinkOp(first.opReplay, first.sig); repro = opReproText(small) + `\n// replayed: ${replayOp(small).join('; ') || 'NOT REPRODUCED in isolation'}` }
      report.push({ sig, count: fs_.length, example: { wf: first.wf, step: first.step, detail: first.detail }, repro, more: fs_.slice(1, 4).map((f) => `${f.wf} ${f.step} ${f.detail}`), all: fs_.map((f) => `${f.wf} | ${f.step} | ${f.detail}`) })
    }
    const summary = { seed: SEED, workflows: done, skipped, steps: stepCount, seconds: secs, failures: fails.length, signatures: report.length, skipWhy: Object.fromEntries(skipWhy), tally: Object.fromEntries([...tally].sort()), notes: Object.fromEntries([...notes].sort((a, b) => b[1].n - a[1].n)), report }
    if (process.env.FUZZ_REPORT) fs.writeFileSync(process.env.FUZZ_REPORT, JSON.stringify(summary, null, 1))
    console.log(`modify fuzz: ${done} workflows (${skipped} skipped), ${stepCount} checked steps, ${fails.length} failures in ${report.length} signatures, ${secs.toFixed(0)} s`)
    for (const r of report) console.log(`  ${r.count} × ${r.sig}\n    e.g. ${JSON.stringify(r.example)}${r.repro ? `\n    ${String(r.repro).replace(/\n/g, '\n    ')}` : ''}`)
    console.log('notes:'); for (const [k, v] of notes) console.log(`  ${v.n} × ${k}  (${v.example.slice(0, 160)})`)
    if (!process.env.FUZZ_ONLY) expect(done).toBe(N)
    expect(report.map((r) => `${r.count} × ${r.sig}`)).toEqual([])
  }, 3_600_000)
})
