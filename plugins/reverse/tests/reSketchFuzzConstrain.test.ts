// SPDX-License-Identifier: AGPL-3.0-only
// The 2D Sketch's relations, dimensions and dragging driven at random, as a
// user drives them: seeded workflows through the real store (useReverse),
// each a few shapes drawn with the drawing tools and then 5–20 steps of
// relations (by the selection and the panel's buttons, or in hand with
// clicks), dimensions (the Dimension tool's clicks, the selection's
// Dimensions button, a typed value in the panel), drags of ends, centres and
// whole pieces, constraint removals, Escape, undo and redo. After every
// store call the sketch is checked against what a CAD sketcher promises —
// every number finite, every relation pointing at pieces that exist, every
// relation met to 1e-6 when the solve says so (measured here, not by the
// solver), a refusal leaving the sketch as it was with a sentence to read,
// a fixed piece where it was, a drag that leaves what was met met. At the
// end undo all goes back to the empty sheet, redo all to the last state, and
// a Finish and an Edit give back the same sketch.
//
// Failures are grouped by signature and each is shrunk (ddmin over steps,
// then over calls) to a short sequence of store calls that still shows it.
// The summary goes to the console and to RE_FUZZ_CONSTRAIN_OUT (default:
// the OS temp folder). The test fails only on a broken harness unless
// RE_FUZZ_CONSTRAIN_STRICT=1, when any product failure fails it.
// RE_FUZZ_CONSTRAIN_N sets the number of workflows (default 1500).

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { useReverse } from '../state/reStore'
import { useRePrefs } from '../state/rePrefs'
import { DEFAULT_DRAW_MODES, setCircularDimensioning } from '../core/draw'
import { fixId, type Constraint, type Sketch, type SketchEntity } from '../core/sketch'
import { XY } from './reKit'
import {auditDistance} from './sketchDistanceOracle'

vi.setConfig({ testTimeout: 4 * 3600_000 })

type V2 = [number, number]
const s = () => useReverse.getState()
const draft = () => s().sketchDraft
const R = 0.5 // the pick radius, sheet millimetres, as the store tests use
const MAX_HISTORY = 40
const WORKFLOWS = Number(process.env.RE_FUZZ_CONSTRAIN_N ?? 1500)
const SEED0 = Number(process.env.RE_FUZZ_CONSTRAIN_SEED ?? 1)
const PLANE = { kind: 'world', axis: 'z', offset: 0 } as const

// ---- seeded random -----------------------------------------------------------

/** mulberry32: the same numbers for the same seed, everywhere. */
function random(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n: number) => Math.floor(next() * n),
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
    weighted: <T extends string>(w: Record<T, number>): T => {
      const keys = Object.keys(w) as T[]
      const total = keys.reduce((t, k) => t + w[k], 0)
      let x = next() * total
      for (const k of keys) {
        x -= w[k]
        if (x < 0) return k
      }
      return keys[keys.length - 1]
    },
  }
}
type Rng = ReturnType<typeof random>

// ---- independent geometry (not the product's helpers) --------------------------

const TWO_PI = 2 * Math.PI
const mod = (x: number, m: number) => ((x % m) + m) % m
const sub = (p: V2, q: V2): V2 => [p[0] - q[0], p[1] - q[1]]
const hyp = (v: V2) => Math.hypot(v[0], v[1])
const dist = (p: V2, q: V2) => hyp(sub(p, q))
const cross = (u: V2, v: V2) => u[0] * v[1] - u[1] * v[0]
const dot = (u: V2, v: V2) => u[0] * v[0] + u[1] * v[1]
const unit = (v: V2): V2 | null => {
  const l = hyp(v)
  return l > 1e-15 ? [v[0] / l, v[1] / l] : null
}

/** Where an anchor of a piece lies — written out here, not taken from the
 *  sketch module, so the check does not share the product's mistakes. */
function anchorAt(e: SketchEntity | undefined, at: string): V2 | null {
  if (!e) return null
  if ((e.kind === 'circle' || e.kind === 'arc') && /^q[0-3]$/.test(at)) {
    const [dx, dy] = [[1,0], [0,1], [-1,0], [0,-1]][Number(at[1])]
    return [e.c[0] + dx * e.r, e.c[1] + dy * e.r]
  }
  switch (e.kind) {
    case 'line':
      return at === 'a' ? e.a : at === 'b' ? e.b : at === 'center' ? [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2] : null
    case 'arc': {
      if (at === 'center') return e.c
      const t = at === 'a' ? e.start : at === 'b' ? e.start + e.sweep : at === 'p0' ? e.start + e.sweep * (e.gripT ?? 0.5) : null
      return t === null ? null : [e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)]
    }
    case 'circle':
      return at === 'center' ? e.c : null
    case 'point':
      return at === 'center' ? e.p : null
    default:
      return null
  }
}

/** A coordinate plane's line in the XY sheet: YZ is x = 0, XZ is y = 0, the
 *  XY plane lies parallel to the sheet and has none. */
function datumOffset(plane: string, p: V2): number | null {
  return plane === 'yz' ? p[0] : plane === 'zx' ? p[1] : null
}

function ids(c: Constraint): number[] {
  const x = c as unknown as Record<string, unknown>
  const out: number[] = []
  for (const k of ['entity', 'a', 'b', 'line']) if (typeof x[k] === 'number') out.push(x[k] as number)
  for (const k of ['p', 'q']) {
    const v = x[k] as Record<string, unknown> | undefined
    if (v && typeof v.entity === 'number') out.push(v.entity)
    if (v && typeof v.line === 'number') out.push(v.line)
  }
  const on = x.on as Record<string, unknown> | undefined
  if (on && typeof on.line === 'number') out.push(on.line)
  if (on && typeof on.curve === 'number') out.push(on.curve)
  const about = x.about as Record<string, unknown> | string | undefined
  if (about && typeof about === 'object' && typeof about.line === 'number') out.push(about.line)
  return out
}

function sketchScale(sk: Sketch): number {
  let m = 1
  for (const e of sk.entities) {
    const pts: V2[] = e.kind === 'line' ? [e.a, e.b] : e.kind === 'arc' || e.kind === 'circle' ? [e.c] : e.kind === 'point' ? [e.p] : []
    for (const p of pts) m = Math.max(m, Math.abs(p[0]), Math.abs(p[1]))
    if (e.kind === 'arc' || e.kind === 'circle') m = Math.max(m, Math.abs(e.r))
  }
  return m
}

/** The display value a dimension reads on the geometry as it is (degrees for
 *  an angle), or null where it cannot be read. */
function dimensionReads(sk: Sketch, c: Constraint): number | null {
  const E = new Map(sk.entities.map((e) => [e.id, e]))
  const lineOf = (id: number) => {
    const e = E.get(id)
    return e && e.kind === 'line' ? e : null
  }
  switch (c.kind) {
    case 'length': {
      const l = lineOf(c.entity)
      return l ? dist(l.a, l.b) : null
    }
    case 'radius':
    case 'diameter': {
      const e = E.get(c.entity)
      if (!e || (e.kind !== 'arc' && e.kind !== 'circle')) return null
      return c.kind === 'radius' ? e.r : 2 * e.r
    }
    case 'distance': {
      return auditDistance(sk,c)
    }
    case 'angle': {
      const la = lineOf(c.a)
      const lb = lineOf(c.b)
      if (!la || !lb) return null
      const ta = Math.atan2(la.b[1] - la.a[1], la.b[0] - la.a[0])
      const tb = Math.atan2(lb.b[1] - lb.a[1], lb.b[0] - lb.a[0])
      if (c.sector) {
        // The ray sa·dirA to the ray sb·dirB, counter-clockwise; flipped, the
        // other way round.
        const ra = ta + (c.sector.sa < 0 ? Math.PI : 0)
        const rb = tb + (c.sector.sb < 0 ? Math.PI : 0)
        const psi = mod(rb - ra, TWO_PI)
        return (mod(c.sector.flip ? -psi : psi, TWO_PI) * 180) / Math.PI
      }
      return (mod(tb - ta, Math.PI) * 180) / Math.PI
    }
    default:
      return null
  }
}

