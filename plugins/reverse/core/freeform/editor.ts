// SPDX-License-Identifier: AGPL-3.0-only
// Selection rules for the interactive cage editor. These are conservative
// implementation rules, not a claim that every native context is equivalent.
import { type Cage, edgeKey, topology, vertexAt, vertexCount } from './cage'
import { addFace, closeHole, deleteFaces, setCrease, splitLoop } from './edit'

export interface FreeformSelection { kind: 'vertex' | 'edge' | 'face'; index: number }
export type EditorAction = 'split' | 'crease' | 'remove_crease' | 'delete' | 'close_hole' | 'bridge'

function checkedSelection(c: Cage, selection: readonly FreeformSelection[]): FreeformSelection[] {
  const edges = topology(c).edges
  const unique = new Map<string, FreeformSelection>()
  for (const item of selection) {
    const count = item.kind === 'vertex' ? vertexCount(c) : item.kind === 'edge' ? edges.length : item.kind === 'face' ? c.faces.length : 0
    if (!Number.isInteger(item.index) || item.index < 0 || item.index >= count) throw new Error('The selection is no longer part of this cage.')
    unique.set(`${item.kind}:${item.index}`, item)
  }
  return [...unique.values()]
}

export function selectedVertices(c: Cage, selection: readonly FreeformSelection[]): number[] {
  const edges = topology(c).edges, vertices = new Set<number>()
  for (const item of checkedSelection(c, selection)) {
    const ids = item.kind === 'vertex' ? [item.index] : item.kind === 'edge' ? [edges[item.index].a, edges[item.index].b] : c.faces[item.index]
    for (const id of ids) vertices.add(id)
  }
  return [...vertices].sort((a, b) => a - b)
}

/** Only explicitly selected edges, not all edges incident to selected points. */
export function selectedEdges(c: Cage, selection: readonly FreeformSelection[]): [number, number][] {
  const edges = topology(c).edges
  return checkedSelection(c, selection).filter(s => s.kind === 'edge').map(s => [edges[s.index].a, edges[s.index].b])
}

/** Native command availability is broader than geometric bridge validity. */
export function bridgeCommandAvailable(c: Cage, selection: readonly FreeformSelection[]): boolean {
  try {
    const picks = checkedSelection(c, selection)
    return picks.length >= 2 && picks.every(p => p.kind === 'edge')
  } catch { return false }
}

/** Edge deletion removes its adjacent faces; vertex deletion removes its
 * incident faces. It never removes extra faces merely sharing an edge end. */
function deletedFaces(c: Cage, selection: readonly FreeformSelection[]): number[] {
  const top = topology(c), faces = new Set<number>()
  for (const s of checkedSelection(c, selection)) {
    const ids = s.kind === 'face' ? [s.index] : s.kind === 'edge' ? top.edges[s.index].faces : top.vertexFaces[s.index]
    for (const id of ids) faces.add(id)
  }
  return [...faces]
}

/** Require the whole four-sided boundary, and never cap a lone existing quad
 * with a coincident reverse face. Single-edge native context keeps this off. */
function selectedHole(c: Cage, selection: readonly FreeformSelection[]): number[] | undefined {
  if (selection.some(s => s.kind === 'face')) return undefined
  const vertices = selectedVertices(c, selection)
  if (vertices.length !== 4) return undefined
  const t = topology(c), edgesOnly = selection.every(s => s.kind === 'edge')
  if (!edgesOnly && selection.some(s => s.kind !== 'vertex')) return undefined
  const edges = edgesOnly ? selection.map(s => t.edges[s.index])
    : t.edges.filter(e => e.faces.length === 1 && vertices.includes(e.a) && vertices.includes(e.b))
  if (edges.length !== 4 || edges.some(e => e.faces.length !== 1)) return undefined
  // Follow only this selected boundary cycle. Other edges at a shared
  // vertex must not divert the walk away from the complete opening.
  const next = new Map<number, number>(), incoming = new Set<number>()
  for (const edge of edges) {
    const face = c.faces[edge.faces[0]], k = face.indexOf(edge.a)
    const a = face[(k + 1) % face.length] === edge.b ? edge.a : edge.b
    const b = a === edge.a ? edge.b : edge.a
    if (next.has(a) || incoming.has(b)) return undefined
    next.set(a, b); incoming.add(b)
  }
  const loop = [vertices[0]]
  for (let i = 1; i < 4; i++) {
    const v = next.get(loop[i - 1])
    if (v === undefined || loop.includes(v)) return undefined
    loop.push(v)
  }
  if (next.get(loop[3]) !== loop[0] || c.faces.some(face => face.length === 4 && face.every(v => loop.includes(v)))) return undefined
  try { closeHole(c, loop); return loop } catch { return undefined }
}

