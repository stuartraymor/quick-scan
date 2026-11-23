// SPDX-License-Identifier: AGPL-3.0-only
// The 2D sketch's tools for an agent, through the same geometry the panel's
// buttons use (core/sketchEdits, sketchPatterns, splineEdits,
// sketchDeviation, curvatureComb): mirror, pattern, spline refinement, a
// selection in the open editor, and the analysis — deviation from the scan
// within a tolerance, curvature, loops and the solve. Each change is one
// undo step on the sketch, solved and rebuilt as reverse.sketch.edit's is.
// Everything runs on this machine; nothing is sent anywhere.

import { arr, bool, enumOf, int, type JsonSchema, num, obj, oneOf } from '../../../src/commands/schema'
import { type Command, CommandError } from '../../../src/plugins/api'
import { exactComb, DEFAULT_COMB } from '../core/curvatureComb'
import { curveOf } from '../core/curveEval'
import { findRegions } from '../core/regions'
import type { Vec2 } from '../../../src/core/flat/types'
import { cloneSketch, entityOf, type Anchor, type Sketch, type SketchEntity } from '../core/sketch'
import { buildCornerTrim } from '../core/sketchCornerTrim'
import { filletScanFit } from '../core/filletFit'
import { sketchDeviation } from '../core/sketchDeviation'
import { mirrorAbout, type MirrorAxis, type SketchEditResult } from '../core/sketchEdits'
import { applyPattern, type CentreRef, type DirectionRef, type LinearDirection, MAX_INSTANCES, type PatternSpec } from '../core/sketchPatterns'
import { insertSplinePoint, rebuildSpline, removeSplinePoint, setSplineEndDirection } from '../core/splineEdits'
import { bodyRows, type Detail, detailIn, featureAnswer } from './reCommandAnswers'
import { change, type Json, re, type Ref, session, sketchNamed } from './reCommandCore'
import { featureRef } from './reSchemas'
import { reverseSession } from './reSession'
import { chainsOn, putSketch } from './reSketchInput'
import { usePlan } from './rePlan'
import { useReverse } from '../state/reStore'
import { useStore } from '../../../src/state/store'

const vec2 = (description: string): JsonSchema => arr(num(), description, { minItems: 2, maxItems: 2 })
const piecesIn = (what: string) => arr(int('A piece’s id.'), what, { minItems: 1 })
const centreIn = (what: string) => oneOf([vec2('[u, v] mm.'), int('A point, circle or arc by id: its position or centre.')], what)

/** Refused: what was asked does not make sense. A declaration, so the
 *  checker reads it as ending the path. */
function invalid(text: string): never {
  throw new CommandError('invalid_input', text)
}

/** Every id given is a piece of the sketch, or the command is refused. */
function piecesOf(sketch: Sketch, name: string, ids: readonly number[]): SketchEntity[] {
  return ids.map((id) => {
    const e = entityOf(sketch, id)
    if (!e) throw new CommandError('not_found', `${name} has no piece ${id}.`)
    return e
  })
}

const done = (r: SketchEditResult, where: string): { sketch: Sketch; ids: number[] } => {
  if (!r.ok) invalid(`${where}: ${r.error}`)
  return { sketch: r.sketch, ids: r.ids }
}

/** One change to a sketch: `op` makes the new sketch from a copy of the
 *  stored one; it is solved, committed as one undo step, and the features
 *  on it rebuilt. */
async function onSketch(ref: Ref, detail: Detail, op: (sketch: Sketch, name: string) => { sketch: Sketch; extra: Json }) {
  const f = sketchNamed(ref)
  const { sketch, extra } = op(cloneSketch(f.sketch), f.name)
  const before = bodyRows(reverseSession())
  let solve: ReturnType<typeof putSketch> = null
  await change(() => {
    re().editSketch(f.id)
    solve = putSketch(sketch)
    if (re().commitSketch() === null) throw new CommandError('failed', 'That leaves the sketch with nothing in it.')
  })
  return featureAnswer(session(), f.id, { ...extra, solve }, detail, before)
}

// ------------------------------------------------------------------ mirror

