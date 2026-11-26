// SPDX-License-Identifier: AGPL-3.0-only
// A seeded random-workflow harness for the 2D Sketch's drawing tools and its
// undo / redo: many short sessions driven through the real store the way the
// stage, the keys and the extra-tool overlay drive it, with the sketch checked
// after every step and the history walked back and forth at the end.
//
// FUZZ_WORKFLOWS (default 1500) and FUZZ_SEED (default 1) steer the run;
// FUZZ_REPORT names a file the report is also written to.

import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { datumTraces } from '../core/datums'
import { arcAbout, type ArcMode, circleFrom, type CircleMode, drawClicks, rectangleCorners, type RectangleMode, tangentArc } from '../core/draw'
import { anchorPoint, anchorsOf, arcThrough, constraintEntities, type Constraint, entityOf, polygonCorners, type PolygonFit, type Sketch, type SketchEntity } from '../core/sketch'
import { snapSketchPoint, type SnapContext } from '../core/snap'
import { chainArcStart, MAX_HISTORY, splineClosesAt } from '../state/reSketchDraft'
import { useRePrefs } from '../state/rePrefs'
import { useReverse } from '../state/reStore'
import { addSketchSlot, addSketchTangentArc, duplicateSketchSelection, middleLineSketchSelection, offsetSketchSelection } from '../state/sketchExtraTools'
import { useSketchPresentation } from '../state/sketchPresentation'
import { activateExtraSketchTool, activateSketchTool, openSketchEditPanel } from '../state/sketchToolActions'
import { XY } from './reKit'

const s = () => useReverse.getState()
const OFF: SnapContext = { off: true }
const SNAP: SnapContext = { datums: datumTraces(XY) }

/** The reset reStore.test.ts makes before every test. */
function resetStore(): void {
  useReverse.setState({
    features: [],
    rolledBack: [],
    featureDraft: null,
    nextFeatureId: 1,
    nextOfKind: {},
    results: {},
    bodies: [],
    sketchDraft: null,
    extrudeDraft: null,
    revolveDraft: null,
    past: [],
    future: [],
    selection: null,
    gripField: null,
    buildVersion: 0,
  })
  useSketchPresentation.setState({ tool: null, edit: null, lineChain: false })
}

function mulberry32(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- the steps -----------------------------------------------------------------

type V = [number, number]
type Pick = { p: V; additive: boolean }
type Step =
  | { t: 'line'; pts: V[]; snap: boolean }
  | { t: 'polyline'; pts: V[]; end: 'sameRaw' | 'sameEnd' | 'escape' | 'none' | 'tangent'; tan?: V; snap: boolean }
  | { t: 'rectangle'; mode: RectangleMode; pts: V[]; snap: boolean }
  | { t: 'circle'; mode: CircleMode; pts: V[]; snap: boolean }
  | { t: 'arc'; mode: ArcMode; pts: V[]; snap: boolean }
  | { t: 'polygon'; mode: PolygonFit; sides: number; pts: V[]; snap: boolean }
  | { t: 'spline'; pts: V[]; end: 'enter' | 'double' | 'close' | 'escape'; snap: boolean }
  | { t: 'slot'; pts: V[] }
  | { t: 'tangentArc'; line: number; at: 'a' | 'b'; to: V; end?: { entity: number; at: 'a' | 'b' } }
  | { t: 'middle'; a: number; b: number }
  | { t: 'select'; picks: Pick[] }
  | { t: 'duplicate'; delta: V; picks?: Pick[] }
  | { t: 'offset'; distance: number; picks?: Pick[] }
  | { t: 'delete'; picks?: Pick[] }
  | { t: 'construction'; picks?: Pick[] }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'escape' }

const fmt = (x: number) => (Object.is(x, -0) ? '-0' : String(x))
const fv = (p: readonly number[]) => `[${p.map(fmt).join(', ')}]`
function describeStep(st: Step): string {
  const snap = 'snap' in st ? (st.snap ? ' snap' : ' raw') : ''
  const picks = 'picks' in st && st.picks ? ` after select ${st.picks.map((k) => (k.additive ? '+' : '') + fv(k.p)).join(' ')}` : ''
  switch (st.t) {
    case 'line':
      return `line${snap} ${st.pts.map(fv).join(' -> ')}`
    case 'polyline':
      return `polyline${snap} ${st.pts.map(fv).join(' -> ')} end=${st.end}${st.tan ? ' ' + fv(st.tan) : ''}`
    case 'rectangle':
    case 'circle':
    case 'arc':
      return `${st.t}(${st.mode})${snap} ${st.pts.map(fv).join(' ')}`
    case 'polygon':
      return `polygon(${st.mode},${st.sides})${snap} ${st.pts.map(fv).join(' ')}`
    case 'spline':
      return `spline${snap} ${st.pts.map(fv).join(' ')} end=${st.end}`
    case 'slot':
      return `slot ${st.pts.map(fv).join(' ')}`
    case 'tangentArc':
      return `tangentArc line ${st.line}.${st.at} -> ${fv(st.to)}${st.end ? ` (end ${st.end.entity}.${st.end.at})` : ''}`
    case 'middle':
      return `middle ${st.a} ${st.b}`
    case 'select':
      return `select ${st.picks.map((k) => (k.additive ? '+' : '') + fv(k.p)).join(' ')}`
    case 'duplicate':
      return `duplicate ${fv(st.delta)}${picks}`
    case 'offset':
      return `offset ${fmt(st.distance)}${picks}`
    default:
      return `${st.t}${picks}`
  }
}

// ---- comparing sketches --------------------------------------------------------