/** How far each relation and dimension is from being met, measured on the
 *  geometry: millimetres ('len') or radians ('ang'). */
function residuals(sk: Sketch): { c: Constraint; res: number; unit: 'len' | 'ang' }[] {
  const E = new Map(sk.entities.map((e) => [e.id, e]))
  const out: { c: Constraint; res: number; unit: 'len' | 'ang' }[] = []
  const P = (a: { entity: number; at: string }) => anchorAt(E.get(a.entity), a.at)
  const lineOf = (id: number) => {
    const e = E.get(id)
    return e && e.kind === 'line' ? e : null
  }
  const dirOf = (id: number) => {
    const l = lineOf(id)
    return l ? unit(sub(l.b, l.a)) : null
  }
  const round = (e: SketchEntity | undefined) => (e && (e.kind === 'arc' || e.kind === 'circle') ? e : null)
  const push = (c: Constraint, res: number | null, u: 'len' | 'ang' = 'len') => {
    if (res !== null) out.push({ c, res: Number.isFinite(res) ? Math.abs(res) : Infinity, unit: u })
  }
  for (const c of sk.constraints) {
    switch (c.kind) {
      case 'coincident': {
        const p = P(c.p)
        const q = P(c.q)
        push(c, p && q ? dist(p, q) : null)
        break
      }
      case 'horizontal':
      case 'vertical': {
        const l = lineOf(c.entity)
        push(c, l ? (c.kind === 'horizontal' ? l.b[1] - l.a[1] : l.b[0] - l.a[0]) : null)
        break
      }
      case 'parallel':
      case 'perpendicular': {
        const da = dirOf(c.a)
        const db = dirOf(c.b)
        push(c, da && db ? (c.kind === 'parallel' ? cross(da, db) : dot(da, db)) : null, 'ang')
        break
      }
      case 'angle': {
        const v = dimensionReads(sk, c)
        if (v === null) break
        const diff = ((v - c.value) * Math.PI) / 180
        // A folded angle repeats every half turn; a sector's every turn.
        const period = c.sector ? TWO_PI : Math.PI
        push(c, mod(diff + period / 2, period) - period / 2, 'ang')
        break
      }
      case 'tangent': {
        const ea = E.get(c.a)
        const eb = E.get(c.b)
        const line = ea?.kind === 'line' ? ea : eb?.kind === 'line' ? eb : null
        const ra = round(ea)
        const rb = round(eb)
        if (line && (ra || rb)) {
          const r = (ra ?? rb)!
          const d = unit(sub(line.b, line.a))
          push(c, d ? Math.abs(cross(d, sub(r.c, line.a))) - r.r : null)
        } else if (ra && rb) {
          const D = dist(ra.c, rb.c)
          push(c, Math.min(Math.abs(D - (ra.r + rb.r)), Math.abs(D - Math.abs(ra.r - rb.r))))
        }
        break
      }
      case 'equal': {
        const ea = E.get(c.a)
        const eb = E.get(c.b)
        if (ea?.kind === 'line' && eb?.kind === 'line') push(c, dist(ea.a, ea.b) - dist(eb.a, eb.b))
        else if (round(ea) && round(eb)) push(c, round(ea)!.r - round(eb)!.r)
        break
      }
      case 'concentric': {
        const ea = round(E.get(c.a))
        const eb = round(E.get(c.b))
        push(c, ea && eb ? dist(ea.c, eb.c) : null)
        break
      }
      case 'pointOn': {
        const p = P(c.p)
        if (!p) break
        if ('datum' in c.on) {
          push(c, datumOffset(c.on.datum, p))
        } else if ('line' in c.on) {
          const l = lineOf(c.on.line)
          const d = l ? unit(sub(l.b, l.a)) : null
          if (l && d) {
            push(c, cross(d, sub(p, l.a)))
            if (c.bounded) {
              const t = dot(d, sub(p, l.a))
              const L = dist(l.a, l.b)
              push(c, t < 0 ? t : t > L ? t - L : 0)
            }
          }
        } else {
          const e = round(E.get(c.on.curve))
          if (e) {
            push(c, dist(p, e.c) - e.r)
            if (c.bounded && e.kind === 'arc' && e.sweep < TWO_PI) {
              const along = mod(Math.atan2(p[1] - e.c[1], p[0] - e.c[0]) - e.start, TWO_PI)
              if (along > e.sweep) push(c, Math.min(along - e.sweep, TWO_PI - along) * e.r)
            }
          }
        }
        break
      }
      case 'collinear': {
        const l = lineOf(c.line)
        if (!l) break
        if ('datum' in c.on) {
          const plane = c.on.datum
          const a = datumOffset(plane, l.a)
          const b = datumOffset(plane, l.b)
          push(c, a === null || b === null ? null : Math.max(Math.abs(a), Math.abs(b)))
        } else {
          const m = lineOf(c.on.line)
          const d = m ? unit(sub(m.b, m.a)) : null
          push(c, m && d ? Math.max(Math.abs(cross(d, sub(l.a, m.a))), Math.abs(cross(d, sub(l.b, m.a)))) : null)
        }
        break
      }
      case 'symmetric': {
        const p = P(c.p)
        const q = P(c.q)
        if (!p || !q) break
        const about = c.about
        let a: V2 | null = null
        let d: V2 | null = null
        if (about === 'x') {
          a = [0, 0]
          d = [1, 0]
        } else if (about === 'y') {
          a = [0, 0]
          d = [0, 1]
        } else if ('line' in about) {
          const l = lineOf(about.line)
          a = l ? l.a : null
          d = l ? unit(sub(l.b, l.a)) : null
        } else if (about.datum === 'yz') {
          a = [0, 0]
          d = [0, 1]
        } else if (about.datum === 'zx') {
          a = [0, 0]
          d = [1, 0]
        }
        if (!a || !d) break
        const mid: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
        push(c, Math.max(Math.abs(cross(d, sub(mid, a))), Math.abs(dot(d, sub(q, p)))))
        break
      }
      case 'length':
      case 'radius':
      case 'diameter':
      case 'distance': {
        const v = dimensionReads(sk, c)
        push(c, v === null ? null : v - c.value)
        break
      }
    }
  }
  return out
}

/** The worst relation, against the 1e-6 relative tolerance. */
function violations(sk: Sketch): { c: Constraint; res: number; unit: 'len' | 'ang' }[] {
  const S = sketchScale(sk)
  return residuals(sk).filter((r) => r.res > (r.unit === 'len' ? 1e-6 * S : 1e-6))
}

function finiteDeep(x: unknown): boolean {
  if (typeof x === 'number') return Number.isFinite(x)
  if (Array.isArray(x)) return x.every(finiteDeep)
  if (x && typeof x === 'object') return Object.values(x).every(finiteDeep)
  return true
}

const quadrants = ['q0', 'q1', 'q2', 'q3']
const VALID_AT: Record<string, string[]> = { line: ['a', 'b', 'center'], arc: ['a', 'b', 'center', 'p0', ...quadrants], circle: ['center', ...quadrants], point: ['center'] }

/** The largest numeric difference between two values of the same shape, or
 *  Infinity where their shapes differ. */
function maxDev(x: unknown, y: unknown): number {
  if (typeof x === 'number' && typeof y === 'number') return x === y ? 0 : Math.abs(x - y)
  if (Array.isArray(x) && Array.isArray(y)) {
    if (x.length !== y.length) return Infinity
    return x.reduce((m: number, v, i) => Math.max(m, maxDev(v, y[i])), 0)
  }
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    const kx = Object.keys(x).sort()
    const ky = Object.keys(y).sort()
    if (kx.join() !== ky.join()) return Infinity
    return kx.reduce((m, k) => Math.max(m, maxDev((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k])), 0)
  }
  return x === y ? 0 : Infinity
}

