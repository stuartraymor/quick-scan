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
  it('deletes the final face through point, edge or face selection without changing the input', () => {
    const c = patch(1)
    c.creases.push([0,1])
    const before = cloneCage(c)
    for (const kind of ['vertex','edge','face'] as const) {
      const selection = [{kind,index:0}]
      expect(editorActions(c,selection).delete).toBe(true)
      expect(applyEditorAction(c,selection,'delete')).toEqual({cage:empty(),selection:[]})
      expect(c).toEqual(before)
    }
    const grid = patch(2)
    expect(applyEditorAction(grid,[{kind:'vertex',index:4}],'delete').cage).toEqual(empty())
    expect(applyEditorAction(grid,grid.faces.map((_,index)=>({kind:'face',index})),'delete').cage).toEqual(empty())
  })
  it('does not enable a duplicate hole cap', () => {
    const c = patch(1)
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
  it('matches the native two-chain bridge and preserves every existing pole', () => {
    // Independently created planar fixture, saved before/after native Bridge.
    const c: Cage = {
      positions: Float64Array.from([-5.543590068817139,-2.3589744567871094,0,-5.543590068817139,3.538461446762085,0,-1.6119657754898071,3.538461685180664,0,-1.6119657754898071,-2.3589744567871094,0,2.319658041000366,-2.3589744567871094,0,2.319658041000366,3.538461446762085,0,6.251282215118408,3.538461446762085,0,6.251282215118408,-2.3589744567871094,0,-1.6119657754898071,0.5897434949874878,0,-5.543590068817139,0.5897434949874878,0,2.319658041000366,0.5897434949874878,0,6.251282215118408,0.5897434949874878,0]),
      faces: [[2,8,9,1],[8,3,0,9],[4,10,11,7],[10,5,6,11]], creases: [[0,9]],
    }
    const before = cloneCage(c), picks = [edge(c,2,8),edge(c,8,3),edge(c,4,10),edge(c,10,5)]
    const canonical = (faces: number[][]) => faces.map(f => f.map((_,i) => [...f.slice(i),...f.slice(0,i)].join(',')).sort()[0]).sort()
    for (const selection of [picks, picks.slice().reverse(), [picks[2],picks[0],picks[3],picks[1]]]) {
      expect(editorActions(c,selection).bridge).toBe(true)
      const result = applyEditorAction(c,selection,'bridge')
      expect(result.cage.positions).toEqual(c.positions)
      expect(result.cage.faces.slice(0,4)).toEqual(c.faces)
      expect(canonical(result.cage.faces.slice(4))).toEqual(canonical([[8,2,5,10],[3,8,10,4]]))
      expect(result.cage.creases).toEqual(c.creases)
      expect(consistent(result.cage)).toBe(true)
      expect(topology(result.cage).edges.filter(e => e.faces.length === 2)).toHaveLength(7)
      expect(result.selection).toEqual([])
    }
    expect(c).toEqual(before)
    expect(editorActions(c,picks.slice(0,3)).bridge).toBe(false)
    expect(() => applyEditorAction(c,picks.slice(0,3),'bridge')).toThrow()
  })
  it('rejects closed boundaries and a strip with one collapsed joining quad atomically', () => {
    const c = addRectangle(patch(2),[4,0,0],[2,0,0],[0,2,0],2,2), before = cloneCage(c)
    const picks = [edge(c,2,5),edge(c,5,8),edge(c,9,12),edge(c,12,15)]
    expect(editorActions(c,picks).bridge).toBe(true)
    const closed = topology(c).edges.flatMap((e,index) => e.faces.length===1 ? [{kind:'edge' as const,index}] : [])
    expect(editorActions(c,closed).bridge).toBe(false)
    const collapsed = cloneCage(c)
    for (const [to,from] of [[9,2],[12,5]]) collapsed.positions.set(c.positions.slice(from*3,from*3+3),to*3)
    expect(editorActions(collapsed,picks).bridge).toBe(false)
    expect(() => applyEditorAction(collapsed,picks,'bridge')).toThrow()
    expect(c).toEqual(before)
  })
})