type Diff = { path: string; a: unknown; b: unknown; cls: 'zero-sign' | 'drift' | 'moved' | 'structure' }
function firstDiff(a: unknown, b: unknown, path = ''): Diff | null {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Object.is(a, b)) return null
    if (a === 0 && b === 0) return { path, a, b, cls: 'zero-sign' }
    const drift = Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b))
    return { path, a, b, cls: drift ? 'drift' : 'moved' }
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return { path, a, b, cls: 'structure' }
    if (a.length !== b.length) return { path: `${path}.length`, a: a.length, b: b.length, cls: 'structure' }
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`)
      if (d) return d
    }
    return null
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ra = a as Record<string, unknown>
    const rb = b as Record<string, unknown>
    const keys = new Set([...Object.keys(ra).filter((k) => ra[k] !== undefined), ...Object.keys(rb).filter((k) => rb[k] !== undefined)])
    for (const k of keys) {
      if (ra[k] === undefined || rb[k] === undefined) return { path: `${path}.${k}`, a: ra[k], b: rb[k], cls: 'structure' }
      const d = firstDiff(ra[k], rb[k], `${path}.${k}`)
      if (d) return d
    }
    return null
  }
  return a === b ? null : { path, a, b, cls: 'structure' }
}
const body = (k: Sketch) => ({ entities: k.entities, constraints: k.constraints })
const sketchDiff = (a: Sketch, b: Sketch) => firstDiff(body(a), body(b))
const clone = <T>(x: T): T => structuredClone(x)
const showDiff = (d: Diff) => `${d.cls} at ${d.path}: ${JSON.stringify(d.a)} vs ${JSON.stringify(d.b)}`

// ---- the run of one workflow ---------------------------------------------------

interface Failure { check: string; stepType: string; detail: string; step: number }
interface Warning { kind: string; detail: string }
interface RunResult { failures: Failure[]; warnings: Warning[]; errors: Map<string, number>; calls: string[]; clicks: number; drift: Map<string, number> }

class Runner {
  failures: Failure[] = []
  warnings: Warning[] = []
  errors = new Map<string, number>()
  calls: string[] = []
  clicks = 0
  step = -1
  stepType = 'start'
  desc = ''
  /** Degenerate pieces already noted, so each is told once, by the step that made it. */
  noted = new Set<number>()
  /** The sketches the history should hold, each with the step that made the next. */
  past: { sketch: Sketch; label: string }[] = []
  future: { sketch: Sketch; label: string }[] = []
  initial!: Sketch
  capped = false

  constructor(readonly radius: number) {}

  fail(check: string, detail: string): void {
    this.failures.push({ check, stepType: this.stepType, detail, step: this.step })
  }
  /** The largest numeric drift seen per check, for the report. */
  drift = new Map<string, number>()
  mismatch(check: string, d: Diff, detail: string): void {
    if (d.cls === 'drift' && typeof d.a === 'number' && typeof d.b === 'number') this.drift.set(check, Math.max(this.drift.get(check) ?? 0, Math.abs(d.a - d.b)))
    this.fail(`${check}|${d.cls}`, detail)
  }
  warn(kind: string, detail: string): void {
    this.warnings.push({ kind, detail })
  }

  start(): void {
    resetStore()
    this.calls.push(`s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)`)
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    const d = s().sketchDraft
    if (!d) throw new Error('startSketch made no draft')
    this.initial = clone(d.sketch)
    this.invariants()
  }

  /** One store call, its sketch change checked against the history: a step
   *  that changes the sketch leaves exactly one undo step holding the sketch
   *  as it was, and a step that leaves no undo step changes nothing. */
  act(code: string, fn: () => unknown, opts: { delta?: number; kind?: 'undo' | 'redo' } = {}): unknown {
    this.calls.push(code)
    const before = s().sketchDraft
    const bSketch = before ? clone(before.sketch) : null
    const bLast = before?.history.at(-1)
    const bLen = before?.history.length ?? 0
    let out: unknown
    try {
      out = fn()
    } catch (e) {
      this.fail('exception', `${code}: ${e instanceof Error ? (e.stack ?? e.message).split('\n').slice(0, 4).join(' | ') : String(e)}`)
      return undefined
    }
    const after = s().sketchDraft
    if (!after || !bSketch) {
      this.fail('draft-lost', `${code} left no sketch draft`)
      return out
    }
    if (after.error) this.errors.set(after.error, (this.errors.get(after.error) ?? 0) + 1)
    const dn = after.sketch.entities.length - bSketch.entities.length
    if (opts.delta !== undefined && dn !== opts.delta) this.fail('count', `${code}: entities changed by ${dn}, expected ${opts.delta} (error: ${after.error ?? 'none'})`)
    if (opts.kind === 'undo') {
      const want = this.past.pop()
      if (!want) {
        const d = sketchDiff(bSketch, after.sketch)
        if (d) this.fail('undo-empty-changed', `undo with nothing to undo changed the sketch: ${showDiff(d)}`)
      } else {
        this.future.push({ sketch: bSketch, label: want.label })
        const d = sketchDiff(after.sketch, want.sketch)
        if (d) this.mismatch('undo-mismatch', d, `undoing ${want.label}: ${showDiff(d)}`)
      }
    } else if (opts.kind === 'redo') {
      const want = this.future.pop()
      if (!want) {
        const d = sketchDiff(bSketch, after.sketch)
        if (d) this.fail('redo-empty-changed', `redo with nothing to redo changed the sketch: ${showDiff(d)}`)
      } else {
        this.past.push({ sketch: bSketch, label: want.label })
        const d = sketchDiff(after.sketch, want.sketch)
        if (d) this.mismatch('redo-mismatch', d, `redoing ${want.label}: ${showDiff(d)}`)
      }
    } else {
      const pushed = after.history.at(-1) !== bLast && after.history.length >= bLen
      if (pushed) {
        const snap = after.history.at(-1)!
        const d = sketchDiff(snap, bSketch)
        if (d) this.fail('history-snapshot', `${code}: the undo step does not hold the sketch as it was: ${showDiff(d)}`)
        this.past.push({ sketch: bSketch, label: this.stepType })
        if (this.past.length > MAX_HISTORY) {
          this.past.shift()
          this.capped = true
        }
        this.future = []
      } else {
        const d = sketchDiff(bSketch, after.sketch)
        if (d) this.fail('changed-without-undo-step', `${code}: ${showDiff(d)}`)
      }
    }
    if (after.history.length !== this.past.length) this.fail('history-length', `${code}: history ${after.history.length}, expected ${this.past.length}`)
    if ((after.future?.length ?? 0) !== this.future.length) this.fail('future-length', `${code}: future ${after.future?.length ?? 0}, expected ${this.future.length}`)
    this.invariants()
    return out
  }

  invariants(): void {
    const d = s().sketchDraft
    if (!d) return
    const k = d.sketch
    // Every number finite.
    const walk = (x: unknown, path: string): void => {
      if (typeof x === 'number') {
        if (!Number.isFinite(x)) this.fail('non-finite', `${path} = ${x}`)
      } else if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${path}[${i}]`))
      else if (x && typeof x === 'object') for (const [key, y] of Object.entries(x)) walk(y, `${path}.${key}`)
    }
    walk(k, 'sketch')
    walk(d.pending, 'pending')
    if (d.report) {
      for (const u of d.report.unmet) if (!Number.isFinite(u.residual)) this.fail('report-nan', `constraint ${u.id} residual ${u.residual}`)
      if (!Number.isFinite(d.report.softRms)) this.fail('report-nan', `softRms ${d.report.softRms}`)
      if (!d.report.ok) this.warn(`solver left relations unmet after ${this.stepType}`, `${this.desc}: ${d.report.unmet.length} unmet, worst ${Math.max(...d.report.unmet.map((u) => u.residual))}`)
    }
    // Ids unique and below nextId.
    const ids = new Set<number>()
    for (const e of k.entities) {
      if (ids.has(e.id)) this.fail('duplicate-id', `entity ${e.id}`)
      ids.add(e.id)
      if (e.id >= k.nextId) this.fail('id-past-nextId', `entity ${e.id} >= ${k.nextId}`)
    }
    const cids = new Set<number>()
    for (const c of k.constraints) {
      if (cids.has(c.id) || ids.has(c.id)) this.fail('duplicate-id', `constraint ${c.id}`)
      cids.add(c.id)
      if (c.id >= k.nextId) this.fail('id-past-nextId', `constraint ${c.id} >= ${k.nextId}`)
      let refs: number[] = []
      try {
        refs = constraintEntities(c)
      } catch (e) {
        this.fail('constraint-shape', `${JSON.stringify(c)}: ${String(e)}`)
      }
      for (const id of refs) if (!ids.has(id)) this.fail('dangling-constraint', `${c.kind} ${c.id} refers to missing ${id}`)
      for (const anchor of anchorsIn(c)) {
        const e = entityOf(k, anchor.entity)
        if (e && !validAnchor(e, anchor.at)) this.fail('invalid-anchor', `${c.kind} ${c.id} names ${e.kind} ${e.id}.${anchor.at}`)
      }
    }
    for (const id of d.selection) if (!ids.has(id)) this.fail('selection-missing', `selection holds ${id}`)
    if (d.chain) {
      const e = entityOf(k, d.chain.entity)
      if (!e) this.fail('chain-missing', `chain holds ${d.chain.entity}`)
    }
    // Collect the first occurrence per entity. The summary fails on any
    // undersized piece or unmet relation, including after OK and reopen.
    for (const e of k.entities) {
      if (this.noted.has(e.id)) continue
      const bad = e.kind === 'line' ? Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) < 1e-6 : (e.kind === 'circle' || e.kind === 'arc') && !(e.r > 1e-6)
      if (!bad) continue
      this.noted.add(e.id)
      this.warn(`${e.kind === 'line' ? 'line shorter than 1e-6 mm' : `${e.kind} of radius under 1e-6 mm`} made by ${this.stepType}`, `${this.desc} -> ${JSON.stringify(e)}`)
    }
  }

  // ---- the user's gestures ----

  ctx(snap: boolean): [SnapContext, string] {
    return snap ? [SNAP, 'SNAP'] : [OFF, 'OFF']
  }

  /** What a click with a drawing tool should add, read off the draft before it. */
  expectedClick(spot: V, ctx: SnapContext): number {
    const d = s().sketchDraft!
    const r = this.radius
    const at = snapSketchPoint(d.sketch, spot, r, ctx).point
    if (d.tool === 'spline') {
      if (splineClosesAt(d.pending, spot, r)) return 1
      const last = d.pending.at(-1)
      if (last && Math.hypot(last[0] - at[0], last[1] - at[1]) <= r / 3) return d.pending.length >= 2 ? 1 : 0
      return 0
    }
    if (d.tool === 'select' || d.tool === 'project' || d.tool === 'dimension' || d.tool === 'relation' || d.tool === 'fillet' || d.tool === 'chamfer') return 0
    const prefs = useRePrefs.getState()
    const modes = prefs.drawModes
    const pend = [...d.pending, at]
    if (pend.length < drawClicks(d.tool, modes)) return 0
    const [p, q, w] = pend
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-6) return 0
    // In a chain, a click back within a third of the reach of the spot the
    // last end was clicked on is the rest of a double click: it ends the
    // chain, as the Spline tool's does (1.2.10).
    if (d.chain && d.chainClick && d.pending.length === 1 && Math.hypot(spot[0] - d.chainClick[0], spot[1] - d.chainClick[1]) <= r / 3) return 0
    switch (d.tool) {
      case 'line':
        return 1
      case 'rectangle': {
        const c = rectangleCorners(modes.rectangle, pend)
        return c ? (modes.rectangle === 'center' ? 7 : 4) : 0
      }
      case 'circle':
        return circleFrom(modes.circle, pend) ? 1 : 0
      case 'arc':
        return (modes.arc === 'center' ? arcAbout(p, q, w) : arcThrough(p, q, w)) ? 1 : 0
      case 'polygon': {
        const c = polygonCorners(p, q, prefs.polygonSides, modes.polygon)
        return c ? c.length + (modes.polygon === 'inscribed' ? 1 : 2) : 0
      }
    }
    return 0
  }

  click(p: V, snap: boolean): void {
    const [ctx, name] = this.ctx(snap)
    const delta = this.expectedClick(p, ctx)
    this.clicks++
    this.act(`s().sketchClick(${fv(p)}, ${this.radius}, false, ${name})`, () => s().sketchClick(p, this.radius, false, ctx), { delta })
  }

  tool(t: Parameters<typeof activateSketchTool>[0]): void {
    this.act(`activateSketchTool('${t}')`, () => activateSketchTool(t), { delta: 0 })
  }

  select(picks: readonly Pick[]): void {
    this.tool('select')
    for (const k of picks) {
      this.clicks++
      this.act(`s().sketchClick(${fv(k.p)}, ${this.radius}, ${k.additive}, OFF)`, () => s().sketchClick(k.p, this.radius, k.additive, OFF), { delta: 0 })
    }
  }

  escape(): void {
    // The sketch's Escape (app/keyboard.ts).
    const d = s().sketchDraft!
    if (d.tool === 'spline' && d.pending.length > 0) {
      const delta = d.pending.length >= 2 ? 1 : 0
      this.act('s().finishSpline()  // Escape', () => s().finishSpline(), { delta })
    } else if (d.pending.length > 0 || d.dimPick || d.dimMade != null || d.selection.length > 0 || d.selectedConstraint !== null) this.act('s().clearSelection()  // Escape', () => s().clearSelection(), { delta: 0 })
    else if (d.tool !== 'select') this.act(`s().setSketchTool('select')  // Escape`, () => s().setSketchTool('select'), { delta: 0 })
  }

  run(st: Step): void {
    const d0 = s().sketchDraft
    if (!d0) return
    switch (st.t) {
      case 'line': {
        // Line (not Polyline): the stage puts the tool down again once a
        // line is made, so every line starts afresh.
        useSketchPresentation.getState().setLineChain(false)
        this.tool('line')
        for (const p of st.pts) {
          const n = s().sketchDraft!.sketch.entities.length
          this.click(p, st.snap)
          if (s().sketchDraft!.sketch.entities.length > n) this.act(`s().setSketchTool('line')`, () => s().setSketchTool('line'), { delta: 0 })
        }
        return
      }
      case 'polyline': {
        useSketchPresentation.getState().setLineChain(true)
        this.tool('line')
        for (const p of st.pts) this.click(p, st.snap)
        const d = s().sketchDraft!
        if (st.end === 'sameRaw') {
          // The second click of a double click, where the hand was: the
          // chain ends there (reSketchSlice's own rule, "a click on the same
          // spot ends the chain"), whatever the solver did to the end.
          const last = st.pts[st.pts.length - 1]
          const n = d.sketch.entities.length
          const chained = d.pending.length === 1 && d.chain !== null
          this.click(last, st.snap)
          const after = s().sketchDraft!
          if (chained && after.sketch.entities.length > n) {
            const e = after.sketch.entities.at(-1)!
            const len = e.kind === 'line' ? Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) : NaN
            this.fail('double-click-adds-stub', `a double click on ${fv(last)} drew a ${fmt(len)} mm ${e.kind} instead of ending the chain`)
          }
        }
        else if (st.end === 'sameEnd' && d.pending.length === 1) this.click([d.pending[0][0], d.pending[0][1]], st.snap)
        else if (st.end === 'escape') this.escape()
        else if (st.end === 'tangent' && st.tan && d.chain && d.pending.length === 1) {
          // Pressed on the chain's end, dragged and let go: a tangent arc.
          const [ctx, name] = this.ctx(st.snap)
          const from = chainArcStart(d, d.pending[0], Infinity)
          const at = snapSketchPoint(d.sketch, st.tan, this.radius, ctx).point
          const delta = from && tangentArc(from.p, from.t, at) ? 1 : 0
          this.act(`s().sketchTangentArc(${fv(st.tan)}, ${this.radius}, ${name})`, () => s().sketchTangentArc(st.tan!, this.radius, ctx), { delta })
          this.escape()
        }
        return
      }
      case 'rectangle':
      case 'circle':
      case 'arc':
      case 'polygon': {
        if (st.t === 'polygon') {
          this.act(`useRePrefs.getState().setPolygonSides(${st.sides})`, () => useRePrefs.getState().setPolygonSides(st.sides), { delta: 0 })
        }
        this.act(`useRePrefs.getState().setDrawMode('${st.t}', '${st.mode}')`, () => useRePrefs.getState().setDrawMode(st.t, st.mode as never), { delta: 0 })
        this.tool(st.t)
        for (const p of st.pts) this.click(p, st.snap)
        return
      }
      case 'spline': {
        this.tool('spline')
        for (const p of st.pts) {
          if (s().sketchDraft!.tool !== 'spline') break
          this.click(p, st.snap)
        }
        const d = s().sketchDraft!
        if (d.tool !== 'spline') return
        if (st.end === 'enter') this.act('s().finishSpline()', () => s().finishSpline(), { delta: d.pending.length >= 2 ? 1 : 0 })
        else if (st.end === 'escape') this.escape()
        else if (st.end === 'double') this.click(st.pts[st.pts.length - 1], st.snap)
        else this.click(st.pts[0], st.snap)
        return
      }
      case 'slot': {
        this.act(`activateExtraSketchTool('slot')`, () => activateExtraSketchTool('slot'), { delta: 0 })
        const [a, b, w] = st.pts
        // The overlay refuses a second centre on the first (SketchExtraOverlay).
        const rad = Math.max(1e-7, this.radius)
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < rad * 0.1) return
        const width = (2 * Math.abs((b[0] - a[0]) * (w[1] - a[1]) - (b[1] - a[1]) * (w[0] - a[0]))) / Math.hypot(b[0] - a[0], b[1] - a[1])
        let ok = false
        const before = s().sketchDraft!.sketch.entities.length
        this.act(`addSketchSlot(${fv(a)}, ${fv(b)}, ${fmt(width)})`, () => (ok = addSketchSlot(a, b, width)))
        const dn = s().sketchDraft!.sketch.entities.length - before
        if (dn !== (ok ? 4 : 0)) this.fail('count', `slot returned ${ok}, entities changed by ${dn}`)
        return
      }
      case 'tangentArc': {
        this.act(`activateExtraSketchTool('tangentArc')`, () => activateExtraSketchTool('tangentArc'), { delta: 0 })
        let ok = false
        const before = s().sketchDraft!.sketch.entities.length
        const end = st.end ? `{ entity: ${st.end.entity}, at: '${st.end.at}' }` : 'undefined'
        this.act(`addSketchTangentArc(${st.line}, '${st.at}', ${fv(st.to)}, ${end})`, () => (ok = addSketchTangentArc(st.line, st.at, st.to, st.end)))
        const dn = s().sketchDraft!.sketch.entities.length - before
        if (dn !== (ok ? 1 : 0)) this.fail('count', `tangent arc returned ${ok}, entities changed by ${dn}`)
        return
      }
      case 'middle': {
        this.act(`activateExtraSketchTool('middle')`, () => activateExtraSketchTool('middle'), { delta: 0 })
        this.act(`useReverse.setState((x) => ({ sketchDraft: { ...x.sketchDraft!, selection: [${st.a}, ${st.b}] } }))`, () => useReverse.setState((x) => (x.sketchDraft ? { sketchDraft: { ...x.sketchDraft, selection: [st.a, st.b] } } : {})), { delta: 0 })
        let ok = false
        const before = s().sketchDraft!.sketch.entities.length
        this.act('middleLineSketchSelection()', () => (ok = middleLineSketchSelection()))
        const dn = s().sketchDraft!.sketch.entities.length - before
        if (dn !== (ok ? 1 : 0)) this.fail('count', `middle line returned ${ok}, entities changed by ${dn}`)
        return
      }
      case 'select':
        this.select(st.picks)
        return
      case 'duplicate':
      case 'offset': {
        if (st.picks) this.select(st.picks)
        const n = s().sketchDraft!.selection.length
        if (n === 0) return // the button is disabled
        this.act(`openSketchEditPanel('${st.t}')`, () => openSketchEditPanel(st.t), { delta: 0 })
        let ok = false
        const before = s().sketchDraft!.sketch.entities.length
        if (st.t === 'duplicate') this.act(`duplicateSketchSelection(${fv(st.delta)})`, () => (ok = duplicateSketchSelection(st.delta)))
        else this.act(`offsetSketchSelection(${fmt(st.distance)})`, () => (ok = offsetSketchSelection(st.distance)))
        const dn = s().sketchDraft!.sketch.entities.length - before
        if (dn !== (ok ? n : 0)) this.fail('count', `${st.t} of ${n} returned ${ok}, entities changed by ${dn}`)
        useSketchPresentation.getState().setEdit(null)
        return
      }
      case 'delete': {
        if (st.picks) this.select(st.picks)
        const d = s().sketchDraft!
        // The Delete key (app/keyboard.ts).
        if (d.selectedConstraint !== null) this.act('s().removeSelectedConstraint()', () => s().removeSelectedConstraint(), { delta: 0 })
        else this.act('s().deleteSelected()', () => s().deleteSelected(), { delta: -new Set(d.selection).size })
        return
      }
      case 'construction': {
        if (st.picks) this.select(st.picks)
        const d = s().sketchDraft!
        if (d.selection.length === 0) return // the button is disabled
        const was = new Map(d.sketch.entities.map((e) => [e.id, Boolean(e.construction)]))
        const all = d.selection.every((id) => was.get(id))
        this.act('s().toggleConstructionSelected()', () => s().toggleConstructionSelected(), { delta: 0 })
        for (const e of s().sketchDraft!.sketch.entities) {
          const want = d.selection.includes(e.id) ? !all : was.get(e.id)
          if (Boolean(e.construction) !== want) this.fail('construction', `piece ${e.id} construction ${e.construction}, expected ${want}`)
        }
        return
      }
      case 'undo':
        this.act('s().undoSketch()', () => s().undoSketch(), { kind: 'undo' })
        return
      case 'redo':
        this.act('s().redoSketch()', () => s().redoSketch(), { kind: 'redo' })
        return
      case 'escape':
        this.escape()
        return
    }
  }

  /** Back to the start, forward to the end, finished, opened again. */
  finish(): void {
    this.stepType = 'final'
    const d0 = s().sketchDraft
    if (!d0) return
    // Redone all the way, the sketch is the newest the history holds: the
    // one before the first undo still waiting to be redone, or this one.
    const finalSketch = clone(this.future.length ? this.future[0].sketch : d0.sketch)
    for (let i = 0; i < 200 && (s().sketchDraft?.history.length ?? 0) > 0; i++) this.act('s().undoSketch()', () => s().undoSketch(), { kind: 'undo' })
    const bottom = s().sketchDraft!.sketch
    if (!this.capped) {
      const d = sketchDiff(bottom, this.initial)
      if (d) this.mismatch('undo-all', d, `after undoing everything: ${showDiff(d)}`)
    }
    for (let i = 0; i < 200 && (s().sketchDraft?.future?.length ?? 0) > 0; i++) this.act('s().redoSketch()', () => s().redoSketch(), { kind: 'redo' })
    {
      const d = sketchDiff(s().sketchDraft!.sketch, finalSketch)
      if (d) this.mismatch('redo-all', d, `after redoing everything: ${showDiff(d)}`)
    }
    const kept = clone(s().sketchDraft!.sketch)
    {
      const d = firstDiff(JSON.parse(JSON.stringify(kept)), kept)
      if (d) this.fail(`json-roundtrip|${d.cls}`, showDiff(d))
    }
    this.calls.push('const id = s().commitSketch()')
    let id: number | null = null
    try {
      id = s().commitSketch()
    } catch (e) {
      this.fail('exception', `commitSketch: ${String(e)}`)
      return
    }
    if (kept.entities.length === 0) {
      if (id !== null) this.fail('commit', `an empty sketch was kept as feature ${id}`)
      return
    }
    if (id === null) {
      this.fail('commit', 'commitSketch returned null for a sketch with pieces')
      return
    }
    const f = s().features.find((x) => x.id === id)
    if (!f || f.kind !== 'sketch') {
      this.fail('commit', `feature ${id} is not a sketch in the list`)
      return
    }
    {
      const d = sketchDiff(f.sketch, kept)
      if (d) this.mismatch('commit-differs', d, showDiff(d))
    }
    this.calls.push('s().editSketch(id)')
    try {
      s().editSketch(id)
    } catch (e) {
      this.fail('exception', `editSketch: ${String(e)}`)
      return
    }
    const again = s().sketchDraft
    if (!again || again.featureId !== id) {
      this.fail('edit', 'editSketch did not reopen the sketch')
      return
    }
    const d = sketchDiff(again.sketch, kept)
    if (d) this.mismatch('reopen-differs', d, showDiff(d))
    this.stepType = 'reopened'
    this.invariants()
  }
}

