// SPDX-License-Identifier: AGPL-3.0-only
import {describe,it,expect} from 'vitest'
import {readProjectView} from '../src/viewer/projectView'
const valid={position:[12,-23,34],target:[2,3,4],up:[0,0,1],zoom:1.7,halfW:20,halfH:30}
describe('optional project viewport',()=>{
 it('accepts a panned zoomed view',()=>expect(readProjectView(valid)).toEqual(valid))
 it('old files and invalid presentation data fall back without losing the part',()=>{
  for(const v of [undefined,null,[],{}, {...valid,zoom:0},{...valid,halfW:Infinity},{...valid,target:[NaN,0,0]}, {...valid,up:[0,0]}, {...valid,position:valid.target}]) expect(readProjectView(v)).toBeNull()
 })
 it('rejects an up vector parallel to the line of sight',()=>expect(readProjectView({...valid,up:[10,-26,30]})).toBeNull())
})
