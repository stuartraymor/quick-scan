// SPDX-License-Identifier: AGPL-3.0-only
// Corner Trim, Auto Fillet and Fixed Size Fillet on pieces made the way a
// user makes them, through the actions the GUI calls.
//
// 1.2.6 passed its stress tests and still refused the first corner a user
// tried ("This operation would move a far end"), because those tests placed
// their pieces by hand. A piece brushed with Fit Line or Fit Arc is not bare
// geometry: it keeps the section points it was fitted to, and the sketch
// solver holds it to them. Here every piece is brushed: the stroke picks the
// section points under the brush, the Fit Primitives store fits and commits
// them, and the Corner Trim store sweeps the corner. Nothing is placed by
// script, and nothing is asked of the core that the GUI does not ask.
//
// Two sets of corners:
//  - QUICKSURFACE's example scan basic_part, aligned as the user aligned it
//    (cylinder on Z, flat face on top): sections across the cylinder, where
//    the flat meets the R100 arc at both ends. Each is brushed with five
//    stretches of line and five of arc, tidy and sloppy (a wide brush that
//    takes in the corner and the other piece's points), and swept three ways.
//  - corners built from their answer (cornerCaseGenerator.ts): line to arc,
//    arc to line and arc to arc, the round inside or outside the arc, the
//    section coarse or fine, clean or noisy.
//
// For every case: the tool must not refuse; the two pieces must stay exactly
// where they were fitted (carrier and far end); a trim must meet at the
// carriers' crossing; a fillet must be tangent at both ends, of the asked
// radius (Fixed) or the built one (Auto, clean sections); the scan must lie
// no further from the result than from the bare corner; Undo must restore
// the sketch exactly; and an ordinary edit afterwards (a full solve, as any
// dimension or drag runs) must leave everything where it is.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { SweepArea } from '../core/cornerSweep'
import { pointsUnderPath } from '../core/instantFit'
import { anchorPoint, cloneSketch, nearestOnEntity, type Sketch, type SketchArc, type SketchEntity, type SketchLine } from '../core/sketch'
import { brushPoints, leastSquaresCircle, type BrushPoint } from '../core/sketchBrush'
import type { CornerTrimMode } from '../core/sketchCornerTrim'
import { useReverse } from '../state/reStore'
import { useSketchBrush } from '../state/sketchBrushStore'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'
import { along, ang, dist, makeCase, polar, rng, type CarrierT } from './cornerCaseGenerator'

const XY = { origin: [0, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], basisU: [1, 0, 0] as [number, number, number], basisV: [0, 1, 0] as [number, number, number] }
const draft = () => useReverse.getState().sketchDraft!
const sketchNow = (): Sketch => draft().sketch
type Piece = SketchLine | SketchArc

/** A new, empty sketch, the Fit Primitives and Corner Trim panels as they open. */
function openSketch() {
  useReverse.getState().reset()
  useReverse.getState().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
  useSketchBrush.setState({ primitive: 'line', instant: true, tolerance: 0.1, axisDegrees: 1, curvePoints: 8, selected: [], selectionOverflow: false, preview: null, message: null })
}

const NOTHING = 'too few section points under the brush'

/** One brush stroke with Fit Line or Fit Arc: the section points within the
 *  brush of the stroke are selected and the fit committed, as on release. */
function brush(kind: 'line' | 'arc', scan: readonly BrushPoint[], stroke: readonly Vec2[], radius: number): Piece | string {
  const selected = pointsUnderPath(scan, stroke, radius)
  if (!selected || selected.length < (kind === 'line' ? 2 : 3)) return NOTHING
  const before = new Set(sketchNow().entities.map((e) => e.id))
  useSketchBrush.setState({ primitive: kind, selected, selectionOverflow: false })
  if (!useSketchBrush.getState().apply()) return useSketchBrush.getState().message ?? 'fit failed'
  const made = sketchNow().entities.find((e) => !before.has(e.id))
  if (!made || (made.kind !== 'line' && made.kind !== 'arc')) return `the fit made a ${made?.kind ?? 'nothing'}`
  return made
}

/** A swept corner, through the Corner Trim store; a result waiting for
 *  Accept is accepted. */