// ---- generating a workflow -----------------------------------------------------

class Gen {
  constructor(readonly rng: () => number) {}
  u(a: number, b: number): number {
    return a + (b - a) * this.rng()
  }
  i(a: number, b: number): number {
    return Math.floor(this.u(a, b + 1))
  }
  chance(p: number): boolean {
    return this.rng() < p
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.rng() * xs.length)]
  }
  anchors(): V[] {
    const d = s().sketchDraft
    if (!d) return []
    return d.sketch.entities.flatMap((e) => anchorsOf(e).map((at) => anchorPoint(e, at) as V))
  }
  base(): V {
    const r = this.rng()
    const anchors = this.anchors()
    if (r < 0.05) return [0, 0]
    if (r < 0.15) return [Math.round(this.u(-200, 200)), Math.round(this.u(-200, 200))]
    if (r < 0.3 && anchors.length) return [...this.pick(anchors)] as V
    if (r < 0.36 && anchors.length) {
      const a = this.pick(anchors)
      const e = this.pick([1e-9, 1e-6, 1e-4, 0.01])
      return [a[0] + e, a[1] - e]
    }
    return [this.u(-200, 200), this.u(-200, 200)]
  }
  next(prev: V): V {
    const r = this.rng()
    const dir = (len: number, ang = this.u(0, 2 * Math.PI)): V => [prev[0] + len * Math.cos(ang), prev[1] + len * Math.sin(ang)]
    if (r < 0.06) return [prev[0], prev[1]]
    if (r < 0.12) return dir(this.pick([1e-9, 1e-7, 1e-5, 1e-3]))
    if (r < 0.2) return dir(0.01)
    if (r < 0.27) return dir(5000)
    if (r < 0.4) return dir(this.u(1, 200), (this.i(0, 3) * Math.PI) / 2 + (this.u(-4, 4) * Math.PI) / 180)
    const anchors = this.anchors()
    if (r < 0.48 && anchors.length) return [...this.pick(anchors)] as V
    return dir(this.u(0.5, 200))
  }
  points(n: number): V[] {
    const out: V[] = [this.base()]
    while (out.length < n) out.push(this.chance(0.15) ? this.base() : this.next(out[out.length - 1]))
    return out
  }
  onPiece(e: SketchEntity): V {
    const t = this.u(0.2, 0.8)
    switch (e.kind) {
      case 'line':
        return [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t]
      case 'circle': {
        const a = this.u(0, 2 * Math.PI)
        return [e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]
      }
      case 'arc': {
        const a = e.start + e.sweep * t
        return [e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)]
      }
      case 'spline':
        return [...this.pick(e.pts)] as V
      case 'point':
        return [e.p[0], e.p[1]]
    }
  }
  picks(): Pick[] | undefined {
    const d = s().sketchDraft
    if (!d || d.sketch.entities.length === 0) return undefined
    const n = this.i(1, 3)
    const out: Pick[] = []
    for (let k = 0; k < n; k++) out.push({ p: this.chance(0.08) ? [this.u(-300, 300), this.u(-300, 300)] : this.onPiece(this.pick(d.sketch.entities)), additive: k > 0 })
    return out
  }
  step(): Step {
    const d = s().sketchDraft!
    const lines = d.sketch.entities.filter((e) => e.kind === 'line')
    const snap = this.chance(0.35)
    const table: [number, () => Step | null][] = [
      [10, () => ({ t: 'line', pts: this.points(2), snap })],
      [12, () => {
        const pts = this.points(this.i(2, 5))
        const end = this.pick(['sameRaw', 'sameEnd', 'escape', 'none', 'tangent'] as const)
        return { t: 'polyline', pts, end, ...(end === 'tangent' ? { tan: this.next(pts[pts.length - 1]) } : {}), snap }
      }],
      [10, () => {
        const mode = this.pick(['corners', 'center', 'threePoint'] as const)
        return { t: 'rectangle', mode, pts: this.points(mode === 'threePoint' ? 3 : 2), snap }
      }],
      [8, () => {
        const mode = this.pick(['center', 'twoPoint', 'threePoint'] as const)
        return { t: 'circle', mode, pts: this.points(mode === 'threePoint' ? 3 : 2), snap }
      }],
      [8, () => ({ t: 'arc', mode: this.pick(['threePoint', 'center'] as const), pts: this.points(3), snap })],
      [6, () => ({ t: 'polygon', mode: this.pick(['inscribed', 'circumscribed'] as const), sides: this.pick([3, 4, 5, 6, 6, 8, 12, 2, 64]), pts: this.points(2), snap })],
      [8, () => ({ t: 'spline', pts: this.points(this.i(1, 6)), end: this.pick(['enter', 'double', 'close', 'escape'] as const), snap })],
      [5, () => ({ t: 'slot', pts: this.points(3) })],
      [5, () => {
        if (lines.length === 0) return null
        const line = this.pick(lines) as Extract<SketchEntity, { kind: 'line' }>
        const at = this.pick(['a', 'b'] as const)
        const others = lines.filter((l) => l.id !== line.id) as Extract<SketchEntity, { kind: 'line' }>[]
        if (others.length && this.chance(0.3)) {
          const o = this.pick(others)
          const oat = this.pick(['a', 'b'] as const)
          return { t: 'tangentArc', line: line.id, at, to: [o[oat][0], o[oat][1]], end: { entity: o.id, at: oat } }
        }
        return { t: 'tangentArc', line: line.id, at, to: this.next([line[at][0], line[at][1]]) }
      }],
      [4, () => {
        if (lines.length < 2) return null
        const a = this.pick(lines)
        const b = this.pick(lines.filter((l) => l.id !== a.id))
        return { t: 'middle', a: a.id, b: b.id }
      }],
      [8, () => {
        const picks = this.picks()
        return picks ? { t: 'select', picks } : null
      }],
      [4, () => ({ t: 'duplicate', delta: this.pick<V>([[10, 0], [this.u(-200, 200), this.u(-200, 200)], [0, 0], [0.01, 0], [5000, 5000]]), picks: d.selection.length && this.chance(0.5) ? undefined : this.picks() })],
      [4, () => ({ t: 'offset', distance: this.pick([1, -1, 0.01, 10, -10, 5000, 0]), picks: d.selection.length && this.chance(0.5) ? undefined : this.picks() })],
      [6, () => ({ t: 'delete', picks: d.selection.length && this.chance(0.5) ? undefined : this.picks() })],
      [4, () => ({ t: 'construction', picks: d.selection.length && this.chance(0.5) ? undefined : this.picks() })],
      [10, () => ({ t: 'undo' })],
      [6, () => ({ t: 'redo' })],
      [3, () => ({ t: 'escape' })],
    ]
    const total = table.reduce((a, [w]) => a + w, 0)
    for (;;) {
      let r = this.rng() * total
      for (const [w, make] of table) {
        r -= w
        if (r <= 0) {
          const st = make()
          if (st) return st
          break
        }
      }
    }
  }
}

