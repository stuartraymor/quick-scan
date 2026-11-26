// SPDX-License-Identifier: AGPL-3.0-only
import type { PolynomialSurface, SurfaceAxis } from '../surfaceStep'
import type { PatchGrid } from './patches'

/** On a regular Catmull-Clark span, the limit is bicubic in the subdivision
 * parameter. Interpolate two half-spans on each group of five limit samples.
 * Their endpoint tangents use the derivative of the quartic interpolant:
 * exact for regular cubics and a closer approximation at extraordinary vertices.
 * Reversing a span reverses the same poles, so adjacent blocks reproduce
 * the same boundary curve independently of their interior spacing. */
export function subdivisionNet(grid: PatchGrid, tangents?: Float64Array): PolynomialSurface | undefined {
  if (grid.rows < 5 || grid.cols < 5 || (grid.rows - 1) % 4 || (grid.cols - 1) % 4) return
  const u = cubicAxis(grid.rows), v = cubicAxis(grid.cols)
  const acrossRows = Array.from({ length: u.count }, (_, i) => poleWeights(i))
  const acrossCols = Array.from({ length: v.count }, (_, j) => poleWeights(j))
  const poles: number[][] = []
  for (const row of acrossRows) for (const col of acrossCols) {
    poles.push(weightedPoint(grid, row, col))
  }
  if (tangents) for (let i = 0; i < tangents.length; i += 4) {
    poles[tangents[i]] = [tangents[i+1], tangents[i+2], tangents[i+3]]
  }
  return { u, v, poles }
}

function weightedPoint(grid: PatchGrid, row: [number, number][], col: [number, number][]): number[] {
  const point = [0, 0, 0]
  for (const [i, wi] of row) for (const [j, wj] of col) {
    const at = 3 * (i * grid.cols + j)
    for (let d = 0; d < 3; d++) point[d] += wi * wj * grid.points[at + d]
  }
  return point
}

interface StripPole { edge: number[]; interior: number[]; fixed: boolean }

/** Reconcile the transverse Bernstein derivatives on each shared smooth span.
 * Pairs use the same topological midpoint and winding. Keep every boundary
 * curve fixed, including at T junctions. Corner-adjacent interior poles
 * participate in two constraints, so relax the strips together. */
export function matchedTangents(grids: PatchGrid[]): Map<PatchGrid, Float64Array> {
  const pending = new Map<number, StripPole[]>()
  const pairs: [StripPole[], StripPole[]][] = []
  const interiors = new Map<PatchGrid, Map<number, number[]>>()
  for (const grid of grids) {
    if (!grid.smoothSpans) continue
    const rows = cubicAxis(grid.rows).count, cols = cubicAxis(grid.cols).count
    const poles = new Map<number, number[]>(), movable = new Map<number, number[]>()
    interiors.set(grid, movable)
    const pole = (r: number, c: number) => {
      const id = r*cols+c
      let p = poles.get(id)
      if (!p) { p = weightedPoint(grid, poleWeights(r), poleWeights(c)); poles.set(id,p) }
      return p
    }
    grid.smoothSpans.forEach((spans, side) => {
      const vertical = side < 2
      spans.forEach((key, span) => {
        if (!key) return
        const strip = [0,1,2,3].map(k => {
          const along = span*3 + (key < 0 ? 3-k : k)
          const row = vertical ? along : side === 3 ? rows-1 : 0
          const col = vertical ? side === 1 ? cols-1 : 0 : along
          const r = row + (side === 2 ? 1 : side === 3 ? -1 : 0)
          const c = col + (side === 0 ? 1 : side === 1 ? -1 : 0)
          const interior = pole(r,c), fixed = r===0 || c===0 || r===rows-1 || c===cols-1
          if (!fixed) movable.set(r*cols+c, interior)
          return { edge: pole(row,col), interior, fixed }
        })
        const id = Math.abs(key), other = pending.get(id)
        if (other) { pairs.push([other,strip]); pending.delete(id) }
        else pending.set(id,strip)
      })
    })
  }
  for (let pass=0; pass<5; pass++) for (const [a,b] of pairs) for (let i=0; i<4; i++) {
    const x=a[i], y=b[i]
    if (x.fixed && y.fixed) continue
    for (let d=0; d<3; d++) {
      const error = (x.edge[d]-x.interior[d]) + (y.edge[d]-y.interior[d])
      if (!x.fixed) x.interior[d] += error * (y.fixed ? 1 : .5)
      if (!y.fixed) y.interior[d] += error * (x.fixed ? 1 : .5)
    }
  }
  const result = new Map<PatchGrid, Float64Array>()
  for (const [grid, movable] of interiors) {
    const data = new Float64Array(movable.size*4)
    let i=0
    for (const [id,p] of movable) { data.set([id,...p],i); i+=4 }
    if (data.length) result.set(grid,data)
  }
  return result
}

function cubicAxis(samples: number): SurfaceAxis {
  const spans = (samples - 1) / 2
  const knots = Array.from({ length: spans + 1 }, (_, i) => i)
  return { degree: 3, count: spans * 3 + 1, knots, mults: knots.map(i => i === 0 || i === spans ? 4 : 3) }
}

function poleWeights(pole: number): [number, number][] {
  const first = 2 * Math.floor(pole / 3)
  const local = pole % 3
  if (local === 0) return [[first, 1]]
  // Cubic Hermite to Bernstein: P1 = start + h*f'(start)/3,
  // P2 = end - h*f'(end)/3. A half-span h covers two samples.
  const base = first - first % 4
  const offset = first - base + (local === 2 ? 2 : 0)
  const sign = local === 1 ? 1 : -1
  const derivative = offset === 0 ? [-25, 48, -36, 16, -3]
    : offset === 4 ? [3, -16, 36, -48, 25] : [1, -8, 0, 8, -1]
  return derivative.map((weight, i) => [base + i, (i === offset ? 1 : 0) + sign * weight / 18])
}
