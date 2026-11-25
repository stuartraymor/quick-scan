// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest'
import {addEntity,emptySketch} from '../core/sketch'
import {reachedPairs} from '../core/cornerSweep'

const corner=()=>{
 const sketch=emptySketch()
 addEntity(sketch,{kind:'line',a:[-30,0],b:[-21,0]})
 addEntity(sketch,{kind:'line',a:[0,21],b:[0,30]})
 return sketch
}
it.each([.1,.01])('reaches the only pair at a painted carrier intersection regardless of brush width %s',radius=>{
 const sketch=corner(),before=JSON.stringify(sketch)
 const pairs=reachedPairs(sketch,{path:[[0,0]],radius})
 expect(pairs.map(p=>p.ids)).toEqual([[1,2]])
 expect(JSON.stringify(sketch)).toBe(before)
})
it('keeps the distance bound when multiple pairs could be chosen',()=>{
 const sketch=corner()
 addEntity(sketch,{kind:'line',a:[-30,3],b:[-21,3]})
 expect(reachedPairs(sketch,{path:[[0,0]],radius:.01})).toEqual([])
})
it('still needs the corner point painted, and never reaches a fixed piece',()=>{
 const sketch=corner()
 expect(reachedPairs(sketch,{path:[[1,1]],radius:.01})).toEqual([])
 sketch.entities[0].fixed=true
 expect(reachedPairs(sketch,{path:[[0,0]],radius:.01})).toEqual([])
})
