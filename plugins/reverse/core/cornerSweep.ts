// SPDX-License-Identifier: AGPL-3.0-only
// Corner Trim's swept selection. QUICKSURFACE fills the area the held cursor
// sweeps, closed back to where the button went down (its held capture,
// analysis/quick-scan-v0.0.191/native-corner-endpoints-held.png, is a filled
// triangle, not a stroke). The area is the union of the fan of triangles from
// that first point to each step of the path, plus the brush ring along the
// path itself, so a straight drag still takes what it passes over.
import type { Vec2 } from '../../../src/core/flat/types'
import { lineIntersection } from './corners'
import { anchorPoint, endsOf, entityPolyline, type Anchor, type Sketch, type SketchEntity } from './sketch'

/** The held selection: `path[0]` is where the button went down. */
export interface Sweep {
  path: Vec2[]
  /** The brush ring's radius, in sheet units. */
  radius: number
}

/** A piece the sweep touches, with where along it (0 at end a, 1 at end b,
 *  by length) the sweep covers it. */
export interface SweptPiece {
  id: number
  covered: number[]
  /** Samples taken along the piece; covered.length / samples is the share. */
  samples: number
}

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy
  const t = len > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p)
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

/** A sweep with its fan cut into triangles and bounding boxes, built once
 *  per path so that testing many pieces stays cheap. */
export class SweepArea {
  readonly path: Vec2[]
  readonly radius: number
  private tris: { a: Vec2; b: Vec2; c: Vec2; min: Vec2; max: Vec2 }[] = []
  readonly min: Vec2
  readonly max: Vec2
  constructor(sweep: Sweep) {
    // Drop repeats so zero-length steps cost nothing.
    const path: Vec2[] = []
    for (const p of sweep.path) if (p.every(Number.isFinite) && (!path.length || dist(p, path[path.length - 1]) > 0)) path.push(p)
    this.path = path
    this.radius = Number.isFinite(sweep.radius) && sweep.radius > 0 ? sweep.radius : 0
    const o = path[0]
    for (let i = 1; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1]
      if (Math.abs(cross(o, a, b)) <= 0) continue
      this.tris.push({ a: o, b: a, c: b, min: [Math.min(o[0], a[0], b[0]), Math.min(o[1], a[1], b[1])], max: [Math.max(o[0], a[0], b[0]), Math.max(o[1], a[1], b[1])] })
    }
    const xs = path.map((p) => p[0]), ys = path.map((p) => p[1]), r = this.radius
    this.min = path.length ? [Math.min(...xs) - r, Math.min(...ys) - r] : [Infinity, Infinity]
    this.max = path.length ? [Math.max(...xs) + r, Math.max(...ys) + r] : [-Infinity, -Infinity]
  }

  get empty(): boolean { return this.path.length === 0 }

  /** The closed outline the area is drawn by: the path and back. */
  get triangles(): readonly { a: Vec2; b: Vec2; c: Vec2 }[] { return this.tris }

  contains(p: Vec2): boolean {
    if (this.empty || p[0] < this.min[0] || p[1] < this.min[1] || p[0] > this.max[0] || p[1] > this.max[1]) return false
    for (const t of this.tris) if (p[0] >= t.min[0] && p[1] >= t.min[1] && p[0] <= t.max[0] && p[1] <= t.max[1] && inTriangle(p, t.a, t.b, t.c)) return true
    return this.nearPath(p) <= this.radius
  }

  /** Distance from p to the path (0 inside the fan, as the area goes). */
  distance(p: Vec2): number {
    if (this.empty) return Infinity
    for (const t of this.tris) if (inTriangle(p, t.a, t.b, t.c)) return 0
    return Math.max(0, Math.min(this.nearPath(p), this.path.length > 1 ? segmentDistance(p, this.path[this.path.length - 1], this.path[0]) : Infinity) - this.radius)
  }

  private nearPath(p: Vec2): number {
    const path = this.path
    if (path.length === 1) return dist(p, path[0])
    let best = Infinity
    for (let i = 1; i < path.length; i++) best = Math.min(best, segmentDistance(p, path[i - 1], path[i]))
    return best
  }

  /** Whether segment ab meets the area anywhere. */
  touches(a: Vec2, b: Vec2): boolean {
    if (this.empty) return false
    if (Math.max(a[0], b[0]) < this.min[0] || Math.max(a[1], b[1]) < this.min[1] || Math.min(a[0], b[0]) > this.max[0] || Math.min(a[1], b[1]) > this.max[1]) return false
    for (const t of this.tris) {
      if (Math.max(a[0], b[0]) < t.min[0] || Math.max(a[1], b[1]) < t.min[1] || Math.min(a[0], b[0]) > t.max[0] || Math.min(a[1], b[1]) > t.max[1]) continue
      if (inTriangle(a, t.a, t.b, t.c) || inTriangle(b, t.a, t.b, t.c)) return true
      if (segmentsCross(a, b, t.a, t.b) || segmentsCross(a, b, t.b, t.c) || segmentsCross(a, b, t.c, t.a)) return true
    }
    const path = this.path
    if (path.length === 1) return segmentDistance(path[0], a, b) <= this.radius
    for (let i = 1; i < path.length; i++) {
      const c = path[i - 1], d = path[i]
      if (segmentsCross(a, b, c, d)) return true
      if (Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b)) <= this.radius) return true
    }
    return false
  }
}