function sweep(mode: CornerTrimMode, radiusMm: number, stroke: readonly Vec2[], radius: number, chains: readonly (readonly Vec2[])[]): { ok: boolean; message: string | null } {
  const ct = useSketchCornerTrim
  ct.getState().setOpen(true)
  ct.setState({ mode, radiusMm, addDimension: true })
  let ok = ct.getState().sweep(stroke, radius, chains.flat(), chains)
  if (!ok && ct.getState().pending) ok = ct.getState().acceptPending()
  const message = ct.getState().message
  ct.getState().cancel()
  return { ok, message }
}

const pieceOf = (s: Sketch, id: number) => s.entities.find((e) => e.id === id) as Piece
const ends = (e: Piece): [Vec2, Vec2] => [anchorPoint(e, 'a'), anchorPoint(e, 'b')]
/** How far a piece's carrier moved: a line's direction and offset, an arc's centre and radius. */
function carrierMoved(a: Piece, b: Piece): number {
  if (a.kind === 'arc' && b.kind === 'arc') return Math.max(dist(a.c, b.c), Math.abs(a.r - b.r))
  if (a.kind === 'line' && b.kind === 'line') {
    const d: Vec2 = [a.b[0] - a.a[0], a.b[1] - a.a[1]], l = Math.hypot(d[0], d[1])
    const off = (p: Vec2) => Math.abs(((p[0] - a.a[0]) * d[1] - (p[1] - a.a[1]) * d[0]) / l)
    return Math.max(off(b.a), off(b.b))
  }
  return Infinity
}
/** The crossings of two pieces' carriers. */
function crossingsOf(a: Piece, b: Piece): Vec2[] {
  const lineCircle = (l: SketchLine, c: Vec2, r: number): Vec2[] => {
    const d: Vec2 = [l.b[0] - l.a[0], l.b[1] - l.a[1]], n = Math.hypot(d[0], d[1]), u: Vec2 = [d[0] / n, d[1] / n]
    const t = (c[0] - l.a[0]) * u[0] + (c[1] - l.a[1]) * u[1], foot: Vec2 = [l.a[0] + u[0] * t, l.a[1] + u[1] * t], h2 = r * r - dist(foot, c) ** 2
    if (h2 < 0) return []
    const h = Math.sqrt(h2)
    return [[foot[0] + u[0] * h, foot[1] + u[1] * h], [foot[0] - u[0] * h, foot[1] - u[1] * h]]
  }
  if (a.kind === 'line' && b.kind === 'arc') return lineCircle(a, b.c, b.r)
  if (a.kind === 'arc' && b.kind === 'line') return lineCircle(b, a.c, a.r)
  if (a.kind === 'arc' && b.kind === 'arc') {
    const d = dist(a.c, b.c)
    if (d > a.r + b.r || d < Math.abs(a.r - b.r) || d < 1e-12) return []
    const x = (a.r * a.r - b.r * b.r + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a.r * a.r - x * x)), u: Vec2 = [(b.c[0] - a.c[0]) / d, (b.c[1] - a.c[1]) / d], m: Vec2 = [a.c[0] + u[0] * x, a.c[1] + u[1] * x]
    return [[m[0] - u[1] * h, m[1] + u[0] * h], [m[0] + u[1] * h, m[1] - u[0] * h]]
  }
  const la = a as SketchLine, lb = b as SketchLine
  const d1: Vec2 = [la.b[0] - la.a[0], la.b[1] - la.a[1]], d2: Vec2 = [lb.b[0] - lb.a[0], lb.b[1] - lb.a[1]], den = d1[0] * d2[1] - d1[1] * d2[0]
  if (Math.abs(den) < 1e-12) return []
  const t = ((lb.a[0] - la.a[0]) * d2[1] - (lb.a[1] - la.a[1]) * d2[0]) / den
  return [[la.a[0] + d1[0] * t, la.a[1] + d1[1] * t]]
}
/** How far off tangent a fillet is from a piece at the point they share. */
function offTangent(fillet: SketchArc, piece: Piece, at: Vec2): number {
  const radial: Vec2 = [(at[0] - fillet.c[0]) / fillet.r, (at[1] - fillet.c[1]) / fillet.r]
  if (piece.kind === 'line') { const d: Vec2 = [piece.b[0] - piece.a[0], piece.b[1] - piece.a[1]], l = Math.hypot(d[0], d[1]); return Math.abs((radial[0] * d[0] + radial[1] * d[1]) / l) }
  const other: Vec2 = [(at[0] - piece.c[0]) / piece.r, (at[1] - piece.c[1]) / piece.r]
  return Math.abs(radial[0] * other[1] - radial[1] * other[0])
}
const rmsTo = (points: readonly Vec2[], shapes: readonly SketchEntity[]) => points.length ? Math.sqrt(points.reduce((sum, p) => sum + Math.min(...shapes.map((e) => nearestOnEntity(e, p).dist)) ** 2, 0) / points.length) : 0