const geometryOf = (e: SketchEntity) => JSON.stringify([e.kind, 'a' in e ? e.a : 0, 'b' in e ? e.b : 0, 'c' in e ? e.c : 0, 'r' in e ? e.r : 0, 'start' in e ? e.start : 0, 'sweep' in e ? e.sweep : 0, 'p' in e ? e.p : 0])

/** A piece's size: a line's length, a round piece's radius. */
function size(e: SketchEntity): number {
  if (e.kind === 'line') return dist(e.a, e.b)
  if (e.kind === 'circle' || e.kind === 'arc') return e.r
  return 1
}

function degenerate(e: SketchEntity): boolean {
  if (e.kind === 'line') return dist(e.a, e.b) < 1e-9
  if (e.kind === 'circle') return !(e.r > 1e-9)
  if (e.kind === 'arc') return !(e.r > 1e-9) || !(e.sweep > 1e-9)
  return false
}

// ---- recorder, checker -------------------------------------------------------

type Call = { m: string; a: unknown[] }
type Step = { label: string; calls: Call[] }
type Failure = { sig: string; detail: string; step: number; call: number }

const REMOVERS = new Set(['removeSelectedConstraint', 'undoSketch', 'redoSketch', 'deleteSelected'])
const FIX_CHANGERS = new Set(['undoSketch', 'redoSketch', 'toggleFixedSelected', 'removeSelectedConstraint'])
const RESTORERS = new Set(['undoSketch', 'redoSketch', 'editSketch'])
const INTENT = new Set(['addRelation', 'addDimension', 'toggleFixedSelected', 'dimensionSelection', 'setDimensionForm', 'removeSelectedConstraint', 'setDimensionValue'])

interface Snap {
  json: string
  sketch: Sketch
  error: string | null
  hist: number
  histLast: string | null
  futLast: string | null
  report: NonNullable<ReturnType<typeof draft>>['report']
  dimMade: number | null
  tool: string
  armed: string | null
  selection: string
}

function snap(): Snap | null {
  const d = draft()
  if (!d) return null
  const json = JSON.stringify(d.sketch)
  return {
    json,
    sketch: JSON.parse(json),
    error: d.error,
    hist: d.history.length,
    histLast: d.history.length ? JSON.stringify(d.history[d.history.length - 1]) : null,
    futLast: d.future?.length ? JSON.stringify(d.future[d.future.length - 1]) : null,
    report: d.report,
    dimMade: d.dimMade ?? null,
    tool: d.tool,
    armed: d.armedRelation ?? null,
    selection: JSON.stringify(d.selection),
  }
}

const show = (x: unknown) => JSON.stringify(x)
const describeC = (c: Constraint) => {
  const { id: _id, place: _place, ...rest } = c as Constraint & { place?: unknown }
  void _id
  void _place
  return JSON.stringify(rest)
}

/** How far a restored sketch strays: within the 1e-6 relative tolerance
 *  ('drift'), or visibly ('moved'). */
function magnitude(dev: number, sk: Sketch): string {
  return dev <= 1e-6 * sketchScale(sk) ? 'drift' : 'moved'
}

/** Whether the target sketch of an undo or redo is one whose relations are
 *  all met — what the store may hand back untouched. */
function metTag(json: string | null): string {
  if (!json) return 'none'
  return violations(JSON.parse(json)).length === 0 ? 'met' : 'unmet'
}

const softErrors = new Map<string, { count: number; methods: Set<string>; example: string }>()

class Runner {
  steps: Step[] = []
  failures: Failure[] = []
  ux: Failure[] = []
  callsRun = 0
  private stepIndex = -1
  private callIndex = 0
  overflowed = false
  S0 = ''
  drag: { before: Snap; snap: boolean } | null = null
  private seen = new Set<string>()

  begin(label: string) {
    this.steps.push({ label, calls: [] })
    this.stepIndex = this.steps.length - 1
    this.callIndex = 0
  }

  fail(sig: string, detail: string) {
    if (this.seen.has(sig)) return
    this.seen.add(sig)
    ;(sig.startsWith('ux:') ? this.ux : this.failures).push({ sig, detail, step: this.stepIndex, call: this.callIndex })
  }

  call(m: string, ...a: unknown[]): unknown {
    const args = a.map((x) => (x === '$sel' ? (draft()?.selectedConstraint ?? null) : x))
    const before = snap()
    let ret: unknown
    let threw: unknown = null
    try {
      ret = (s() as unknown as Record<string, (...x: unknown[]) => unknown>)[m](...args)
    } catch (e) {
      threw = e
    }
    if (this.stepIndex >= 0) this.steps[this.stepIndex].calls.push({ m, a })
    this.callsRun++
    this.check(m, args, before, ret, threw)
    this.callIndex++
    return ret
  }