/** Pieces with two ends (lines, arcs, open curves) the area touches, and
 *  where along each it lies. Points, circles and closed curves never join. */
export function piecesInSweep(sketch: Pick<Sketch, 'entities'>, sweep: Sweep | SweepArea): SweptPiece[] {
  const area = sweep instanceof SweepArea ? sweep : new SweepArea(sweep)
  if (area.empty) return []
  const out: SweptPiece[] = []
  for (const e of sketch.entities) {
    if (endsOf(e).length !== 2) continue
    const outline = entityPolyline(e, 192)
    let hit = false
    for (let i = 1; i < outline.length && !hit; i++) hit = area.touches(outline[i - 1], outline[i])
    if (!hit) continue
    // Sample by length, finely enough that the brush ring cannot fall
    // between two samples, so the share on each side of a corner is true.
    const lengths = [0]
    for (let i = 1; i < outline.length; i++) lengths.push(lengths[i - 1] + dist(outline[i - 1], outline[i]))
    const total = lengths[lengths.length - 1]
    if (!(total > 0)) continue
    const step = area.radius > 0 ? area.radius / 2 : total / 64
    const samples = Math.max(16, Math.min(600, Math.ceil(total / step)))
    const covered: number[] = []
    let k = 1
    for (let s = 0; s <= samples; s++) {
      const at = (total * s) / samples
      while (k < outline.length - 1 && lengths[k] < at) k++
      const seg = lengths[k] - lengths[k - 1], u = seg > 0 ? (at - lengths[k - 1]) / seg : 0
      const p: Vec2 = [outline[k - 1][0] + (outline[k][0] - outline[k - 1][0]) * u, outline[k - 1][1] + (outline[k][1] - outline[k - 1][1]) * u]
      if (area.contains(p)) covered.push(s / samples)
    }
    if (!covered.length) {
      // A sliver of the area clips the piece between samples: where it does.
      for (let i = 1; i < outline.length; i++) if (area.touches(outline[i - 1], outline[i])) { covered.push((lengths[i - 1] + lengths[i]) / 2 / total); break }
    }
    out.push({ id: e.id, covered, samples: samples + 1 })
  }
  return out
}

/** Which end of a piece the sweep means to move. QUICKSURFACE moves the end
 *  that is painted. A line the corner falls within moves the end nearer the
 *  swept area: the painted overhang goes, and a stub left past the corner
 *  (a fitted or hand-drawn line a hair too long) goes even when the sweep
 *  misses it, rather than the long side being cut back to the corner. Before
 *  1.2.10 the side the sweep covered more of went, so a sweep along the long
 *  side, short of a 0.2 mm stub, kept the stub and threw the line away.
 *  Where both ends are as near, the side covered more goes. A line short of
 *  the corner, or a curve, moves the end the sweep lies nearer. */
export function sweptEnd(e: SketchEntity, piece: SweptPiece, corner: Vec2 | null, area?: SweepArea): 'a' | 'b' {
  const covered = piece.covered
  if (e.kind === 'line' && corner) {
    const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], len2 = dx * dx + dy * dy
    const t = len2 > 0 ? ((corner[0] - e.a[0]) * dx + (corner[1] - e.a[1]) * dy) / len2 : 0
    if (t > 1e-6 && t < 1 - 1e-6) {
      if (area) {
        const da = area.distance(e.a), db = area.distance(e.b)
        if (Math.abs(da - db) > 1e-9 * Math.max(1, Math.sqrt(len2))) return da < db ? 'a' : 'b'
      }
      const onA = covered.filter((f) => f < t).length, onB = covered.filter((f) => f > t).length
      const shareA = onA / Math.max(1e-9, t), shareB = onB / Math.max(1e-9, 1 - t)
      if (Math.abs(shareA - shareB) > 1e-9 * Math.max(shareA, shareB)) return shareA > shareB ? 'a' : 'b'
      return t <= 1 - t ? 'a' : 'b'
    }
    return dist(e.a, corner) <= dist(e.b, corner) ? 'a' : 'b'
  }
  const mean = covered.length ? covered.reduce((s, f) => s + f, 0) / covered.length : 0.5
  return mean <= 0.5 ? 'a' : 'b'
}

