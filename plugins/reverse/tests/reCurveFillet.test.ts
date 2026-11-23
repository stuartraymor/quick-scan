// SPDX-License-Identifier: AGPL-3.0-only
// Auto Fillet and Fixed Size Fillet where an arc meets a line or another arc
// (Corner Trim). Each section below is made from a known corner: two carriers
// and a tangent round of known radius between them, so the fillet Quick Scan
// reads off the section can be checked against the radius it was made with.
import { describe, expect, it } from 'vitest'
import type { Vec2 } from '../../../src/core/flat/types'
import { addEntity, anchorPoint, emptySketch, entityOf, type Sketch, type SketchArc, type SketchLine } from '../core/sketch'
import { sweepCornerTrim, type CornerTrimOptions } from '../core/sketchCornerTrim'

const auto: CornerTrimOptions = { mode: 'autoFillet', radiusMm: 1, addDimension: true }
const fixed = (r: number): CornerTrimOptions => ({ mode: 'fixedFillet', radiusMm: r, addDimension: true })
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
const at = (c: Vec2, r: number, a: number): Vec2 => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]
const ang = (c: Vec2, p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0])

/** A section polyline: straight runs and arcs, sampled about every `step`. */
function polyline(parts: ({ line: [Vec2, Vec2] } | { arc: { c: Vec2; r: number; from: number; to: number } })[], step = 0.25, wobble = 0): Vec2[] {
  const out: Vec2[] = []
  let k = 0
  const push = (p: Vec2, n: Vec2) => { const w = wobble ? wobble * Math.sin(k++ * 2.3) : 0; out.push([p[0] + n[0] * w, p[1] + n[1] * w]) }
  for (const part of parts) {
    if ('line' in part) {
      const [a, b] = part.line, n = Math.max(1, Math.ceil(dist(a, b) / step)), u: Vec2 = [(b[0] - a[0]) / dist(a, b), (b[1] - a[1]) / dist(a, b)]
      for (let i = 0; i < n; i++) push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n], [-u[1], u[0]])
    } else {
      const { c, r, from, to } = part.arc, n = Math.max(2, Math.ceil(Math.abs(to - from) * r / step))
      for (let i = 0; i < n; i++) { const t = from + (to - from) * i / n; push(at(c, r, t), [Math.cos(t), Math.sin(t)]) }
    }
  }
  const last = parts[parts.length - 1]
  out.push('line' in last ? last.line[1] : at(last.arc.c, last.arc.r, last.arc.to))
  return out
}

function check(s: Sketch, result: ReturnType<typeof sweepCornerTrim>['result'], ids: number[]) {
  expect(result.ok, result.ok ? '' : result.error).toBe(true)
  if (!result.ok) throw new Error()
  const arc = result.sketch.entities.find((e): e is SketchArc => e.kind === 'arc' && !ids.includes(e.id))!
  expect(arc).toBeTruthy()
  // Both pieces end exactly on the fillet, and the fillet is tangent to each.
  const ends = [anchorPoint(arc, 'a'), anchorPoint(arc, 'b')]
  for (const id of ids) {
    const e = entityOf(result.sketch, id)!
    const touching = (['a', 'b'] as const).map((k) => anchorPoint(e, k)).filter((p) => ends.some((q) => dist(p, q) < 1e-6))
    expect(touching.length).toBe(1)
    const p = touching[0]
    const toFillet: Vec2 = [p[0] - arc.c[0], p[1] - arc.c[1]]
    if (e.kind === 'line') {
      const d: Vec2 = [e.b[0] - e.a[0], e.b[1] - e.a[1]]
      expect(Math.abs(toFillet[0] * d[0] + toFillet[1] * d[1]) / Math.hypot(...d) / arc.r).toBeLessThan(1e-6)
    } else if (e.kind === 'arc') {
      const toOwn: Vec2 = [p[0] - e.c[0], p[1] - e.c[1]]
      expect(Math.abs(toFillet[0] * toOwn[1] - toFillet[1] * toOwn[0]) / Math.hypot(...toFillet) / Math.hypot(...toOwn)).toBeLessThan(1e-6)
    }
  }
  // The far ends never move.
  for (const f of result.farAnchors) expect(dist(anchorPoint(entityOf(result.sketch, f.anchor.entity)!, f.anchor.at), f.to)).toBeLessThan(1e-6)
  void s
  return arc
}

