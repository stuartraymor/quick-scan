// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.8: the last fillet Corner Trim made can have its radius changed (the
// panel field or the square handle on the arc), and Auto Fillet says when
// the scan's round is not circular enough for an arc within the sketch
// tolerance. Everything runs through the stores the GUI calls, on pieces
// brushed with Fit Line and Fit Arc (see reFittedCornerStress.test.ts for
// why scripted pieces are not enough).
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { arcMiddle, filletScanFit, radiusFromHandle, tidyRadius } from '../core/filletFit'
import { pointsUnderPath } from '../core/instantFit'
import { anchorPoint, cloneSketch, emptySketch, addEntity, type Sketch, type SketchArc, type SketchLine } from '../core/sketch'
import { brushPoints, type BrushPoint } from '../core/sketchBrush'
import type { CornerTrimMode } from '../core/sketchCornerTrim'
import { useReverse } from '../state/reStore'
import { useSketchAnalysis } from '../state/sketchAnalysisStore'
import { useSketchBrush } from '../state/sketchBrushStore'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'
import { along, dist, makeCase, rng, type CarrierT } from './cornerCaseGenerator'

const XY = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], basisU: [1, 0, 0] as [number, number, number], basisV: [0, 1, 0] as [number, number, number] }
const draft = () => useReverse.getState().sketchDraft!
const sketchNow = (): Sketch => draft().sketch
type Piece = SketchLine | SketchArc
const ct = useSketchCornerTrim

function openSketch() {
  useReverse.getState().reset()
  useReverse.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
  useSketchBrush.setState({ primitive: 'line', instant: true, tolerance: 0.1, axisDegrees: 1, curvePoints: 8, selected: [], selectionOverflow: false, preview: null, message: null })
  useSketchAnalysis.getState().setToleranceMm(0.1)
}

function brush(kind: 'line' | 'arc', scan: readonly BrushPoint[], stroke: readonly Vec2[], radius: number): Piece {
  const selected = pointsUnderPath(scan, stroke, radius)
  if (!selected || selected.length < 3) throw new Error('nothing under the brush')
  const before = new Set(sketchNow().entities.map((e) => e.id))
  useSketchBrush.setState({ primitive: kind, selected, selectionOverflow: false })
  if (!useSketchBrush.getState().apply()) throw new Error(useSketchBrush.getState().message ?? 'fit failed')
  const made = sketchNow().entities.find((e) => !before.has(e.id))
  if (!made || (made.kind !== 'line' && made.kind !== 'arc')) throw new Error('fit made no line or arc')
  return made
}

/** A section: the u axis, a round, then up the v axis, like a plate corner.
 *  `round(t)` gives the corner's curve for t in [0, 1] from (rx, 0)-ish to (0, ry)-ish. */
function plateCorner(round: (t: number) => Vec2, step = 0.1): Vec2[][] {
  const pts: Vec2[] = []
  const first = round(0), last = round(1)
  for (let x = 40; x > first[0]; x -= step) pts.push([x, 0])
  for (let i = 0; i <= 200; i++) pts.push(round(i / 200))
  for (let y = last[1]; y < 40; y += step) pts.push([0, y])
  return [pts]
}
// A round of radius 5 tangent to y = 0 and x = 0, centre (5, 5).
const circular = (r: number) => (t: number): Vec2 => { const a = -Math.PI / 2 - t * Math.PI / 2; return [r + r * Math.cos(a), r + r * Math.sin(a)] }
// A quarter ellipse 3 × 9: not a circle.
const elliptical = (t: number): Vec2 => { const a = -Math.PI / 2 - t * Math.PI / 2; return [9 + 9 * Math.cos(a), 3 + 3 * Math.sin(a)] }

function sweepCorner(mode: CornerTrimMode, radiusMm: number, stroke: Vec2[], radius: number, chains: Vec2[][]) {
  ct.getState().setOpen(true)
  ct.setState({ mode, radiusMm, addDimension: false })
  let ok = ct.getState().sweep(stroke, radius, chains.flat(), chains)
  if (!ok && ct.getState().pending) ok = ct.getState().acceptPending()
  return ok
}

const offTangent = (fillet: SketchArc, piece: Piece, at: Vec2) => {
  const radial: Vec2 = [(at[0] - fillet.c[0]) / fillet.r, (at[1] - fillet.c[1]) / fillet.r]
  if (piece.kind === 'line') { const d: Vec2 = [piece.b[0] - piece.a[0], piece.b[1] - piece.a[1]], l = Math.hypot(d[0], d[1]); return Math.abs((radial[0] * d[0] + radial[1] * d[1]) / l) }
  const other: Vec2 = [(at[0] - piece.c[0]) / piece.r, (at[1] - piece.c[1]) / piece.r]
  return Math.abs(radial[0] * other[1] - radial[1] * other[0])
}

