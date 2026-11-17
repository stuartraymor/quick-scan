// SPDX-License-Identifier: AGPL-3.0-only
// Live tolerance analysis (2D Sketch overhaul 4): how far each portion of
// the sketch lies from the scan's section contour on the same sheet.
//
// The contour is the sketch's own section chains (already in this sheet's
// coordinates, so the plane and its transform are the sketch's). Its
// segments go into a uniform grid once per chain set; every sample along a
// piece then looks only in the cells round it. A sample with no contour
// within reach has no reading — it is never coloured as if it had one.
// Portions are split where the deviation crosses the tolerance, so one line
// can pass along part of its length and fail along the rest.

import type { Vec2 } from '../../../src/core/flat/types'
import { entityPolyline, type Sketch, type SketchEntity } from './sketch'

export type DeviationMode = 'passFail' | 'gradient'

export interface DeviationRun {
  pts: Vec2[]
  /** pass: within ±tolerance; fail: outside; none: no contour within reach. */
  cls: 'pass' | 'fail' | 'none'
  /** Mean deviation of the run over the tolerance. */
  ratio: number
  /** The deviation at each point of the run, mm (null: no reading). */
  d: (number | null)[]
}

export interface DeviationStats {
  /** Samples that found the contour. */
  samples: number
  /** Samples with no contour within reach. */
  unread: number
  min: number
  max: number
  mean: number
  rms: number
  /** Share of the read length within tolerance, 0–1. */
  passShare: number
  /** The pieces with any length outside tolerance. */
  failing: number[]
}

export interface SketchDeviation { runs: DeviationRun[]; stats: DeviationStats; reach: number }

interface SegmentGrid { cell: number; cells: Map<string, number[]>; segs: Float64Array; count: number; diagonal: number }

const gridCache = new WeakMap<readonly (readonly Vec2[])[], SegmentGrid>()

function median(xs: number[]): number {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** The contour's segments in a grid, built once per chain set. Each chain
 *  is one connected run along the mesh (a flat face gives a long step); the
 *  chains themselves are never joined to each other. */
export function contourGrid(chains: readonly (readonly Vec2[])[]): SegmentGrid | null {
  const hit = gridCache.get(chains)
  if (hit) return hit
  const lengths: number[] = []
  const segs: number[] = []
  for (const c of chains) {
    for (let i = 1; i < c.length; i++) {
      const a = c[i - 1], b = c[i]
      if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) continue
      segs.push(a[0], a[1], b[0], b[1])
      lengths.push(Math.hypot(b[0] - a[0], b[1] - a[1]))
    }
    // A lone point still counts, as a segment of no length.
    if (c.length === 1 && c[0].every(Number.isFinite)) { segs.push(c[0][0], c[0][1], c[0][0], c[0][1]); lengths.push(0) }
  }
  const count = segs.length / 4
  if (!count) return null
  const longest = Math.max(...lengths)
  const usual = median(lengths.filter((l) => l > 0)) || longest || 1
  // Cells of a few usual steps, but never so small that the longest step
  // crosses more than a few hundred of them.
  const cell = Math.max(usual * 4, longest / 256, 1e-6)
  const cells = new Map<string, number[]>()
  for (let s = 0; s < count; s++) {
    const ax = segs[4 * s], ay = segs[4 * s + 1], bx = segs[4 * s + 2], by = segs[4 * s + 3]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (cell / 2)))
    let last = ''
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n
      // The cell and its neighbours: a segment passing a cell's corner is
      // found from either side.
      const ci = Math.floor(x / cell), cj = Math.floor(y / cell), key = `${ci},${cj}`
      if (key === last) continue
      last = key
      const list = cells.get(key)
      if (!list) cells.set(key, [s]); else if (list[list.length - 1] !== s) list.push(s)
    }
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (let i = 0; i < segs.length; i += 2) { x0 = Math.min(x0, segs[i]); x1 = Math.max(x1, segs[i]); y0 = Math.min(y0, segs[i + 1]); y1 = Math.max(y1, segs[i + 1]) }
  const grid: SegmentGrid = { cell, cells, segs: Float64Array.from(segs), count, diagonal: Math.hypot(x1 - x0, y1 - y0) }
  gridCache.set(chains, grid)
  return grid
}

