// SPDX-License-Identifier: AGPL-3.0-only
import { type Cage, edgeKey, topology, vertexAt } from './cage'
import { cloneCage, snapSelected, windConsistently } from './edit'
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
  // Control Net OFF point contact: the merged point's surface position is the
  // captured hit, the others' stay where they were — the same four
  // corrections over every pole. Setting the hit as the control pole alone
  // left the surface 0.97 mm off the drop on a native-paired seam weld.
  if (point && !controlNet) {
    const target = anchors.map((a, v) => (v === point.vertex ? point.position : a))
    for (let step = 0; step < 4; step++) {
      const current = cageVertexLimits(out)
      out.positions = Float64Array.from(out.positions, (p, k) => p + target[Math.floor(k / 3)][k % 3] - current[Math.floor(k / 3)][k % 3])
    }
  }
  validateContactGeometry(input, out)
  return out
}

/** A face's area normal (twice its area long), by its own winding. */
function normal(c: Cage, f: readonly number[]): Vec3 {
  const p = vertexAt(c, f[0]), result: Vec3 = [0, 0, 0]
  for (let i = 1; i + 1 < f.length; i++) {
    const u = vertexAt(c, f[i]).map((v, k) => v - p[k]), v = vertexAt(c, f[i + 1]).map((v, k) => v - p[k])
    result[0] += u[1] * v[2] - u[2] * v[1]; result[1] += u[2] * v[0] - u[0] * v[2]; result[2] += u[0] * v[1] - u[1] * v[0]
  }
  return result
}

/** A face at one of `vertices` that shares three or more points with
 *  another: the two lie on one another, joined along two sides at once. */
function doubledAt(c: Cage, vertices: readonly number[]): boolean {
  const top = topology(c)
  for (const i of new Set(vertices.flatMap(v => top.vertexFaces[v] ?? []))) {
    const shared = new Map<number, number>()
    for (const v of c.faces[i]) for (const f of top.vertexFaces[v]) if (f !== i) shared.set(f, (shared.get(f) ?? 0) + 1)
    for (const count of shared.values()) if (count > 2) return true
  }
  return false
}

/** Whether a join left a quad turned over or crossed on itself, measured
 *  against the cage as it was before the drag began. The join's own check
 *  compares with the cage already dragged, where a point pulled through its
 *  quad has turned it over before the contact is made. `after` has `before`'s
 *  faces in order, its points renumbered by `map`. */
export function joinFolds(before: Cage, after: Cage, map: (v: number) => number): boolean {
  if (after.faces.length !== before.faces.length) return true
  for (let i = 0; i < after.faces.length; i++) {
    const was = before.faces[i], now = after.faces[i]
    if (now.length !== was.length) return true
    // A part turned to fit runs its faces the other way round.
    const k = now.indexOf(map(was[0])), turned = now[(k + 1) % now.length] !== map(was[1])
    const a = normal(before, was), b = normal(after, now), sign = turned ? -1 : 1
    if (!(a.reduce((s, v, axis) => s + v * b[axis], 0) * sign > 0)) return true
    // Two corners bending against the face are a quad crossed on itself. Only
    // a quad the join crossed counts: a user cage (impeller, 2026-11-18) had
    // four quads far from the contact already crossed, which refused every
    // join on that surface.
    if (crossedCorners(after, now, b) > 1 && crossedCorners(after, now, b) > crossedCorners(before, was, a)) return true
  }
  return false
}

/** How many corners of a face bend against its area normal `n`. */
function crossedCorners(c: Cage, f: readonly number[], n: Vec3): number {
  let against = 0
  for (let k = 0; k < f.length; k++) {
    const p = vertexAt(c, f[k]), q = vertexAt(c, f[(k + 1) % f.length]), r = vertexAt(c, f[(k + f.length - 1) % f.length])
    const u = q.map((v, axis) => v - p[axis]), w = r.map((v, axis) => v - p[axis])
    const corner = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]
    if (corner.reduce((s, v, axis) => s + v * n[axis], 0) < 0) against++
  }
  return against
}