  private check(m: string, args: unknown[], before: Snap | null, ret: unknown, threw: unknown) {
    const where = `${m}(${args.map((x) => show(x)).join(', ')})`
    if (threw) this.fail(`exception:${m}`, `${where} threw ${threw instanceof Error ? threw.message : String(threw)}`)
    const d = draft()
    if (!d || !before) return
    const sk = d.sketch
    const json = JSON.stringify(sk)
    if (d.history.length >= MAX_HISTORY) this.overflowed = true

    if (!finiteDeep(sk)) this.fail(`non-finite:${m}`, `${where} left a number that is not finite: ${json.slice(0, 400)}`)
    const E = new Map(sk.entities.map((e) => [e.id, e]))
    for (const c of sk.constraints) {
      const missing = ids(c).filter((i) => !E.has(i))
      if (missing.length) this.fail(`dangling-ref:${c.kind}`, `${where} left ${describeC(c)} on missing piece(s) ${missing}`)
      for (const k of ['p', 'q'] as const) {
        const an = (c as unknown as Record<string, { entity?: number; at?: string }>)[k]
        if (an && typeof an.entity === 'number' && an.at && E.has(an.entity) && !VALID_AT[E.get(an.entity)!.kind]?.includes(an.at))
          this.fail(`bad-anchor:${c.kind}`, `${where}: ${describeC(c)} names anchor '${an.at}' a ${E.get(an.entity)!.kind} does not have`)
      }
    }
    for (const e of sk.entities) if (e.kind === 'arc' && !(e.sweep > 0 && e.sweep <= TWO_PI + 1e-12)) this.fail('arc-sweep-out-of-range', `${where}: arc ${e.id} sweep ${e.sweep}`)
    const rep = d.report
    if (rep) {
      if (rep.ok !== (rep.unmet.length === 0)) this.fail('report-inconsistent', `${where}: ok=${rep.ok} with ${rep.unmet.length} unmet`)
      const cids = new Set(sk.constraints.map((c) => c.id))
      const unknown = rep.unmet.filter((u) => !cids.has(u.id))
      if (unknown.length) this.fail('unmet-names-missing-constraint', `${where}: unmet ${show(unknown)} not in the sketch`)
    }

    // A refusal: a sentence to read, the sketch as it was.
    if (d.error && d.error !== before.error) {
      const known = softErrors.get(d.error) ?? { count: 0, methods: new Set<string>(), example: where }
      known.count++
      known.methods.add(m)
      softErrors.set(d.error, known)
      if (!d.error.trim() || /undefined|NaN|\[object|Infinity|null/.test(d.error)) this.fail('unreadable-error', `${where}: "${d.error}"`)
      const original = (m === 'sketchDragEnd' && this.drag) ? this.drag.before : before
      if (json !== original.json || d.history.length !== original.hist) this.fail(`refusal-changed-sketch:${m}`, `${where} said "${d.error}" but changed the sketch (history ${original.hist}→${d.history.length})`)
    }

    // Nothing an add or a drag does takes a relation away.
    if (!REMOVERS.has(m)) {
      const after = new Set(sk.constraints.map((c) => c.id))
      const gone = before.sketch.constraints.filter((c) => c.id !== before.dimMade && !after.has(c.id))
      if (gone.length) this.fail(`constraint-dropped:${m}`, `${where} removed ${gone.map(describeC).join('; ')}`)
    }

    // A fixed piece stays where it is.
    if (!FIX_CHANGERS.has(m)) {
      for (const e0 of before.sketch.entities) {
        const e1 = E.get(e0.id)
        if (e0.fixed && e1?.fixed && geometryOf(e0) !== geometryOf(e1)) this.fail(`fixed-entity-moved:${m}`, `${where} moved fixed ${e0.kind} ${e0.id}: ${geometryOf(e0)} → ${geometryOf(e1)}`)
      }
    }

    // What the solve says is met is met, measured here.
    if (rep?.ok && m !== 'sketchDrag' && json !== before.json) {
      const bad = violations(sk)
      for (const v of bad.slice(0, 3)) {
        const gross = v.unit === 'len' ? v.res > 1e-3 : v.res > 1e-3 / sketchScale(sk)
        this.fail(`violated-when-ok:${v.c.kind}:${gross ? 'gross' : 'fine'}`, `${where}: report ok but ${describeC(v.c)} is off by ${v.res.toExponential(3)} ${v.unit === 'len' ? 'mm' : 'rad'}`)
      }
    }

    // A piece that was whole and is now (next to) a point — unless a value
    // typed made it so small, or it is a step given back by undo or redo.
    const start = m === 'sketchDragEnd' && this.drag ? this.drag.before : before
    if (json !== start.json && !RESTORERS.has(m)) {
      const was = new Map(start.sketch.entities.map((e) => [e.id, size(e)]))
      const tinyTyped = sk.constraints.some((c) => 'value' in c && c.kind !== 'angle' && c.value < 0.05)
      for (const e of sk.entities) {
        const w = was.get(e.id)
        const now = size(e)
        if (w === undefined || tinyTyped || !(w >= 1e-3)) continue
        if (degenerate(e) || (now < 1e-2 * w && now < 0.05)) this.fail(`collapsed:${e.kind}:${m}:${start.report?.ok ? 'from-solved' : 'from-unsolved'}`, `${where} shrank ${e.kind} ${e.id} from ${w.toPrecision(6)} to ${now.toExponential(3)} (${geometryOf(e)}); report ok=${rep?.ok}`)
      }
    }

    // A relation asked for twice is taken twice.
    if (m === 'addRelation' || (m === 'sketchClick' && before.tool === 'relation')) {
      const anchorKey = (a: {entity: number; at: string}) => `${a.entity}/${a.at}`
      const key = (c: Constraint) => {
        if (c.kind === 'coincident') return 'coincident:' + [anchorKey(c.p), anchorKey(c.q)].sort().join(',')
        if (c.kind === 'pointOn') return `pointOn:${anchorKey(c.p)}:${JSON.stringify(c.on)}:${!!c.bounded}`
        if (c.kind === 'symmetric') return `symmetric:${[anchorKey(c.p), anchorKey(c.q)].sort()}:${JSON.stringify(c.about)}`
        if (c.kind === 'collinear' && 'datum' in c.on) return `collinear:${c.line}:${c.on.datum}`
        return `${c.kind}:${ids(c).sort((x, y) => x - y).join(',')}`
      }
      const had = new Set(before.sketch.constraints.map(key))
      const added = sk.constraints.filter((c) => !before.sketch.constraints.some((b) => b.id === c.id))
      for (const c of added) if (had.has(key(c))) this.fail(`ux:duplicate-relation-accepted:${c.kind}`, `${where} added ${describeC(c)} beside ${before.sketch.constraints.filter(old => key(old) === key(c)).map(describeC).join(', ')} (redundant=${rep?.redundant})`)
      if (added.length && before.report?.ok && rep && !rep.ok) this.fail(`ux:conflicting-relation-kept:${added[0].kind}`, `${where} added ${added.map(describeC).join('; ')}; unmet now ${show(rep.unmet)} (shown as ⚠, no refusal)`)
    }
    if (INTENT.has(m) && json === before.json && !d.error && d.tool === before.tool && (d.armedRelation ?? null) === before.armed && (d.dimMade ?? null) === before.dimMade && m !== 'setDimensionValue') {
      this.fail(`ux:silent-noop:${m}:${String(args[0] ?? '')}`, `${where} with selection ${before.selection} changed nothing and said nothing`)
    }

    // A dimension takes the value typed — or says why not.
    if (m === 'setDimensionValue' || (m === 'setDimensionForm' && typeof args[2] === 'number')) {
      const id = args[0] as number
      const V = (m === 'setDimensionValue' ? args[1] : args[2]) as number
      const c = sk.constraints.find((x) => x.id === id)
      if (c && 'value' in c) {
        const invalid =
          (c.kind === 'length' || c.kind === 'radius' || c.kind === 'diameter') && V <= 0
            ? V === 0 ? 'zero' : 'negative'
            : c.kind === 'distance' && V < 0
              ? 'negative'
              : c.kind === 'angle' && (V < 0 || V >= 360 || (!c.sector && V > 180))
                ? 'out-of-range'
                : null
        if (invalid && !d.error) {
          const reads = dimensionReads(sk, c)
          this.fail(`invalid-dim-value-accepted:${c.kind}:${invalid}`, `${where} accepted ${c.kind} = ${V} without a word; report ok=${rep?.ok}, unmet=${show(rep?.unmet ?? [])}, geometry now reads ${reads}`)
        }
        if (!invalid && c.value !== V && json !== before.json) this.fail(`dim-value-not-stored:${c.kind}`, `${where}: stored ${c.value}, typed ${V}`)
        if (!invalid && rep?.ok) {
          const reads = dimensionReads(sk, c)
          if (reads !== null && c.value === V) {
            const off = c.kind === 'angle' ? Math.abs(mod(reads - V + (c.sector ? 180 : 90), c.sector ? 360 : 180) - (c.sector ? 180 : 90)) : Math.abs(reads - V)
            if (off > 1e-6 * Math.max(1, Math.abs(V), c.kind === 'angle' ? 1 : sketchScale(sk))) this.fail(`dim-value-not-reached-when-ok:${c.kind}`, `${where}: reads ${reads} after typing ${V}`)
          }
        }
        if (!invalid && !rep?.ok && before.report?.ok) this.fail(`ux:dim-value-overdefines:${c.kind}`, `${where}: typed ${V}; unmet ${show(rep?.unmet ?? [])} (shown as ⚠, no refusal)`)
      }
    }

    // Undo and redo give back exactly what they keep.
    if (m === 'undoSketch' && before.histLast) {
      if (json !== before.histLast) {
        const dev = maxDev(sk, JSON.parse(before.histLast))
        this.fail(`undo-inexact:${metTag(before.histLast)}:${magnitude(dev, sk)}`, `${where}: restored differs from the kept step by ${dev.toExponential(3)}`)
      }
    }
    if (m === 'redoSketch' && before.futLast) {
      if (json !== before.futLast) {
        const dev = maxDev(sk, JSON.parse(before.futLast))
        this.fail(`redo-inexact:${metTag(before.futLast)}:${magnitude(dev, sk)}`, `${where}: restored differs from the kept step by ${dev.toExponential(3)}`)
      }
    }

    // The drag: refused cleanly, and what was met is met when it lets go.
    if (m === 'sketchDragStart') {
      if (ret === true) this.drag = { before, snap: false }
      else if (json !== before.json) this.fail('drag-refused-changed-sketch', `${where} refused but changed the sketch`)
    }
    if (m === 'sketchDrag' && this.drag && !(args[2] as { off?: boolean })?.off) this.drag.snap = true
    if (m === 'sketchDragEnd' && this.drag) {
      const b = this.drag.before
      const how = this.drag.snap ? 'snap' : 'raw'
      this.drag = null
      if (json !== b.json && b.report?.ok) {
        if (!rep?.ok) this.fail(`drag-broke-constraints:${how}`, `${where}: the sketch was solved before the drag; after it unmet ${show(rep?.unmet ?? [])} — ${(rep?.unmet ?? []).map((u) => { const c = sk.constraints.find((x) => x.id === u.id); return c ? describeC(c) : u.id }).join('; ')}`)
        const loose = new Set(b.report.underConstrained)
        const S = sketchScale(sk)
        const addedHolds = sk.constraints.length !== b.sketch.constraints.length
        for (const e0 of b.sketch.entities) {
          if (loose.has(e0.id) || e0.fixed) continue
          const e1 = E.get(e0.id)
          if (e1 && maxDev(JSON.parse(geometryOf(e0)), JSON.parse(geometryOf(e1))) > 1e-6 * S && !addedHolds)
            this.fail(`drag-moved-fully-constrained:${e0.kind}`, `${where}: ${e0.kind} ${e0.id} was fully defined (report ok, not loose) and moved: ${geometryOf(e0)} → ${geometryOf(e1)}; ok after=${rep?.ok}`)
        }
      }
    }
  }
}

// ---- driving the sheet as a user does ---------------------------------------

function nearestDist(e: SketchEntity, p: V2): number {
  switch (e.kind) {
    case 'line': {
      const ab = sub(e.b, e.a)
      const L = dot(ab, ab)
      const t = L > 0 ? Math.max(0, Math.min(1, dot(sub(p, e.a), ab) / L)) : 0
      return dist(p, [e.a[0] + t * ab[0], e.a[1] + t * ab[1]])
    }
    case 'circle':
      return Math.min(Math.abs(dist(p, e.c) - e.r), dist(p, e.c))
    case 'arc': {
      const along = mod(Math.atan2(p[1] - e.c[1], p[0] - e.c[0]) - e.start, TWO_PI)
      const onRim = along <= e.sweep ? Math.abs(dist(p, e.c) - e.r) : Infinity
      return Math.min(onRim, dist(p, anchorAt(e, 'a')!), dist(p, anchorAt(e, 'b')!), dist(p, e.c))
    }
    case 'point':
      return dist(p, e.p)
    default:
      return 0
  }
}

const clear = (sk: Sketch, p: V2, margin = 3 * R) => sk.entities.every((e) => nearestDist(e, p) > margin)

/** A spot on a piece's body, away from its ends where it can be. */
function spotOn(e: SketchEntity, rng: Rng): V2 {
  switch (e.kind) {
    case 'line': {
      const t = rng.range(0.35, 0.65)
      return [e.a[0] + t * (e.b[0] - e.a[0]), e.a[1] + t * (e.b[1] - e.a[1])]
    }
    case 'circle': {
      const t = rng.range(0, TWO_PI)
      return [e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)]
    }
    case 'arc': {
      const t = e.start + e.sweep * rng.range(0.3, 0.7)
      return [e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)]
    }
    case 'point':
      return e.p
    default:
      return [0, 0]
  }
}