const RADII = [0.05, 0.5, 0.5, 0.5, 3]

/** A fresh workflow from its seed, generated as it runs. */
const stepTime = new Map<string, [number, number]>()
/** The slowest single steps seen, with their seed and what they were. */
const slowest: { ms: number; seed: number; what: string }[] = []
let timingSeed = 0
function timed(key: string, fn: () => void, what = key): void {
  const t = performance.now()
  fn()
  const ms = performance.now() - t
  const [n, total] = stepTime.get(key) ?? [0, 0]
  stepTime.set(key, [n + 1, total + ms])
  if (slowest.length < 8 || ms > slowest[slowest.length - 1].ms) {
    slowest.push({ ms, seed: timingSeed, what })
    slowest.sort((a, b) => b.ms - a.ms)
    slowest.length = Math.min(slowest.length, 8)
  }
}

function generate(seed: number): { steps: Step[]; radius: number; result: RunResult } {
  timingSeed = seed
  const g = new Gen(mulberry32(seed))
  const radius = g.pick(RADII)
  const n = g.i(4, 15)
  const runner = new Runner(radius)
  runner.start()
  const steps: Step[] = []
  for (let k = 0; k < n; k++) {
    const st = g.step()
    steps.push(st)
    runner.step = k
    runner.stepType = st.t
    runner.desc = describeStep(st)
    timed(st.t, () => runner.run(st), `step ${k}: ${describeStep(st).slice(0, 160)}`)
  }
  timed('final', () => runner.finish(), `final undo-all / redo-all / commit / reopen of ${s().sketchDraft?.sketch.entities.length ?? 0} pieces`)
  return { steps, radius, result: runner }
}