interface Row { id: string; ok: boolean; problem?: string; radius?: number; shape?: string; drift?: number; skipped?: boolean }
interface Setup { id: string; chains: Vec2[][]; a: Piece; b: Piece; near: Vec2; truth?: number; exact?: boolean; /** How far Auto's radius may be from the built one, as a share of it. */ within?: number; noise: number }

/** One swept corner on two brushed pieces, checked from every side. `how`
 *  picks the sweep: a stroke over both ends through the corner point, a
 *  wide one, or the ends only (the corner point left unpainted). */
function runCorner(c: Setup, mode: CornerTrimMode, how: 'stroke' | 'wide' | 'ends', fixedRadius: number): Row {
  const id = `${c.id} ${mode} ${how}`
  const fail = (problem: string, extra: Partial<Row> = {}): Row => ({ id, ok: false, problem, ...extra })
  const start = cloneSketch(sketchNow()), history = draft().history.length
  const a0 = pieceOf(start, c.a.id), b0 = pieceOf(start, c.b.id)
  const cross = crossingsOf(a0, b0).sort((p, q) => dist(p, c.near) - dist(q, c.near))
  if (!cross.length) return { id, ok: true, shape: 'no crossing' }
  const corner = cross[0]
  const nearEnd = (e: Piece) => { const [p, q] = ends(e); return dist(p, corner) <= dist(q, corner) ? p : q }
  const farEnd = (e: Piece) => { const [p, q] = ends(e); return dist(p, corner) <= dist(q, corner) ? q : p }
  const na = nearEnd(a0), nb = nearEnd(b0), fa = farEnd(a0), fb = farEnd(b0)
  const reach = Math.max(dist(na, corner), dist(nb, corner), 0.5)
  const stroke: Vec2[] = how === 'ends' ? [na, nb] : how === 'wide' ? [na, [corner[0] + 0.15 * reach, corner[1] + 0.15 * reach], corner, nb] : [na, corner, nb]
  const brushRadius = how === 'ends' ? Math.min(0.3, 0.2 * reach) : 0.3 + 0.05 * reach
  // The ends-only sweep means something only when it leaves the corner point out.
  const cornerPainted = new SweepArea({ path: stroke, radius: brushRadius }).distance(corner) <= 0
  const did = sweep(mode, fixedRadius, stroke, brushRadius, c.chains)
  const after = sketchNow()
  const undoAll = () => { while (draft().history.length > history) useReverse.getState().undoSketch() }
  if (!did.ok) { undoAll(); return fail(`refused: ${did.message}`) }
  const a1 = pieceOf(after, c.a.id), b1 = pieceOf(after, c.b.id)
  const steps = draft().history.length - history
  const fillet = after.entities.find((e) => e.kind === 'arc' && !start.entities.some((x) => x.id === e.id)) as SketchArc | undefined
  const row: Row = { id, ok: true, shape: fillet ? 'arc' : 'sharp', ...(fillet ? { radius: fillet.r } : {}) }
  const bad = (problem: string) => { if (row.ok) { row.ok = false; row.problem = problem } }
  // The pieces stay where they were fitted.
  if (carrierMoved(a0, a1) > 1e-9 || carrierMoved(b0, b1) > 1e-9) bad(`a piece moved off its carrier by ${Math.max(carrierMoved(a0, a1), carrierMoved(b0, b1)).toExponential(2)}`)
  if (Math.min(...ends(a1).map((p) => dist(p, fa))) > 1e-9 || Math.min(...ends(b1).map((p) => dist(p, fb))) > 1e-9) bad('a far end moved')
  const wantFillet = mode !== 'trim' && cornerPainted
  if (!fillet) {
    if (Math.min(...ends(a1).map((p) => dist(p, corner))) > 1e-7 || Math.min(...ends(b1).map((p) => dist(p, corner))) > 1e-7) bad('the pieces do not meet at the corner point')
    if (steps !== 1) bad(`a join took ${steps} undo steps`)
    if (mode === 'fixedFillet' && wantFillet) bad('Fixed Size Fillet made no fillet')
  } else {
    if (!wantFillet) bad(mode === 'trim' ? 'Corner Trim made a fillet' : 'filleted without the corner point')
    const fe = ends(fillet)
    const touch = (e: Piece) => { const [p, q] = ends(e); let best = Infinity, at = p; for (const x of [p, q]) for (const y of fe) if (dist(x, y) < best) { best = dist(x, y); at = y } return { best, at } }
    const ta = touch(a1), tb = touch(b1)
    if (ta.best > 1e-6 || tb.best > 1e-6) bad(`gap at a tangent point (${Math.max(ta.best, tb.best).toExponential(2)})`)
    const lean = Math.max(offTangent(fillet, a1, ta.at), offTangent(fillet, b1, tb.at))
    if (lean > 1e-6) bad(`not tangent (${lean.toExponential(2)})`)
    if (steps !== 2) bad(`a fillet took ${steps} undo steps`)
    if (mode === 'fixedFillet' && Math.abs(fillet.r - fixedRadius) > 1e-9) bad(`Fixed radius ${fillet.r} for ${fixedRadius}`)
    if (mode === 'autoFillet' && c.truth !== undefined && c.exact && Math.abs(fillet.r - c.truth) > (c.within ?? 0.005) * c.truth + 0.002) bad(`Auto radius ${fillet.r.toFixed(4)} for a round of ${c.truth.toFixed(4)}`)
  }
  if (mode === 'autoFillet' && !fillet && wantFillet && c.truth !== undefined && c.exact && c.truth > 0.5) bad(`Auto Fillet left a round of ${c.truth.toFixed(3)} sharp`)
  // The scan lies no further from the result than from the bare corner.
  if (mode === 'autoFillet' && wantFillet) {
    const zone = Math.max(3 * (fillet?.r ?? 0), 2)
    const pts = c.chains.flat().filter((p) => dist(p, corner) <= zone)
    const sharpA = { ...a0 } as Piece, sharpB = { ...b0 } as Piece
    // The bare corner: the two carriers, as whole circles and long lines.
    const whole = (e: Piece): SketchEntity => e.kind === 'arc' ? ({ id: 0, kind: 'circle', c: e.c, r: e.r } as SketchEntity) : ({ ...e, a: [e.a[0] - (e.b[0] - e.a[0]) * 50, e.a[1] - (e.b[1] - e.a[1]) * 50], b: [e.b[0] + (e.b[0] - e.a[0]) * 50, e.b[1] + (e.b[1] - e.a[1]) * 50] } as SketchEntity)
    const bare = rmsTo(pts, [whole(sharpA), whole(sharpB)])
    const got = rmsTo(pts, [whole(a1), whole(b1), ...(fillet ? [fillet] : [])])
    if (got > bare + 0.03 + 3 * c.noise) bad(`the result lies ${got.toFixed(3)} off the scan; the bare corner ${bare.toFixed(3)}`)
  }
  // An ordinary edit afterwards (a full solve) leaves everything where it is.
  const settled = cloneSketch(sketchNow())
  useReverse.getState().setSketch(cloneSketch(settled))
  const later = sketchNow()
  let drift = 0
  for (const e of settled.entities) {
    if (e.kind !== 'line' && e.kind !== 'arc') continue
    const l = pieceOf(later, e.id)
    drift = Math.max(drift, carrierMoved(e, l), ...ends(e).map((p, i) => dist(p, ends(l)[i])))
  }
  row.drift = drift
  if (drift > 1e-4) bad(`the next edit moved the sketch by ${drift.toExponential(2)}`)
  useReverse.getState().undoSketch()
  // Undo restores the sketch exactly.
  undoAll()
  if (JSON.stringify(sketchNow()) !== JSON.stringify(start)) bad('Undo did not restore the sketch')
  if (!row.ok && process.env.CORNER_DETAIL) row.problem += ` | corner ${corner.map((v) => v.toFixed(3))} crossings ${JSON.stringify(cross.map((p) => p.map((v) => +v.toFixed(3))))} a ${JSON.stringify(ends(a0).map((p) => p.map((v) => +v.toFixed(3))))}→${JSON.stringify(ends(a1).map((p) => p.map((v) => +v.toFixed(3))))} b ${JSON.stringify(ends(b0).map((p) => p.map((v) => +v.toFixed(3))))}→${JSON.stringify(ends(b1).map((p) => p.map((v) => +v.toFixed(3))))} arc ${b0.kind === 'arc' ? `c ${b0.c.map((v) => v.toFixed(2))} r ${b0.r.toFixed(2)} sweep ${b0.sweep.toFixed(3)}` : ''} msg ${did.message}`
  return row
}

