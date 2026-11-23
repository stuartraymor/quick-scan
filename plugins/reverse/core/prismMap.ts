// SPDX-License-Identifier: AGPL-3.0-only
// The live map of a straight extrude, read while its arrow is in the hand.
//
// The ghost of an extrude swept square off its sketch, with no taper, is a
// prism: the picked profiles between two heights. The signed distance to a
// prism is exact in closed form — the distance across the sketch plane to the
// profiles' outline and the distance along the normal to the slab, put
// together the way a box's are — so the map needs neither the CAD kernel's
// ghost nor a tree over its triangles. Better: only the heights move while an
// end is dragged, and the half of the reading that is across the plane does
// not. That half is read once per profile (prepareExtrudeMap), and every step
// of the drag after it is a pass of arithmetic over the scan near the
// profiles (extrudeField) — fast enough to follow the cursor frame by frame.
//
// It is the same reading the kernel's map makes (liveMap.ts) — signed
// millimetres, positive outside the body, the vertices within the reach
// only, a scan vertex facing away from its nearest surface read against the
// nearest one within reach that faces it — against the exact profile rather
// than a tessellation of it. When the hand lets go, the kernel's map of the
// built ghost takes over as before.

import type { Vec2 } from '../../../src/core/flat/types'
import type { SectionFrame } from '../../../src/core/section/frame'
import type { Vec3 } from '../../../src/core/types'
import { liveMapReach, type SparseField } from './liveMap'

/** The profiles to sweep: each an outer loop and its holes, as polygons on
 *  the sketch plane. */
export interface PrismLoops {
  outer: readonly Vec2[]
  holes: readonly (readonly Vec2[])[]
}

/** The outline of the profiles taken together: every loop's sides, less the
 *  sides two picked profiles share — those are inside the swept body, not on
 *  its surface — four numbers a side (ax, ay, bx, by). */
export function prismOutline(loops: readonly PrismLoops[]): Float64Array {
  const sides: number[][] = []
  for (const r of loops) {
    for (const ring of [r.outer, ...r.holes]) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        if (a[0] === b[0] && a[1] === b[1]) continue
        sides.push([a[0], a[1], b[0], b[1]])
      }
    }
  }
  const key = (x: number, y: number) => `${Math.round(x * 1e6)},${Math.round(y * 1e6)}`
  const count = new Map<string, number>()
  const sideKey = (s: number[]) => {
    const p = key(s[0], s[1])
    const q = key(s[2], s[3])
    return p < q ? `${p}|${q}` : `${q}|${p}`
  }
  for (const s of sides) count.set(sideKey(s), (count.get(sideKey(s)) ?? 0) + 1)
  const kept = sides.filter((s) => count.get(sideKey(s)) === 1)
  const out = new Float64Array(kept.length * 4)
  kept.forEach((s, i) => out.set(s, i * 4))
  return out
}

/** A grid over the outline: the sides within reach of each cell, so a
 *  point's distance is read off a handful of sides; a cell with none is
 *  wholly inside or wholly outside, and remembers which. */
class OutlineGrid {
  readonly x0: number
  readonly y0: number
  readonly cell: number
  readonly nx: number
  readonly ny: number
  private readonly start: Uint32Array
  private readonly list: Uint32Array
  private readonly inside: Int8Array

