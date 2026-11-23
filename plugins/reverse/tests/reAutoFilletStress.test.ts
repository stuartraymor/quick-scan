// SPDX-License-Identifier: AGPL-3.0-only
// Auto Fillet stress test on real scan sections. Every corner between two
// flats of each section is tried with lines fitted the way Fit Line fits a
// brush stroke, over different stretches of each flat (long, short, far from
// the corner, into the round), and swept the ways a user sweeps (a box over
// the ends and the corner point, a stroke through the corner, the ends only).
// Each result is checked geometrically. The sections are slices of
// QUICKSURFACE's example scan basic_part.stl, kept out of the repository
// (analysis/autofillet/basic_part-sections.json, made by
// scripts/dump-section-chains.mjs).
import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { fixture } from '../../../tests/fixtures'
import type { Vec2 } from '../../../src/core/flat/types'
import { emptySketch, entityOf, type Sketch, type SketchArc, type SketchLine } from '../core/sketch'
import { fitBrushPrimitive, sketchWithBrushFit, type BrushPoint } from '../core/sketchBrush'
import { sweepCornerTrim, type CornerTrimOptions } from '../core/sketchCornerTrim'
import { SweepArea } from '../core/cornerSweep'
import { lineIntersection } from '../core/corners'

const data = fixture('analysis/autofillet/basic_part-sections.json')
const auto: CornerTrimOptions = { mode: 'autoFillet', radiusMm: 1, addDimension: true }
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
const segDist = (p: Vec2, a: Vec2, b: Vec2) => { const d = sub(b, a), l = dot(d, d), t = l > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l)) : 0; return dist(p, [a[0] + t * d[0], a[1] + t * d[1]]) }
const lineDist = (p: Vec2, a: Vec2, b: Vec2) => { const d = sub(b, a), l = Math.hypot(d[0], d[1]); return Math.abs((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / l }

/** Douglas–Peucker vertex indices of a closed chain. */
function simplify(chain: Vec2[], tol: number): number[] {
  const keep = new Set([0, chain.length - 1])
  const rec = (i: number, j: number) => {
    let best = -1, bd = tol
    for (let k = i + 1; k < j; k++) { const d = dist(chain[i], chain[j]) > 1e-9 ? lineDist(chain[k], chain[i], chain[j]) : dist(chain[k], chain[i]); if (d > bd) { bd = d; best = k } }
    if (best >= 0) { keep.add(best); rec(i, best); rec(best, j) }
  }
  // Split at the point farthest from the start so a closed ring works.
  let far = 0
  for (let k = 1; k < chain.length; k++) if (dist(chain[k], chain[0]) > dist(chain[far], chain[0])) far = k
  keep.add(far); rec(0, far); rec(far, chain.length - 1)
  return [...keep].sort((a, b) => a - b)
}

interface Flat { i: number; j: number; a: Vec2; b: Vec2; length: number }
interface Corner { section: string; A: Flat; B: Flat; chain: Vec2[]; chainIndex: number; turn: number }

function cornersOf(section: { axis: string; offset: number; chains: Vec2[][] }): Corner[] {
  const out: Corner[] = []
  section.chains.forEach((chain, chainIndex) => {
    if (chain.length < 20) return
    const v = simplify(chain, 0.25)
    const flats: Flat[] = []
    for (let k = 1; k < v.length; k++) {
      const a = chain[v[k - 1]], b = chain[v[k]], length = dist(a, b)
      // A flat: long, and every chain point between lies close to it.
      if (length < 8) continue
      let ok = true
      for (let m = v[k - 1]; m <= v[k]; m++) if (lineDist(chain[m], a, b) > 0.3) { ok = false; break }
      if (ok) flats.push({ i: v[k - 1], j: v[k], a, b, length })
    }
    for (let k = 1; k < flats.length; k++) {
      const A = flats[k - 1], B = flats[k]
      // Only neighbours: the chain between them is short (a corner, not a side).
      let between = 0
      for (let m = A.j + 1; m <= B.i; m++) between += dist(chain[m - 1], chain[m])
      if (between > 0.6 * Math.min(A.length, B.length) + 15) continue
      const da = sub(A.b, A.a), db = sub(B.b, B.a)
      const turn = Math.acos(Math.max(-1, Math.min(1, dot(da, db) / Math.hypot(...da) / Math.hypot(...db)))) * 180 / Math.PI
      if (turn < 20 || turn > 160) continue
      out.push({ section: `${section.axis}${section.offset}`, A, B, chain, chainIndex, turn })
    }
  })
  return out
}

/** Chain points on a stretch of a flat, measured from its corner end, as a brush stroke picks them. */
function brushed(c: Corner, flat: Flat, atCorner: 'a' | 'b', from: number, to: number): BrushPoint[] {
  const start = atCorner === 'a' ? flat.a : flat.b, end = atCorner === 'a' ? flat.b : flat.a
  const u = sub(end, start), L = Math.hypot(u[0], u[1]), dir: Vec2 = [u[0] / L, u[1] / L]
  const out: BrushPoint[] = []
  c.chain.forEach((p, index) => {
    const s = dot(sub(p, start), dir)
    if (s >= from && s <= to && lineDist(p, flat.a, flat.b) <= 0.6) out.push({ key: `${c.chainIndex}:${index}`, chain: c.chainIndex, index, p: [p[0], p[1]] })
  })
  return out
}

const stretches: Record<string, (L: number) => [number, number]> = {
  whole: (L) => [1, L - 1],
  nearHalf: (L) => [1, L / 2],
  farHalf: (L) => [L / 2, L - 1],
  shortFar: (L) => [0.7 * L, 0.92 * L],
  intoRound: (L) => [-2, L - 1],
}
const pairs: [string, string][] = [['whole', 'whole'], ['nearHalf', 'nearHalf'], ['farHalf', 'farHalf'], ['shortFar', 'shortFar'], ['whole', 'shortFar'], ['farHalf', 'nearHalf'], ['intoRound', 'whole'], ['intoRound', 'intoRound']]

/** Independent reading of the scan corner: the gap between the lines'
 *  crossing and the nearest scan point gives the tangent round's radius,
 *  r = d / (1 / sin(half) - 1), whatever fit the tool uses. */
function scanCorner(c: Corner, la: SketchLine, lb: SketchLine, x: Vec2) {
  const da = sub(la.b, la.a), db = sub(lb.b, lb.a)
  const cos = Math.abs(dot(da, db)) / Math.hypot(...da) / Math.hypot(...db)
  // Interior half angle between the lines (the corner is the obtuse/acute side the chain turns round).
  const turn = c.turn * Math.PI / 180, half = (Math.PI - turn) / 2
  void cos
  // The section is a polyline: its nearest approach may fall between vertices.
  const span = c.chain.slice(Math.max(0, c.A.i), c.B.j + 1)
  let d = Infinity
  for (let k = 1; k < span.length; k++) d = Math.min(d, segDist(x, span[k - 1], span[k]))
  const factor = 1 / Math.sin(half) - 1
  return { gap: d, ref: d / factor, sharp: d < 0.05 }
}

const GUI_CASES = ['z340#8 77° whole/whole box', 'z340#8 77° farHalf/farHalf box', 'z340#10 49° whole/whole box', 'z340#11 54° shortFar/shortFar box', 'z240#1 109° shortFar/shortFar box', 'z290#5 102° whole/whole box', 'x120#19 46° whole/whole box', 'y20#33 119° whole/whole box']
const gui: { id: string; section: string; la: Vec2[]; lb: Vec2[]; path: Vec2[]; radius: number | null; shape?: string }[] = []
type Row = { id: string; turn: number; ok: boolean; problem?: string; shape?: string; radius?: number; ref?: number; gap?: number; follow?: number; message?: string }

describe.skipIf(!data.exists)('Auto Fillet on real scan corners (basic_part)', () => {
  const sections = data.exists ? JSON.parse(readFileSync(data.path, 'utf8')).sections as { axis: string; offset: number; chains: Vec2[][] }[] : []
  const corners = sections.flatMap(cornersOf)
  const rows: Row[] = []

  it('finds corners to try', () => { expect(corners.length).toBeGreaterThan(10) })

  // Async, yielding after each corner: a long synchronous run blocks the
  // worker and vitest's progress messages time out under a loaded full run.
  it('every corner, every line length, every sweep', async () => {
    for (const [ci, c] of corners.entries()) {
      await new Promise((r) => setTimeout(r, 0))
      // Which end of each flat is at the corner.
      const aEnd: 'a' | 'b' = 'b', bEnd: 'a' | 'b' = 'a'
      for (const [sa, sb] of pairs) {
        const pa = brushed(c, c.A, aEnd, ...stretches[sa](c.A.length)), pb = brushed(c, c.B, bEnd, ...stretches[sb](c.B.length))
        const id = `${c.section}#${ci} ${c.turn.toFixed(0)}° ${sa}/${sb}`
        const fa = fitBrushPrimitive('line', pa, { tolerance: 0.1, axisDegrees: 1, curvePoints: 8 }), fb = fitBrushPrimitive('line', pb, { tolerance: 0.1, axisDegrees: 1, curvePoints: 8 })
        if (pa.length < 2 || pb.length < 2) continue // the stretch holds no section point to brush
        if (!fa.ok || !fb.ok) { rows.push({ id, turn: c.turn, ok: false, problem: 'fit', message: (fa.ok ? '' : fa.error) + (fb.ok ? '' : fb.error) }); continue }
        // Committed as Fit Line commits a fit (with its axis snap relation).
        const s: Sketch = sketchWithBrushFit(sketchWithBrushFit(emptySketch(), fa)!, fb)!
        const [idA, idB] = s.entities.map((e) => e.id)
        const la = entityOf(s, idA) as SketchLine, lb = entityOf(s, idB) as SketchLine
        const x = lineIntersection(la, lb)
        if (!x) continue
        const near = (l: SketchLine): Vec2 => dist(l.a, x) < dist(l.b, x) ? l.a : l.b
        const nA = near(la), nB = near(lb)
        const truth = scanCorner(c, la, lb, x)
        // Sweeps: a box round the two near ends and the corner point; a stroke
        // end → corner point → end; the ends only.
        const centre: Vec2 = [(nA[0] + nB[0] + x[0]) / 3, (nA[1] + nB[1] + x[1]) / 3]
        const grow = (p: Vec2, m: number): Vec2 => { const d = sub(p, centre), l = Math.hypot(d[0], d[1]) || 1; return [p[0] + d[0] / l * m, p[1] + d[1] / l * m] }
        const sweeps: Record<string, Vec2[]> = { box: [grow(nA, 2), grow(x, 2), grow(nB, 2), grow(nA, 2)], stroke: [nA, x, nB], endsOnly: [nA, nB] }
        for (const [how, path] of Object.entries(sweeps)) {
          const r = sweepCornerTrim(s, { path, radius: 0.3 }, auto, [], c.section ? [c.chain] : [])
          const row: Row = { id: `${id} ${how}`, turn: c.turn, ok: true, ref: truth.ref, gap: truth.gap }
          const fail = (problem: string) => { row.ok = false; row.problem = problem }
          if (!r.result.ok) { fail('refused'); row.message = r.result.error; rows.push(row); continue }
          const res = r.result
          row.shape = res.shape ?? (res.sketch.entities.some((e) => e.kind === 'arc') ? 'arc' : 'sharp')
          if (res.confirm) row.message = res.confirm
          const arc = res.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')
          const A2 = entityOf(res.sketch, idA) as SketchLine, B2 = entityOf(res.sketch, idB) as SketchLine
          const farA = dist(la.a, x) > dist(la.b, x) ? 'a' : 'b', farB = dist(lb.a, x) > dist(lb.b, x) ? 'a' : 'b'
          if (dist(A2[farA], la[farA]) > 1e-6 || dist(B2[farB], lb[farB]) > 1e-6) fail('far end moved')
          const painted = new SweepArea({ path, radius: 0.3 }).distance(x) <= 0
          if (!painted) {
            if (arc) fail('filleted without the corner point')
          } else if (truth.sharp) {
            if (arc && arc.r > 0.5) fail(`round R ${arc.r.toFixed(3)} on a sharp corner`)
          } else if (!arc) {
            // A round shallower than the scan noise may fairly read as sharp.
            if (truth.ref > 0.5) fail(`no fillet (${row.shape}) where the scan rounds R≈${truth.ref.toFixed(2)}`)
          } else {
            row.radius = arc.r
            const [p, q] = [0, 1].map((k): Vec2 => { const t = arc.start + k * arc.sweep; return [arc.c[0] + arc.r * Math.cos(t), arc.c[1] + arc.r * Math.sin(t)] })
            const gap = (e: Vec2) => Math.min(dist(e, p), dist(e, q))
            const nearA2 = farA === 'a' ? A2.b : A2.a, nearB2 = farB === 'a' ? B2.b : B2.a
            if (gap(nearA2) > 1e-6 || gap(nearB2) > 1e-6) fail('gap at a tangent point')
            else if (Math.abs(lineDist(arc.c, A2.a, A2.b) - arc.r) > 1e-6 || Math.abs(lineDist(arc.c, B2.a, B2.b) - arc.r) > 1e-6) fail('not tangent')
            else {
              // Is this radius as close to the scan as any round tangent to
              // these two lines can be? Brute force over radii, scoring each
              // line-round-line profile against the same stretch of section
              // (sampled finely) round the corner.
              const span = c.chain.slice(Math.max(0, c.A.i), c.B.j + 1)
              const uA = sub(la[farA], x), uB = sub(lb[farB], x), rA = Math.hypot(...uA), rB = Math.hypot(...uB)
              const dA: Vec2 = [uA[0] / rA, uA[1] / rA], dB: Vec2 = [uB[0] / rB, uB[1] / rB]
              const h = Math.acos(Math.max(-1, Math.min(1, dot(dA, dB)))) / 2, bl = Math.hypot(dA[0] + dB[0], dA[1] + dB[1]), bis: Vec2 = [(dA[0] + dB[0]) / bl, (dA[1] + dB[1]) / bl]
              const tAlg = arc.r / Math.tan(h), T = Math.max(1.5 * tAlg, 1)
              const sample: Vec2[] = []
              for (let k = 1; k < span.length; k++) for (let t = 0; t < 1; t += 0.1) { const p: Vec2 = [span[k - 1][0] + t * (span[k][0] - span[k - 1][0]), span[k - 1][1] + t * (span[k][1] - span[k - 1][1])]; if (dot(sub(p, x), dA) <= T && dot(sub(p, x), dB) <= T && dist(p, x) <= T / Math.sin(h) + 1) sample.push(p) }
              const profileRms = (r: number) => {
                const t = r / Math.tan(h), cc: Vec2 = [x[0] + bis[0] * r / Math.sin(h), x[1] + bis[1] * r / Math.sin(h)]
                let sum = 0
                for (const p of sample) {
                  const sa = dot(sub(p, x), dA), sb = dot(sub(p, x), dB)
                  const d = sa > t || sb > t ? Math.min(sa > t ? Math.abs((p[0] - x[0]) * dA[1] - (p[1] - x[1]) * dA[0]) : Infinity, sb > t ? Math.abs((p[0] - x[0]) * dB[1] - (p[1] - x[1]) * dB[0]) : Infinity) : Math.abs(dist(p, cc) - r)
                  sum += d * d
                }
                return Math.sqrt(sum / Math.max(1, sample.length))
              }
              const rTop = 0.94 * Math.min(rA, rB) * Math.tan(h)
              let best = Infinity, bestR = 0
              for (let i = 0; i <= 600; i++) { const r = 0.005 * Math.pow(rTop / 0.005, i / 600), v = profileRms(r); if (v < best) { best = v; bestR = r } }
              row.follow = profileRms(arc.r)
              ;(row as Row & { best?: number; bestR?: number }).best = best
              ;(row as Row & { best?: number; bestR?: number }).bestR = bestR
              if (sample.length >= 5 && row.follow > 1.3 * best + 0.015) fail(`round R ${arc.r.toFixed(3)} is off the scan by ${row.follow.toFixed(3)} rms; R ${bestR.toFixed(3)} gives ${best.toFixed(3)}`)
              // A well-conditioned corner (turn ≥ 35°) must also agree with the
              // round read off the gap between the corner point and the section.
              else if (c.turn >= 35 && Math.abs(arc.r - truth.ref) > 0.35 * truth.ref + 0.4) fail(`radius ${arc.r.toFixed(3)} vs scan ${truth.ref.toFixed(3)}`)
            }
          }
          if (GUI_CASES.includes(row.id) && r.result.ok) {
            const arc = r.result.sketch.entities.find((e): e is SketchArc => e.kind === 'arc')
            gui.push({ id: row.id, section: c.section, la: [la.a, la.b], lb: [lb.a, lb.b], path, radius: arc?.r ?? null, shape: row.shape })
          }
          rows.push(row)
        }
      }
    }
    // Cases the GUI e2e (e2e-sketch-autofillet-realscan) repeats in the app.
    writeFileSync(data.path.replace(/sections\.json$/, 'gui-cases.json'), JSON.stringify(gui, null, 1))
    const bad = rows.filter((r) => !r.ok)
    writeFileSync(data.path.replace(/\.json$/, '-stress-report.json'), JSON.stringify({ total: rows.length, failed: bad.length, corners: corners.length, byProblem: Object.fromEntries([...new Set(bad.map((r) => r.problem!.replace(/ [\d.]+.*$/, '')))].map((k) => [k, bad.filter((r) => r.problem!.startsWith(k)).length])), failures: bad, rows }, null, 1))
    console.log(`Auto Fillet stress: ${rows.length} cases on ${corners.length} corners, ${bad.length} failed`)
    for (const r of bad.slice(0, 40)) console.log(' ✗', r.id, '—', r.problem, r.message ?? '', r.ref !== undefined ? `(scan R≈${r.ref.toFixed(2)}, gap ${r.gap?.toFixed(3)})` : '')
    expect(bad.map((r) => `${r.id}: ${r.problem}`)).toEqual([])
  }, 300_000)
})
