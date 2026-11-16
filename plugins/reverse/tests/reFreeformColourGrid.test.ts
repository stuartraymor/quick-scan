// SPDX-License-Identifier: AGPL-3.0-only
import {it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {ReKernel,rectangleLoop} from '../core/kernel'
it('maps a regular color chart back to the unchanged native curved CAD',async()=>{
 const k=await ReKernel.load(),shape=k.importStep(readFileSync(new URL('./fixtures/freeform-curved-native.stp',import.meta.url),'utf8')),mesh=k.mesh(shape,.001,.1),t=performance.now(),grid=k.deviationGrid(shape,mesh)!,o=(k as any).occt,faces=o.getSubShapes(shape,'face')
 const errors:number[]=[]
 for(let i=0;i<mesh.positions.length/3;i++){const face=Math.round(grid.coordinates[i*3+2]),b=o.uvBounds(faces[face]),u=b.uMin+(b.uMax-b.uMin)*grid.coordinates[i*3],v=b.vMin+(b.vMax-b.vMin)*grid.coordinates[i*3+1],p=o.pointOnSurface(faces[face],u,v);errors.push(Math.hypot(p.x-mesh.positions[i*3],p.y-mesh.positions[i*3+1],p.z-mesh.positions[i*3+2]))}
 console.log({ms:performance.now()-t,vertices:errors.length,maxError:Math.max(...errors),gridFaces:grid.faces});expect(Math.max(...errors)).toBeLessThan(1e-5)
 for(const f of faces)o.release(f);k.release(shape)
},120000)

it('keeps sparse fragment samples on the same curved CAD and rejects trimmed holes',async()=>{
 const k=await ReKernel.load(),shape=k.importStep(readFileSync(new URL('./fixtures/freeform-curved-native.stp',import.meta.url),'utf8'))
 const mesh=k.mesh(shape,.001,.1),positions=mesh.positions.slice(),indices=mesh.indices.slice()
 const dense=k.deviationGrid(shape,mesh,17)!,sparse=k.deviationGrid(shape,mesh,5,true)!
 expect(sparse).toBeDefined();expect(sparse.faces).toBe(dense.faces)
 for(let f=0;f<sparse.faces;f++)for(let j=0;j<5;j++)for(let i=0;i<5;i++)for(let a=0;a<3;a++)
  expect(sparse.positions[((f*5+j)*5+i)*3+a]).toBe(dense.positions[((f*17+j*4)*17+i*4)*3+a])
 expect(mesh.positions).toEqual(positions);expect(mesh.indices).toEqual(indices)
 const hole=k.face({outer:rectangleLoop([0,0,0],[1,0,0],[0,1,0],20,20),holes:[rectangleLoop([8,8,0],[1,0,0],[0,1,0],4,4)]})
 expect(k.deviationGrid(hole,k.mesh(hole,.01,.1))).toBeUndefined()
 k.release(shape,hole)
},120000)
