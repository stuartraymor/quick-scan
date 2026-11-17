// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { type Cage, topology, edgeKey } from '../core/freeform/cage'
import { boundaryLoops, cloneCage, closeHole } from '../core/freeform/edit'
import { applyEditorAction, editorActions, type FreeformSelection } from '../core/freeform/editor'
import local from './fixtures/freeform-point-junction-hole.json'

// A 3x3 patch with its centre and a diagonal corner missing. The centre
// opening touches the outer boundary at one point, but has four valid sides.
function touchingHole(): Cage {
  const positions: number[] = [], faces: number[][] = []
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) positions.push(x, y, .02 * x * y)
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
    if (x === y && x < 2) continue
    const v = y * 4 + x
    faces.push([v, v + 1, v + 5, v + 4])
  }
  return { positions: Float64Array.from(positions), faces, creases: [[5, 6]] }
}
const loop = [5, 9, 10, 6]
function picks(c: Cage): FreeformSelection[] {
  const t = topology(c)
  return loop.map((v, i) => ({ kind: 'edge', index: t.edgeOf.get(edgeKey(v, loop[(i + 1) % 4]))! }))
}

it('closes the reported opening using only its six adjacent faces and thirteen translated poles', () => {
  const c: Cage = {positions:Float64Array.from(local.positions),faces:local.faces.map(f=>[...f]),creases:local.creases.map(e=>[e[0],e[1]])}
  const before = cloneCage(c), t = topology(c)
  const selected = local.loop.map((v,i):FreeformSelection=>({kind:'edge',index:t.edgeOf.get(edgeKey(v,local.loop[(i+1)%4]))!}))
  expect(boundaryLoops(c).some(l=>l.length===4&&local.loop.every(v=>l.includes(v)))).toBe(false)
  expect(editorActions(c,selected).close_hole).toBe(true)
  const out = applyEditorAction(c,selected,'close_hole').cage
  expect(out.faces).toEqual([...c.faces,local.loop.slice().reverse()])
  expect(out.positions).toEqual(c.positions)
  expect(out.creases).toEqual(c.creases)
  expect(c).toEqual(before)
})

it('closes only the selected four-edge opening at a point junction', () => {
  const c = touchingHole(), before = cloneCage(c), selected = picks(c)
  expect(boundaryLoops(c).some(l => l.length === 4 && loop.every(v => l.includes(v)))).toBe(false)
  expect(topology(c).vertexEdges[5].filter(i => topology(c).edges[i].faces.length === 1)).toHaveLength(4)
  expect(editorActions(c, selected).close_hole).toBe(true)
  const result = applyEditorAction(c, selected, 'close_hole')
  expect(result.cage.faces.slice(0, c.faces.length)).toEqual(c.faces)
  expect(result.cage.faces.at(-1)).toEqual(loop.slice().reverse())
  expect(result.cage.positions).toEqual(c.positions)
  expect(result.cage.creases).toEqual(c.creases)
  expect(result.selection).toEqual([])
  const t = topology(result.cage)
  for (const v of loop) expect(t.vertexFaces[v].length).toBe(topology(c).vertexFaces[v].length + 1)
  expect(t.edges.every(e => e.faces.length <= 2)).toBe(true)
  expect(t.edges.filter(e => e.faces.length === 1)).toHaveLength(topology(c).edges.filter(e => e.faces.length === 1).length - 4)
  expect(editorActions(result.cage, loop.map(index => ({kind:'vertex',index}))).close_hole).toBe(false)
  expect(c).toEqual(before)
})

it('derives winding from the cage, independent of selected edge order', () => {
  const c = touchingHole(), all = picks(c), expected = applyEditorAction(c, all, 'close_hole').cage
  for (const selected of [[all[2], all[0], all[3], all[1]], all.slice().reverse(), [...all.slice(1), all[0]]]) {
    expect(applyEditorAction(c, selected, 'close_hole').cage).toEqual(expected)
  }
  expect(applyEditorAction(c, loop.slice().reverse().map(index => ({kind:'vertex',index})), 'close_hole').cage).toEqual(expected)
  expect(closeHole(c, loop.slice().reverse()).faces.at(-1)).toEqual(loop.slice().reverse())
})

it('requires all four sides, rather than inferring a missing fourth selected edge', () => {
  const c = touchingHole(), all = picks(c), before = cloneCage(c)
  for (const selected of [all.slice(0, 3), [all[0], all[2]], [all[0]], [all[0], all[1], all[2], all[2]]]) {
    expect(editorActions(c, selected).close_hole).toBe(false)
    expect(() => applyEditorAction(c, selected, 'close_hole')).toThrow()
  }
  expect(c).toEqual(before)
})

it('refuses a noncycle, repeated vertex, filled loop and internal edge atomically', () => {
  const c = touchingHole(), before = cloneCage(c)
  for (const invalid of [[5, 10, 9, 6], [5, 9, 10, 9], [5, 9, 10], [1, 2, 6, 5]]) {
    expect(() => closeHole(c, invalid)).toThrow()
  }
  expect(c).toEqual(before)
})

it('keeps the collapsed and crossed-quad geometry guards at a point junction', () => {
  for (const coordinates of [[0,0,0,1,0,0,2,0,0,3,0,0], [0,0,0,1,1,0,1,0,0,0,1,0]]) {
    const c = touchingHole()
    loop.forEach((v, i) => c.positions.set(coordinates.slice(i * 3, i * 3 + 3), v * 3))
    const before = cloneCage(c)
    expect(editorActions(c, picks(c)).close_hole).toBe(false)
    expect(() => closeHole(c, loop)).toThrow(/collapsed, folded or overlapping/)
    expect(c).toEqual(before)
  }
})
