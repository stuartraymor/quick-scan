// SPDX-License-Identifier: AGPL-3.0-only
// Extend Surface (F8 of audit-2026-11-07/FREEFORM_ROADMAP.md): a sheet made
// larger past its edges by an offset. QUICKSURFACE 8.0.128's dialog picks an
// edge chain, an Extend type (Natural, Soft, Linear) and an Offset in mm; the
// body it makes replaces the surface it was made from.
//
// Measured on the native one (analysis/freeform-2026-11-09/, ext_*.py):
// the Fit Surface of the basic_part wall (a 5 × 5 degree-4 net, 217 × 385 mm),
// its whole edge chain, 10 mm, in each type — the result is one B-spline
// carrier (11 to 23 control points a side, wider than the 10 mm) trimmed by
// the parameter rectangle that lies 10 mm past the old edges: the corners
// of the new boundary stand 10.0 mm past the old ones along the surface, in
// all three types alike. Inside the old patch the carrier is the old surface
// re-fitted (0.05 mm mean, 0.09 mm most); past it, the three types part from
// one another by at most 0.8 mm (0.015 mm mean) at 10 mm on this surface, and
// from the old surface's own polynomial continuation by 0.06 mm mean, 1 mm
// most. This surface is too gentle to tell them apart further; here they are
// the three ways an edge is run on: Linear along its end tangent, Natural
// along the curve of its end (the tangent and the curvature held), Soft with
// that curvature faded to nothing at the offset.

import { SketchError } from './freeform/sketch'

export type ExtendType = 'natural' | 'soft' | 'linear'
export const EXTEND_TYPES: readonly ExtendType[] = ['natural', 'soft', 'linear']

/** The four edges of a patch's parameter box: u runs along a row of the grid, v down its columns. */
export type ExtendSide = 'u0' | 'u1' | 'v0' | 'v1'
export const EXTEND_SIDES: readonly ExtendSide[] = ['u0', 'u1', 'v0', 'v1']

/** Samples a side the sheet is read at, as the fill's grid: a face of 41 × 41 points is a patch of 40 × 40 spans. */
export const EXTEND_SAMPLES = 41
export const EXTEND_SAMPLES_MIN = 8
export const EXTEND_SAMPLES_MAX = 129

/** The most an edge is run on, mm: past it a quadratic run on is no longer the surface. */
export const EXTEND_MAX_FRACTION = 0.5

export const EXTEND_NOT_A_PATCH = 'Extend Surface runs on the edges of one sheet face that is a whole patch (a surface fitted through a grid, a Fill, a fitted or freeform patch): this one is trimmed, or has more than one face.'

type P3 = [number, number, number]

/** A grid of points, `rows` of `cols`, x y z each, row-major. */
export interface PointGrid {
  points: Float64Array
  rows: number
  cols: number
}

const at = (g: PointGrid, r: number, c: number): P3 => {
  const o = (r * g.cols + c) * 3
  return [g.points[o], g.points[o + 1], g.points[o + 2]]
}

const dist = (a: P3, b: P3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])

/**
 * The points an edge is run on by, `offset` mm past the last of `line` (the
 * edge's end, the line's points in order and nearly evenly spaced). A cubic
 * through the last four points, by their chord lengths, gives the end's
 * direction and curvature; the run-on is the quadratic of them: Linear
 * leaves the curvature out, Soft lets it fade to nothing over the offset.
 * `count` points are returned, the last `offset` past the end.
 */