export const sketchMirror: Command<{ sketch: Ref; pieces: number[]; axis: Json; detail?: Detail }> = {
  name: 'mirror',
  title: 'Mirror sketch pieces',
  description:
    'Copies of pieces reflected about a line, as the panel’s Mirror does: their exact definitions reflected (ends, centres, spline points, arc sweeps, end directions), the originals unchanged, nothing joined to the line. axis: { piece } a line of the sketch (construction or not), { through: [[u, v], [u, v]] } two points, or { sketchAxis: "u" | "v" } the sheet’s own axes through its origin. Returns the copies’ ids (made), in the order given. One undo step.',
  input: obj(
    {
      sketch: featureRef('sketch'),
      pieces: piecesIn('The pieces to mirror.'),
      axis: obj({ piece: int('A line of the sketch.'), through: arr(vec2(''), 'Two points on the mirror line.', { minItems: 2, maxItems: 2 }), sketchAxis: enumOf(['u', 'v'] as const, 'The sheet’s u axis (v = 0) or v axis (u = 0).') }, [], 'The mirror line: exactly one of piece, through, sketchAxis.'),
      detail: detailIn,
    },
    ['sketch', 'pieces', 'axis'],
  ),
  label: ({ pieces }) => `mirror ${pieces.length} sketch piece${pieces.length === 1 ? '' : 's'}`,
  run: ({ sketch, pieces, axis, detail = 'brief' }) =>
    onSketch(sketch, detail, (sk, name) => {
      piecesOf(sk, name, pieces)
      const given = ['piece', 'through', 'sketchAxis'].filter((k) => axis[k] !== undefined)
      if (given.length !== 1) invalid('axis: give exactly one of piece, through, sketchAxis.')
      let line: MirrorAxis
      if (axis.piece !== undefined) {
        const e = piecesOf(sk, name, [axis.piece as number])[0]
        if (e.kind !== 'line') invalid(`axis.piece: ${e.id} is a ${e.kind}, not a line.`)
        if (pieces.includes(e.id)) invalid('axis.piece: the mirror line is one of the pieces being mirrored.')
        line = { a: e.a, b: e.b }
      } else if (axis.through !== undefined) {
        const [a, b] = axis.through as Vec2[]
        line = { a, b }
      } else line = axis.sketchAxis === 'u' ? { a: [0, 0], b: [1, 0] } : { a: [0, 0], b: [0, 1] }
      const r = done(mirrorAbout(sk, pieces, line), 'mirror')
      return { sketch: r.sketch, extra: { made: r.ids } }
    }),
}

// ------------------------------------------------------------------ corner

