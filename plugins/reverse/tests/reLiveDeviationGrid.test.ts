// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { liveDeviationGrid } from '../core/freeform/liveDeviationGrid'

it('measures displayed nonplanar triangles and reuses stationary charts across renumbering, edits and thresholds', () => {
  const points:Vec3[] = [[0,0,0],[1,0,0],[1,1,1],[0,1,0],[2,0,0],[2,1,1]]
  const faces = [[0,1,2,3],[1,4,5,2]], sample=liveDeviationGrid(), reference={}
  const measure=vi.fn((p:Float32Array)=>Float32Array.from({length:p.length/3},(_,i)=>p[i*3+2]))
  const first=sample(points,faces,measure,reference)
  expect(measure.mock.calls[0][0].length/3).toBe(50)
  for(let i=0;i<25;i++) expect(first.grid.values[i]).toBeCloseTo(Math.min(i%5/4,Math.floor(i/5)/4))
  const again=sample(points,faces,measure,reference)
  expect(again).toEqual(first);expect(measure).toHaveBeenCalledOnce()
  // One corner changes one cell; the neighboring chart must not be queried.
  points[0]=[0,0,.2]
  const moved=sample(points,faces,measure,reference)
  expect(measure.mock.lastCall![0].length/3).toBe(25)
  expect(moved.grid.values.slice(25)).toEqual(first.grid.values.slice(25))
  expect(moved.values[0]).toBeCloseTo(.2)
  const renumbered=sample([...points].reverse(),faces.map(f=>f.map(v=>points.length-1-v)),measure,reference)
  expect(renumbered).toEqual(moved);expect(measure).toHaveBeenCalledTimes(2)
  sample(points,faces,measure,{})
  expect(measure.mock.lastCall![0].length/3).toBe(50)
})

it('preserves missing correspondence instead of inventing passing samples', () => {
  const field=liveDeviationGrid()([[0,0,0],[1,0,0],[1,1,0],[0,1,0]],[[0,1,2,3]],p=>new Float32Array(p.length/3).fill(NaN))
  expect(field.values.every(Number.isNaN)).toBe(true)
})
