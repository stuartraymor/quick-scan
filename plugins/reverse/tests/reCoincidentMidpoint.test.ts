// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest'
import {coincidentFor} from '../core/draw'
import {addEntity,emptySketch} from '../core/sketch'
const setup=()=>{const sk=emptySketch();const a=addEntity(sk,{kind:'line',a:[0,0],b:[12,0]});const b=addEntity(sk,{kind:'line',a:[20,5],b:[26,13]});return{sk,a,b}}
it('coincides explicitly picked line midpoints rather than laying the full lines together',()=>{
 const {sk,a,b}=setup()
 expect(coincidentFor(sk,{kind:'piece',id:a,via:{entity:a,at:'center'}},{kind:'piece',id:b,via:{entity:b,at:'center'}})).toEqual({kind:'coincident',p:{entity:a,at:'center'},q:{entity:b,at:'center'}})
})
it('puts an explicitly picked midpoint on a line without forcing the carriers collinear',()=>{
 const {sk,a,b}=setup()
 expect(coincidentFor(sk,{kind:'piece',id:a,via:{entity:a,at:'center'}},{kind:'piece',id:b})).toEqual({kind:'pointOn',p:{entity:a,at:'center'},on:{line:b}})
})
it('keeps whole-line Coincident as Collinear when no point was picked',()=>{
 const {sk,a,b}=setup()
 expect(coincidentFor(sk,{kind:'piece',id:a},{kind:'piece',id:b})).toEqual({kind:'collinear',line:a,on:{line:b}})
})