  constructor(readonly sides: Float64Array, readonly reach: number) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const n = sides.length / 4
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, sides[i * 4], sides[i * 4 + 2])
      maxX = Math.max(maxX, sides[i * 4], sides[i * 4 + 2])
      minY = Math.min(minY, sides[i * 4 + 1], sides[i * 4 + 3])
      maxY = Math.max(maxY, sides[i * 4 + 1], sides[i * 4 + 3])
    }
    if (n === 0) minX = minY = maxX = maxY = 0
    this.x0 = minX - reach
    this.y0 = minY - reach
    const w = maxX - minX + 2 * reach
    const h = maxY - minY + 2 * reach
    this.cell = Math.max(reach, Math.max(w, h) / 256, 1e-6)
    this.nx = Math.max(1, Math.ceil(w / this.cell))
    this.ny = Math.max(1, Math.ceil(h / this.cell))
    const cells = this.nx * this.ny
    const counts = new Uint32Array(cells + 1)
    const visit = (i: number, fn: (c: number) => void) => {
      const ax = sides[i * 4], ay = sides[i * 4 + 1], bx = sides[i * 4 + 2], by = sides[i * 4 + 3]
      const cx0 = this.col(Math.min(ax, bx) - reach), cx1 = this.col(Math.max(ax, bx) + reach)
      const cy0 = this.row(Math.min(ay, by) - reach), cy1 = this.row(Math.max(ay, by) + reach)
      // A long slanted side's box covers cells it passes far from; those
      // are left out by their distance to the side.
      const half = this.cell * Math.SQRT1_2 + reach
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const px = this.x0 + (cx + 0.5) * this.cell, py = this.y0 + (cy + 0.5) * this.cell
          if (segmentDistance(px, py, ax, ay, bx, by).d <= half) fn(cy * this.nx + cx)
        }
      }
    }
    for (let i = 0; i < n; i++) visit(i, (c) => counts[c + 1]++)
    for (let c = 0; c < cells; c++) counts[c + 1] += counts[c]
    this.start = counts
    this.list = new Uint32Array(counts[cells])
    const fill = counts.slice(0, cells)
    for (let i = 0; i < n; i++) visit(i, (c) => { this.list[fill[c]++] = i })
    this.inside = new Int8Array(cells).fill(-1)
  }

  col(x: number): number {
    return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.x0) / this.cell)))
  }

  row(y: number): number {
    return Math.min(this.ny - 1, Math.max(0, Math.floor((y - this.y0) / this.cell)))
  }

  /** Whether a point is inside the outline: an even-odd count of the sides
   *  a ray to +x crosses. */
  contains(x: number, y: number): boolean {
    const s = this.sides
    let inside = false
    for (let i = 0; i < s.length; i += 4) {
      const ay = s[i + 1], by = s[i + 3]
      if ((ay > y) === (by > y)) continue
      const ax = s[i], bx = s[i + 2]
      if (x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inside = !inside
    }
    return inside
  }

  /**
   * The signed distance across the plane from (x, y) to the outline,
   * negative inside — exact within the reach, and past it only ±(reach + 1)
   * with the right sign. `normal` gets the outward direction of the nearest
   * side at the point, for reading which way the surface there faces.
   */
  signed(x: number, y: number, normal: Float64Array): number {
    const far = this.reach + 1
    normal[0] = 0
    normal[1] = 0
    if (x < this.x0 || y < this.y0 || x > this.x0 + this.nx * this.cell || y > this.y0 + this.ny * this.cell) return far
    const c = this.row(y) * this.nx + this.col(x)
    const a = this.start[c], b = this.start[c + 1]
    if (a === b) {
      if (this.inside[c] < 0) this.inside[c] = this.contains(this.x0 + (this.col(x) + 0.5) * this.cell, this.y0 + (this.row(y) + 0.5) * this.cell) ? 1 : 0
      return this.inside[c] === 1 ? -far : far
    }
    const s = this.sides
    let best = Infinity, qx = 0, qy = 0, side = -1
    for (let k = a; k < b; k++) {
      const i = this.list[k] * 4
      const r = segmentDistance(x, y, s[i], s[i + 1], s[i + 2], s[i + 3])
      if (r.d < best) {
        best = r.d
        qx = r.x
        qy = r.y
        side = i
      }
    }
    const inside = this.contains(x, y)
    if (best > this.reach) return inside ? -far : far
    // Outward: from the nearest point to the point outside, the other way
    // inside; on the outline itself, square to the side it is on.
    let nx = x - qx, ny = y - qy
    const l = Math.hypot(nx, ny)
    if (l > 1e-12) {
      nx /= l
      ny /= l
      if (inside) { nx = -nx; ny = -ny }
    } else if (side >= 0) {
      const dx = s[side + 2] - s[side], dy = s[side + 3] - s[side + 1]
      const m = Math.hypot(dx, dy) || 1
      nx = dy / m
      ny = -dx / m
      if (this.contains(x + nx * 1e-6, y + ny * 1e-6)) { nx = -nx; ny = -ny }
    }
    normal[0] = nx
    normal[1] = ny
    return inside ? -best : best
  }
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): { d: number; x: number; y: number } {
  const dx = bx - ax, dy = by - ay
  const l2 = dx * dx + dy * dy
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const x = ax + t * dx, y = ay + t * dy
  return { d: Math.hypot(px - x, py - y), x, y }
}