export const sketchCorner: Command<{ sketch: Ref; pieces: number[]; ends?: ('a' | 'b')[]; mode?: 'trim' | 'autoFillet' | 'fixedFillet'; radius?: number; addDimension?: boolean; tolerance?: number; detail?: Detail }> = {
  name: 'corner',
  title: 'Join or fillet a sketch corner',
  description:
    'Corner Trim, Auto Fillet or Fixed Size Fillet on two pieces (lines, arcs; open curves for trim), through the same geometry the panel’s brush uses. trim: the pieces are cut or extended to the exact crossing of their carriers and joined there (no gap, no overlap); far ends never move. autoFillet: joined, then rounded by the circular arc fitted to the scan section round the corner (least-squares, tangent to both, outliers set aside); a sharp scan corner is joined sharp. fixedFillet: rounded at radius (mm). ends: which end of each piece is at the corner ("a"/"b"), the nearer ends by default. Returns the fillet radius, its arc id, and for autoFillet how far the scan points lie off the finished corner against tolerance (mm; the plan’s or 0.1): exceeds says the scan round is not circular and the arc misses the tolerance. One undo step.',
  input: obj(
    {
      sketch: featureRef('sketch'),
      pieces: arr(int('A piece’s id.'), 'The two pieces of the corner.', { minItems: 2, maxItems: 2 }),
      ends: arr(enumOf(['a', 'b'] as const, 'An end.'), 'The corner end of each piece, in the order of pieces.', { minItems: 2, maxItems: 2 }),
      mode: enumOf(['trim', 'autoFillet', 'fixedFillet'] as const, 'trim by default.'),
      radius: num('mm, for fixedFillet.', { exclusiveMinimum: 0 }),
      addDimension: bool('Put a radius dimension on the fillet (false by default).'),
      tolerance: num('mm either side of the scan for the fit check; the plan’s or 0.1 by default.', { exclusiveMinimum: 0 }),
      detail: detailIn,
    },
    ['sketch', 'pieces'],
  ),
  label: ({ mode = 'trim' }) => (mode === 'trim' ? 'corner trim' : mode === 'autoFillet' ? 'auto fillet' : 'fixed fillet'),
  run: async ({ sketch, pieces, ends, mode = 'trim', radius, addDimension = false, tolerance, detail = 'brief' }) => {
    const f = sketchNamed(sketch)
    const sk = cloneSketch(f.sketch)
    piecesOf(sk, f.name, pieces)
    if (mode === 'fixedFillet' && radius === undefined) invalid('radius: give the fillet radius in mm for fixedFillet.')
    let chains: Vec2[][] | undefined
    if (mode === 'autoFillet') {
      const d = re().sketchDraft
      chains = await chainsOn(f.plane, f.frame, d && d.featureId === f.id ? d.level : undefined)
      if (!chains.length) invalid('autoFillet: the scan does not cross this sketch’s plane. Use fixedFillet.')
    }
    const anchors: Anchor[] | undefined = ends ? pieces.map((entity, i) => ({ entity, at: ends[i] })) : undefined
    const result = buildCornerTrim(sk, pieces, { mode, radiusMm: radius ?? 1, addDimension }, [], anchors, chains)
    if (!result.ok) invalid(`corner: ${result.error}`)
    const tol = tolerance ?? usePlan.getState().plan?.target.tolerance ?? 0.1
    const fit = result.profile?.length && result.shape === 'arc' ? filletScanFit(result.sketch, result.changedIds, result.profile, tol) : null
    const arc = result.changedIds[2]
    const before = bodyRows(reverseSession())
    let solve: ReturnType<typeof putSketch> = null
    await change(() => {
      re().editSketch(f.id)
      // Built exactly on the pieces' carriers: put in as it is, so brushed
      // pieces are not refitted to their scan points (as the brush does).
      solve = result.exact ? putSketch(result.sketch, undefined, true) : putSketch(result.sketch, result.farAnchors)
      if (re().commitSketch() === null) throw new CommandError('failed', 'That leaves the sketch with nothing in it.')
    })
    const extra: Json = {
      mode,
      ...(result.shape ? { shape: result.shape } : {}),
      ...(result.radiusMm !== undefined && arc !== undefined ? { radius: round(result.radiusMm), arc } : {}),
      ...(fit ? { scanFit: { max: round(fit.maxMm), rms: round(fit.rmsMm), points: fit.points, outside: fit.over, tolerance: tol, exceeds: fit.exceeds } } : {}),
      ...(result.unswept ? { unswept: true } : {}),
      solve,
    }
    return featureAnswer(session(), f.id, extra, detail, before)
  },
}

// ----------------------------------------------------------------- pattern

const directionIn = (n: number) =>
  obj(
    {
      along: oneOf([enumOf(['u', 'v'] as const, 'The sheet axis.'), int('A line of the sketch, by id.')], 'Its direction; u by default for direction 1, v for 2.'),
      count: int(`Instances along it, the original counted (1–${MAX_INSTANCES}).`, { minimum: 1, maximum: MAX_INSTANCES }),
      spacing: num('mm between neighbours.'),
      flip: bool('The other way along it.'),
    },
    ['count', 'spacing'],
    `Direction ${n}.`,
  )

function directionOfIn(d: Json | undefined, fallback: 'u' | 'v'): LinearDirection {
  if (!d) return { on: false, ref: { kind: fallback === 'u' ? 'x' : 'y' }, count: 1, spacing: 10, flip: false }
  const along = (d.along ?? fallback) as 'u' | 'v' | number
  const ref: DirectionRef = typeof along === 'number' ? { kind: 'line', id: along } : { kind: along === 'u' ? 'x' : 'y' }
  return { on: true, ref, count: d.count as number, spacing: d.spacing as number, flip: Boolean(d.flip) }
}

function centreRefOf(sk: Sketch, name: string, given: unknown, fallback: CentreRef): { ref: CentreRef; typed: Vec2 | null } {
  if (given === undefined) return { ref: fallback, typed: null }
  if (Array.isArray(given)) return { ref: { kind: 'typed' }, typed: given as Vec2 }
  const e = piecesOf(sk, name, [given as number])[0]
  if (e.kind === 'point') return { ref: { kind: 'point', id: e.id }, typed: null }
  if (e.kind === 'circle' || e.kind === 'arc') return { ref: { kind: 'circle', id: e.id }, typed: null }
  return invalid(`${e.id} is a ${e.kind}: a centre is a point, a circle or an arc.`)
}