describe('Fillet a line and an arc', () => {
  // Part below y = 0 and inside the circle C (10, -20) R 25: corner at (25, 0).
  // An R4 round inside both: centre (10 + √185, -4).
  const C: Vec2 = [10, -20], R = 25, r = 4
  const P: Vec2 = [10 + Math.sqrt(185), -4]
  const tLine: Vec2 = [P[0], 0], tArc = at(C, R, ang(C, P))
  const chain = polyline([{ line: [[-10, 0], tLine] }, { arc: { c: P, r, from: Math.PI / 2, to: ang(P, tArc) } }, { arc: { c: C, r: R, from: ang(C, tArc), to: -Math.PI / 3 } }])
  const sketch = () => {
    const s = emptySketch()
    const line = addEntity(s, { kind: 'line', a: [-8, 0], b: [18, 0] })
    const arc = addEntity(s, { kind: 'arc', c: C, r: R, start: -Math.PI / 3, sweep: Math.PI / 3 + 20 * Math.PI / 180 })
    return { s, line, arc }
  }
  const stroke: Vec2[] = [[18, 0], [25, 0], at(C, R, 20 * Math.PI / 180)]

  it('Auto Fillet reads the round off the section: R 4', () => {
    const { s, line, arc } = sketch()
    const { result } = sweepCornerTrim(s, { path: stroke, radius: 0.5 }, auto, [], [chain])
    const fillet = check(s, result, [line, arc])
    expect(Math.abs(fillet.r - r)).toBeLessThan(1e-4)
    expect(dist(fillet.c, P)).toBeLessThan(1e-3)
    // Two undo steps, as between two lines: the join first.
    expect(result.ok && result.joined).toBeTruthy()
  })

  it('reads it through scan noise', () => {
    const { s, line, arc } = sketch()
    const noisy = polyline([{ line: [[-10, 0], tLine] }, { arc: { c: P, r, from: Math.PI / 2, to: ang(P, tArc) } }, { arc: { c: C, r: R, from: ang(C, tArc), to: -Math.PI / 3 } }], 0.25, 0.02)
    const { result } = sweepCornerTrim(s, { path: stroke, radius: 0.5 }, auto, [], [noisy])
    const fillet = check(s, result, [line, arc])
    expect(Math.abs(fillet.r - r)).toBeLessThan(0.08)
  })

  it('Fixed Size Fillet puts the asked radius in', () => {
    const { s, line, arc } = sketch()
    const { result } = sweepCornerTrim(s, { path: stroke, radius: 0.5 }, fixed(2.5), [], [chain])
    const fillet = check(s, result, [line, arc])
    expect(fillet.r).toBeCloseTo(2.5, 9)
  })

  it('joins sharp when the corner point is not painted', () => {
    const { s } = sketch()
    const { result } = sweepCornerTrim(s, { path: [[18, 0], [22, -1.2], at(C, R, 20 * Math.PI / 180)], radius: 0.3 }, auto, [], [chain])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.unswept).toBe(true)
    expect(result.sketch.entities.filter((e) => e.kind === 'arc').length).toBe(1)
  })

  it('lines far short of the corner are extended and filleted', () => {
    const s = emptySketch()
    const line = addEntity(s, { kind: 'line', a: [-8, 0], b: [2, 0] })
    const arc = addEntity(s, { kind: 'arc', c: C, r: R, start: -Math.PI / 3, sweep: Math.PI / 3 - 10 * Math.PI / 180 })
    const end = at(C, R, -10 * Math.PI / 180)
    const { result } = sweepCornerTrim(s, { path: [[2, 0], [25, 0], end], radius: 0.5 }, auto, [], [chain])
    const fillet = check(s, result, [line, arc])
    expect(Math.abs(fillet.r - r)).toBeLessThan(1e-4)
  })
})

