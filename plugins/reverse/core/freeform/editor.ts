// SPDX-License-Identifier: AGPL-3.0-only
// Selection rules for the interactive cage editor. These are conservative
// implementation rules, not a claim that every native context is equivalent.
import { type Cage, edgeKey, topology, vertexAt, vertexCount } from './cage'
import { addFace, boundaryLoops, closeHole, deleteFaces, setCrease, splitLoop } from './edit'

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
  return boundaryLoops(c).find(loop => loop.length === 4 && loop.every(v => vertices.includes(v)) &&
    !c.faces.some(face => face.length === 4 && face.every(v => loop.includes(v))))
}

/** Bridge two disjoint boundary edges with one quad. Unlike the existing
 * face-to-face tube operation, this preserves both selected edges' faces. */
function bridgeEdges(c: Cage, selection: readonly FreeformSelection[]): Cage {
  if (selection.length !== 2 || selection.some(s => s.kind !== 'edge')) throw new Error('Select two separate boundary edges to bridge.')
  const top = topology(c), edges = selection.map(s => top.edges[s.index])
  if (edges.some(e => e.faces.length !== 1) || new Set(edges.flatMap(e => [e.a, e.b])).size !== 4) throw new Error('Select two separate boundary edges to bridge.')
  const directed = edges.map(e => {
    const face = c.faces[e.faces[0]], k = face.findIndex((v, i) => edgeKey(v, face[(i + 1) % face.length]) === edgeKey(e.a, e.b))
    return [face[k], face[(k + 1) % face.length]]
  })
  const [[p, q], [r, s]] = directed, corners = [q, p, s, r]
  if (c.faces.some(face => face.length === 4 && face.every(v => corners.includes(v)))) throw new Error('The selected edges already bound one face.')
  // Two triangle normals must agree: reject collapsed or twisted-over quads.
  const points = corners.map(v => vertexAt(c, v))
  const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i])
  const cross = (a: number[], b: number[]) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
  const n1 = cross(sub(points[1], points[0]), sub(points[2], points[0]))
  const n2 = cross(sub(points[2], points[0]), sub(points[3], points[0]))
  if (!(n1.reduce((sum, v, i) => sum + v*n2[i], 0) > 1e-20)) throw new Error('The bridge would be folded or collapsed.')
  return addFace(c, corners)
}

export function editorActions(c: Cage, selection: readonly FreeformSelection[]): Record<EditorAction, boolean> {
  const off = { split: false, crease: false, remove_crease: false, delete: false, close_hole: false, bridge: false }
  let picks: FreeformSelection[]
  try { picks = checkedSelection(c, selection) } catch { return off }
  if (!picks.length) return off
  const edgesOnly = picks.every(s => s.kind === 'edge'), gone = deletedFaces(c, picks)
  const top = topology(c)
  let canBridge = false
  if (edgesOnly && picks.length === 2) { try { bridgeEdges(c, picks); canBridge = true } catch { /* invalid pair */ } }
  return {
    split: edgesOnly && picks.length === 1 && top.edges[picks[0].index].faces.every(f => c.faces[f].length === 4),
    crease: edgesOnly,
    remove_crease: edgesOnly,
    delete: gone.length > 0 && gone.length < c.faces.length,
    close_hole: !!selectedHole(c, picks),
    bridge: canBridge,
  }
}

export function applyEditorAction(c: Cage, selection: readonly FreeformSelection[], action: EditorAction): { cage: Cage; selection: FreeformSelection[] } {
  const picks = checkedSelection(c, selection)
  if (!editorActions(c, picks)[action]) throw new Error(`Cannot ${action.replaceAll('_', ' ')} with this selection.`)
  const edges = selectedEdges(c, picks)
  let cage: Cage
  switch (action) {
    case 'split': cage = splitLoop(c, ...edges[0]); break
    case 'crease': cage = setCrease(c, edges, true); break
    case 'remove_crease': cage = setCrease(c, edges, false); break
    case 'delete': cage = deleteFaces(c, deletedFaces(c, picks)); break
    case 'close_hole': cage = closeHole(c, selectedHole(c, picks)![0]); break
    case 'bridge': cage = bridgeEdges(c, picks); break
  }
  return { cage, selection: action === 'crease' || action === 'remove_crease' ? picks.map(s => ({ ...s })) : [] }
}