const modes: CornerTrimMode[] = ['trim', 'autoFillet', 'fixedFillet']
const hows = ['stroke', 'wide', 'ends'] as const
function report(name: string, rows: Row[]) {
  const badRows = rows.filter((r) => !r.ok)
  const kinds = new Map<string, number>()
  for (const r of badRows) { const k = (r.problem ?? '').replace(/[-\d.e+]+/g, '#').slice(0, 70); kinds.set(k, (kinds.get(k) ?? 0) + 1) }
  console.log(`${name}: ${rows.filter((r) => !r.skipped).length} cases (${rows.filter((r) => r.skipped).length} more had too few section points to brush), ${badRows.length} failed; fillets ${rows.filter((r) => r.shape === 'arc').length}, sharp joins ${rows.filter((r) => r.shape === 'sharp').length}, carriers that never cross ${rows.filter((r) => r.shape === 'no crossing').length}; largest move at the next edit ${Math.max(0, ...rows.map((r) => r.drift ?? 0)).toExponential(2)} mm`)
  for (const [k, n] of [...kinds].sort((a, b) => b[1] - a[1])) console.log(`  ${n} × ${k}`)
  for (const r of badRows.slice(0, 25)) console.log('  ✗', r.id, '—', r.problem)
  return badRows
}

const fixture = path.resolve(__dirname, '../../../analysis/autofillet/basic_part_aligned-sections.json')
const real = fs.existsSync(fixture) ? JSON.parse(fs.readFileSync(fixture, 'utf8')) as { sections: { axis: string; offset: number; chains: Vec2[][] }[] } : null