/** What stays put while the extrude's ends move: the scan vertices within
 *  reach of the profiles across the plane, each with its height off the
 *  plane, its distance across the plane, the outline's outward direction
 *  there, and its own normal in the sketch's frame. */
export interface ExtrudeMapPrep {
  reach: number
  index: Uint32Array
  height: Float32Array
  across: Float32Array
  /** The outline's outward direction across the plane, two per vertex. */
  wall: Float32Array
  /** The scan's normal in the sketch's frame (u, v, n), three per vertex;
   *  null without normals. */
  normal: Float32Array | null
}

/**
 * Read the scan across the sketch plane once: every vertex whose foot on
 * the plane lies within `reach` of the profiles. `positions` and `normals`
 * are the scan's, in the frame the sketch is in.
 */
export function prepareExtrudeMap(positions: Float32Array, normals: Float32Array | null, frame: SectionFrame, loops: readonly PrismLoops[], range: number): ExtrudeMapPrep {
  const reach = liveMapReach(range)
  const grid = new OutlineGrid(prismOutline(loops), reach)
  const o = frame.origin, U = frame.basisU, V = frame.basisV, N = frame.normal
  const n = positions.length / 3
  const index: number[] = []
  const height: number[] = []
  const across: number[] = []
  const wall: number[] = []
  const nrm: number[] = []
  const side = new Float64Array(2)
  const gx0 = grid.x0, gy0 = grid.y0, gx1 = grid.x0 + grid.nx * grid.cell, gy1 = grid.y0 + grid.ny * grid.cell
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3] - o[0], y = positions[v * 3 + 1] - o[1], z = positions[v * 3 + 2] - o[2]
    const u = x * U[0] + y * U[1] + z * U[2]
    if (u < gx0 || u > gx1) continue
    const w = x * V[0] + y * V[1] + z * V[2]
    if (w < gy0 || w > gy1) continue
    const d2 = grid.signed(u, w, side)
    if (d2 > reach) continue
    index.push(v)
    height.push(x * N[0] + y * N[1] + z * N[2])
    across.push(d2)
    wall.push(side[0], side[1])
    if (normals) {
      const a = normals[v * 3], b = normals[v * 3 + 1], c = normals[v * 3 + 2]
      nrm.push(a * U[0] + b * U[1] + c * U[2], a * V[0] + b * V[1] + c * V[2], a * N[0] + b * N[1] + c * N[2])
    }
  }
  return {
    reach,
    index: Uint32Array.from(index),
    height: Float32Array.from(height),
    across: Float32Array.from(across),
    wall: Float32Array.from(wall),
    normal: normals ? Float32Array.from(nrm) : null,
  }
}

/** The prism's signed distance and the outward direction of the surface
 *  nearest, for one vertex: `d2` across the plane, `dh` along the normal
 *  past the slab (both negative inside). */
function prismDistance(d2: number, dh: number, wx: number, wy: number, up: number, out: Float64Array): number {
  if (d2 <= 0 && dh <= 0) {
    // Inside: the nearer of the side and the end faces.
    if (d2 > dh) { out[0] = wx; out[1] = wy; out[2] = 0 } else { out[0] = 0; out[1] = 0; out[2] = up }
    return Math.max(d2, dh)
  }
  const a = Math.max(d2, 0), b = Math.max(dh, 0)
  const d = Math.hypot(a, b)
  out[0] = d > 0 ? (wx * a) / d : 0
  out[1] = d > 0 ? (wy * a) / d : 0
  out[2] = d > 0 ? (up * b) / d : up
  return d
}

