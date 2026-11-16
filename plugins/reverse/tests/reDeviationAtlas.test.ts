// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest'
import {deviationAtlas,deviationAtlasValues} from '../core/freeform/deviationAtlas'

it('keeps every sample of 1600 face charts in the correct GPU tile',()=>{
  const size=17,faces=1600,values=Float32Array.from({length:size*size*faces},(_,i)=>i/16)
  const atlas=deviationAtlasValues(values,size,faces,.5)
  expect(atlas.width).toBeLessThanOrEqual(2048);expect(atlas.height).toBeLessThanOrEqual(2048)
  expect(atlas.columns).toBeGreaterThan(1)
  for(let face=0;face<faces;face++) for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
    const tx=(face%atlas.columns)*size+x,ty=Math.floor(face/atlas.columns)*size+y
    if(atlas.data[ty*atlas.width+tx]!==-2*values[(face*size+y)*size+x])throw Error(`Wrong chart sample ${face}/${x}/${y}`)
  }
})

it('rejects charts beyond the GPU bound and incomplete sample buffers',()=>{
  expect(()=>deviationAtlas(17,14401)).toThrow('capacity')
  expect(()=>deviationAtlasValues(new Float32Array(5),17,1,.01)).toThrow('samples')
  expect(()=>deviationAtlasValues(new Float32Array(289),17,1,0)).toThrow('samples')
})