function replay(steps: readonly Step[], radius: number): RunResult {
  const runner = new Runner(radius)
  runner.start()
  steps.forEach((st, k) => {
    runner.step = k
    runner.stepType = st.t
    runner.desc = describeStep(st)
    runner.run(st)
  })
  runner.finish()
  return runner
}

/** Mismatches carry their class in the check and are one fault wherever they
 *  show; anything else is told apart by the step it showed in. */
/** Failure signatures already reported and not yet fixed. (The double click
 *  that drew a stub instead of ending a polyline was fixed in 1.2.10.) */
const KNOWN: RegExp[] = []

const signatureOf = (f: Failure) => (f.check.includes('|') ? f.check : `${f.check} @ ${f.stepType}`)

/** The fewest steps (and points within them) that still fail the same way. */
function shrink(steps: Step[], radius: number, sig: string): Step[] {
  const fails = (xs: Step[]) => replay(xs, radius).failures.some((f) => signatureOf(f) === sig)
  let cur = steps
  for (let changed = true, rounds = 0; changed && rounds < 20; rounds++) {
    changed = false
    for (let i = cur.length - 1; i >= 0; i--) {
      const next = cur.filter((_, k) => k !== i)
      if (fails(next)) {
        cur = next
        changed = true
      }
    }
    for (let i = 0; i < cur.length; i++) {
      const st = cur[i]
      if (st.t === 'polyline' || st.t === 'spline') {
        for (let j = st.pts.length - 1; j >= 0 && st.pts.length > 1; j--) {
          const smaller = { ...st, pts: st.pts.filter((_, k) => k !== j) }
          const next = cur.map((x, k) => (k === i ? smaller : x))
          if (fails(next)) {
            cur = next
            changed = true
            break
          }
        }
      }
      if ('picks' in st && st.picks && st.picks.length > 1) {
        for (let j = st.picks.length - 1; j >= 0; j--) {
          const smaller = { ...st, picks: st.picks.filter((_, k) => k !== j).map((p, k) => ({ ...p, additive: k > 0 })) }
          const next = cur.map((x, k) => (k === i ? smaller : x)) as Step[]
          if (fails(next)) {
            cur = next
            changed = true
            break
          }
        }
      }
    }
  }
  return cur
}

