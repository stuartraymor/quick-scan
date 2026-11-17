// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { type Cage, topology } from '../core/freeform/cage'
import { cloneCage, closeHole, extrapolate, extrapolateEdges } from '../core/freeform/edit'
import { editorActions, applyEditorAction } from '../core/freeform/editor'
import { validateAddedFaces } from '../core/freeform/connectionGeometry'

const patch = (): Cage => ({ positions: Float64Array.from([0,0,0,5,0,0,5,5,0,0,5,0]), faces: [[0,1,2,3]], creases: [[0,1]] })
const ring = (inner: number[]): Cage => ({
  positions: Float64Array.from([-2,-2,2,2,-2,2,2,2,2,-2,2,2,...inner]),
  faces: [[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]], creases: [[4,5]],
})
const selection = (c: Cage) => topology(c).edges.flatMap((e, index) => e.faces.length === 1 && e.a >= 4 && e.b >= 4 ? [{ kind: 'edge' as const, index }] : [])

it.each([
  ['collinear', [-1,0,0,-.3,0,0,.3,0,0,1,0,0]],
  ['crossed', [-1,-1,0,1,1,0,1,-1,0,-1,1,0]],
  ['coincident distinct vertices', [-1,-1,0,1,-1,0,1,-1,0,-1,1,0]],
] as const)('refuses a %s four-sided hole without changing geometry or creases', (_, inner) => {
  const cage = ring([...inner]), before = cloneCage(cage), picks = selection(cage)
  expect(editorActions(cage, picks).close_hole).toBe(false)
  expect(() => applyEditorAction(cage, picks, 'close_hole')).toThrow()
  expect(() => closeHole(cage, 4)).toThrow(/collapsed, folded or overlapping/)
  expect(cage).toEqual(before)
})

it.each([1e-6, 1, 1e6])('closes a curved creased hole with existing vertices at scale %s', scale => {
  const cage = ring([-1,-1,0,1,-1,.2,1,1,.4,-1,1,0])
  cage.positions = cage.positions.map(v => v * scale)
  const before = cloneCage(cage), picks = selection(cage)
  expect(editorActions(cage, picks).close_hole).toBe(true)
  const result = applyEditorAction(cage, picks, 'close_hole').cage
  expect(result.positions).toEqual(cage.positions)
  expect(result.creases).toEqual(cage.creases)
  expect(result.faces).toHaveLength(5)
  expect(topology(result).edges.filter(e => e.faces.length === 2)).toHaveLength(8)
  expect(cage).toEqual(before)
})

it('refuses a coplanar inward D extension atomically through single and chain APIs', () => {
  const cage = patch(), before = cloneCage(cage)
  expect(() => extrapolateEdges(cage, [0], [0,2,0])).toThrow(/overlapping/)
  expect(() => extrapolate(cage, 0, 1, [0,2,0])).toThrow(/overlapping/)
  expect(cage).toEqual(before)
})

it.each([[0,-2,.4], [0,0,2], [0,2,1]] as [number,number,number][])('retains valid outward or bent extensions (%s, %s, %s)', (x, y, z) => {
  const cage = patch(), before = cloneCage(cage), result = extrapolateEdges(cage, [0], [x,y,z]).cage
  expect(result.faces).toHaveLength(2)
  expect(topology(result).edges.filter(e => e.faces.length === 2)).toHaveLength(1)
  expect(result.creases).toEqual(cage.creases)
  expect(cage).toEqual(before)
})

it('rejects a post-projection folded new face whose unsigned triangle area is positive', () => {
  const cage = patch(), result = extrapolateEdges(cage, [0], [0,-2,0]).cage
  result.positions.set([6,-2,0], 4 * 3)
  result.positions.set([-1,-2,0], 5 * 3)
  expect(() => validateAddedFaces(cage, result)).toThrow(/folded/)
})

it('continues a strip for twelve connected extensions without duplicating shared vertices', () => {
  let cage = patch(), edges = [0]
  for (let step = 0; step < 12; step++) ({ cage, edges } = extrapolateEdges(cage, edges, [0,-2,step * .02]))
  expect(cage.faces).toHaveLength(13)
  expect(cage.positions.length / 3).toBe(28)
  expect(topology(cage).edges.filter(e => e.faces.length === 2)).toHaveLength(12)
})