function validateContactGeometry(input: Cage, cage: Cage) {
  const refuse = () => { throw new Error('These boundary points cannot be merged without damaging the surface.') }
  if (!cage.positions.every(Number.isFinite)) return refuse()
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
  const result = mergeBoundaryContacts(input, [[from, to]], contact)
  return { cage: result.cage, vertex: result.mapping[to] }
}

/** A D pull dropped on another boundary: each new pole of the extension that
 * reached an existing boundary pole is welded to it, one after another, each
 * weld followed by four corrections that keep the existing poles' surface
 * points where they were before the pull (the new poles are not corrected).
 * Paired with QUICKSURFACE 2026-11-17 (analysis/side-joins-2026-11-17/
 * reference/d-pull-merge.qsf): identical faces, poles within 0.004 mm.
 * `welds`: [new pole, existing pole], in `extended` indices; the existing
 * poles are those of `original` (indices below its pole count). */
export function weldExtension(original: Cage, extended: Cage, welds: readonly (readonly [number, number])[]): { cage: Cage; mapping: number[] } {
  const refuse = () => { throw new Error('These boundary points cannot be merged without damaging the surface.') }
  const n = original.positions.length / 3, total = extended.positions.length / 3
  const goals = cageVertexLimits({ ...original, creases: [] })
  const before = topology(extended)
  const boundary = (v: number) => before.vertexEdges[v].some(e => before.edges[e].faces.length === 1)
  for (const [from, to] of welds) {
    if (!(from >= n && from < total) || !(to >= 0 && to < n) || !boundary(to)) return refuse()
    if (extended.faces.some(f => f.includes(from) && f.includes(to))) return refuse()
  }
  if (new Set(welds.map(w => w[0])).size !== welds.length || new Set(welds.map(w => w[1])).size !== welds.length) return refuse()
  let cage: Cage = cloneCage(extended)
  // Current index of each pole of `extended`; -1 once welded away.
  let at = Array.from({ length: total }, (_, v) => v)
  for (const [from, to] of welds) {
    const f = at[from], t = at[to], count = cage.positions.length / 3
    const kept = Array.from({ length: count }, (_, v) => v).filter(v => v !== f)
    const map = (v: number) => kept.indexOf(v === f ? t : v)
    const positions = Float64Array.from(cage.positions)
    positions.set(vertexAt(cage, t), f * 3)
    cage = {
      positions: Float64Array.from(kept.flatMap(v => Array.from(positions.slice(v * 3, v * 3 + 3)))),
      faces: cage.faces.map(face => face.map(map)),
      creases: cage.creases.map(([a, b]) => [map(a), map(b)] as [number, number]),
    }
    at = at.map(v => (v < 0 ? -1 : v === f ? -1 : kept.indexOf(v)))
    // Existing poles keep their pre-pull surface points; the new ones do not move.
    const source = Array.from({ length: kept.length }, () => -1)
    at.forEach((v, e) => { if (v >= 0 && e < n) source[v] = e })
    for (let step = 0; step < 4; step++) {
      const current = cageVertexLimits({ ...cage, creases: [] })
      cage.positions = Float64Array.from(cage.positions, (p, k) => {
        const e = source[Math.floor(k / 3)]
        return e >= 0 ? p + goals[e][k % 3] - current[Math.floor(k / 3)][k % 3] : p
      })
    }
  }
  if (!cage.positions.every(Number.isFinite)) return refuse()
  const top = topology(cage), faces = new Set<string>()
  for (const f of cage.faces) {
    if (new Set(f).size !== f.length) return refuse()
    const key = [...f].sort((a, b) => a - b).join(':')
    if (faces.has(key)) return refuse()
    faces.add(key)
  }
  if (top.edges.some(e => e.faces.length > 2) || doubledAt(cage, welds.map(([, to]) => at[to]))) return refuse()
  // A pull welded onto a part wound the other way turns one part to fit.
  cage.faces = windConsistently(cage.faces)
  cage.creases = cage.creases.filter((e, i, all) => e[0] !== e[1] && all.findIndex(q => edgeKey(...q) === edgeKey(...e)) === i)
  return { cage, mapping: at }
}

