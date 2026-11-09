// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it, vi } from 'vitest'
import { surfaceMeshCost } from '../core/surfaceMeshCost'
import { polynomialOfFit, buildEditedSurface } from '../core/editedSurface'
import { DEFAULT_SURFACE_FIT, fitSurface, meshTriangles } from '../core/surfaceFit'
import { surfaceAxis, type PolynomialSurface } from '../core/surfaceStep'
import type { ReKernel } from '../core/kernel'

function curved() {
  const points=[]
  for(let i=0;i<=20;i++) for(let j=0;j<=20;j++) points.push(i,j,.03*i*i+.02*j*j)
  return fitSurface(Float64Array.from(points),{...DEFAULT_SURFACE_FIT,net:{u:5,v:5},degree:3,expandPct:0})
}
it('tracks the existing height-field estimate on an ordinary curved fit',()=>{
  const fit=curved(),cost=surfaceMeshCost(polynomialOfFit(fit),.01).triangles,baseline=meshTriangles(fit,.01)
  expect(Math.abs(cost-baseline)/baseline).toBeLessThan(.2)
})
it('is independent of rigid orientation and affine knot parameterization',()=>{
  const net=polynomialOfFit(curved()),before=surfaceMeshCost(net,.01).triangles
  const moved={...net,u:{...net.u,knots:net.u.knots.map(x=>3+2*x)},v:{...net.v,knots:net.v.knots.map(x=>-7+.5*x)},poles:net.poles.map(([x,y,z])=>[z+4,x+5,y-9])}
  expect(surfaceMeshCost(moved,.01).triangles).toBe(before)
})
it('refuses an expensive edited net before CAD construction or residual measurements',()=>{
  const count=20,degree=3,knots=[...Array(4).fill(0),...Array.from({length:count-degree-1},(_,i)=>(i+1)/(count-degree)),...Array(4).fill(1)]
  const axis=surfaceAxis(knots,degree,count)
  const net:PolynomialSurface={u:axis,v:axis,poles:Array.from({length:count*count},(_,i)=>{const u=Math.floor(i/count),v=i%count;return [u,v,((u+v)%2?1:-1)*100]})}
  const cost=surfaceMeshCost(net)
  expect(cost.triangles).toBeGreaterThan(300_000)
  const kernel={surfaceFromControlNet:vi.fn(),distanceToPoint:vi.fn()} as unknown as ReKernel
  expect(()=>buildEditedSurface(kernel,net,new Float32Array([0,0,0]))).toThrow(/edited surface would mesh/)
  expect(kernel.surfaceFromControlNet).not.toHaveBeenCalled()
  expect(kernel.distanceToPoint).not.toHaveBeenCalled()
})