/** The fillet arc of the sketch joins both pieces without a gap and tangent. */
function checkFillet(s: Sketch, arcId: number, ids: readonly number[]) {
  const arc = s.entities.find((e) => e.id === arcId) as SketchArc
  expect(arc?.kind).toBe('arc')
  const fe = [anchorPoint(arc, 'a'), anchorPoint(arc, 'b')]
  for (const id of ids) {
    const p = s.entities.find((e) => e.id === id) as Piece
    const ends = [anchorPoint(p, 'a'), anchorPoint(p, 'b')]
    let best = Infinity, at = fe[0]
    for (const x of ends) for (const y of fe) if (dist(x, y) < best) { best = dist(x, y); at = y }
    expect(best).toBeLessThan(1e-6)
    expect(offTangent(arc, p, at)).toBeLessThan(1e-6)
  }
  return arc
}

describe('fillet helpers', () => {
  it('scan fit reads exact distances against the tolerance', () => {
    const s = emptySketch()
    const a = addEntity(s, { kind: 'line', a: [10, 0], b: [40, 0] } as never)
    const fit = filletScanFit(s, [a], [[20, 0.05], [30, -0.2], [25, 0]], 0.1)!
    expect(fit.maxMm).toBeCloseTo(0.2, 12)
    expect(fit.over).toBe(1)
    expect(fit.exceeds).toBe(true)
    expect(filletScanFit(s, [a], [[20, 0.05]], 0.1)!.exceeds).toBe(false)
  })
  it('the handle scales the radius along the corner–middle line', () => {
    // Two lines at 90°: corner (0,0), R 5 centre (5,5), middle 5(1 − 1/√2)(1,1).
    const r = 5, m = r * (1 - Math.SQRT1_2)
    const middle: Vec2 = [m, m]
    expect(radiusFromHandle([0, 0], middle, r, middle)).toBeCloseTo(5, 12)
    expect(radiusFromHandle([0, 0], middle, r, [2 * m, 2 * m])).toBeCloseTo(10, 12)
    // Off the line: only the part along it counts.
    expect(radiusFromHandle([0, 0], middle, r, [2 * m + 3, 2 * m - 3])).toBeCloseTo(10, 12)
    expect(radiusFromHandle([0, 0], middle, r, [-1, -1])).toBeNull()
    expect(tidyRadius(4.996, 'mm')).toBeCloseTo(5, 12)
    expect(tidyRadius(25.41, 'in')).toBeCloseTo(25.4, 12)
    expect(arcMiddle({ c: [0, 0], r: 2, start: 0, sweep: Math.PI })).toEqual([expect.closeTo(0, 12), expect.closeTo(2, 12)])
  })
})