/** Order two disjoint open boundaries by their adjacent face winding. */
function bridgeChains(c: Cage, selection: readonly FreeformSelection[]): number[][] {
  const fail = () => { throw new Error('Select two separate, equally divided open boundary chains to bridge.') }
  if (selection.length < 2 || selection.some(s => s.kind !== 'edge')) return fail()
  const top = topology(c), next = new Map<number, number>(), previous = new Map<number, number>()
  // Observed for both an open chain and a connected, branched edge region.
  const selected = new Set(selection.map(p => p.index)), connected = new Set<number>(), pending = [selection[0].index]
  while (pending.length) {
    const index = pending.pop()!
    if (connected.has(index)) continue
    connected.add(index)
    const edge = top.edges[index]
    for (const v of [edge.a, edge.b]) for (const other of top.vertexEdges[v]) {
      if (selected.has(other) && !connected.has(other)) pending.push(other)
    }
  }
  if (connected.size === selection.length) throw new Error('Only one chain is selected, nothing to do.')
  for (const pick of selection) {
    const edge = top.edges[pick.index]
    if (edge.faces.length !== 1) return fail()
    const face = c.faces[edge.faces[0]]
    const k = face.findIndex((v, i) => edgeKey(v, face[(i + 1) % face.length]) === edgeKey(edge.a, edge.b))
    const a = face[k], b = face[(k + 1) % face.length]
    if (next.has(a) || previous.has(b)) return fail()
    next.set(a, b); previous.set(b, a)
  }
  const starts = [...next.keys()].filter(v => !previous.has(v)).sort((a, b) => a - b)
  if (starts.length !== 2) return fail()
  const chains = starts.map(start => {
    const chain = [start]
    while (next.has(chain[chain.length - 1])) {
      const v = next.get(chain[chain.length - 1])!
      if (chain.includes(v)) return fail()
      chain.push(v)
    }
    return chain
  })
  if (chains[0].length !== chains[1].length || chains.reduce((n, chain) => n + chain.length - 1, 0) !== selection.length ||
      new Set(chains.flat()).size !== chains.flat().length) return fail()
  return chains
}

/** Bridge equal open chains without adding or moving poles. This is separate
 * from the face-to-face tube operation exposed through the shared API. */
function bridgeEdges(c: Cage, selection: readonly FreeformSelection[]): Cage {
  const [a, b] = bridgeChains(c, selection)
  const opposite = b.slice().reverse()
  let result = c
  for (let k = 0; k < a.length - 1; k++) {
  const corners = [a[k + 1], a[k], opposite[k], opposite[k + 1]]
  if (c.faces.some(face => face.length === 4 && face.every(v => corners.includes(v)))) throw new Error('The selected edges already bound one face.')
  // Two triangle normals must agree: reject collapsed or twisted-over quads.
  const points = corners.map(v => vertexAt(c, v))
  const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i])
  const cross = (a: number[], b: number[]) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
  const n1 = cross(sub(points[1], points[0]), sub(points[2], points[0]))
  const n2 = cross(sub(points[2], points[0]), sub(points[3], points[0]))
  if (!(n1.reduce((sum, v, i) => sum + v*n2[i], 0) > 1e-20)) throw new Error('The bridge would be folded or collapsed.')
  result = addFace(result, corners)
  }
  return result
}

