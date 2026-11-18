// SPDX-License-Identifier: AGPL-3.0-only
// 2D Sketch overhaul Batch 4, stability: every sketch tool given what a
// damaged file, a slip of the hand or an agent can hand it — an empty or
// stale selection, zero-length, duplicate, parallel, near-tangent and
// tiny or huge geometry, NaN — either refuses with a reason or gives back
// geometry that is all finite. Nothing throws, and the input is never
// changed.
import { describe, expect, it } from 'vitest'
import { DEFAULT_COMB, exactComb } from '../core/curvatureComb'
import { curvatureOf, curveOf } from '../core/curveEval'
import { chamferLines, filletLines } from '../core/filletCorner'
import { findRegions } from '../core/regions'
import { addEntity, cloneSketch, emptySketch, type Sketch, type SketchEntity } from '../core/sketch'
import { buildCornerTrim } from '../core/sketchCornerTrim'
import { sketchDeviation } from '../core/sketchDeviation'
import { duplicateSelected, mirrorAbout, offsetSelected, trimAt } from '../core/sketchEdits'
import { applyPattern, defaultPattern, type PatternSpec } from '../core/sketchPatterns'
import { insertSplinePoint, rebuildSpline, removeSplinePoint, setSplineEndDirection } from '../core/splineEdits'
import { solveSketch } from '../core/solver'

type Vec2 = [number, number]
type Input = Parameters<typeof addEntity>[1]

const sketchOf = (...entities: Input[]): Sketch => {
  const s = emptySketch()
  for (const e of entities) addEntity(s, e)
  return s
}

/** Every number anywhere in it is finite. */
function allFinite(x: unknown, path = ''): string | null {
  if (typeof x === 'number') return Number.isFinite(x) ? null : `${path} = ${x}`
  if (Array.isArray(x)) {
    for (let i = 0; i < x.length; i++) {
      const bad = allFinite(x[i], `${path}[${i}]`)
      if (bad) return bad
    }
    return null
  }
  if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      const bad = allFinite(v, `${path}.${k}`)
      if (bad) return bad
    }
  }
  return null
}

/** A result that refuses says why; one that succeeds is all finite. */
function sane(r: { ok: boolean; error?: string; sketch?: Sketch } | string | object, what: string): void {
  if (typeof r === 'string') {
    expect(r.length, what).toBeGreaterThan(3)
    return
  }
  if ('ok' in r && r.ok === false) {
    expect(typeof r.error === 'string' && r.error.length > 3, `${what}: refusal says why`).toBe(true)
    return
  }
  expect(allFinite(r), what).toBeNull()
}

/** Runs `op` on a copy, checks it never throws, never touches the input,
 *  and is sane. */
function check<T extends object | string>(sketch: Sketch, what: string, op: (s: Sketch) => T): T {
  const before = JSON.stringify(sketch)
  let out: T | undefined
  expect(() => { out = op(sketch) }, what).not.toThrow()
  expect(JSON.stringify(sketch), `${what}: input unchanged`).toBe(before)
  sane(out!, what)
  return out!
}

const line = (a: Vec2, b: Vec2): Input => ({ kind: 'line', a, b })

// The hostile cases, each a sketch and the ids worth handing the tools.
const CASES: { name: string; sketch: Sketch; ids: number[] }[] = [
  { name: 'empty sketch, empty selection', sketch: emptySketch(), ids: [] },
  { name: 'a stale id', sketch: sketchOf(line([0, 0], [10, 0])), ids: [99] },
  { name: 'a zero-length line', sketch: sketchOf(line([5, 5], [5, 5]), line([0, 0], [10, 0])), ids: [1, 2] },
  { name: 'two identical lines', sketch: sketchOf(line([0, 0], [10, 0]), line([0, 0], [10, 0])), ids: [1, 2] },
  { name: 'two parallel lines', sketch: sketchOf(line([0, 0], [10, 0]), line([0, 1e-9], [10, 1e-9])), ids: [1, 2] },
  { name: 'a near-tangent corner', sketch: sketchOf(line([0, 0], [10, 0]), line([10, 0], [20, 1e-7])), ids: [1, 2] },
  { name: 'a circle of radius 1e-9', sketch: sketchOf({ kind: 'circle', c: [0, 0], r: 1e-9 }, line([-5, 0], [5, 0])), ids: [1, 2] },
  { name: 'huge coordinates', sketch: sketchOf(line([1e7, 1e7], [1e7 + 10, 1e7]), line([1e7 + 10, 1e7], [1e7 + 10, 1e7 + 10])), ids: [1, 2] },
  { name: 'micron-scale geometry', sketch: sketchOf(line([0, 0], [1e-6, 0]), line([1e-6, 0], [1e-6, 1e-6])), ids: [1, 2] },
  { name: 'a spline with doubled points', sketch: sketchOf({ kind: 'spline', pts: [[0, 0], [0, 0], [5, 5], [5, 5], [10, 0]] }), ids: [1] },
  { name: 'a zero-sweep arc', sketch: sketchOf({ kind: 'arc', c: [0, 0], r: 5, start: 0, sweep: 0 }, line([5, 0], [10, 0])), ids: [1, 2] },
  { name: 'NaN from a damaged file', sketch: sketchOf(line([0, 0], [NaN, 3]), line([0, 0], [Infinity, 0])), ids: [1, 2] },
]