/** The distance from `p` to the nearest contour segment within `reach`, or
 *  null when there is none. */
export function contourDistance(grid: SegmentGrid, p: Vec2, reach: number): number | null {
  const { cell, cells, segs } = grid
  const ring = Math.min(Math.ceil(reach / cell) + 1, 64)
  const ci = Math.floor(p[0] / cell), cj = Math.floor(p[1] / cell)
  let best = Infinity
  const seen = new Set<number>()
  for (let r = 0; r <= ring; r++) {
    // Cells at Chebyshev ring r; once the best is closer than ring r's near
    // edge, nothing further can beat it.
    // (A segment is filed in the cells it passes, give or take one.)
    if (best < (r - 2) * cell) break
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue
      const list = cells.get(`${i},${j}`)
      if (!list) continue
      for (const s of list) {
        if (seen.has(s)) continue
        seen.add(s)
        const ax = segs[4 * s], ay = segs[4 * s + 1], dx = segs[4 * s + 2] - ax, dy = segs[4 * s + 3] - ay
        const l2 = dx * dx + dy * dy
        let t = l2 > 0 ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))
        if (d < best) best = d
      }
    }
  }
  return best <= reach ? best : null
}

const entityCache = new Map<string, { d: (number | null)[]; pts: Vec2[] }>()
const ENTITY_CACHE_MAX = 4000

/** Points along a piece no further apart than `step` (at most 4000): a
 *  line's own outline is just its two ends. */
function samplesOf(e: SketchEntity, step: number): Vec2[] {
  const rough = entityPolyline(e, 256)
  let length = 0
  for (let i = 1; i < rough.length; i++) length += Math.hypot(rough[i][0] - rough[i - 1][0], rough[i][1] - rough[i - 1][1])
  const budget = Math.max(16, Math.min(4000, Math.ceil(length / Math.max(step, 1e-9))))
  const out: Vec2[] = rough.length ? [rough[0]] : []
  for (let i = 1; i < rough.length; i++) {
    const a = rough[i - 1], b = rough[i], l = Math.hypot(b[0] - a[0], b[1] - a[1])
    const k = Math.max(1, Math.min(budget, Math.ceil((l / Math.max(length, 1e-12)) * budget)))
    for (let j = 1; j <= k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k])
  }
  return out
}

/** Each drawn piece's deviation from the contour, split into runs where it
 *  crosses the tolerance. `reach` is how far a sample looks for the
 *  contour; beyond it a portion has no reading. */