/** A spot on the bare sheet, clear of every piece and of the plane lines. */
function emptySpot(sk: Sketch, rng: Rng, near?: V2, within = 25): V2 {
  for (let i = 0; i < 80; i++) {
    const p: V2 = near ? [near[0] + rng.range(-within, within), near[1] + rng.range(-within, within)] : [rng.range(-140, 140), rng.range(-140, 140)]
    if (clear(sk, p) && Math.abs(p[0]) > 3 * R && Math.abs(p[1]) > 3 * R) return p
  }
  return [400 + rng.range(0, 50), 400 + rng.range(0, 50)]
}

/** A spot on one of the coordinate planes' lines, clear of the pieces. */
function axisSpot(sk: Sketch, rng: Rng): V2 {
  for (let i = 0; i < 60; i++) {
    const t = rng.range(-140, 140)
    const p: V2 = rng.chance(0.5) ? [0, t] : [t, 0]
    if (clear(sk, p) && Math.abs(t) > 3 * R) return p
  }
  return rng.chance(0.5) ? [0, 300] : [300, 0]
}

function anchorSpots(e: SketchEntity): V2[] {
  if (e.kind === 'line') return [e.a, e.b]
  if (e.kind === 'arc') return [anchorAt(e, 'a')!, anchorAt(e, 'b')!, e.c]
  if (e.kind === 'circle') return [e.c]
  if (e.kind === 'point') return [e.p]
  return []
}

const sketchNow = () => draft()!.sketch

function drawBase(r: Runner, rng: Rng) {
  const cells: V2[] = []
  for (const x of [-70, 0, 70]) for (const y of [-70, 0, 70]) cells.push([x + rng.range(-15, 15), y + rng.range(-15, 15)])
  const shapes = 1 + rng.int(3)
  const off = { off: true }
  for (let i = 0; i < shapes; i++) {
    const at = cells.splice(rng.int(cells.length), 1)[0]
    const size = rng.range(8, 50)
    const kind = rng.weighted({ rectangle: 4, line: 2, polyline: 2, circle: 2, arc: 2, polygon: 1 })
    r.begin(`draw ${kind}`)
    if (kind === 'rectangle') {
      const w = size
      const h = size * rng.range(0.3, 1.5)
      r.call('setSketchTool', 'rectangle')
      r.call('sketchClick', [at[0] - w / 2, at[1] - h / 2], R, false, off)
      r.call('sketchClick', [at[0] + w / 2, at[1] + h / 2], R, false, off)
    } else if (kind === 'line' || kind === 'polyline') {
      r.call('setSketchTool', 'line')
      const n = kind === 'line' ? 2 : 3 + rng.int(3)
      let p: V2 = [at[0] - size / 2, at[1] + rng.range(-size / 2, size / 2)]
      r.call('sketchClick', p, R, false, off)
      let heading = rng.range(0, TWO_PI)
      for (let k = 1; k < n; k++) {
        // Now and then nearly level or upright, which the line tool takes
        // as meant so.
        const theta = rng.chance(0.3) ? rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) + rng.range(-0.03, 0.03) : heading
        const len = rng.range(size * 0.3, size)
        p = [p[0] + len * Math.cos(theta), p[1] + len * Math.sin(theta)]
        r.call('sketchClick', p, R, false, off)
        heading += rng.range(0.6, 2.2) * (rng.chance(0.5) ? 1 : -1)
      }
      r.call('clearSelection') // Escape ends the chain
    } else if (kind === 'circle') {
      r.call('setSketchTool', 'circle')
      r.call('sketchClick', at, R, false, off)
      r.call('sketchClick', [at[0] + size / 2, at[1]], R, false, off)
    } else if (kind === 'arc') {
      const rad = size / 2
      const t0 = rng.range(0, TWO_PI)
      const sweep = rng.range(0.6, 4.6)
      const pt = (t: number): V2 => [at[0] + rad * Math.cos(t), at[1] + rad * Math.sin(t)]
      r.call('setSketchTool', 'arc')
      r.call('sketchClick', pt(t0), R, false, off)
      r.call('sketchClick', pt(t0 + sweep), R, false, off)
      r.call('sketchClick', pt(t0 + sweep * rng.range(0.3, 0.7)), R, false, off)
    } else {
      r.call('setSketchTool', 'polygon')
      r.call('sketchClick', at, R, false, off)
      r.call('sketchClick', [at[0] + size / 2, at[1] + rng.range(-3, 3)], R, false, off)
    }
    r.call('setSketchTool', 'select')
  }
}

