// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Cage } from '../core/freeform/cage'
import { movePoints } from '../core/freeform/edit'
import { cageVertexLimits } from '../core/freeform/limit'
import { surfaceAnchorDrag, snapSurfaceAnchors } from '../viewer/freeformAnchorDrag'

const strip: Cage = {
  positions: Float64Array.from([0,0,0, 5,-12,0, 5,5,0, 0,5,0, 10,0,0, 10,5,0]),
  faces: [[0,1,2,3],[1,4,5,2]], creases: [],
}

it('projects coupled surface anchors to a curved scan without projecting the surface interior', () => {
  const points=cageVertexLimits(strip), ids=[1,2]
  const project=(p:[number,number,number]):[number,number,number]=>[p[0],p[1],p[0]*p[0]/100]
  const result=snapSurfaceAnchors(strip,ids,project)!
  const after=cageVertexLimits(result)
  ids.forEach(v=>after[v].forEach((p,k)=>expect(p).toBeCloseTo(project(points[v])[k],10)))
  for(const v of [0,3,4,5]) expect(Array.from(result.positions.slice(3*v,3*v+3))).toEqual(Array.from(strip.positions.slice(3*v,3*v+3)))
  expect(result.faces).toEqual(strip.faces)
  expect(snapSurfaceAnchors(strip,ids,()=>null)).toBeNull()
  expect(snapSurfaceAnchors(strip,ids,()=>[0,0,NaN])).toBeNull()
})

it('moves a single surface anchor by the requested amount instead of the smaller pole-mask response', () => {
  const before = cageVertexLimits(strip)[1]
  const poles = surfaceAnchorDrag(strip, [1])!([[2, -3, 1]])
  const moved = movePoints(strip, [{vertex: 1, by: poles[0]}])
  const after = cageVertexLimits(moved)[1]
  expect(after[0] - before[0]).toBeCloseTo(2)
  expect(after[1] - before[1]).toBeCloseTo(-3)
  expect(after[2] - before[2]).toBeCloseTo(1)
  expect(poles[0][0]).toBeGreaterThan(2)
  expect(strip.positions[3]).toBe(5)
})

it('moves two selected anchors together while accounting for their coupled limit masks', () => {
  for (const radius of [0, 8]) {
    const vertices = [1, 2]
    const before = cageVertexLimits(strip)
    const poleTravel = surfaceAnchorDrag(strip, vertices, radius)!([[2, 1, 0], [2, 1, 0]])
    const moved = movePoints(strip, vertices.map((vertex, i) => ({vertex, by: poleTravel[i]})), radius)
    const after = cageVertexLimits(moved)
    for (const vertex of vertices) {
      expect(after[vertex][0] - before[vertex][0]).toBeCloseTo(2)
      expect(after[vertex][1] - before[vertex][1]).toBeCloseTo(1)
    }
  }
})

it('supports distinct per-anchor travel for surface-mode rotate and scale gestures', () => {
  const vertices = [1, 2]
  const targets: [number, number, number][] = [[2, 1, 0], [-1, 2, 0]]
  const before = cageVertexLimits(strip)
  const poleTravel = surfaceAnchorDrag(strip, vertices)!(targets)
  const moved = movePoints(strip, vertices.map((vertex, i) => ({vertex, by: poleTravel[i]})))
  const after = cageVertexLimits(moved)
  for (let i = 0; i < vertices.length; i++) {
    for (let axis = 0; axis < 3; axis++) expect(after[vertices[i]][axis] - before[vertices[i]][axis]).toBeCloseTo(targets[i][axis])
  }
})
