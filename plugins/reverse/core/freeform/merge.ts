// SPDX-License-Identifier: AGPL-3.0-only
import { type Cage, edgeKey, topology, vertexAt } from './cage'
import { cloneCage, snapSelected } from './edit'
import { cageVertexLimits } from './limit'
import type { Vec3 } from '../../../../src/core/types'

/** Closest Point contact fits the joined surface, not the approaching poles.
 * Native point contact uses a camera-ray hit at the captured target. With
 * Control Net ON its connected component fits too. Chain contact fits only
 * the selected row; Control Net OFF retains the other surface anchors. */
export function fitMergedContact(input: Cage, selected: readonly number[], controlNet: boolean,
  closest: (p: Vec3) => Vec3 | null, point?: { vertex: number; position: Vec3 }): Cage {
  const cage = cloneCage(input), top = topology(cage), vertices = new Set(selected)
  const anchors = cageVertexLimits(cage)
  if (point) {
    if (!point.position.every(Number.isFinite)) throw new Error('No valid mesh contact.')
    cage.positions.set(point.position, point.vertex * 3)
    vertices.clear(); vertices.add(point.vertex)
    if (controlNet) for (const v of vertices) for (const ei of top.vertexEdges[v]) {
      const e = top.edges[ei]; vertices.add(e.a); vertices.add(e.b)
    }
  }
  const out = snapSelected(cage, [...vertices], p => {
    const q = closest(p)
    return q?.every(Number.isFinite) ? { point: q, distance: Math.hypot(...q.map((v, k) => v - p[k])) } : null
  })
  if (!point && !controlNet) for (let step = 0; step < 4; step++) {
    const current = cageVertexLimits(out)
    out.positions = Float64Array.from(out.positions, (p, k) => vertices.has(Math.floor(k / 3)) ? p
      : p + anchors[Math.floor(k / 3)][k % 3] - current[Math.floor(k / 3)][k % 3])
  }
  validateContactGeometry(input, out)
  return out
}

function validateContactGeometry(input: Cage, cage: Cage) {
  const refuse = () => { throw new Error('These boundary points cannot be merged without damaging the surface.') }
  if (!cage.positions.every(Number.isFinite)) return refuse()
  const normal = (c: Cage, f: number[]) => {
    const p = vertexAt(c, f[0]), result = [0, 0, 0]
    for (let i = 1; i + 1 < f.length; i++) {
      const u = vertexAt(c, f[i]).map((v, k) => v - p[k]), v = vertexAt(c, f[i + 1]).map((v, k) => v - p[k])
      result[0] += u[1] * v[2] - u[2] * v[1]; result[1] += u[2] * v[0] - u[0] * v[2]; result[2] += u[0] * v[1] - u[1] * v[0]
    }
    return result
  }
  for (let i = 0; i < cage.faces.length; i++) {
    const a = normal(input, input.faces[i]), b = normal(cage, cage.faces[i]), scale = Math.hypot(...a)
    if (!(a.reduce((s, v, k) => s + v * b[k], 0) > scale * scale * 1e-12)) return refuse()
    const f = cage.faces[i]
    for (let k = 0; k < f.length; k++) {
      const p = vertexAt(cage, f[k]), q = vertexAt(cage, f[(k + 1) % f.length])
      if (!(p.reduce((s, v, k) => s + (v - q[k]) ** 2, 0) > scale * 1e-20)) return refuse()
    }
  }
}

/** Ends of one open selected boundary, ordered by adjacent face winding.
 * Native whole-chain contact captures its trailing end first; it does not
 * weld every coincident pole. Branches and closed perimeters stay excluded. */
export function mergeChainEnds(cage: Cage, indices: readonly number[]): number[] {
  if (!indices.length || new Set(indices).size !== indices.length) return []
  const top = topology(cage), next = new Map<number, number>(), previous = new Map<number, number>()
  for (const index of indices) {
    const e = top.edges[index]
    if (!e || e.faces.length !== 1) return []
    const face = cage.faces[e.faces[0]]
    const k = face.findIndex((v, i) => edgeKey(v, face[(i + 1) % face.length]) === edgeKey(e.a, e.b))
    const a = face[k], b = face[(k + 1) % face.length]
    if (next.has(a) || previous.has(b)) return []
    next.set(a, b); previous.set(b, a)
  }
  const starts = [...next.keys()].filter(v => !previous.has(v))
  if (starts.length !== 1) return []
  const seen = new Set<number>(), start = starts[0]
  let end = start
  while (next.has(end)) {
    if (seen.has(end)) return []
    seen.add(end); end = next.get(end)!
  }
  return seen.size === indices.length ? [end, start] : []
}

