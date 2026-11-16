// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { type Cage, topology } from '../core/freeform/cage'
import { mergeBoundaryEdge, mergeBoundaryPoint, mergeChainEnds } from '../core/freeform/merge'
import aligned from './fixtures/freeform-aligned-edge-reference.json'
import { irregularBoundaryVertices } from '../core/freeform/repair'
import fixtures from './fixtures/freeform-merge-reference.json'
import creased from './fixtures/freeform-creased-merge.json'

it('welds both ends of the saved native aligned edge in one anchor solve', () => {
  const cage: Cage = { positions: Float64Array.from(aligned.input.positions), faces: aligned.input.faces, creases: [] }
  for (const v of aligned.source) cage.positions[v * 3] += 4
  const before = structuredClone(cage), out = mergeBoundaryEdge(cage, [1,2], [4,7]).cage
  expect(out.faces).toEqual(aligned.expected.faces)
  expect(Math.max(...out.positions.map((v,i) => Math.abs(v - aligned.expected.positions[i])))).toBeLessThan(1e-6)
  expect(topology(out).edges.filter(e => e.faces.length === 2)).toHaveLength(1)
  expect(cage).toEqual(before)
  expect(() => mergeBoundaryEdge(cage, [1,2], [7,4])).toThrow()
})

for (const trial of fixtures) it(`matches saved native ${trial.name} coordinates and oriented connectivity`, () => {
  const cage: Cage = { positions: Float64Array.from(trial.input.positions), faces: trial.input.faces.map(f => [...f]), creases: [] }
  const before = structuredClone(cage), result = mergeBoundaryPoint(cage, trial.from, trial.to)
  expect(result.cage.faces).toEqual(trial.expected.faces)
  expect(Math.max(...result.cage.positions.map((v, i) => Math.abs(v - trial.expected.positions[i])))).toBeLessThan(5e-7)
  expect(result.cage.positions.length).toBe(cage.positions.length - 3)
  expect(topology(result.cage).edges.every(e => e.faces.length <= 2)).toBe(true)
  expect(cage).toEqual(before)
  if (trial.name === 'third-contact-off') expect(irregularBoundaryVertices(result.cage)).toEqual([])
})

it('refuses collapsed faces and invalid contacts without changing the input', () => {
  const f = fixtures[0], cage: Cage = { positions: Float64Array.from(f.input.positions), faces: f.input.faces, creases: [] }
  const before = structuredClone(cage)
  expect(() => mergeBoundaryPoint(cage, 2, 8)).toThrow('cannot be merged')
  expect(() => mergeBoundaryPoint(cage, -1, 10)).toThrow('cannot be merged')
  expect(cage).toEqual(before)
})

it('orders one open chain independently of click order and excludes disconnected, internal and closed selections',()=>{
 const f=fixtures[0],c:Cage={positions:Float64Array.from(f.input.positions),faces:f.input.faces,creases:[]},t=topology(c)
 const edge=(a:number,b:number)=>t.edges.findIndex(e=>(e.a===a&&e.b===b)||(e.a===b&&e.b===a))
 expect(mergeChainEnds(c,[edge(2,8),edge(8,3)])).toEqual([3,2])
 expect(mergeChainEnds(c,[edge(8,3),edge(2,8)])).toEqual([3,2])
 expect(mergeChainEnds(c,[edge(2,8),edge(4,10)])).toEqual([])
 expect(mergeChainEnds(c,[edge(8,9)])).toEqual([])
 expect(mergeChainEnds(c,t.edges.flatMap((e,i)=>e.faces.length===1?[i]:[]))).toEqual([])
})

for(const trial of creased) it('preserves native crease connectivity for '+trial.name,()=>{
 const c:Cage={positions:Float64Array.from(trial.input.positions),faces:trial.input.faces,creases:trial.input.creases as [number,number][]},before=structuredClone(c);
 const out=mergeBoundaryPoint(c,trial.from,trial.to,trial.contact==='chain'?'chain':'point').cage;
 expect(out.faces).toEqual(trial.expected.faces);expect(out.creases.map(e=>[...e].sort((a,b)=>a-b)).sort()).toEqual(trial.expected.creases.map(e=>[...e].sort((a,b)=>a-b)).sort());
 expect(Math.max(...out.positions.map((v,i)=>Math.abs(v-trial.expected.positions[i])))).toBeLessThan(5e-7);expect(c).toEqual(before);
})
