// SPDX-License-Identifier: AGPL-3.0-only
// Independent reconstruction from saved isolated and connected boundary repairs.
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

/** Extend each irregular fan's boundary to one-face corners, copying the
 * old perimeter and moving its poles a quarter inward. The native repair
 * applies strips in vertex order, so later strips use earlier moved poles.
 * The observed point-only joins stay unchanged while other components repair.
 * Work on clones: any other unsupported strip must not partially repair. */
export function repairBoundary(c: Cage): Cage {
  const irregular = irregularBoundaryVertices(c)
  if (!irregular.length) return cloneCage(c)
  let out = cloneCage(c)
  for (const v of irregular) {
    // One native strip may repair neighboring irregular boundary points
    // together. Do not attempt a second strip through a now-interior point.
    if (!irregularBoundaryVertices(out).includes(v)) continue
    if (pointOnlyJunction(out, v)) continue
    out = repairFan(out, v)
  }
  // Do not create a history entry or rebuild for a junction-only no-op.
  if (out.faces.length === c.faces.length) throw unsupported()
  return out
}

/** Two or three one-face corners, two two-face rows, or a one-face corner
 * and a two-face row joined at one point.
 * Native repair leaves these observed arrangements in place, including when
 * an independent connected fan is repaired by the same warning click. */
function pointOnlyJunction(c: Cage, v: number): boolean {
  const t = topology(c), faces = t.vertexFaces[v]
  const boundaryCount = t.vertexEdges[v].filter(e => t.edges[e].faces.length === 1).length
  if (![2, 3, 4].includes(faces.length) || ![4, 6].includes(boundaryCount)) return false
  const remaining = new Set(faces), groups: number[][] = []
  while (remaining.size) {
    const group = [remaining.values().next().value!]; remaining.delete(group[0])
    for (let i = 0; i < group.length; i++) {
      for (const edge of t.vertexEdges[v].map(e => t.edges[e]).filter(e => e.faces.includes(group[i]))) {
        for (const f of edge.faces) if (remaining.delete(f)) group.push(f)
      }
    }
    groups.push(group)
  }
  const pattern = groups.map(g => g.length).sort((a, b) => a - b).join(',')
  // Only observed junctions may remain while another component repairs.
  // Do not skip arbitrary disconnected fans or suppress a failed repair.
  if (boundaryCount !== 2 * groups.length || !['1,1', '1,2', '2,2', '1,1,1'].includes(pattern)) return false
  for (const group of groups) orderedFan(c, v, group)
  return true
}

function orderedFan(c: Cage, v: number, faces: number[]) {
  if (faces.some(f => c.faces[f].length !== 4)) throw unsupported()
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
  return { fan, diagonals }
}

function repairFan(c: Cage, v: number): Cage {
  const t = topology(c), faces = t.vertexFaces[v]
  if (![3, 4, 5, 6, 7, 8, 9, 12].includes(faces.length)) throw unsupported()
  orderedFan(c, v, faces)
  const next = new Map<number, number[]>(), previous = new Map<number, number[]>()
  for (const edge of t.edges) {
    if (edge.faces.length !== 1) continue
    const face = c.faces[edge.faces[0]], k = face.indexOf(edge.a)
    const a = face[(k + 1) % face.length] === edge.b ? edge.a : edge.b
    const b = a === edge.a ? edge.b : edge.a
    next.set(a, [...(next.get(a) ?? []), b]); previous.set(b, [...(previous.get(b) ?? []), a])
  }
  const strip = [v]
  const extend = (prepend: boolean, map: Map<number, number[]>) => {
    while (true) {
      const candidates = map.get(prepend ? strip[0] : strip[strip.length - 1])
      if (candidates?.length !== 1) throw unsupported()
      const p = candidates[0]
      if (strip.includes(p)) throw unsupported()
      if (prepend) strip.unshift(p); else strip.push(p)
      if (t.vertexFaces[p].length === 1) break
      if (![2, 3, 4, 5, 6, 7, 8, 9, 12].includes(t.vertexFaces[p].length)) throw unsupported()
      // Adjacent irregular fans belong to the same strip. A disconnected
      // fan or branching boundary is still refused rather than guessed.
      orderedFan(c, p, t.vertexFaces[p])
    }
  }
  extend(true, previous); extend(false, next)
  const remaining = irregularBoundaryVertices(c).filter(p => !strip.includes(p))
  // Native repair retains the original crease edges, including a boundary
  // crease that becomes internal. It does not crease the copied perimeter.
  const towards = strip.map(p => {
    const { fan, diagonals } = orderedFan(c, p, t.vertexFaces[p])
    if (diagonals.length === 1) {
      const inward = fan.filter(q => !strip.includes(q))
      if (inward.length !== 1) throw unsupported()
      return inward[0]
    }
    return diagonals.length % 2 ? diagonals[(diagonals.length - 1) / 2] : fan[diagonals.length / 2]
  })
  const out = cloneCage(c), count = c.positions.length / 3
  out.positions = new Float64Array(c.positions.length + strip.length * 3)
  out.positions.set(c.positions)
  strip.forEach((p, i) => {
    out.positions.set(vertexAt(c, p), (count + i) * 3)
    for (let k = 0; k < 3; k++) out.positions[p * 3 + k] += (c.positions[towards[i] * 3 + k] - c.positions[p * 3 + k]) * .25
  })
  for (let i = 0; i + 1 < strip.length; i++) out.faces.push([count + i + 1, strip[i + 1], strip[i], count + i])
  topology(out)
  const after = irregularBoundaryVertices(out)
  if (after.length !== remaining.length || after.some((p, i) => p !== remaining[i]) ||
      !out.positions.every(Number.isFinite)) throw unsupported()
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
    const segment = i - c.faces.length
    const edge = segment < 0 ? undefined : t.edges.find(e => e.faces.length === 1 &&
      (e.a === strip[segment] && e.b === strip[segment + 1] || e.b === strip[segment] && e.a === strip[segment + 1]))
    const reference = i < c.faces.length ? c.faces[i] : c.faces[edge!.faces[0]]
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