describe.skipIf(!real)('brushed line and arc on the aligned scan (basic_part), every tool', () => {
  it('both corners of every section, five stretches of line and of arc, three sweeps', async () => {
    const rows: Row[] = []
    const lineStretch: Record<string, [number, number]> = { whole: [70, 1], nearHalf: [30, 0.5], farHalf: [70, 35], shortFar: [64, 38], intoCorner: [25, -0.5] }
    const arcStretch: Record<string, [number, number]> = { long: [2, 45], near: [1, 15], far: [25, 50], shortFar: [30, 36], intoCorner: [-0.5, 30] }
    let n = 0, used = 0
    for (const sec of real!.sections.filter((s) => s.axis === 'z')) {
      const scan = brushPoints(sec.chains), all = sec.chains.flat()
      const top = Math.max(...all.map((p) => p[1]))
      const flat = all.filter((p) => p[1] > top - 1.5).map((p) => p[1]).sort((x, y) => x - y)
      const level = flat[Math.floor(flat.length / 2)]
      const body = all.filter((p) => p[1] < top - 15 && Math.abs(p[0]) > 25)
      const circle = leastSquaresCircle(body, [0, 0], 100)
      // Only sections that are the flat and the cylinder: higher up the part
      // has a pocket and a rounded end, and the strokes below would miss.
      const offCircle = Math.sqrt(body.reduce((sum, p) => sum + (dist(p, circle.c) - circle.r) ** 2, 0) / body.length)
      if (offCircle > 0.2 || Math.abs(circle.r - 100) > 2) continue
      used++
      const half = Math.sqrt(Math.max(0, circle.r ** 2 - (level - circle.c[1]) ** 2))
      for (const side of [1, -1] as const) {
        const corner: Vec2 = [circle.c[0] + side * half, level]
        const cornerAngle = ang(circle.c, corner)
        for (const [ln, [l0, l1]] of Object.entries(lineStretch)) for (const [an, [a0, a1]] of Object.entries(arcStretch)) {
          await new Promise((r) => setTimeout(r, 0))
          // Tidy and sloppy brushes alternate: 1.5 mm, or 4.5 mm that takes in strays.
          const wide = n % 2 === 1, brushR = wide ? 4.5 : 1.5
          const lineStroke: Vec2[] = Array.from({ length: 21 }, (_, i) => [corner[0] - side * (l0 + (l1 - l0) * i / 20), level])
          const arcStroke: Vec2[] = Array.from({ length: 25 }, (_, i) => polar(circle.c, circle.r, cornerAngle - side * (a0 + (a1 - a0) * i / 24) * Math.PI / 180))
          n++
          for (const [mi, mode] of modes.entries()) {
            const how = hows[(n + mi) % 3]
            openSketch()
            const tag = `z${sec.offset} ${side > 0 ? 'right' : 'left'} line:${ln} arc:${an} brush${brushR}`
            const line = brush('line', scan, lineStroke, brushR), arc = brush('arc', scan, arcStroke, brushR)
            if (line === NOTHING || arc === NOTHING) { rows.push({ id: tag, ok: true, skipped: true }); continue }
            if (typeof line === 'string' || typeof arc === 'string') { rows.push({ id: tag, ok: false, problem: `could not fit: ${typeof line === 'string' ? line : arc}` }); continue }
            rows.push(runCorner({ id: tag, chains: sec.chains, a: line, b: arc, near: corner, noise: 0.02 }, mode, how, 2))
          }
        }
      }
    }
    const badRows = report('aligned basic_part', rows)
    fs.mkdirSync(path.dirname(fixture), { recursive: true })
    fs.writeFileSync(path.resolve(path.dirname(fixture), 'basic_part_aligned-fitted-corner-report.json'), JSON.stringify({ cases: rows.length, failed: badRows.length, rows }, null, 1))
    expect(used).toBeGreaterThanOrEqual(5)
    expect(rows.filter((r) => !r.skipped).length).toBeGreaterThan(500)
    expect(badRows).toEqual([])
  }, 600_000)
})