export function editorActions(c: Cage, selection: readonly FreeformSelection[]): Record<EditorAction, boolean> {
  const off = { split: false, crease: false, remove_crease: false, delete: false, close_hole: false, bridge: false }
  let picks: FreeformSelection[]
  try { picks = checkedSelection(c, selection) } catch { return off }
  if (!picks.length) return off
  const edgesOnly = picks.every(s => s.kind === 'edge'), gone = deletedFaces(c, picks)
  const top = topology(c)
  let canBridge = false
  if (edgesOnly && picks.length >= 2) { try { bridgeEdges(c, picks); canBridge = true } catch { /* invalid chains */ } }
  return {
    split: edgesOnly && picks.length === 1 && top.edges[picks[0].index].faces.every(f => c.faces[f].length === 4),
    crease: edgesOnly,
    remove_crease: edgesOnly,
    delete: gone.length > 0,
    close_hole: !!selectedHole(c, picks),
    bridge: canBridge,
  }
}

/** Native manual Split inserts midpoints and moves regular adjacent rows a
 * third of the way towards their continuation away from the cut. Paired on
 * a boundary-adjacent strip and a second cut between two interior rows.
 * Keep the shared API's arbitrary-fraction split unchanged. Extraordinary
 * and creased neighbourhoods retain the existing conservative midpoint split. */
function splitEditorLoop(c: Cage, a: number, b: number): Cage {
  const next = splitLoop(c, a, b), before = topology(c), after = topology(next)
  const cut = new Set(before.edges.flatMap((e, i) => after.edgeOf.has(edgeKey(e.a, e.b)) ? [] : [i]))
  for (const index of cut) {
    const edge = before.edges[index]
    for (const v of [edge.a, edge.b]) {
      const incident = before.vertexEdges[v]
      if (incident.length !== (edge.faces.length === 1 ? 3 : 4) ||
          incident.some(i => before.edges[i].crease) ||
          before.vertexFaces[v].some(i => c.faces[i].length !== 4) ||
          incident.filter(i => cut.has(i)).length !== 1) continue
      const continuation = incident.filter(i => i !== index && !before.edges[i].faces.some(f => edge.faces.includes(f)))
      if (continuation.length !== 1) continue
      const opposite = before.edges[continuation[0]], other = opposite.a === v ? opposite.b : opposite.a
      for (let k = 0; k < 3; k++) next.positions[v * 3 + k] = (2 * c.positions[v * 3 + k] + c.positions[other * 3 + k]) / 3
    }
  }
  return next
}

export function applyEditorAction(c: Cage, selection: readonly FreeformSelection[], action: EditorAction): { cage: Cage; selection: FreeformSelection[] } {
  const picks = checkedSelection(c, selection)
  if (action === 'bridge' && bridgeCommandAvailable(c, picks)) return { cage: bridgeEdges(c, picks), selection: [] }
  if (!editorActions(c, picks)[action]) throw new Error(`Cannot ${action.replaceAll('_', ' ')} with this selection.`)
  const edges = selectedEdges(c, picks)
  let cage: Cage
  switch (action) {
    case 'split': cage = splitEditorLoop(c, ...edges[0]); break
    case 'crease': cage = setCrease(c, edges, true); break
    case 'remove_crease': cage = setCrease(c, edges, false); break
    case 'delete': {
      const gone = deletedFaces(c, picks)
      // The interactive editor retains an empty, undoable Freeform feature.
      // The shared deleteFaces API continues to require a nonempty result.
      cage = gone.length === c.faces.length
        ? { positions: new Float64Array(), faces: [], creases: [] }
        : deleteFaces(c, gone)
      break
    }
    case 'close_hole': cage = closeHole(c, selectedHole(c, picks)!); break
    case 'bridge': cage = bridgeEdges(c, picks); break
  }
  return { cage, selection: action === 'crease' || action === 'remove_crease' ? picks.map(s => ({ ...s })) : [] }
}