/** Every number in an anchor-bearing constraint's anchors. */
function anchorsIn(c: Constraint): { entity: number; at: string }[] {
  const out: { entity: number; at: string }[] = []
  for (const key of ['p', 'q'] as const) {
    const a = (c as unknown as Record<string, unknown>)[key]
    if (a && typeof a === 'object' && 'entity' in a && 'at' in a) out.push(a as { entity: number; at: string })
  }
  return out
}

function validAnchor(e: SketchEntity, at: string): boolean {
  if ((anchorsOf(e) as string[]).includes(at)) return true
  if (at === 'center') return e.kind !== 'spline'
  if (at === 'p0') return e.kind === 'arc'
  return false
}

// ---- the tests -----------------------------------------------------------------

const WORKFLOWS = Number(process.env.FUZZ_WORKFLOWS ?? 1500)
const CHUNK = 10
const SEED0 = Number(process.env.FUZZ_SEED ?? 1)

describe('2D Sketch drawing and history, seeded random workflows', () => {
  // Gathered across the chunks, reported by the last test.
  const groups = new Map<string, { count: number; first: { seed: number; steps: Step[]; radius: number; failure: Failure } }>()
  const warnings = new Map<string, { count: number; example: string; seed: number }>()
  const errors = new Map<string, number>()
  const drift = new Map<string, number>()
  let steps = 0
  let clicks = 0
  let failedRuns = 0
  let ran = 0
  const t0 = Date.now()

  // Chunks of ten: a long synchronous test starves vitest's worker RPC.
  for (let c = 0; c < WORKFLOWS; c += CHUNK) {
    const from = SEED0 + c
    const to = SEED0 + Math.min(WORKFLOWS, c + CHUNK) - 1
    it(`workflows seeded ${from}..${to}`, async () => {
      for (let seed = from; seed <= to; seed++) {
        // Let vitest's worker answer its RPC between workflows.
        await new Promise((r) => setTimeout(r, 0))
        const { steps: st, radius, result } = generate(seed)
        ran++
        steps += st.length
        clicks += result.clicks
        for (const [m, n] of result.errors) errors.set(m, (errors.get(m) ?? 0) + n)
        for (const [k, v] of result.drift) drift.set(k, Math.max(drift.get(k) ?? 0, v))
        for (const x of result.warnings) {
          const g = warnings.get(x.kind)
          if (g) g.count++
          else warnings.set(x.kind, { count: 1, example: x.detail, seed })
        }
        if (result.failures.length) failedRuns++
        const seen = new Set<string>()
        for (const f of result.failures) {
          const sig = signatureOf(f)
          if (seen.has(sig)) continue
          seen.add(sig)
          const g = groups.get(sig)
          if (g) {
            g.count++
            if (st.length < g.first.steps.length) g.first = { seed, steps: st, radius, failure: f }
          } else groups.set(sig, { count: 1, first: { seed, steps: st, radius, failure: f } })
        }
      }
    }, 600_000)
  }

  it('reports the failures, shrunk, and finds none but the known ones', () => {
    const WORKFLOWS = ran
    const lines: string[] = []
    lines.push(`workflows ${WORKFLOWS} (seeds ${SEED0}..${SEED0 + WORKFLOWS - 1}), steps ${steps}, clicks ${clicks}`)
    lines.push(`workflows passing ${WORKFLOWS - failedRuns}, failing ${failedRuns}; distinct failure signatures ${groups.size}; run ${((Date.now() - t0) / 1000).toFixed(1)} s`)
    for (const [k, v] of drift) lines.push(`   largest drift seen in ${k}: ${v.toExponential(2)} mm`)
    for (const [sig, g] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
      const small = shrink(g.first.steps, g.first.radius, sig)
      const again = replay(small, g.first.radius)
      const f = again.failures.find((x) => signatureOf(x) === sig) ?? g.first.failure
      lines.push('')
      lines.push(`== ${sig}  (${g.count} workflows; first seed ${g.first.seed}, radius ${g.first.radius})`)
      lines.push(`   ${f.detail}`)
      lines.push(`   minimal steps (${small.length}):`)
      small.forEach((x, k) => lines.push(`     ${k}. ${describeStep(x)}`))
      lines.push('   store calls:')
      for (const c of again.calls) lines.push(`     ${c}`)
    }
    lines.push('')
    lines.push(`shrinking took ${((Date.now() - t0) / 1000).toFixed(1)} s in all`)
    lines.push(`time per step kind: ${[...stepTime].sort((a, b) => b[1][1] - a[1][1]).map(([k, [n, ms]]) => `${k} ${n}x ${(ms / n).toFixed(1)}ms`).join(', ')}`)
    lines.push('slowest single steps:')
    for (const x of slowest) lines.push(`   ${(x.ms / 1000).toFixed(2)} s  seed ${x.seed}  ${x.what}`)
    lines.push('geometry and relation violations:')
    for (const [k, g] of [...warnings].sort((a, b) => b[1].count - a[1].count)) lines.push(`   ${g.count}x ${k}  e.g. seed ${g.seed}: ${g.example.slice(0, 200)}`)
    lines.push('')
    lines.push('messages shown to the user (draft.error):')
    for (const [m, n] of [...errors].sort((a, b) => b[1] - a[1])) lines.push(`   ${n}x ${m}`)
    const report = lines.join('\n')
    console.log(report)
    if (process.env.FUZZ_REPORT) writeFileSync(process.env.FUZZ_REPORT, report)
    expect(steps).toBeGreaterThan(0)
    // The faults already reported (KNOWN): anything else is new and fails
    // the run.
    const unknown = [...groups.keys()].filter((sig) => !KNOWN.some((k) => k.test(sig)))
    expect(unknown).toEqual([])
    expect([...warnings.keys()]).toEqual([])
  }, 1_800_000)
})