describe('brushed pieces on corners built from their answer, every tool', () => {
  it('300 corners: line to arc, arc to line, arc to arc; tidy and sloppy brushes', async () => {
    const rows: Row[] = []
    let built = 0, n = 0
    for (let seed = 1; built < 300 && seed < 4000; seed++) {
      const k = makeCase(seed), g = k.build()
      if (!g) continue
      const R = rng(seed * 7919 + 13)
      // A stretch of each carrier the section runs along, from near the round
      // (or, sloppy, from inside it) outwards.
      const stretch = (c: CarrierT, out: number, sloppy: boolean): Vec2[] | null => {
        const most = c.kind === 'circle' ? Math.min(out, 1.2 * Math.PI * c.R) : out
        const from = sloppy ? -0.3 * k.r : 0.15 + R() * 0.3 * most
        const least = c.kind === 'circle' ? Math.max(3, 0.35 * c.R) : 3
        if (most - Math.max(from, 0) < least) return null
        const to = Math.max(from, 0) + least + R() * (most - Math.max(from, 0) - least)
        return Array.from({ length: 41 }, (_, i) => along(c, from + (to - from) * i / 40))
      }
      const sloppy = built % 3 === 2
      const sa = stretch(g.A, g.outA, sloppy), sb = stretch(g.B, g.outB, sloppy)
      if (!sa || !sb) continue
      built++
      if (built % 5 === 0) await new Promise((r) => setTimeout(r, 0))
      const chains = [g.chain], scan = brushPoints(chains)
      const brushR = sloppy ? Math.max(1, 0.4 * k.r) : Math.max(0.3, 0.6 * g.step)
      n++
      for (const [mi, mode] of modes.entries()) {
        const how = hows[(n + mi) % 3]
        openSketch()
        const tag = `${k.id} ${sloppy ? 'sloppy' : 'tidy'}`
        const a = brush(g.A.kind === 'line' ? 'line' : 'arc', scan, sa, brushR), b = brush(g.B.kind === 'line' ? 'line' : 'arc', scan, sb, brushR)
        if (a === NOTHING || b === NOTHING) { rows.push({ id: tag, ok: true, skipped: true }); continue }
        if (typeof a === 'string' || typeof b === 'string') { rows.push({ id: tag, ok: false, problem: `could not fit: ${typeof a === 'string' ? a : b}` }); continue }
        // The built radius is the answer only where the fit recovers the
        // carriers: a clean section, a tidy brush, no line snapped to an axis.
        const snapped = sketchNow().constraints.some((c) => c.kind === 'horizontal' || c.kind === 'vertical')
        // A round the section crosses in under five steps (a 0.6 mm round
        // sampled every 0.9 mm) is three or four points: its radius is read
        // to a fifth, not to half a percent.
        const within = k.phi * k.r / k.step >= 5 ? 0.005 : 0.2
        rows.push(runCorner({ id: tag, chains, a, b, near: g.corner, truth: k.r, exact: k.noise === 0 && !sloppy && !snapped, within, noise: k.noise }, mode, how, Math.max(0.2, 0.7 * k.r)))
      }
    }
    const badRows = report('built corners', rows)
    expect(built).toBe(300)
    expect(badRows).toEqual([])
  }, 600_000)
})