/** Select pieces as the arrow does: a click, then Ctrl-clicks — or a box. */
function selectPieces(r: Runner, rng: Rng, pieces: SketchEntity[]) {
  if (draft()!.tool !== 'select') r.call('setSketchTool', 'select')
  if (pieces.length === 0) {
    r.call('clearSelection')
    return
  }
  pieces.forEach((e, i) => r.call('sketchClick', spotOn(e, rng), R, i > 0))
}

const RELATIONS = ['horizontal', 'vertical', 'parallel', 'perpendicular', 'tangent', 'equal', 'concentric', 'collinear', 'coincident', 'symmetric'] as const
type Rel = (typeof RELATIONS)[number]

/** Pieces a relation is meant for — most of the time; otherwise any, which
 *  the store should refuse with a reason. */
function piecesFor(kind: Rel, sk: Sketch, rng: Rng): SketchEntity[] {
  const all = sk.entities
  const lines = all.filter((e) => e.kind === 'line')
  const rounds = all.filter((e) => e.kind === 'arc' || e.kind === 'circle')
  const take = (pool: SketchEntity[], n: number) => {
    const p = [...pool]
    const out: SketchEntity[] = []
    while (out.length < n && p.length) out.push(p.splice(rng.int(p.length), 1)[0])
    return out
  }
  if (!rng.chance(0.8)) return take(all, 1 + rng.int(3))
  switch (kind) {
    case 'horizontal':
    case 'vertical':
      return take(lines, rng.chance(0.8) ? 1 : 2)
    case 'parallel':
    case 'perpendicular':
      return take(lines, rng.chance(0.8) ? 2 : 3)
    case 'equal':
      return rng.chance(0.6) ? take(lines, 2 + rng.int(2)) : take(rounds, 2)
    case 'tangent':
      return rng.chance(0.5) ? [...take(lines, 1), ...take(rounds, 1)] : take(rounds, 2)
    case 'concentric':
      return take(rounds, 2)
    case 'collinear':
      return take(lines, 2)
    case 'coincident':
      return take(all, 2)
    case 'symmetric': {
      const kindOf = rng.pick(['line', 'circle', 'arc'] as const)
      const pair = take(all.filter((e) => e.kind === kindOf), 2)
      const axis = take(lines.filter((l) => !pair.includes(l)), 1)
      return rng.chance(0.5) ? [...pair, ...axis] : pair
    }
  }
}

/** The second half of a relation the button took in hand: a mirror line for
 *  Symmetric, two picks for Coincident. */
function finishArmed(r: Runner, rng: Rng) {
  const d = draft()!
  if (d.tool !== 'relation') return
  const sk = d.sketch
  if (d.armedRelation === 'symmetric' && d.selection.length === 2) {
    const lines = sk.entities.filter((e) => e.kind === 'line' && !d.selection.includes(e.id))
    r.call('sketchClick', lines.length && rng.chance(0.6) ? spotOn(rng.pick(lines), rng) : axisSpot(sk, rng), R, false)
  } else if (d.armedRelation === 'coincident') {
    for (let i = 0; i < 2; i++) r.call('sketchClick', coincidentPick(sketchNow(), rng), R, false)
  }
}

function coincidentPick(sk: Sketch, rng: Rng): V2 {
  const e = sk.entities.length ? rng.pick(sk.entities) : null
  const how = rng.weighted({ anchor: 5, piece: 3, axis: 1 })
  if (!e || how === 'axis') return axisSpot(sk, rng)
  if (how === 'anchor') return rng.pick(anchorSpots(e))
  return spotOn(e, rng)
}

function stepRelationBySelection(r: Runner, rng: Rng) {
  const kind = rng.pick(RELATIONS)
  r.begin(`relation ${kind} on selection`)
  selectPieces(r, rng, piecesFor(kind, sketchNow(), rng))
  r.call('addRelation', kind)
  finishArmed(r, rng)
  if (rng.chance(0.5)) r.call('setSketchTool', 'select')
}

function stepRelationArmed(r: Runner, rng: Rng) {
  const kind = rng.pick(RELATIONS)
  r.begin(`relation ${kind} in hand`)
  if (draft()!.selection.length) r.call('clearSelection')
  r.call('armRelation', kind)
  if (kind === 'coincident') {
    for (let i = 0; i < 2; i++) r.call('sketchClick', coincidentPick(sketchNow(), rng), R, false)
  } else {
    const pieces = piecesFor(kind, sketchNow(), rng)
    for (const e of pieces) r.call('sketchClick', spotOn(e, rng), R, false)
    finishArmed(r, rng)
  }
  if (rng.chance(0.6)) r.call('setSketchTool', 'select')
}

function stepFix(r: Runner, rng: Rng) {
  r.begin('fix')
  const all = sketchNow().entities
  selectPieces(r, rng, all.length ? [rng.pick(all), ...(rng.chance(0.3) ? [rng.pick(all)] : [])].filter((e, i, xs) => xs.indexOf(e) === i) : [])
  r.call('toggleFixedSelected')
}

/** A value to type into a dimension's field: near or far from what it reads,
 *  round, nothing, negative, huge, tiny — and angles round the circle. */
function valueFor(kind: string, current: number, rng: Rng): number {
  if (kind === 'angle') {
    const which = rng.weighted({ any: 4, right: 2, half: 1, zero: 1, straight: 1, reflex: 2, full: 1, negative: 1, nudge: 1, scaled: 2 })
    switch (which) {
      case 'any': return rng.range(1, 179)
      case 'right': return 90
      case 'half': return 45
      case 'zero': return 0
      case 'straight': return 180
      case 'reflex': return rng.range(181, 359)
      case 'full': return 360
      case 'negative': return -30
      case 'nudge': return current + 1e-6
      case 'scaled': return current * rng.range(0.5, 1.5)
    }
  }
  const x = rng.next()
  if (x < 0.3) return current * rng.range(0.5, 2)
  if (x < 0.42) return current * (1 + rng.pick([1e-9, 1e-6, 1e-3, -1e-6]))
  if (x < 0.52) return rng.pick([5, 10, 12.5, 25, 50])
  if (x < 0.6) return 0
  if (x < 0.7) return rng.chance(0.5) ? -current : -rng.range(1, 50)
  if (x < 0.78) return rng.pick([1e4, 1e6])
  if (x < 0.86) return rng.pick([1e-6, 1e-3])
  return current * rng.range(3, 10)
}

function typeValue(r: Runner, rng: Rng) {
  const d = draft()!
  const c = d.sketch.constraints.find((x) => x.id === d.selectedConstraint)
  if (!c || !('value' in c)) return
  const V = Number(valueFor(c.kind, c.value, rng))
  r.call('setDimensionValue', '$sel', V)
  if (rng.chance(0.5)) r.call('finishDimension', '$sel')
}

/** Where to put a dimension in hand down: for an angle, a spot round where
 *  its lines cross, so every sector gets taken. */
function putDownSpot(rng: Rng): V2 {
  const d = draft()!
  const c = d.sketch.constraints.find((x) => x.id === d.dimMade)
  if (c?.kind === 'angle') {
    const a = d.sketch.entities.find((e) => e.id === c.a)
    const b = d.sketch.entities.find((e) => e.id === c.b)
    if (a?.kind === 'line' && b?.kind === 'line') {
      const da = sub(a.b, a.a)
      const db = sub(b.b, b.a)
      const det = cross(da, db)
      if (Math.abs(det) > 1e-9) {
        const t = cross(sub(b.a, a.a), db) / det
        const x: V2 = [a.a[0] + t * da[0], a.a[1] + t * da[1]]
        return emptySpot(d.sketch, rng, x, rng.range(4, 20))
      }
    }
  }
  return emptySpot(d.sketch, rng)
}