// The faults the harness found, each reduced to its few store calls and kept
// as a plain check once fixed.
describe('2D Sketch faults found by the random workflows', () => {
  // Fixed in 1.2.10: the second click was compared with the end where the
  // solver had levelled it, not with the spot the hand clicked.
  it('a double click ends a polyline even after a nearly level segment moved its end', () => {
    resetStore()
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    useSketchPresentation.getState().setLineChain(true)
    activateSketchTool('line')
    s().sketchClick([10, 10], 0.5, false, SNAP)
    s().sketchClick([110, 13], 0.5, false, SNAP) // 1.7 degrees: made horizontal, the end moves 1.5 mm
    s().sketchClick([110, 13], 0.5, false, SNAP) // the second click of the double click
    expect(s().sketchDraft!.sketch.entities).toHaveLength(1)
    expect(s().sketchDraft!.pending).toEqual([])
  })

  // Found drifting by up to 4.7e-7 mm (and once 0.16 mm) before
  // restoreSettled (reSketchDraft.ts) stopped Undo / Redo / Edit solving the
  // kept sketch again; kept as a plain check.
  it('undo puts back exactly the sketch the step started from', () => {
    resetStore()
    s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
    activateSketchTool('line')
    s().sketchClick([10, 10], 0.5, false, OFF)
    s().sketchClick([110, 13], 0.5, false, OFF)
    s().setSketchTool('line')
    const before = structuredClone(s().sketchDraft!.sketch)
    useRePrefs.getState().setDrawMode('rectangle', 'threePoint')
    activateSketchTool('rectangle')
    s().sketchClick([0, 0], 0.5, false, OFF)
    s().sketchClick([50, 20], 0.5, false, OFF)
    s().sketchClick([40, 60], 0.5, false, OFF)
    s().undoSketch()
    expect(body(s().sketchDraft!.sketch)).toStrictEqual(body(before))
  })
})