export const sketchPattern: Command<{ sketch: Ref; pieces: number[]; mode: PatternSpec['mode']; d1?: Json; d2?: Json; centre?: unknown; pivot?: unknown; count?: number; totalDeg?: number; clockwise?: boolean; stepDeg?: number; keepOrientation?: boolean; curve?: number; spacing?: number; reverse?: boolean; startOffset?: number; endOffset?: number; detail?: Detail }> = {
  name: 'pattern',
  title: 'Pattern sketch pieces',
  description:
    'Copies of pieces as the panel’s Duplicate → Pattern makes them; instance counts include the original, and every copy is an exact rigid motion of it. mode linear: d1 (and d2 for a grid) { along: "u" | "v" | a line’s id, count, spacing mm, flip }. circular: count over totalDeg (360 by default; a full turn never puts a copy on the original) about centre ([u, v], a point/circle/arc id; the origin by default), clockwise, keepOrientation. angular: count by stepDeg about pivot (the pieces’ own centre by default), keepOrientation. alongCurve: count along curve (a piece’s id, not one copied) equally by arc length — or by spacing mm when given — with startOffset, endOffset, reverse, keepOrientation (else each copy turns with the tangent); a closed curve never doubles its seam. Returns the copies’ ids (made) and a note when fewer fit. One undo step.',
  input: obj(
    {
      sketch: featureRef('sketch'),
      pieces: piecesIn('The pieces to copy.'),
      mode: enumOf(['linear', 'circular', 'angular', 'alongCurve'] as const, 'The kind of pattern.'),
      d1: directionIn(1),
      d2: directionIn(2),
      centre: centreIn('circular: the centre.'),
      pivot: centreIn('angular: the pivot.'),
      count: int('circular, angular, alongCurve: instances, the original counted.', { minimum: 1, maximum: MAX_INSTANCES }),
      totalDeg: num('circular: the angle the copies span, degrees.'),
      clockwise: bool('circular: clockwise (counter-clockwise by default).'),
      stepDeg: num('angular: degrees between neighbours (negative turns clockwise).'),
      keepOrientation: bool('circular, angular, alongCurve: copies keep the original’s orientation.'),
      curve: int('alongCurve: the guide piece.'),
      spacing: num('alongCurve: mm along the curve between neighbours (equal spacing when left out).'),
      reverse: bool('alongCurve: from the curve’s far end.'),
      startOffset: num('alongCurve: mm left free at the start.', { minimum: 0 }),
      endOffset: num('alongCurve: mm left free at the end.', { minimum: 0 }),
      detail: detailIn,
    },
    ['sketch', 'pieces', 'mode'],
  ),
  label: ({ mode, pieces }) => `${mode} pattern of ${pieces.length} sketch piece${pieces.length === 1 ? '' : 's'}`,
  run: (input) =>
    onSketch(input.sketch, input.detail ?? 'brief', (sk, name) => {
      piecesOf(sk, name, input.pieces)
      const need = (k: 'count' | 'stepDeg' | 'curve') => {
        if (input[k] === undefined) invalid(`${input.mode} takes ${k}.`)
        return input[k] as number
      }
      let spec: PatternSpec
      if (input.mode === 'linear') {
        if (!input.d1) invalid('linear takes d1.')
        spec = { mode: 'linear', d1: directionOfIn(input.d1, 'u'), d2: directionOfIn(input.d2, 'v') }
      } else if (input.mode === 'circular') {
        const c = centreRefOf(sk, name, input.centre, { kind: 'origin' })
        spec = { mode: 'circular', centre: c.typed ?? [0, 0], centreRef: c.ref, count: need('count'), totalDeg: input.totalDeg ?? 360, ccw: !input.clockwise, keepOrientation: Boolean(input.keepOrientation) }
      } else if (input.mode === 'angular') {
        const c = centreRefOf(sk, name, input.pivot, { kind: 'selection' })
        spec = { mode: 'angular', pivot: c.typed, pivotRef: c.ref, count: need('count'), stepDeg: need('stepDeg'), flip: false, keepOrientation: Boolean(input.keepOrientation) }
      } else {
        const curve = need('curve')
        piecesOf(sk, name, [curve])
        spec = { mode: 'alongCurve', curve, count: need('count'), equal: input.spacing === undefined, spacing: input.spacing ?? 0, reverse: Boolean(input.reverse), tangent: !input.keepOrientation, startOffset: input.startOffset ?? 0, endOffset: input.endOffset ?? 0 }
      }
      const r = applyPattern(sk, input.pieces, spec)
      const out = done(r, 'pattern')
      return { sketch: out.sketch, extra: { made: out.ids, ...(r.ok && r.note ? { note: r.note } : {}) } }
    }),
}