function stepDimensionTool(r: Runner, rng: Rng) {
  r.begin('dimension tool')
  r.call('setSketchTool', 'dimension')
  const sk = sketchNow()
  const pickSpot = () => {
    const now = sketchNow()
    const e = now.entities.length ? rng.pick(now.entities) : null
    const how = rng.weighted({ piece: 6, anchor: 3, axis: 1 })
    if (!e || how === 'axis') return axisSpot(now, rng)
    return how === 'anchor' ? rng.pick(anchorSpots(e)) : spotOn(e, rng)
  }
  if (!sk.entities.length) return
  r.call('sketchClick', pickSpot(), R, false)
  let d = draft()!
  if (d.dimMade != null && rng.chance(0.35)) r.call('sketchClick', pickSpot(), R, false)
  else if (d.dimMade == null && d.dimPick) r.call('sketchClick', pickSpot(), R, false)
  d = draft()!
  if (d.dimMade != null) {
    if (rng.chance(0.8)) r.call('sketchClick', putDownSpot(rng), R, false)
    else r.call('putDownDimension')
  }
  if (rng.chance(0.85)) typeValue(r, rng)
  if (rng.chance(0.15)) r.call('clearSelection')
  if (rng.chance(0.4)) r.call('setSketchTool', 'select')
}

function stepDimensionSelection(r: Runner, rng: Rng) {
  r.begin('dimension the selection')
  const all = sketchNow().entities
  const n = rng.chance(0.6) ? 1 : 2
  const picks: SketchEntity[] = []
  while (picks.length < n && picks.length < all.length) {
    const e = rng.pick(all)
    if (!picks.includes(e)) picks.push(e)
  }
  selectPieces(r, rng, picks)
  r.call('dimensionSelection')
  const d = draft()!
  if (d.dimMade != null) {
    if (rng.chance(0.7)) r.call('sketchClick', putDownSpot(rng), R, false)
    else r.call('putDownDimension')
  }
  if (rng.chance(0.85)) typeValue(r, rng)
  r.call('setSketchTool', 'select')
}

function stepAddDimension(r: Runner, rng: Rng) {
  const kind = rng.pick(['length', 'radius', 'diameter', 'angle', 'distance'] as const)
  r.begin(`addDimension ${kind}`)
  const all = sketchNow().entities
  const picks: SketchEntity[] = []
  const n = kind === 'angle' || kind === 'distance' ? 2 : 1
  while (picks.length < n && picks.length < all.length) {
    const e = rng.pick(all)
    if (!picks.includes(e)) picks.push(e)
  }
  selectPieces(r, rng, picks)
  if (rng.chance(0.5)) r.call('addDimension', kind)
  else r.call('addDimension', kind, Number(valueFor(kind, kind === 'angle' ? 60 : 20, rng)))
}

function stepEditDimension(r: Runner, rng: Rng) {
  const dims = sketchNow().constraints.filter((c) => 'value' in c)
  if (!dims.length) return stepDimensionTool(r, rng)
  const c = rng.pick(dims) as Constraint & { value: number }
  r.begin(`type a value into ${c.kind} ${c.id}`)
  r.call('setDimensionValue', c.id, Number(valueFor(c.kind, c.value, rng)))
}

function stepDimensionForm(r: Runner, rng: Rng) {
  const rounds = sketchNow().constraints.filter((c) => c.kind === 'radius' || c.kind === 'diameter')
  if (!rounds.length) return stepDimensionTool(r, rng)
  const c = rng.pick(rounds) as Constraint & { kind: 'radius' | 'diameter'; value: number }
  r.begin(`switch ${c.kind} ${c.id}`)
  const form = c.kind === 'radius' ? 'diameter' : 'radius'
  if (rng.chance(0.5)) r.call('setDimensionForm', c.id, form)
  else r.call('setDimensionForm', c.id, form, Number(valueFor(form, form === 'diameter' ? 2 * c.value : c.value / 2, rng)))
}