export function runOn(line: readonly P3[], offset: number, count: number, type: ExtendType): P3[] {
  const n = line.length
  if (n < 4) throw new SketchError('an edge needs four points to be run on from.')
  const last = line[n - 1]
  // Chord lengths back from the last point: t = −d1, −d2, −d3.
  const t = [0, 0, 0]
  let run = 0
  for (let k = 1; k <= 3; k++) {
    run += dist(line[n - k], line[n - k - 1])
    t[k - 1] = -run
  }
  // The cubic p(s) = last + a1 s + a2 s² + a3 s³ through the three points behind: a 3 × 3 system, Cramer.
  const m = [
    [t[0], t[0] ** 2, t[0] ** 3],
    [t[1], t[1] ** 2, t[1] ** 3],
    [t[2], t[2] ** 2, t[2] ** 3],
  ]
  const det3 = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  const d = det3(m)
  if (!(Math.abs(d) > 1e-12)) throw new SketchError('an edge whose last points coincide cannot be run on.')
  const a1: P3 = [0, 0, 0]
  const a2: P3 = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const rhs = [line[n - 2][c] - last[c], line[n - 3][c] - last[c], line[n - 4][c] - last[c]]
    const col = (k: number) => m.map((row, i) => row.map((x, j) => (j === k ? rhs[i] : x)))
    a1[c] = det3(col(0)) / d
    a2[c] = det3(col(1)) / d
  }
  // The run-on is taken by arc: the speed of the cubic at its end is its chord length's rate, near one.
  const speed = Math.hypot(a1[0], a1[1], a1[2])
  if (!(speed > 1e-9)) throw new SketchError('an edge whose end has no direction cannot be run on.')
  const out: P3[] = []
  for (let k = 1; k <= count; k++) {
    const s = (offset * k) / count
    const bend = type === 'linear' ? 0 : type === 'soft' ? s * s - (s * s * s) / (3 * offset) : s * s
    out.push([last[0] + (a1[0] * s) / speed + (a2[0] * bend) / (speed * speed), last[1] + (a1[1] * s) / speed + (a2[1] * bend) / (speed * speed), last[2] + (a1[2] * s) / speed + (a2[2] * bend) / (speed * speed)])
  }
  return out
}

/** How many points an edge run on by `offset` gets: the grid's own spacing at its end, at least two, so the new points lie as the old do. */
export function runOnCount(spacing: number, offset: number): number {
  if (!(spacing > 1e-9)) return 2
  return Math.max(2, Math.min(40, Math.round(offset / spacing)))
}

/** The grid with the given sides run on by `offsets` mm (a side not named is left). The rows are run on first, then the columns of what that makes, so the corners are the run-on's run-on. */
export function extendGrid(grid: PointGrid, offsets: Partial<Record<ExtendSide, number>>, type: ExtendType): PointGrid {
  if (grid.rows < 4 || grid.cols < 4 || grid.points.length !== grid.rows * grid.cols * 3) throw new SketchError('the surface grid is malformed.')
  const lines = (g: PointGrid, alongU: boolean) => (alongU ? Array.from({ length: g.rows }, (_, r) => Array.from({ length: g.cols }, (_, c) => at(g, r, c))) : Array.from({ length: g.cols }, (_, c) => Array.from({ length: g.rows }, (_, r) => at(g, r, c))))
  // One direction: every line run on at its start (the line reversed) and its end.
  const along = (g: PointGrid, alongU: boolean, start: number, end: number): PointGrid => {
    const ls = lines(g, alongU)
    const spacing = (line: readonly P3[], atEnd: boolean) => (atEnd ? dist(line[line.length - 1], line[line.length - 2]) : dist(line[0], line[1]))
    // One count a side, from the middle line, so every line gets as many points.
    const mid = ls[Math.floor(ls.length / 2)]
    const head = start > 0 ? runOnCount(spacing(mid, false), start) : 0
    const tail = end > 0 ? runOnCount(spacing(mid, true), end) : 0
    const grown = ls.map((line) => {
      const before = head > 0 ? runOn([...line].reverse(), start, head, type).reverse() : []
      const after = tail > 0 ? runOn(line, end, tail, type) : []
      return [...before, ...line, ...after]
    })
    const length = grown[0].length
    const lineCount = grown.length
    const rows = alongU ? lineCount : length
    const cols = alongU ? length : lineCount
    const points = new Float64Array(rows * cols * 3)
    for (let l = 0; l < lineCount; l++) {
      for (let k = 0; k < length; k++) {
        const r = alongU ? l : k
        const c = alongU ? k : l
        points.set(grown[l][k], (r * cols + c) * 3)
      }
    }
    return { points, rows, cols }
  }
  const wide = offsets.u0 || offsets.u1 ? along(grid, true, offsets.u0 ?? 0, offsets.u1 ?? 0) : grid
  return offsets.v0 || offsets.v1 ? along(wide, false, offsets.v0 ?? 0, offsets.v1 ?? 0) : wide
}