// ------------------------------------------------------------------ spline

export const sketchSpline: Command<{ sketch: Ref; piece: number; add?: Vec2; remove?: number; rebuild?: number; tangent?: { end: 'a' | 'b'; angleDeg: number | null }; detail?: Detail }> = {
  name: 'spline',
  title: 'Refine a sketch spline',
  description:
    'One change to a fit-point spline, as its right-click menu and end handles make it: add — a fit point on the curve nearest [u, v], the shape kept; remove — the fit point at that index (0 is the first; an open spline keeps 2, a closed one 3); rebuild — through that many points evenly by arc length, the ends kept, saying how far the curve moved (deviation, mm); tangent — { end: "a" | "b", angleDeg } holds that end’s direction (degrees counter-clockwise from +u), angleDeg null frees it. A control-pole spline is rebuilt before points are added or removed. Exactly one of add, remove, rebuild, tangent. Relations on later points follow their point. One undo step.',
  input: obj(
    {
      sketch: featureRef('sketch'),
      piece: int('The spline, by id.'),
      add: vec2('Where to add a fit point, [u, v] mm (it lands on the curve).'),
      remove: int('The index of the fit point to remove.', { minimum: 0 }),
      rebuild: int('How many fit points to rebuild through.', { minimum: 2, maximum: 400 }),
      tangent: obj({ end: enumOf(['a', 'b'] as const, 'The first (a) or last (b) point.'), angleDeg: oneOf([num(), { type: 'null' }], 'Degrees from +u, or null to free it.') }, ['end', 'angleDeg']),
      detail: detailIn,
    },
    ['sketch', 'piece'],
  ),
  label: ({ add, remove, rebuild }) => (add ? 'add a spline point' : remove !== undefined ? 'remove a spline point' : rebuild !== undefined ? 'rebuild a spline' : 'set a spline end direction'),
  run: ({ sketch, piece, add, remove, rebuild, tangent, detail = 'brief' }) =>
    onSketch(sketch, detail, (sk, name) => {
      const e = piecesOf(sk, name, [piece])[0]
      if (e.kind !== 'spline') invalid(`piece: ${piece} is a ${e.kind}, not a spline.`)
      const given = [add, remove, rebuild, tangent].filter((x) => x !== undefined).length
      if (given !== 1) invalid('Give exactly one of add, remove, rebuild, tangent.')
      if (add) {
        const r = insertSplinePoint(sk, piece, add)
        return { sketch: done(r, 'add').sketch, extra: r.ok && r.note ? { note: r.note } : {} }
      }
      if (remove !== undefined) {
        const r = removeSplinePoint(sk, piece, remove)
        return { sketch: done(r, 'remove').sketch, extra: r.ok && r.note ? { note: r.note } : {} }
      }
      if (rebuild !== undefined) {
        const r = rebuildSpline(sk, piece, rebuild)
        return { sketch: done(r, 'rebuild').sketch, extra: { ...(r.deviation !== undefined ? { deviation: r.deviation } : {}), ...(r.ok && r.note ? { note: r.note } : {}) } }
      }
      const t = tangent!
      if (t.angleDeg !== null && !Number.isFinite(t.angleDeg)) invalid('tangent.angleDeg: a finite number or null.')
      const r = setSplineEndDirection(sk, piece, t.end, t.angleDeg === null ? null : (t.angleDeg * Math.PI) / 180)
      return { sketch: done(r, 'tangent').sketch, extra: r.ok && r.note ? { note: r.note } : {} }
    }),
}

// ------------------------------------------------------------------ select