/** A complete single-edge contact captures both ends in the same correction
 * solve. Sequential point welds change the anchors before the second contact. */
export function mergeBoundaryEdge(input: Cage, from: readonly [number, number], to: readonly [number, number]) {
  const top = topology(input)
  for (const pair of [from, to]) if (!top.edges.some(e => edgeKey(e.a, e.b) === edgeKey(...pair) && e.faces.length === 1)) {
    throw new Error('Only boundary edges can be joined.')
  }
  return mergeBoundaryContacts(input, [[from[0], to[0]], [from[1], to[1]]], 'chain')
}

function mergeBoundaryContacts(input: Cage, pairs: readonly (readonly [number, number])[], contact: 'point' | 'chain' | 'surface-point') {
  const refuse = () => { throw new Error('These boundary points cannot be merged without damaging the surface.') }
  const n = input.positions.length / 3, before = topology(input)
  const boundary = (v: number) => before.vertexEdges[v].some(e => before.edges[e].faces.length === 1)
  if (new Set(pairs.flat()).size !== pairs.length * 2) return refuse()
  for (const [from, to] of pairs) {
    if (![from, to].every(v => Number.isInteger(v) && v >= 0 && v < n) || from === to) return refuse()
    if (!boundary(from) || !boundary(to) || input.faces.some(f => f.includes(from) && f.includes(to))) return refuse()
  }
  const moved = cloneCage(input)
  for (const [from, to] of pairs) moved.positions.set(vertexAt(input, to), from * 3)
  // A native chain contact preserves the dragged chain's anchors before
  // capturing its endpoint; individual point contact uses the captured pole.
  // Native crease flags survive the weld, but its four contact corrections
  // use the smooth cage masks. A creased chain has the same captured poles
  // as its uncreased counterpart; including sharp masks pins its midpoint.
  const contactLimits = (c: Cage) => cageVertexLimits({ ...c, creases: [] })
  const anchors = contactLimits(contact === 'point' ? moved : input)
  const targets = new Map(pairs), kept = Array.from({ length: n }, (_, v) => v).filter(v => !targets.has(v))
  const mapping = Array.from({ length: n }, (_, v) => kept.indexOf(targets.get(v) ?? v))
  const map = (v: number) => mapping[v]
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
  if (doubledAt(cage, pairs.map(([, to]) => mapping[to]))) return refuse()
  // Two quads drawn in opposite senses meet with their shared edge running
  // the same way in both. That used to refuse the join (after the first
  // point had welded, the second never would); the part being joined on is
  // turned to fit instead, the part it is dropped on keeping its sense.
  const joined = cage.faces
  cage.faces = windConsistently(joined, joined.flatMap((f, i) => pairs.some(([, to]) => f.includes(mapping[to])) ? [i] : []))
  const turned = cage.faces.map((f, i) => f !== joined[i])
  for (let step = 0; step < 4; step++) {
    const current = contactLimits(cage)
    cage.positions = Float64Array.from(cage.positions, (p, k) => p + anchors[kept[Math.floor(k / 3)]][k % 3] - current[Math.floor(k / 3)][k % 3])
  }
  if (!cage.positions.every(Number.isFinite)) return refuse()
  for (let i = 0; i < cage.faces.length; i++) {
    const a = normal(input, input.faces[i]), b = normal(cage, cage.faces[i]), scale = Math.hypot(...a)
    if (!(a.reduce((s, v, k) => s + v * b[k], 0) * (turned[i] ? -1 : 1) > scale * scale * 1e-12)) return refuse()
    for (const v of cage.faces[i]) for (const ei of top.vertexEdges[v]) {
      const e = top.edges[ei], p = vertexAt(cage, e.a), q = vertexAt(cage, e.b)
      if (!(p.reduce((s, v, k) => s + (v - q[k]) ** 2, 0) > scale * 1e-20)) return refuse()
    }
  }
  // Keep crease serialization canonical when unrelated creases are present.
  cage.creases = cage.creases.filter((e, i, all) => all.findIndex(q => edgeKey(...q) === edgeKey(...e)) === i)
  return { cage, mapping }
}
