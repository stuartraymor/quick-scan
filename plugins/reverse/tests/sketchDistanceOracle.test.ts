// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest'
import {auditDistance} from './sketchDistanceOracle'
import type {Constraint,Sketch} from '../core/sketch'
const sketch:Sketch={nextId:4,entities:[{id:1,kind:'point',p:[1,2]},{id:2,kind:'point',p:[4,6]},{id:3,kind:'line',a:[0,0],b:[10,0]}],constraints:[]}
const base:Extract<Constraint,{kind:'distance'}>={id:4,kind:'distance',p:{entity:1,at:'center'},q:{entity:2,at:'center'},value:0}
it.each([['x',3],['y',4],[undefined,5]] as const)('reads %s distance independently', (axis,value)=>expect(auditDistance(sketch,{...base,axis})).toBe(value))
it('reads point-to-line and datum distances',()=>{
 expect(auditDistance(sketch,{...base,q:{line:3}})).toBe(2)
 expect(auditDistance(sketch,{...base,q:{datum:'yz'}})).toBe(1)
 expect(auditDistance(sketch,{...base,q:{datum:'zx'}})).toBe(2)
})
it('reads separate circular rims independently of the centres',()=>{
 const circles:Sketch={nextId:3,entities:[{id:1,kind:'circle',c:[0,0],r:1},{id:2,kind:'circle',c:[10,0],r:2}],constraints:[]}
 expect(auditDistance(circles,{...base,edge:'near'})).toBe(7)
 expect(auditDistance(circles,{...base,edge:'far'})).toBe(13)
 expect(auditDistance(circles,{...base})).toBe(10)
})