function stepDrag(r: Runner, rng: Rng) {
  const all = sketchNow().entities
  if (!all.length) return
  const e = rng.pick(all)
  const grips: V2[] = [...anchorSpots(e), spotOn(e, rng)]
  if (e.kind === 'line') grips.push([(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2])
  if (e.kind === 'arc') grips.push(anchorAt(e, 'p0')!)
  const from = rng.pick(grips)
  const snapOn = rng.chance(0.25)
  r.begin(`drag ${e.kind} ${e.id}${e.fixed ? ' (fixed)' : ''}${snapOn ? ' snapping' : ''}`)
  if (draft()!.tool !== 'select') r.call('setSketchTool', 'select')
  if (!r.call('sketchDragStart', from, R)) return
  const far = rng.chance(0.5) ? rng.range(5, 50) : rng.range(0.05, 3)
  const t = rng.range(0, TWO_PI)
  const to: V2 = [from[0] + far * Math.cos(t), from[1] + far * Math.sin(t)]
  const moves = 1 + rng.int(5)
  for (let i = 1; i <= moves; i++) r.call('sketchDrag', [from[0] + ((to[0] - from[0]) * i) / moves, from[1] + ((to[1] - from[1]) * i) / moves], R, snapOn ? {} : { off: true })
  r.call('sketchDragEnd')
}

function stepRemove(r: Runner, rng: Rng) {
  const sk = sketchNow()
  const choices = [...sk.constraints.map((c) => c.id), ...sk.entities.filter((e) => e.fixed).map((e) => fixId(e.id))]
  if (!choices.length) return stepRelationBySelection(r, rng)
  const id = rng.pick(choices)
  r.begin(`remove ${id}`)
  r.call('selectConstraint', id)
  r.call('removeSelectedConstraint')
}

function stepUndoRedo(r: Runner, rng: Rng) {
  const undo = rng.chance(0.6)
  r.begin(undo ? 'undo' : 'redo')
  const n = 1 + rng.int(3)
  for (let i = 0; i < n; i++) r.call(undo ? 'undoSketch' : 'redoSketch')
}

function randomStep(r: Runner, rng: Rng) {
  const kind = rng.weighted({ relSel: 16, relArmed: 12, fix: 5, dimTool: 16, dimSel: 6, addDim: 3, edit: 10, form: 3, drag: 18, remove: 6, undo: 8, escape: 2, solve: 2 })
  switch (kind) {
    case 'relSel': return stepRelationBySelection(r, rng)
    case 'relArmed': return stepRelationArmed(r, rng)
    case 'fix': return stepFix(r, rng)
    case 'dimTool': return stepDimensionTool(r, rng)
    case 'dimSel': return stepDimensionSelection(r, rng)
    case 'addDim': return stepAddDimension(r, rng)
    case 'edit': return stepEditDimension(r, rng)
    case 'form': return stepDimensionForm(r, rng)
    case 'drag': return stepDrag(r, rng)
    case 'remove': return stepRemove(r, rng)
    case 'undo': return stepUndoRedo(r, rng)
    case 'escape':
      r.begin('escape')
      r.call('clearSelection')
      return
    case 'solve':
      r.begin('solve now')
      r.call('solveNow')
      return
  }
}

// ---- a workflow, from the empty sheet to Finish and Edit ---------------------

function resetStore() {
  useReverse.setState({ ...useReverse.getInitialState() }, true)
  // The drag in hand lives beside the store; with no sketch this only lets it go.
  s().sketchDragEnd()
  useRePrefs.setState({ drawModes: { ...DEFAULT_DRAW_MODES }, polygonSides: 6, gridSnap: false })
  setCircularDimensioning('diameter')
}

function begin(r: Runner) {
  resetStore()
  s().startSketch(PLANE, XY)
  r.S0 = JSON.stringify(draft()!.sketch)
}

/** Undo all, redo all, Finish, Edit: every state given back exactly. */
function finale(r: Runner) {
  r.begin('finale')
  r.call('sketchDragEnd')
  if (draft()!.dimMade != null) r.call('putDownDimension')
  r.call('clearSelection')
  r.call('setSketchTool', 'select')
  const F = JSON.stringify(draft()!.sketch)
  const n = draft()!.history.length
  for (let i = 0; i < n; i++) r.call('undoSketch')
  if (!r.overflowed && JSON.stringify(draft()!.sketch) !== r.S0) r.fail('undo-all-not-initial', `after ${n} undos the sheet is ${JSON.stringify(draft()!.sketch).slice(0, 300)}`)
  for (let i = 0; i < n; i++) r.call('redoSketch')
  const G = JSON.stringify(draft()!.sketch)
  if (G !== F) {
    const dev = maxDev(JSON.parse(G), JSON.parse(F))
    r.fail(`redo-all-not-final:${metTag(F)}:${magnitude(dev, JSON.parse(F))}`, `after ${n} redos the sketch differs from the last state by ${dev.toExponential(3)}`)
  }
  const id = r.call('commitSketch') as number | null
  if (id === null) {
    if (JSON.parse(G).entities.length) r.fail('commit-refused', 'Finish made no feature of a sketch with pieces')
    return
  }
  r.call('editSketch', id)
  const H = JSON.stringify(draft()?.sketch)
  if (H !== G) {
    const dev = H ? maxDev(JSON.parse(H), JSON.parse(G)) : Infinity
    r.fail(`commit-edit-roundtrip:${metTag(G)}:${magnitude(dev, JSON.parse(G))}`, `Finish then Edit gives a sketch that differs by ${dev.toExponential(3)}`)
  }
}

function generate(seed: number): Runner {
  const rng = random(seed)
  const r = new Runner()
  begin(r)
  drawBase(r, rng)
  const steps = 5 + rng.int(16)
  for (let i = 0; i < steps; i++) randomStep(r, rng)
  finale(r)
  return r
}

/** The recorded calls played again, finale and checks included. */
function replay(steps: Step[]): Runner {
  const r = new Runner()
  begin(r)
  for (const st of steps) {
    r.begin(st.label)
    for (const c of st.calls) r.call(c.m, ...c.a)
  }
  // A drag left open by a shrink is let go before the finale.
  finale(r)
  return r
}

const has = (r: Runner, sig: string) => r.failures.some((f) => f.sig === sig) || r.ux.some((f) => f.sig === sig)

/** ddmin over steps, then over single calls. */
function shrink(steps: Step[], sig: string, budget = 250): Step[] {
  let tries = 0
  const holds = (cand: Step[]) => {
    tries++
    try {
      return has(replay(cand), sig)
    } catch {
      return false
    }
  }
  let cur = steps
  let n = 2
  while (cur.length >= 2 && tries < budget) {
    const chunk = Math.ceil(cur.length / n)
    let reduced = false
    for (let i = 0; i < cur.length && tries < budget; i += chunk) {
      const cand = [...cur.slice(0, i), ...cur.slice(i + chunk)]
      if (holds(cand)) {
        cur = cand
        n = Math.max(n - 1, 2)
        reduced = true
        break
      }
    }
    if (!reduced) {
      if (chunk <= 1) break
      n = Math.min(cur.length, n * 2)
    }
  }
  if (cur.length === 1 && tries < budget && holds([])) cur = []
  for (let i = cur.length - 1; i >= 0 && tries < budget; i--) {
    for (let j = cur[i].calls.length - 1; j >= 0 && tries < budget; j--) {
      const cand = cur.map((st, k) => (k === i ? { ...st, calls: st.calls.filter((_, q) => q !== j) } : st))
      if (holds(cand)) cur = cand
    }
  }
  return cur.filter((st) => st.calls.length > 0)
}

function code(steps: Step[]): string {
  const arg = (x: unknown) => (x === '$sel' ? 's().sketchDraft.selectedConstraint' : JSON.stringify(x))
  const lines = [`s().startSketch(${JSON.stringify(PLANE)}, XY)`]
  for (const st of steps) {
    lines.push(`// ${st.label}`)
    for (const c of st.calls) lines.push(`s().${c.m}(${c.a.map(arg).join(', ')})`)
  }
  lines.push('// then: undo all, redo all, commitSketch(), editSketch(id)')
  return lines.join('\n')
}

// ---- the run -------------------------------------------------------------------

describe('2D Sketch: relations, dimensions and dragging at random', () => {
  it(`keeps every promise over ${WORKFLOWS} seeded workflows`, async () => {
    // The loop is synchronous; the worker is let breathe between workflows.
    const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
    const groups = new Map<string, { count: number; first: { seed: number; detail: string; steps: Step[] } }>()
    const harness: string[] = []
    let stepsRun = 0
    let callsRun = 0
    let failedWorkflows = 0
    const started = Date.now()
    for (let w = 0; w < WORKFLOWS; w++) {
      const seed = SEED0 + w
      if (w % 10 === 0) await breathe()
      let r: Runner
      try {
        r = generate(seed)
      } catch (e) {
        harness.push(`seed ${seed}: ${e instanceof Error ? e.stack : String(e)}`)
        continue
      }
      stepsRun += r.steps.length
      callsRun += r.callsRun
      if (r.failures.length) failedWorkflows++
      for (const f of [...r.failures, ...r.ux]) {
        const g = groups.get(f.sig)
        if (g) g.count++
        else groups.set(f.sig, { count: 1, first: { seed, detail: f.detail, steps: r.steps.slice(0, r.steps.length - 1) } })
      }
    }
    const generatedMs = Date.now() - started

    // Each signature shrunk to the fewest calls that still show it.
    const report: { sig: string; workflows: number; seed: number; detail: string; minimal: string; minimalDetail: string; original: string; originalSteps: Step[] }[] = []
    for (const [sig, g] of [...groups].sort((a, b) => b[1].count - a[1].count)) {
      await breathe()
      const small = sig.startsWith('ux:') ? g.first.steps : shrink(g.first.steps, sig)
      const again = replay(small)
      const f = [...again.failures, ...again.ux].find((x) => x.sig === sig)
      report.push({ sig, workflows: g.count, seed: g.first.seed, detail: g.first.detail, minimal: sig.startsWith('ux:') ? '(not shrunk)' : code(small), minimalDetail: f?.detail ?? '(did not reproduce on replay)', original: code(g.first.steps), originalSteps: g.first.steps })
    }
    const errors = [...softErrors].sort((a, b) => b[1].count - a[1].count).map(([msg, v]) => ({ msg, count: v.count, methods: [...v.methods], example: v.example }))
    const failing = report.filter((x) => !x.sig.startsWith('ux:'))
    const summary = {
      workflows: WORKFLOWS,
      firstSeed: SEED0,
      steps: stepsRun,
      calls: callsRun,
      workflowsWithFailures: failedWorkflows,
      workflowsClean: WORKFLOWS - failedWorkflows - harness.length,
      generatedMs,
      totalMs: Date.now() - started,
      failures: failing,
      usability: report.filter((x) => x.sig.startsWith('ux:')),
      errorMessages: errors,
      harness,
    }
    const out = process.env.RE_FUZZ_CONSTRAIN_OUT ?? join(tmpdir(), 're-sketch-fuzz-constrain.json')
    writeFileSync(out, JSON.stringify(summary, null, 2))
    console.log(
      [
        `sketch fuzz: ${WORKFLOWS} workflows, ${stepsRun} steps, ${callsRun} store calls, ${failedWorkflows} workflows with failures, ${summary.totalMs} ms → ${out}`,
        ...failing.map((x) => `  FAIL ${x.sig} ×${x.workflows} (seed ${x.seed}) ${x.detail}`),
        ...summary.usability.map((x) => `  UX   ${x.sig} ×${x.workflows} (seed ${x.seed}) ${x.detail}`),
        ...harness.map((h) => `  HARNESS ${h}`),
      ].join('\n'),
    )
    expect(harness).toEqual([])
    if (process.env.RE_FUZZ_CONSTRAIN_STRICT === '1') expect(failing.map((x) => x.sig)).toEqual([])
  })
})
