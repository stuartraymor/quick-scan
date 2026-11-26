// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest'
import {splitMesh} from '../core/splitMesh'
import {splitEnvelope} from '../core/splitEnvelope'
import {buildMeshGraph} from '../../../src/core/geometry/buildGraph'
import {parsePLY} from '../../../src/core/parsers/ply'
import {buildBinaryPly} from '../core/plyWriter'
import {vertexComponents} from '../../../src/core/geometry/unionFind'
import type {Vec3} from '../../../src/core/types'
const quad=(p:number[])=>({positions:Float32Array.from(p),indices:Uint32Array.of(0,1,2,0,2,3)})
const sheet=quad([-2,-2,0,2,-2,0,2,2,0,-2,2,0])
const blade=quad([0,-3,-2,0,3,-2,0,3,2,0,-3,2])
const plane={plane:{origin:[0,0,0] as Vec3,normal:[1,0,0] as Vec3}}
it.each([['finite surface',blade],['datum',plane]] as const)('splits with a %s and retains individual regions after serialization',(_,tool)=>{
  const result=splitMesh(sheet,tool)
  expect(result.parts).toBe(2)
  const graph=buildMeshGraph(parsePLY(buildBinaryPly(result.positions,result.indices).slice().buffer))
  const components=vertexComponents(graph.indices,graph.vertexCount)
  expect(new Set(Array.from(graph.indices,v=>components.find(v))).size).toBe(2)
  let area=0
  for(let k=0;k<result.indices.length;k+=3){
    const [a,b,c]=Array.from(result.indices.slice(k,k+3),i=>result.positions.subarray(i*3,i*3+3))
    const cross=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);expect(cross).toBeGreaterThan(0);area+=cross/2
  }
  expect(area).toBeCloseTo(16,6)
})
it('exposes both offset boundaries of a finite-thickness envelope',()=>{
  const tool=splitEnvelope(blade,sheet,.3)
  expect(splitMesh(sheet,tool).parts).toBe(3)
})
it('rejects a short blade or a disjoint surface',()=>{
  expect(()=>splitMesh(sheet,quad([0,-.4,-2,0,.4,-2,0,.4,2,0,-.4,2]))).toThrow(/separate/)
  expect(()=>splitMesh(sheet,quad([6,-3,-2,6,3,-2,6,3,2,6,-3,2]))).toThrow(/cross/)
})