export function sketchDeviation(sketch: Sketch, chains: readonly (readonly Vec2[])[], tolerance: number, reach?: number): SketchDeviation | null {
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) return null
  const grid = contourGrid(chains)
  if (!grid) return null
  const pieces = sketch.entities.filter((e) => !e.construction && e.kind !== 'point')
  // Reach: a twentieth of the section's size — a piece that far off reads
  // as failing, one further off (a construction aid, another feature) has
  // no reading. It does not grow with the tolerance, so a looser tolerance
  // never makes more pieces fail; only a tolerance beyond half the reach
  // widens it.
  const look = reach ?? Math.max(grid.diagonal * 0.05, tolerance * 2, grid.cell * 2)
  const step = Math.max(grid.cell / 4, tolerance / 4)
  const runs: DeviationRun[] = []
  let samples = 0, unread = 0, min = Infinity, max = 0, sum = 0, sum2 = 0, passLen = 0, readLen = 0
  const failing: number[] = []
  for (const e of pieces) {
    const key = `${JSON.stringify(e)}|${look}|${step}|${grid.count}`
    let hit = entityCache.get(key)
    if (!hit || gridCache.get(chains) !== grid) {
      const pts = samplesOf(e, step)
      hit = { pts, d: pts.map((p) => contourDistance(grid, p, look)) }
      if (entityCache.size > ENTITY_CACHE_MAX) entityCache.clear()
      entityCache.set(key, hit)
    }
    const { pts, d } = hit
    let failed = false
    const classOf = (v: number | null) => (v === null ? 'none' : v <= tolerance ? 'pass' : 'fail') as DeviationRun['cls']
    let run: DeviationRun | null = null, runSum = 0, runN = 0
    const close = () => { if (run && run.pts.length > 1) { run.ratio = runN ? runSum / runN / tolerance : 0; runs.push(run) } }
    for (let i = 0; i < pts.length; i++) {
      const v = d[i]
      if (v !== null) { samples++; if (v < min) min = v; if (v > max) max = v; sum += v; sum2 += v * v } else unread++
      if (v !== null && v > tolerance) failed = true
      const cls = classOf(v)
      if (!run) { run = { pts: [pts[i]], d: [v], cls, ratio: 0 }; runSum = v ?? 0; runN = v === null ? 0 : 1; continue }
      const prev = d[i - 1], seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
      if (prev !== null && v !== null) { readLen += seg; passLen += seg * (((prev <= tolerance ? 1 : 0) + (v <= tolerance ? 1 : 0)) / 2) }
      if (cls === run.cls) { run.pts.push(pts[i]); run.d.push(v); if (v !== null) { runSum += v; runN++ }; continue }
      // Split where the deviation crosses the tolerance, between samples.
      let cut: Vec2 = pts[i - 1], cutD: number | null = null
      if (prev !== null && v !== null && prev !== v) {
        const t = Math.min(1, Math.max(0, (tolerance - prev) / (v - prev)))
        cut = [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])]
        cutD = tolerance
      } else if (prev === null || v === null) cut = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2]
      run.pts.push(cut); run.d.push(cutD ?? prev)
      close()
      run = { pts: [cut, pts[i]], d: [cutD ?? v, v], cls, ratio: 0 }; runSum = v ?? 0; runN = v === null ? 0 : 1
    }
    close()
    if (failed) failing.push(e.id)
  }
  const stats: DeviationStats = {
    samples, unread,
    min: samples ? min : 0, max, mean: samples ? sum / samples : 0, rms: samples ? Math.sqrt(sum2 / samples) : 0,
    passShare: readLen > 0 ? passLen / readLen : 0, failing,
  }
  return { runs, stats, reach: look }
}

/** Gradient colour for a deviation over tolerance ratio: green at 0, amber
 *  at the tolerance, red at twice it and beyond. */
export function gradientColor(ratio: number): string {
  const r = Math.max(0, Math.min(2, ratio)) / 2
  const stops: [number, [number, number, number]][] = [[0, [47, 191, 113]], [0.5, [240, 190, 50]], [1, [229, 72, 77]]]
  let k = 0
  while (k < stops.length - 2 && r > stops[k + 1][0]) k++
  const [t0, c0] = stops[k], [t1, c1] = stops[k + 1]
  const f = (r - t0) / (t1 - t0 || 1)
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0')
  return `#${hex(c0[0] + f * (c1[0] - c0[0]))}${hex(c0[1] + f * (c1[1] - c0[1]))}${hex(c0[2] + f * (c1[2] - c0[2]))}`
}

export const PASS_COLOR = '#2fbf71'
export const FAIL_COLOR = '#e5484d'

/** A run cut into pieces of one gradient colour each: the deviation over
 *  the tolerance quantised to `levels` steps per tolerance. */
export function gradientPieces(run: DeviationRun, tolerance: number, levels = 8): { pts: Vec2[]; color: string }[] {
  const out: { pts: Vec2[]; color: string }[] = []
  for (let i = 1; i < run.pts.length; i++) {
    const a = run.d[i - 1], b = run.d[i]
    if (a === null || b === null) continue
    const level = Math.round(((a + b) / 2 / tolerance) * levels) / levels
    const color = gradientColor(level)
    const last = out.at(-1)
    if (last && last.color === color && last.pts.at(-1) === run.pts[i - 1]) last.pts.push(run.pts[i])
    else out.push({ pts: [run.pts[i - 1], run.pts[i]], color })
  }
  return out
}
