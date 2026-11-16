// SPDX-License-Identifier: AGPL-3.0-only
// Independent reconstruction from saved three- and four-face boundary repairs.
import { type Cage, topology, vertexAt } from './cage'
import { cloneCage } from './edit'

export function irregularBoundaryVertices(c: Cage): number[] {
  const t = topology(c)
  return t.vertexEdges.flatMap((edges, v) => {
    const boundary = edges.filter(e => t.edges[e].faces.length === 1).length
    return boundary && (boundary !== 2 || t.vertexFaces[v].length > 2) ? [v] : []
  })
}

const unsupported = () => new Error('These boundary points could not be repaired. Undo the topology edit or reconnect the boundary.')

/** Repair the isolated, uncreased three/four-face boundary fan observed in
 * the native editor. Other patterns are detected but not guessed. The two
 * old boundary edges become internal; their copies retain the old boundary.
 * Each old pole moves one quarter inward, along its ordered quad fan. */
export function repairBoundary(c: Cage): Cage {
  const irregular = irregularBoundaryVertices(c)
  if (!irregular.length) return cloneCage(c)
  if (irregular.length !== 1) throw unsupported()
  const v = irregular[0], t = topology(c), faces = t.vertexFaces[v]
  if (![3, 4].includes(faces.length) || faces.some(f => c.faces[f].length !== 4)) throw unsupported()
  const links = new Map<number, { next: number; diagonal: number }>()
  const incoming = new Set<number>()
  for (const f of faces) {
    const face = c.faces[f], k = face.indexOf(v)
    const previous = face[(k + 3) % 4], next = face[(k + 1) % 4]
    if (links.has(previous) || incoming.has(next)) throw unsupported()
    links.set(previous, { next, diagonal: face[(k + 2) % 4] }); incoming.add(next)
  }
  const starts = [...links.keys()].filter(p => !incoming.has(p))
  if (starts.length !== 1) throw unsupported()
  const fan = [starts[0]], diagonals: number[] = []
  while (links.has(fan[fan.length - 1])) {
    const step = links.get(fan[fan.length - 1])!
    if (fan.includes(step.next)) throw unsupported()
    fan.push(step.next); diagonals.push(step.diagonal)
  }
  if (diagonals.length !== faces.length) throw unsupported()
  const a = fan[0], b = fan[fan.length - 1], strip = [a, v, b]
  // The measured strip ends at one-face corners. Extending through regular
  // boundary rows, adjoining irregular fans or creases remains unverified.
  if (t.vertexFaces[a].length !== 1 || t.vertexFaces[b].length !== 1 ||
      c.creases.some(edge => edge.some(p => strip.includes(p)))) throw unsupported()
  const other = (p: number) => {
    const edges = t.vertexEdges[p].map(e => t.edges[e]).filter(e => e.a !== v && e.b !== v)
    if (edges.length !== 1) throw unsupported()
    return edges[0].a === p ? edges[0].b : edges[0].a
  }
  const middle = faces.length % 2 ? diagonals[(faces.length - 1) / 2] : fan[faces.length / 2]
  const towards = [other(a), middle, other(b)], out = cloneCage(c), count = c.positions.length / 3
  out.positions = new Float64Array(c.positions.length + 9)
  out.positions.set(c.positions)
  strip.forEach((p, i) => {
    out.positions.set(vertexAt(c, p), (count + i) * 3)
    for (let k = 0; k < 3; k++) out.positions[p * 3 + k] += (c.positions[towards[i] * 3 + k] - c.positions[p * 3 + k]) * .25
  })
  out.faces.push([v, a, count, count + 1], [b, v, count + 1, count + 2])
  topology(out)
  if (irregularBoundaryVertices(out).length || !out.positions.every(Number.isFinite)) throw unsupported()
  // Refuse collapsed or reversed local faces rather than committing a fold.
  const normal = (cage: Cage, face: number[]) => {
    const p = vertexAt(cage, face[0]), n = [0, 0, 0]
    for (let i = 1; i + 1 < face.length; i++) {
      const u = vertexAt(cage, face[i]).map((x, k) => x - p[k]), w = vertexAt(cage, face[i + 1]).map((x, k) => x - p[k])
      n[0] += u[1] * w[2] - u[2] * w[1]; n[1] += u[2] * w[0] - u[0] * w[2]; n[2] += u[0] * w[1] - u[1] * w[0]
    }
    return n
  }
  for (let i = 0; i < out.faces.length; i++) {
    if (i < c.faces.length && !c.faces[i].some(p => strip.includes(p))) continue
    const reference = i < c.faces.length ? c.faces[i] : c.faces[t.vertexFaces[i === c.faces.length ? a : b][0]]
    const before = normal(c, reference), after = normal(out, out.faces[i])
    if (!(before.reduce((s, x, k) => s + x * after[k], 0) > Math.hypot(...before) ** 2 * 1e-12)) throw unsupported()
    const face = out.faces[i], scale = Math.hypot(...before)
    for (let k = 0; k < face.length; k++) {
      const p = vertexAt(out, face[k]), q = vertexAt(out, face[(k + 1) % face.length])
      if (!(p.reduce((sum, x, axis) => sum + (x - q[axis]) ** 2, 0) > scale * 1e-20)) throw unsupported()
    }
  }
  return out
}
