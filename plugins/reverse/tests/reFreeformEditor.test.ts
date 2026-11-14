// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { type Cage, edgeKey, topology } from '../core/freeform/cage'
import { addRectangle, cloneCage } from '../core/freeform/edit'
import { applyEditorAction, editorActions, type FreeformSelection, selectedEdges, selectedVertices } from '../core/freeform/editor'

const empty = (): Cage => ({ positions: new Float64Array(), faces: [], creases: [] })
const patch = (n = 2) => addRectangle(empty(), [0, 0, 0], [n, 0, 0], [0, n, 0], n, n)
const edge = (c: Cage, a: number, b: number): FreeformSelection => ({ kind: 'edge', index: topology(c).edgeOf.get(edgeKey(a, b))! })
const box = (): Cage => ({ positions: Float64Array.from([-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1]), faces: [[0,3,2,1],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]], creases: [] })
const consistent = (c: Cage) => {
  const seen = new Set<string>()
  for (const f of c.faces) for (let i = 0; i < f.length; i++) {
    const key = `${f[i]}>${f[(i+1)%f.length]}`
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

describe('freeform editor selection', () => {
  it('deduplicates overlapping vertex, edge and face picks', () => {
    const c = patch(), selection: FreeformSelection[] = [{kind:'face',index:0},edge(c,0,1),{kind:'vertex',index:1}]
    expect(selectedVertices(c, selection)).toEqual([0,1,3,4])
    expect(selectedEdges(c, selection)).toEqual([[0,1]])
  })
  it('refuses stale, negative, fractional and nonfinite selections without changing a cage', () => {
    const c = patch(), before = cloneCage(c)
    for (const index of [-1, 100, 0.5, NaN]) {
      const selection: FreeformSelection[] = [{kind:'edge',index}]
      expect(Object.values(editorActions(c, selection)).every(v => !v)).toBe(true)
      expect(() => applyEditorAction(c, selection, 'split')).toThrow(/selection/)
    }
    expect(c).toEqual(before)
  })
  it('disables all commands for an empty selection', () => {
    expect(Object.values(editorActions(patch(), [])).every(v => !v)).toBe(true)
  })
  it('single boundary edge enables split and creasing but not bridge or close hole', () => {
    const c = patch(), actions = editorActions(c, [edge(c,0,1)])
    expect(actions).toEqual({split:true,crease:true,remove_crease:true,delete:true,bridge:false,close_hole:false})
  })
})

describe('freeform editor actions', () => {
  it('splits a strip, preserves winding and clears renumberable picks', () => {
    const c = patch(), before = cloneCage(c)
    const result = applyEditorAction(c,[edge(c,0,1)],'split')
    expect(result.cage.faces).toHaveLength(6)
    expect(consistent(result.cage)).toBe(true)
    expect(result.selection).toEqual([])
    expect(c).toEqual(before)
  })
  it('retains selection across crease and remove crease without changing input', () => {
    const c = patch(), before = cloneCage(c), selection = [edge(c,0,1)]
    const marked = applyEditorAction(c,selection,'crease')
    expect(marked.cage.creases).toEqual([[0,1]])
    expect(marked.selection).toEqual(selection)
    expect(applyEditorAction(marked.cage,marked.selection,'remove_crease').cage.creases).toEqual([])
    expect(c).toEqual(before)
  })
  it('deletes only faces beside an edge, not all faces at its endpoints', () => {
    const c = patch(3), before = cloneCage(c)
    const result = applyEditorAction(c,[edge(c,5,6)],'delete')
    expect(result.cage.faces).toHaveLength(7)
    expect(result.selection).toEqual([])
    expect(consistent(result.cage)).toBe(true)
    expect(c).toEqual(before)
  })
  it('refuses deleting the final face and does not enable a duplicate hole cap', () => {
    const c = patch(1)
    expect(editorActions(c,[{kind:'face',index:0}]).delete).toBe(false)
    expect(() => applyEditorAction(c,[{kind:'face',index:0}],'delete')).toThrow()
    const picks = topology(c).edges.map((_,index):FreeformSelection => ({kind:'edge',index}))
    expect(editorActions(c,picks).close_hole).toBe(false)
  })
  it('fills a selected four-edge opening and preserves a closed manifold', () => {
    const c = box(), before = cloneCage(c), picks = [edge(c,4,5),edge(c,5,6),edge(c,6,7),edge(c,7,4)]
    expect(editorActions(c,[picks[0]]).close_hole).toBe(false)
    const result = applyEditorAction(c,picks,'close_hole')
    expect(result.cage.faces).toHaveLength(6)
    expect(topology(result.cage).closed).toBe(true)
    expect(consistent(result.cage)).toBe(true)
    expect(result.selection).toEqual([])
    expect(c).toEqual(before)
  })
  it('bridges disjoint boundaries with one quad, keeping both original faces', () => {
    const c = addRectangle(patch(1),[2,0,0],[1,0,0],[0,1,0]), before = cloneCage(c)
    const picks = [edge(c,1,3),edge(c,4,6)]
    expect(editorActions(c,picks).bridge).toBe(true)
    const result = applyEditorAction(c,picks,'bridge')
    expect(result.cage.faces).toHaveLength(3)
    expect(result.cage.faces.slice(0,2)).toEqual(c.faces)
    expect(consistent(result.cage)).toBe(true)
    expect(topology(result.cage).edges.filter(e=>e.faces.length===2)).toHaveLength(2)
    expect(result.selection).toEqual([])
    expect(c).toEqual(before)
  })
  it('rejects internal, adjoining, duplicate, and collapsed bridge pairs', () => {
    const c = patch()
    for (const picks of [[edge(c,1,4),edge(c,6,7)],[edge(c,0,1),edge(c,1,2)],[edge(c,0,1),edge(c,0,1)]]) {
      expect(editorActions(c,picks).bridge).toBe(false)
      expect(() => applyEditorAction(c,picks,'bridge')).toThrow()
    }
    const d = addRectangle(patch(1),[0,0,0],[1,0,0],[0,1,0])
    expect(editorActions(d,[edge(d,1,3),edge(d,5,7)]).bridge).toBe(false)
    const single = patch(1)
    expect(editorActions(single,[edge(single,0,1),edge(single,2,3)]).bridge).toBe(false)
  })
})