export const sketchSelect: Command<{ sketch: Ref; pieces?: number[]; near?: Vec2; within?: number; kind?: string; construction?: boolean }> = {
  name: 'select',
  title: 'Select sketch pieces',
  description:
    'Pieces of a sketch picked by id, kind, construction, or nearness to [u, v] (within mm, 1 by default) — every test given must hold. When the sketch is open in the editor they become its selection there, so the panel’s Mirror, Pattern, Offset and relations act on them; the status bar says the assistant picked them, so a pick made for you is never mistaken for your own. Returns the ids picked and whether the editor took them. Changes no geometry.',
  input: obj(
    {
      sketch: featureRef('sketch'),
      pieces: piecesIn('Only these ids.'),
      near: vec2('Pieces passing within `within` of this point, [u, v] mm.'),
      within: num('mm for near; 1 by default.', { exclusiveMinimum: 0 }),
      kind: enumOf(['line', 'arc', 'circle', 'spline', 'point'] as const, 'Only pieces of this kind.'),
      construction: bool('Only construction pieces (true) or only solid ones (false).'),
    },
    ['sketch'],
  ),
  readOnly: true,
  run: async ({ sketch, pieces, near, within = 1, kind, construction }) => {
    const f = sketchNamed(sketch)
    const d = re().sketchDraft
    const open = d && d.featureId === f.id
    const sk = open ? d.sketch : f.sketch
    if (pieces) piecesOf(sk, f.name, pieces)
    const picked = sk.entities.filter((e) => {
      if (pieces && !pieces.includes(e.id)) return false
      if (kind && e.kind !== kind) return false
      if (construction !== undefined && Boolean(e.construction) !== construction) return false
      if (near) return distanceTo(e, near) <= within
      return true
    })
    const ids = picked.map((e) => e.id)
    if (open) {
      useReverse.setState((st) => (st.sketchDraft ? { sketchDraft: { ...st.sketchDraft, selection: ids, selectedConstraint: null } } : {}))
      useStore.getState().setStatus(`The assistant selected ${ids.length} sketch piece${ids.length === 1 ? '' : 's'}.`)
    }
    return { sketch: { id: f.id, name: f.name }, picked: ids, kinds: picked.map((e) => e.kind), inEditor: Boolean(open) }
  },
}

/** How far a point is from a piece, mm (sampled along curves). */
function distanceTo(e: SketchEntity, p: Vec2): number {
  if (e.kind === 'point') return Math.hypot(e.p[0] - p[0], e.p[1] - p[1])
  const c = curveOf(e)
  if (!c) return Infinity
  let best = Infinity
  const n = 256
  for (let i = 0; i <= n; i++) {
    const q = c.at(c.paramAt((c.length * i) / n))
    best = Math.min(best, Math.hypot(q[0] - p[0], q[1] - p[1]))
  }
  return best
}

// ----------------------------------------------------------------- analyse

const round = (x: number, places = 4) => Math.round(x * 10 ** places) / 10 ** places