describe('Auto Fillet on brushed lines: radius editing and the tolerance check', () => {
  it('R5 plate corner: fitted, within tolerance; radius typed 3, 7.5 then undone', () => {
    openSketch()
    const chains = plateCorner(circular(5)), scan = brushPoints(chains)
    const h = brush('line', scan, [[38, 0], [12, 0]], 1)
    const v = brush('line', scan, [[0, 12], [0, 38]], 1)
    expect(sweepCorner('autoFillet', 1, [[12, 0], [0, 0], [0, 12]], 1.5, chains)).toBe(true)
    const s = ct.getState()
    expect(s.lastFillet).not.toBeNull()
    expect(s.lastFillet!.radiusMm).toBeCloseTo(5, 2)
    expect(s.lastFit?.scanFit?.exceeds).toBe(false)
    expect(s.lastFit?.scanFit?.maxMm).toBeLessThan(0.05)
    const arcId = s.lastFillet!.arcId
    checkFillet(sketchNow(), arcId, [h.id, v.id])
    const farOf = (e: Piece) => [anchorPoint(e, 'a'), anchorPoint(e, 'b')].sort((p, q) => dist(q, [0, 0]) - dist(p, [0, 0]))[0]
    const far = { h: farOf(h), v: farOf(v) }
    const filleted = cloneSketch(sketchNow()), steps = draft().history.length

    // The handle's preview changes nothing in the sketch.
    expect(ct.getState().previewFilletRadius(4)).toBe(true)
    expect(ct.getState().radiusPreview?.radiusMm).toBe(4)
    expect(JSON.stringify(sketchNow())).toBe(JSON.stringify(filleted))
    expect(ct.getState().previewFilletRadius(null)).toBe(false)
    expect(ct.getState().radiusPreview).toBeNull()

    for (const r of [3, 7.5]) {
      expect(ct.getState().setFilletRadius(r)).toBe(true)
      const arc = checkFillet(sketchNow(), arcId, [h.id, v.id])
      expect(arc.r).toBeCloseTo(r, 9)
      // Centre on the bisector of the right-angle corner.
      expect(arc.c[0]).toBeCloseTo(r, 6); expect(arc.c[1]).toBeCloseTo(r, 6)
      // Far ends held.
      const ends = sketchNow().entities.filter((e) => e.id === h.id || e.id === v.id).flatMap((e) => [anchorPoint(e, 'a'), anchorPoint(e, 'b')])
      expect(Math.min(...ends.map((p) => dist(p, far.h)))).toBeLessThan(1e-9)
      expect(Math.min(...ends.map((p) => dist(p, far.v)))).toBeLessThan(1e-9)
      // The handle follows the new arc.
      expect(dist(ct.getState().lastFillet!.middle, arcMiddle(arc))).toBeLessThan(1e-12)
    }
    // 3 is off the scan's R5 round by more than 0.1: said.
    expect(ct.getState().lastFit?.scanFit?.exceeds).toBe(true)
    expect(draft().history.length).toBe(steps + 2)
    // A later plain solve moves nothing.
    const settled = cloneSketch(sketchNow())
    useReverse.getState().setSketch(cloneSketch(settled))
    for (const e of settled.entities) for (const at of ['a', 'b'] as const) {
      if (e.kind !== 'line' && e.kind !== 'arc') continue
      const l = sketchNow().entities.find((x) => x.id === e.id)!
      expect(dist(anchorPoint(e, at), anchorPoint(l, at))).toBeLessThan(1e-4)
    }
    useReverse.getState().undoSketch()
    // Each radius change is one undo step; two back is the fitted R5.
    useReverse.getState().undoSketch(); useReverse.getState().undoSketch()
    expect(JSON.stringify(sketchNow())).toBe(JSON.stringify(filleted))
    // Undo back onto the fitted R5: it is the fillet the field edits again,
    // with its own fit text (the panel no longer shows the 3 or 7.5).
    expect(ct.getState().lastFillet?.radiusMm).toBeCloseTo(5, 2)
    expect(ct.getState().lastFit?.rms).toBeDefined()
    expect(ct.getState().lastFit?.scanFit?.exceeds).toBe(false)
    expect(ct.getState().message).toMatch(/Radius restored/)
    // Redo onto 3, then a new radius from there.
    useReverse.getState().redoSketch()
    expect(ct.getState().lastFillet?.radiusMm).toBe(3)
    expect(ct.getState().lastFit?.radiusMm).toBe(3)
    expect(ct.getState().setFilletRadius(4)).toBe(true)
    expect(checkFillet(sketchNow(), arcId, [h.id, v.id]).r).toBeCloseTo(4, 9)
    // Undo past the fillet: nothing is said about it any more.
    for (let i = 0; i < 3; i++) useReverse.getState().undoSketch()
    expect(ct.getState().lastFillet).toBeNull()
    expect(ct.getState().lastFit).toBeNull()
  })

  it('another edit ends radius editing; a bad radius is refused with nothing changed', () => {
    openSketch()
    const chains = plateCorner(circular(5)), scan = brushPoints(chains)
    brush('line', scan, [[38, 0], [12, 0]], 1)
    brush('line', scan, [[0, 12], [0, 38]], 1)
    expect(sweepCorner('fixedFillet', 2, [[12, 0], [0, 0], [0, 12]], 1.5, chains)).toBe(true)
    const made = cloneSketch(sketchNow())
    expect(ct.getState().setFilletRadius(-1)).toBe(false)
    expect(ct.getState().setFilletRadius(500)).toBe(false)
    expect(JSON.stringify(sketchNow())).toBe(JSON.stringify(made))
    // Any other edit: the fillet is no longer the latest one.
    const other = cloneSketch(sketchNow())
    addEntity(other, { kind: 'line', a: [50, 50], b: [60, 50] } as never)
    useReverse.getState().setSketch(other)
    expect(ct.getState().setFilletRadius(3)).toBe(false)
    expect(ct.getState().lastFillet).toBeNull()
    // Undo that edit: the fillet is the latest edit again, R2, editable.
    useReverse.getState().undoSketch()
    expect(ct.getState().lastFillet?.radiusMm).toBe(2)
    expect(ct.getState().setFilletRadius(3)).toBe(true)
  })

  it('a 3 × 9 elliptical round: the arc is made (as in QUICKSURFACE) and said to miss the tolerance', () => {
    openSketch()
    const chains = plateCorner(elliptical), scan = brushPoints(chains)
    brush('line', scan, [[38, 0], [14, 0]], 1)
    brush('line', scan, [[0, 8], [0, 38]], 1)
    expect(sweepCorner('autoFillet', 1, [[14, 0], [0, 0], [0, 8]], 1.5, chains)).toBe(true)
    const s = ct.getState()
    expect(s.lastFillet).not.toBeNull()
    expect(s.lastFit?.scanFit?.exceeds).toBe(true)
    expect(s.lastFit!.scanFit!.maxMm).toBeGreaterThan(0.1)
    expect(s.message).toMatch(/not circular/)
    // Loosening the tolerance past the worst point passes it.
    useSketchAnalysis.getState().setToleranceMm(s.lastFit!.scanFit!.maxMm * 1.01)
    expect(ct.getState().setFilletRadius(s.lastFillet!.radiusMm + 0.01)).toBe(true)
  })
})