export interface SweptPair { ids: [number, number]; ends: [Anchor, Anchor]; cost: number }

/** The point a given share of the way along a piece, by length. */
function pointAtShare(e: SketchEntity, share: number): Vec2 {
  const outline = entityPolyline(e, 192)
  let total = 0
  for (let i = 1; i < outline.length; i++) total += dist(outline[i - 1], outline[i])
  let at = Math.max(0, Math.min(1, share)) * total
  for (let i = 1; i < outline.length; i++) {
    const seg = dist(outline[i - 1], outline[i])
    if (at <= seg || i === outline.length - 1) { const u = seg > 0 ? Math.min(1, at / seg) : 0; return [outline[i - 1][0] + (outline[i][0] - outline[i - 1][0]) * u, outline[i - 1][1] + (outline[i][1] - outline[i - 1][1]) * u] }
    at -= seg
  }
  return outline[0]
}

/** Which end of a piece a sweep means where the pair has no corner point
 *  yet (a line with an arc, two arcs, a curve). Where the sweep lies to one
 *  side of the piece, that end. A piece swept whole, or evenly about its
 *  middle (a short piece under a wide sweep), says nothing by where it was
 *  swept: it moves the end towards the swept part of the other piece.
 *  Before 1.2.7 such a piece always moved its first end, and a short line
 *  swept whole was run off the wrong way to the far side of the arc. */
function sweptEndTowards(e: SketchEntity, piece: SweptPiece, other: SketchEntity, otherPiece: SweptPiece): 'a' | 'b' {
  const mean = piece.covered.length ? piece.covered.reduce((sum, f) => sum + f, 0) / piece.covered.length : 0.5
  const share = piece.covered.length / Math.max(1, piece.samples)
  if (share < 0.8 && Math.abs(mean - 0.5) > 0.1) return mean <= 0.5 ? 'a' : 'b'
  const otherMean = otherPiece.covered.length ? otherPiece.covered.reduce((sum, f) => sum + f, 0) / otherPiece.covered.length : 0.5
  const towards = pointAtShare(other, otherMean)
  return dist(anchorPoint(e, 'a'), towards) <= dist(anchorPoint(e, 'b'), towards) ? 'a' : 'b'
}

/** Pairs of swept pieces, the one the sweep most plausibly means first: the
 *  pair whose moving ends lie closest to their corner, the corner in or near
 *  the area. Unrelated pieces the area happens to cross rank last. */
export function rankSweptPairs(sketch: Pick<Sketch, 'entities'>, sweep: Sweep | SweepArea, pieces?: readonly SweptPiece[]): SweptPair[] {
  const area = sweep instanceof SweepArea ? sweep : new SweepArea(sweep)
  const swept = pieces ?? piecesInSweep(sketch, area)
  const byId = new Map(sketch.entities.map((e) => [e.id, e]))
  const pairs: SweptPair[] = []
  for (let i = 0; i < swept.length; i++) for (let j = i + 1; j < swept.length; j++) {
    const e = byId.get(swept[i].id)!, f = byId.get(swept[j].id)!
    let corner: Vec2 | null = null
    if (e.kind === 'line' && f.kind === 'line') {
      corner = lineIntersection(e, f)
      if (!corner) continue
    }
    const ea = corner ? sweptEnd(e, swept[i], corner, area) : sweptEndTowards(e, swept[i], f, swept[j]), fa = corner ? sweptEnd(f, swept[j], corner, area) : sweptEndTowards(f, swept[j], e, swept[i])
    const pe = anchorPoint(e, ea), pf = anchorPoint(f, fa)
    const meet: Vec2 = corner ?? [(pe[0] + pf[0]) / 2, (pe[1] + pf[1]) / 2]
    const spread = corner ? dist(pe, corner) + dist(pf, corner) : dist(pe, pf)
    // Construction pieces only pair with each other.
    const mixed = Boolean(e.construction) !== Boolean(f.construction) ? 1e6 : 0
    pairs.push({ ids: [e.id, f.id], ends: [{ entity: e.id, at: ea }, { entity: f.id, at: fa }], cost: spread + 3 * area.distance(meet) + mixed })
  }
  return pairs.sort((p, q) => p.cost - q.cost)
}