describe('Fillet a line and an arc bulging into the part', () => {
  // Part below y = 0 and outside the circle C (10, 10) R 15: corner at (10 + √125, 0).
  // An R4 round outside the circle: centre (10 + √165, -4).
  const C: Vec2 = [10, 10], R = 15, r = 4
  const P: Vec2 = [10 + Math.sqrt(165), -4]
  const tLine: Vec2 = [P[0], 0], tArc = at(C, R, ang(C, P))
  const chain = polyline([{ arc: { c: C, r: R, from: -Math.PI / 2 - 0.4, to: ang(C, tArc) } }, { arc: { c: P, r, from: ang(P, tArc), to: Math.PI / 2 } }, { line: [tLine, [45, 0]] }])

  it('Auto Fillet: R 4 outside the arc', () => {
    const s = emptySketch()
    const arc = addEntity(s, { kind: 'arc', c: C, r: R, start: -Math.PI / 2 - 0.4, sweep: 0.9 })
    const line = addEntity(s, { kind: 'line', a: [27, 0], b: [44, 0] })
    const corner: Vec2 = [10 + Math.sqrt(125), 0]
    const { result } = sweepCornerTrim(s, { path: [at(C, R, -Math.PI / 2 + 0.5), corner, [27, 0]], radius: 0.5 }, auto, [], [chain])
    const fillet = check(s, result, [line, arc])
    expect(Math.abs(fillet.r - r)).toBeLessThan(1e-4)
    expect(dist(fillet.c, P)).toBeLessThan(1e-3)
  })
})

describe('Fillet two arcs', () => {
  // A lens: inside both circles (0, 0) R 30 and (40, 0) R 30; top corner (20, √500).
  // An R4 round inside both: centre (20, √276).
  const C1: Vec2 = [0, 0], C2: Vec2 = [40, 0], R = 30, r = 4
  const P: Vec2 = [20, Math.sqrt(276)]
  const t1 = at(C1, R, ang(C1, P)), t2 = at(C2, R, ang(C2, P))
  const chain = polyline([{ arc: { c: C1, r: R, from: 0.2, to: ang(C1, t1) } }, { arc: { c: P, r, from: ang(P, t1), to: ang(P, t2) } }, { arc: { c: C2, r: R, from: ang(C2, t2), to: Math.PI - 0.2 } }])

  const sketch = () => {
    const s = emptySketch()
    const a1 = addEntity(s, { kind: 'arc', c: C1, r: R, start: 0.2, sweep: 0.5 })
    const a2 = addEntity(s, { kind: 'arc', c: C2, r: R, start: Math.PI - 0.7, sweep: 0.5 })
    return { s, a1, a2 }
  }
  const stroke: Vec2[] = [at(C1, R, 0.7), [20, Math.sqrt(500)], at(C2, R, Math.PI - 0.7)]

  it('Auto Fillet: R 4 between the arcs', () => {
    const { s, a1, a2 } = sketch()
    const { result } = sweepCornerTrim(s, { path: stroke, radius: 0.5 }, auto, [], [chain])
    const fillet = check(s, result, [a1, a2])
    expect(Math.abs(fillet.r - r)).toBeLessThan(1e-4)
    expect(dist(fillet.c, P)).toBeLessThan(1e-3)
    expect(result.ok && result.joined).toBeTruthy()
  })

  it('Fixed Size Fillet between the arcs', () => {
    const { s, a1, a2 } = sketch()
    const { result } = sweepCornerTrim(s, { path: stroke, radius: 0.5 }, fixed(6), [], [chain])
    const fillet = check(s, result, [a1, a2])
    expect(fillet.r).toBeCloseTo(6, 9)
  })

  it('refuses a radius that does not fit', () => {
    const { s } = sketch()
    const { result } = sweepCornerTrim(s, { path: stroke, radius: 0.5 }, fixed(200), [], [chain])
    expect(result.ok).toBe(false)
  })
})

describe('a sharp scan corner between a line and an arc', () => {
  const C: Vec2 = [10, -20], R = 25
  const corner: Vec2 = [25, 0]
  const chain = polyline([{ line: [[-10, 0], corner] }, { arc: { c: C, r: R, from: ang(C, corner), to: -Math.PI / 3 } }])
  it('is joined sharp', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [-8, 0], b: [18, 0] })
    addEntity(s, { kind: 'arc', c: C, r: R, start: -Math.PI / 3, sweep: Math.PI / 3 + 20 * Math.PI / 180 })
    const { result } = sweepCornerTrim(s, { path: [[18, 0], corner, at(C, R, 20 * Math.PI / 180)], radius: 0.5 }, auto, [], [chain])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.shape).toBe('sharp')
    const line = result.sketch.entities.find((e): e is SketchLine => e.kind === 'line')!
    expect(Math.min(dist(line.a, corner), dist(line.b, corner))).toBeLessThan(1e-6)
  })
})