describe('radius editing on built line–arc and arc–arc corners (brushed)', () => {
  it('150 corners: Fixed then a new radius, tangent, far ends held, one undo step each', async () => {
    let built = 0, edited = 0
    const failures: string[] = []
    const skipped = { brush: 0, sweep: 0, why: [] as string[] }
    for (let seed = 1; built < 150 && seed < 3000; seed++) {
      const k = makeCase(seed), g = k.build()
      if (!g || k.noise > 0.005) continue
      const R = rng(seed * 31 + 7)
      const stretch = (c: CarrierT, out: number): Vec2[] | null => {
        const most = c.kind === 'circle' ? Math.min(out, 1.2 * Math.PI * c.R) : out
        const from = 0.2 + R() * 0.2 * most, least = c.kind === 'circle' ? Math.max(3, 0.35 * c.R) : 3
        if (most - from < least) return null
        const to = from + least + R() * (most - from - least)
        return Array.from({ length: 41 }, (_, i) => along(c, from + (to - from) * i / 40))
      }
      const sa = stretch(g.A, g.outA), sb = stretch(g.B, g.outB)
      if (!sa || !sb) continue
      built++
      if (built % 10 === 0) await new Promise((r) => setTimeout(r, 0))
      openSketch()
      const scan = brushPoints([g.chain]), brushR = Math.max(0.3, 0.6 * g.step)
      let a: Piece, b: Piece
      try {
        a = brush(g.A.kind === 'line' ? 'line' : 'arc', scan, sa, brushR); b = brush(g.B.kind === 'line' ? 'line' : 'arc', scan, sb, brushR)
      } catch { skipped.brush++; continue }
      const nearOf = (e: Piece) => [anchorPoint(e, 'a'), anchorPoint(e, 'b')].sort((p, q) => dist(p, g.corner) - dist(q, g.corner))[0]
      const na = nearOf(a), nb = nearOf(b)
      const reach = Math.max(dist(na, g.corner), dist(nb, g.corner), 0.5)
      const first = Math.max(0.2, 0.7 * k.r)
      if (!sweepCorner('fixedFillet', first, [na, g.corner, nb], 0.3 + 0.05 * reach, [g.chain])) { skipped.sweep++; skipped.why.push(ct.getState().message ?? ''); continue }
      const f = ct.getState().lastFillet
      if (!f) { failures.push(`${k.id}: no fillet kept for editing`); continue }
      const before = cloneSketch(sketchNow()), steps = draft().history.length
      const next = first * (0.6 + 0.3 * R())
      if (!ct.getState().setFilletRadius(next)) { failures.push(`${k.id}: refused ${next.toFixed(3)}: ${ct.getState().message}`); continue }
      try {
        const arc = checkFillet(sketchNow(), f.arcId, [a.id, b.id])
        expect(arc.r).toBeCloseTo(next, 9)
        expect(draft().history.length).toBe(steps + 1)
        useReverse.getState().undoSketch()
        expect(JSON.stringify(sketchNow())).toBe(JSON.stringify(before))
        edited++
      } catch (e) { failures.push(`${k.id}: ${(e as Error).message.split('\n')[0]}`) }
    }
    if (failures.length) console.log(failures.slice(0, 20).join('\n'))
    expect(failures).toEqual([])
    expect(edited, JSON.stringify({ built, ...skipped, why: [...new Set(skipped.why)].slice(0, 6) })).toBeGreaterThanOrEqual(140)
  }, 300_000)
})
