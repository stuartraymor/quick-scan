// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { type Cage } from '../core/freeform/cage'
import type { Vec3 } from '../../../src/core/types'
import { moveSurfaceAnchor } from '../viewer/freeformAnchorDrag'
import { mergeBoundaryPoint } from '../core/freeform/merge'
import fixtures from './fixtures/freeform-surface-drag-reference.json'
for(const f of fixtures) it(`matches native evaluated ${f.name} movement and topology`,()=>{
 const input:Cage={positions:Float64Array.from(f.input.positions),faces:f.input.faces,creases:[]},original=structuredClone(input)
 const moved=moveSurfaceAnchor(input,f.vertex,f.travel as Vec3),actual=f.target===null?moved:mergeBoundaryPoint(moved,f.vertex,f.target,'surface-point').cage
 expect(actual.faces).toEqual(f.expected.faces)
 expect(actual.positions.length).toBe(f.expected.positions.length)
 expect(Math.max(...actual.positions.map((p,k)=>Math.abs(p-f.expected.positions[k])))).toBeLessThan(5e-7)
 expect(input).toEqual(original)
})