/** Independently measured on three consecutive native seam contacts. The
 * moved cage supplies the surface anchors; four simultaneous corrections
 * preserve them after replacing the source pole by the target pole. */
export function mergeBoundaryPoint(input: Cage, from: number, to: number, contact: 'point' | 'chain' | 'surface-point' = 'point'): { cage: Cage; vertex: number } {
  const refuse = () => { throw new Error('These boundary points cannot be merged without damaging the surface.') }
  const n = input.positions.length / 3, before = topology(input)
  const boundary = (v: number) => before.vertexEdges[v].some(e => before.edges[e].faces.length === 1)
  if (![from, to].every(v => Number.isInteger(v) && v >= 0 && v < n) || from === to) return refuse()
  if (!boundary(from) || !boundary(to) || input.faces.some(f => f.includes(from) && f.includes(to))) return refuse()
  const moved = cloneCage(input)
  moved.positions.set(vertexAt(input, to), from * 3)
  // A native chain contact preserves the dragged chain's anchors before
  // capturing its endpoint; individual point contact uses the captured pole.
  // Native crease flags survive the weld, but its four contact corrections
  // use the smooth cage masks. A creased chain has the same captured poles
  // as its uncreased counterpart; including sharp masks pins its midpoint.
  const contactLimits = (c: Cage) => cageVertexLimits({ ...c, creases: [] })
  const anchors = contactLimits(contact === 'point' ? moved : input)
  const map = (v: number) => { const w = v === from ? to : v; return w > from ? w - 1 : w }
  const kept = Array.from({ length: n }, (_, v) => v).filter(v => v !== from)
  const cage: Cage = {
    positions: Float64Array.from(kept.flatMap(v => vertexAt(moved, v))),
    faces: input.faces.map(f => f.map(map)),
    creases: input.creases.map(([a, b]) => [map(a), map(b)]),
  }
  const top = topology(cage)
  // Shared edges must have opposite directed uses, and faces remain distinct.
  const faces = new Set<string>()
  for (const f of cage.faces) {
    if (new Set(f).size !== f.length) return refuse()
    const key = [...f].sort((a, b) => a - b).join(':')
    if (faces.has(key)) return refuse()
    faces.add(key)
  }
  for (const e of top.edges.filter(e => e.faces.length === 2)) {
    const forward = e.faces.map(fi => { const f = cage.faces[fi]; return f[(f.indexOf(e.a) + 1) % f.length] === e.b })
    if (forward[0] === forward[1]) return refuse()
  }
  for (let step = 0; step < 4; step++) {
    const current = contactLimits(cage)
    cage.positions = Float64Array.from(cage.positions, (p, k) => p + anchors[kept[Math.floor(k / 3)]][k % 3] - current[Math.floor(k / 3)][k % 3])
  }
  if (!cage.positions.every(Number.isFinite)) return refuse()
  const normal = (c: Cage, f: number[]) => {
    const p = vertexAt(c, f[0]), result = [0, 0, 0]
    for (let i = 1; i + 1 < f.length; i++) {
      const u = vertexAt(c, f[i]).map((v, k) => v - p[k]), v = vertexAt(c, f[i + 1]).map((v, k) => v - p[k])
      result[0] += u[1] * v[2] - u[2] * v[1]; result[1] += u[2] * v[0] - u[0] * v[2]; result[2] += u[0] * v[1] - u[1] * v[0]
    }
    return result
  }
  for (let i = 0; i < cage.faces.length; i++) {
    const a = normal(input, input.faces[i]), b = normal(cage, cage.faces[i]), scale = Math.hypot(...a)
    if (!(a.reduce((s, v, k) => s + v * b[k], 0) > scale * scale * 1e-12)) return refuse()
    for (const v of cage.faces[i]) for (const ei of top.vertexEdges[v]) {
      const e = top.edges[ei], p = vertexAt(cage, e.a), q = vertexAt(cage, e.b)
      if (!(p.reduce((s, v, k) => s + (v - q[k]) ** 2, 0) > scale * 1e-20)) return refuse()
    }
  }
  // Keep crease serialization canonical when unrelated creases are present.
  cage.creases = cage.creases.filter((e, i, all) => all.findIndex(q => edgeKey(...q) === edgeKey(...e)) === i)
  return { cage, vertex: map(to) }
}