export const sketchAnalyse: Command<{ sketch: Ref; tolerance?: number; pieces?: number[]; curvature?: boolean; deviation?: boolean }> = {
  name: 'analyse',
  title: 'Analyse a sketch',
  description:
    'A sketch read as the panel’s Display → Analysis and Curvature show it, and checked: for every piece its length, and (deviation) how far it lies from the scan’s outline at the sketch plane — min/max/mean mm, the share of its length within ±tolerance, and the stretches outside it (from, to, max) — from the same cut and measure the Analysis colours use; (curvature) the true curvature: 1/r for an arc or circle, the tightest radius on a spline and where, 0 on a line. Then the whole: pass share, the pieces failing, closed regions, loose ends (open profile ends no other end meets), and the solve (under-constrained pieces, redundant relations). tolerance: mm, the plan’s or 0.1 by default. Changes nothing.',
  input: obj(
    {
      sketch: featureRef('sketch'),
      tolerance: num('mm either side of the scan; the plan’s tolerance or 0.1 by default.', { exclusiveMinimum: 0 }),
      pieces: piecesIn('Only these pieces; every one by default.'),
      curvature: bool('Read curvature (true by default).'),
      deviation: bool('Measure against the scan (true by default; needs a scan).'),
    },
    ['sketch'],
  ),
  readOnly: true,
  run: async ({ sketch, tolerance, pieces, curvature = true, deviation = true }) => {
    const f = sketchNamed(sketch)
    const sk = f.sketch
    const picked = pieces ? piecesOf(sk, f.name, pieces) : sk.entities
    const tol = tolerance ?? usePlan.getState().plan?.target.tolerance ?? 0.1
    let chains: Vec2[][] | null = null
    let deviationNote: string | null = null
    if (deviation) {
      try {
        const d = re().sketchDraft
        chains = await chainsOn(f.plane, f.frame, d && d.featureId === f.id ? d.level : undefined)
        if (chains.length === 0) deviationNote = 'The scan does not cross this sketch’s plane.'
      } catch (e) {
        deviationNote = e instanceof CommandError ? e.message : String(e)
      }
    }
    const whole = chains && chains.length > 0 ? sketchDeviation({ ...sk, entities: picked }, chains, tol) : null
    const out = picked.map((e) => {
      const c = curveOf(e)
      const row: Json = { id: e.id, kind: e.kind, ...(e.construction ? { construction: true } : {}), ...(c ? { length: round(c.length) } : {}) }
      if (curvature && c) {
        if (e.kind === 'line') row.curvature = { k: 0 }
        else if (e.kind === 'arc' || e.kind === 'circle') row.curvature = { k: round(1 / e.r, 6), radius: round(e.r) }
        else {
          const comb = exactComb(e, { ...DEFAULT_COMB, density: 200, smooth: 0 })
          const x = comb?.extreme
          if (x && Math.abs(x.k) > 1e-12) row.curvature = { kMax: round(Math.abs(x.k), 6), minRadius: round(1 / Math.abs(x.k)), at: [round(x.at[0]), round(x.at[1])], ...(comb && comb.breaks > 0 ? { corners: comb.breaks } : {}) }
          else row.curvature = { k: 0 }
        }
      }
      if (whole && !e.construction && e.kind !== 'point') {
        const one = sketchDeviation({ ...sk, entities: [e] }, chains!, tol, whole.reach)
        if (one && one.stats.samples > 0) {
          const outside = one.runs.filter((r) => r.cls === 'fail').map((r) => ({ from: r.pts[0].map((v) => round(v)), to: r.pts[r.pts.length - 1].map((v) => round(v)), max: round(Math.max(...r.d.map((v) => v ?? 0))) }))
          row.deviation = { min: round(one.stats.min), max: round(one.stats.max), mean: round(one.stats.mean), within: round(one.stats.passShare, 3), ...(outside.length > 0 ? { outside } : {}), ...(one.stats.unread > 0 ? { unread: one.stats.unread } : {}) }
        } else row.deviation = null
      }
      return row
    })
    const regions = findRegions(sk)
    const looseEnds = looseEndsOf(sk)
    const d = re().sketchDraft
    const report = d && d.featureId === f.id ? d.report : null
    return {
      sketch: { id: f.id, name: f.name },
      tolerance: tol,
      pieces: out,
      ...(whole ? { deviation: { within: round(whole.stats.passShare, 3), max: round(whole.stats.max), mean: round(whole.stats.mean), rms: round(whole.stats.rms), failing: whole.stats.failing } } : {}),
      ...(deviationNote ? { deviationNote } : {}),
      regions: regions.length,
      closed: looseEnds.length === 0 && regions.length > 0,
      ...(looseEnds.length > 0 ? { looseEnds } : {}),
      ...(report ? { solve: { ok: report.ok, underConstrained: report.underConstrained, redundant: report.redundant } } : {}),
    }
  },
}

/** Ends of solid lines, arcs and open splines that no other solid end
 *  meets (within 1e-6 mm): where a profile is open. */
function looseEndsOf(sk: Sketch): { piece: number; at: 'a' | 'b'; p: Vec2 }[] {
  const ends: { piece: number; at: 'a' | 'b'; p: Vec2 }[] = []
  for (const e of sk.entities) {
    if (e.construction) continue
    const c = curveOf(e)
    if (!c || c.closed) continue
    ends.push({ piece: e.id, at: 'a', p: c.at(0) }, { piece: e.id, at: 'b', p: c.at(c.end) })
  }
  return ends
    .filter((x, i) => !ends.some((y, j) => j !== i && Math.hypot(x.p[0] - y.p[0], x.p[1] - y.p[1]) < 1e-6))
    .map((x) => ({ ...x, p: [round(x.p[0]), round(x.p[1])] as Vec2 }))
}