/**
 * The map for one pair of ends, `from` and `to` along the normal (either
 * way round): the vertices within reach and their signed distances,
 * ascending — what liveMap gives for the same ghost. With `facing`, a
 * vertex whose nearest face turns away from it (the scan's normal against
 * the face's, past 90°) is read against the nearest face within reach that
 * turns towards it, as the kernel's map is (ScanSide, DEFAULT_FACING_DEG);
 * the scan's winding is read off the vertices near the surface first.
 */
export function extrudeField(prep: ExtrudeMapPrep, from: number, to: number, facing = true): SparseField {
  const lo = Math.min(from, to), hi = Math.max(from, to)
  const { reach, index, height, across, wall } = prep
  const normal = facing ? prep.normal : null
  const n = index.length
  const out = new Float64Array(3)
  // Which way round the scan is wound: its normals against the faces they
  // are nearest, weighted to the vertices on the surface (scanNormalsSign).
  let sign = 1
  if (normal) {
    let agree = 0
    const step = Math.max(1, Math.floor(n / 4000))
    for (let i = 0; i < n; i += step) {
      const h = height[i]
      const up = h - lo < hi - h ? -1 : 1
      const d = prismDistance(across[i], Math.max(lo - h, h - hi), wall[i * 2], wall[i * 2 + 1], up, out)
      if (!(Math.abs(d) <= reach)) continue
      const wgt = 1 / (1 + (d / (reach / 10)) ** 2)
      agree += wgt * (normal[i * 3] * out[0] + normal[i * 3 + 1] * out[1] + normal[i * 3 + 2] * out[2])
    }
    sign = agree < 0 ? -1 : 1
  }
  const subset = new Uint32Array(n)
  const values = new Float32Array(n)
  let w = 0
  for (let i = 0; i < n; i++) {
    const h = height[i]
    const d2 = across[i]
    const dh = Math.max(lo - h, h - hi)
    const up = h - lo < hi - h ? -1 : 1
    let d = prismDistance(d2, dh, wall[i * 2], wall[i * 2 + 1], up, out)
    if (normal) {
      const sx = sign * normal[i * 3], sy = sign * normal[i * 3 + 1], sz = sign * normal[i * 3 + 2]
      if (sx * out[0] + sy * out[1] + sz * out[2] < 0) {
        // The nearest face turns away: the nearest within reach that turns
        // this way, if any — an end face over the profile, or the side
        // within the slab.
        let best = Infinity
        if (d2 <= 0) {
          if (sz > 0 && Math.abs(h - hi) < Math.abs(best)) best = h - hi
          if (sz < 0 && Math.abs(lo - h) < Math.abs(best)) best = lo - h
        }
        if (h >= lo && h <= hi && sx * wall[i * 2] + sy * wall[i * 2 + 1] > 0 && Math.abs(d2) < Math.abs(best)) best = d2
        if (Math.abs(best) <= reach) d = best
      }
    }
    if (!(Math.abs(d) <= reach)) continue
    subset[w] = index[i]
    values[w] = d
    w++
  }
  return { subset: subset.slice(0, w), values: values.slice(0, w) }
}

/** Whether an extrude's ghost is a prism this reads exactly: off a sketch,
 *  square to it, untapered, both ends numbers. */
export function prismReadable(d: { face?: unknown; direction?: Vec3 | null; draftDeg: number; extent: { kind: string } }): boolean {
  return !d.face && !d.direction && d.draftDeg === 0 && (d.extent.kind === 'distance' || d.extent.kind === 'symmetric')
}

/** The two heights of an extent this reads: a distance's ends, or half a
 *  symmetric total either side of the plane. */
export function prismEnds(extent: { kind: 'distance'; from: number; to: number } | { kind: 'symmetric'; total: number }): [number, number] {
  return extent.kind === 'distance' ? [extent.from, extent.to] : [-extent.total / 2, extent.total / 2]
}
