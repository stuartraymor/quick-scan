// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { type Cage, topology } from '../core/freeform/cage'
import { combineCages } from '../core/freeform/combine'
import { irregularBoundaryVertices, repairBoundary } from '../core/freeform/repair'
import fixture from './fixtures/freeform-asymmetric-repair.json'

const cage=(c:{positions:number[];faces:number[][]}):Cage=>({positions:Float64Array.from(c.positions),faces:c.faces.map(f=>[...f]),creases:[]})
const junction=():Cage=>({positions:Float64Array.from(fixture.before.positions.slice(24)),faces:fixture.before.faces.slice(3).map(f=>f.map(v=>v-8)),creases:[]})

it('matches native repair of an independent fan beside a one-face/two-face point junction',()=>{
  const input=cage(fixture.before),before=structuredClone(input),out=repairBoundary(input)
  expect(out.faces).toEqual(fixture.after.faces)
  expect(out.positions.length).toBe(fixture.after.positions.length)
  expect(Math.max(...out.positions.map((v,i)=>Math.abs(v-fixture.after.positions[i])))).toBeLessThan(2e-7)
  expect(Array.from(out.positions.slice(24,51))).toEqual(fixture.before.positions.slice(24))
  expect(out.faces.slice(3,6)).toEqual(fixture.before.faces.slice(3))
  expect(irregularBoundaryVertices(out)).toEqual([8])
  expect(topology(out).edges.every(e=>e.faces.length<=2)).toBe(true)
  expect(input).toEqual(before)
})

it('leaves an isolated asymmetric point-only junction unchanged without a repair transaction',()=>{
  const input=junction(),before=structuredClone(input)
  expect(irregularBoundaryVertices(input)).toEqual([0])
  expect(()=>repairBoundary(input)).toThrow(/could not be repaired/)
  expect(input).toEqual(before)
})

it('does not add another strip on repeated repair of the remaining junction',()=>{
  const input=cage(fixture.after),before=structuredClone(input)
  expect(()=>repairBoundary(input)).toThrow(/could not be repaired/)
  expect(input).toEqual(before)
})

it('repairs the independent fan when the asymmetric junction is encountered first',()=>{
  const fan:Cage={positions:Float64Array.from(fixture.before.positions.slice(0,24)),faces:fixture.before.faces.slice(0,3),creases:[]}
  const input=combineCages([junction(),fan]),before=structuredClone(input),out=repairBoundary(input)
  expect(out.faces).toHaveLength(8)
  expect(out.positions.length/3).toBe(20)
  expect(irregularBoundaryVertices(out)).toEqual([0])
  expect(Array.from(out.positions.slice(0,27))).toEqual(Array.from(input.positions.slice(0,27)))
  expect(out.faces.slice(0,3)).toEqual(input.faces.slice(0,3))
  expect(input).toEqual(before)
})

it('does not generalize the skip rule to an unverified one-face/three-face junction',()=>{
  const c=junction(),positions=Array.from(c.positions),s=Math.SQRT2
  positions.push(-s,s,0,-s,2+s,0)
  const unsupported:Cage={positions:Float64Array.from(positions),faces:[...c.faces,[0,6,10,9]],creases:[]}
  const fan:Cage={positions:Float64Array.from(fixture.before.positions.slice(0,24)),faces:fixture.before.faces.slice(0,3),creases:[]}
  const input=combineCages([fan,unsupported]),before=structuredClone(input)
  expect(()=>repairBoundary(input)).toThrow(/could not be repaired/)
  expect(input).toEqual(before)
})

it('retains atomic rejection when a repair would reverse an existing narrow face',()=>{
  // Reduced three-face form of the user's reversal, projected into a local
  // plane and rounded. No user archive or scan data is required by this test.
  const input:Cage={positions:Float64Array.from([2.82,0,0,2.36,-4.83,0,0,0,0,-.46,-5.16,0,-.39,0,0,-.7,-5.44,0,.03,-.09,0,-.36,-.09,0]),faces:[[1,0,2,3],[3,2,4,5],[4,2,6,7]],creases:[]}
  const before=structuredClone(input)
  expect(irregularBoundaryVertices(input)).toEqual([2])
  expect(()=>repairBoundary(input)).toThrow(/could not be repaired/)
  expect(input).toEqual(before)
})