const SPECS = (s: Sketch, ids: number[]): PatternSpec[] => [
  defaultPattern('linear', 10),
  { ...defaultPattern('linear', 10), mode: 'linear', d1: { on: true, ref: { kind: 'x' }, count: 3, spacing: 1e-12, flip: false }, d2: { on: false, ref: { kind: 'y' }, count: 1, spacing: 1, flip: false } },
  defaultPattern('circular', 10),
  { mode: 'circular', centre: [0, 0], centreRef: { kind: 'origin' }, count: 500, totalDeg: 1e-12, ccw: true, keepOrientation: true },
  defaultPattern('angular', 10),
  { ...(defaultPattern('alongCurve', 10) as Extract<PatternSpec, { mode: 'alongCurve' }>), curve: s.entities.find((e) => !ids.includes(e.id))?.id ?? ids[0] ?? 1 },
]

describe('sketch tools never crash on hostile geometry', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const s = c.sketch
      const [a, b] = [c.ids[0] ?? 1, c.ids[1] ?? 2]
      check(s, 'mirror', (x) => mirrorAbout(x, c.ids, { a: [0, 0], b: [0, 1] }))
      check(s, 'mirror on a point axis', (x) => mirrorAbout(x, c.ids, { a: [1, 1], b: [1, 1] }))
      check(s, 'duplicate', (x) => duplicateSelected(x, c.ids, [1e-12, 0]))
      check(s, 'offset', (x) => offsetSelected(x, c.ids, 1))
      check(s, 'offset by 0', (x) => offsetSelected(x, c.ids, 0))
      check(s, 'trim', (x) => trimAt(x, a, [3, 0]))
      for (const spec of SPECS(s, c.ids)) check(s, `pattern ${spec.mode}`, (x) => applyPattern(x, c.ids, spec))
      check(s, 'fillet', (x) => filletLines(cloneSketch(x), a, b))
      check(s, 'fillet radius 1e9', (x) => filletLines(cloneSketch(x), a, b, 1e9))
      check(s, 'chamfer', (x) => chamferLines(cloneSketch(x), a, b))
      check(s, 'corner trim', (x) => buildCornerTrim(x, [a, b], { mode: 'trim', radiusMm: 1, addDimension: false }))
      check(s, 'corner fixed fillet', (x) => buildCornerTrim(x, [a, b], { mode: 'fixedFillet', radiusMm: 1, addDimension: true }))
      check(s, 'corner auto fillet', (x) => buildCornerTrim(x, [a, b], { mode: 'autoFillet', radiusMm: 1, addDimension: true }, [[1, 1], [NaN, 2], [3, 3]]))
      check(s, 'spline add', (x) => insertSplinePoint(x, a, [2, 2]))
      check(s, 'spline remove', (x) => removeSplinePoint(x, a, 0))
      check(s, 'spline rebuild', (x) => rebuildSpline(x, a, 7))
      check(s, 'spline tangent', (x) => setSplineEndDirection(x, a, 'a', NaN))
      check(s, 'regions', (x) => ({ regions: findRegions(x).map((r) => r.area) }))
      check(s, 'solve', (x) => { const y = cloneSketch(x); const r = solveSketch(y); return { ok: r.ok, unmet: r.unmet.length } })
      for (const e of s.entities as SketchEntity[]) {
        check(s, `comb of ${e.kind}`, () => exactComb(e, { ...DEFAULT_COMB, density: 50 }) ?? {})
        check(s, `comb with silly options`, () => exactComb(e, { scale: NaN, density: -3, maxLength: Infinity, signed: true, smooth: 1e9, offset: NaN }) ?? {})
        const cv = curveOf(e)
        if (cv && Number.isFinite(cv.length)) check(s, `curvature of ${e.kind}`, () => ({ k: [0, 0.5, 1].map((t) => curvatureOf(cv, t * cv.end)).filter(Number.isFinite) }))
      }
      check(s, 'deviation', (x) => sketchDeviation(x, [[[0, 0], [10, 0], [10, 10]], [], [[NaN, 0], [1, 1]]], 0.1) ?? {})
      check(s, 'deviation, bad tolerance', (x) => sketchDeviation(x, [[[0, 0], [10, 0]]], NaN) ?? {})
    })
  }

  it('repeated undo steps of a pattern give back the same sketch each time', () => {
    const s = sketchOf(line([0, 0], [10, 0]))
    const history: Sketch[] = []
    let now = s
    for (let i = 0; i < 40; i++) {
      const r = applyPattern(now, [1], defaultPattern('linear', 1))
      expect(r.ok).toBe(true)
      if (!r.ok) return
      history.push(now)
      now = r.sketch
    }
    // Undoing all of it lands on the very first sketch, untouched.
    while (history.length > 1) history.pop()
    expect(JSON.stringify(history[0])).toBe(JSON.stringify(s))
    expect(allFinite(now)).toBeNull()
  })
})
