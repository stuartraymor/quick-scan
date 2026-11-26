// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import { coverageProbes, scanCoverage } from '../core/freeform/scanCoverage'
import { measuredDeviationStats } from '../core/freeform/analysisRamp'
import { AUTO_ALGORITHMS, AUTO_BUILD_STEPS, runAutoFreeform } from '../core/freeform/autoFreeform'
import { rims } from '../core/freeform/autoPrepare'
import { fitCageToScan, surfaceDeviation, type ScanProject } from '../core/freeform/limitFit'
import { boundedBuildSteps, freeformBody } from '../core/freeform/make'
import { cagePatches, type PatchGrid } from '../core/freeform/patches'
import { matchedTangents, subdivisionNet } from '../core/freeform/subdivisionNet'
import { ReKernel } from '../core/kernel'

it('keeps default CAD conversion within the sampling budget at the observed Highest density', () => {
  expect(boundedBuildSteps(4431, AUTO_BUILD_STEPS)).toBe(3)
  expect(boundedBuildSteps(11529, AUTO_BUILD_STEPS)).toBe(2)
})

const ringCases = [
  [0, 'basic', 100], [0, 'feature', 100], [9, 'feature', 100],
  [10, 'basic', 100], [11, 'feature', 100], [11, 'basic', 120],
  [11, 'basic', 150], [13, 'basic', 150], [15, 'feature', 100],
  [16, 'feature', 100], [17, 'basic', 120], [17, 'basic', 220],
] as const
it.each(ringCases)('keeps ring %i closed with %s at target %i', (variant, algorithm, quads) => {
  const positions: number[] = [], indices: number[] = []
  const around = 20 + 2 * (variant % 5), cross = 14 + variant % 6
  const rx = 6 + variant * .37, ry = 5 + variant * .23, radius = .45 + variant * .015
  for (let j=0; j<cross; j++) for (let i=0; i<around; i++) {
    const a = i/around * (2*Math.PI), b = j/cross * (2*Math.PI)
    positions.push((rx+radius*Math.cos(b))*Math.cos(a), (ry+radius*Math.cos(b))*Math.sin(a), radius*Math.sin(b))
    const p = j*around+i, q = j*around+(i+1)%around
    const r = ((j+1)%cross)*around+(i+1)%around, s = ((j+1)%cross)*around+i
    indices.push(p,q,r,p,r,s)
  }
  const made = runAutoFreeform({positions:Float32Array.from(positions), indices:Uint32Array.from(indices)},
    {algorithm,quads,hardEdgeAngle:25,details:'low'})
  expect(made.topologyResolutionRaised).toBe(true)
  expect(made.closed).toBe(true)
  expect(made.vertices-made.quads).toBe(0)
  expect(made.boundaryEdges).toBe(0)
  expect(made.coverage.max).toBeLessThan(variant === 0 ? .05 : radius * 1.1)
  expect(made.coverage.rms).toBeLessThan(.055)
})

it('encodes adjacent bicubic subdivision spans with matching boundary and cross-boundary derivatives', () => {
  const sample = (u: number, v: number) => [u, v, u ** 3 + u * v * v + v ** 3]
  const patch = (origin: number) => {
    const points = Float64Array.from(Array.from({ length: 25 }, (_, i) =>
      sample(origin + Math.floor(i / 5) / 4, (i % 5) / 4)).flat())
    return subdivisionNet({ points, rows: 5, cols: 5, faces: [] })!.poles
  }
  const a = patch(0), b = patch(1)
  const n = Math.sqrt(a.length)
  for (let j = 0; j < n; j++) for (let k = 0; k < 3; k++) {
    const last = (n - 1) * n + j
    expect(a[last][k]).toBeCloseTo(b[j][k], 12)
    expect(a[last][k] - a[last-n][k]).toBeCloseTo(b[n+j][k] - b[j][k], 12)
    expect(a[last][k] - 2*a[last-n][k] + a[last-2*n][k]).toBeCloseTo(b[2*n+j][k] - 2*b[n+j][k] + b[j][k], 12)
  }
})

it('reconciles opposing derivatives without moving boundary curves or crossing a marked crease', () => {
  const patch = (side: number): PatchGrid => {
    const points = new Float64Array(9*9*3)
    for (let i=0; i<9; i++) for (let j=0; j<9; j++) {
      const u=i/8, v=j/8+side
      points.set([u,v,(side ? 2 : 1)*u*(1-u)*(v-1)],3*(9*i+j))
    }
    const smoothSpans: number[][] = [[],[],[],[]]
    smoothSpans[side ? 0 : 1] = [1,2,3,4]
    return { points, rows:9, cols:9, faces:[], smoothSpans }
  }
  const a=patch(0), b=patch(1), match=matchedTangents([a,b])
  const left=subdivisionNet(a,match.get(a))!, right=subdivisionNet(b,match.get(b))!
  const original=subdivisionNet(a)!, n=left.v.count
  for (let i=0; i<n; i++) {
    const last=i*n+n-1, first=i*n
    expect(left.poles[last]).toEqual(original.poles[last])
    expect(left.poles[last]).toEqual(right.poles[first])
    if (i>0 && i<n-1) for (let d=0; d<3; d++) {
      expect(left.poles[last][d]-left.poles[last-1][d]).toBeCloseTo(right.poles[first+1][d]-right.poles[first][d],11)
    }
  }
  const cage = {positions:Float64Array.of(0,0,0, 1,0,0, 2,0,1, 0,1,0, 1,1,0, 2,1,1),
    faces:[[0,1,4,3],[1,2,5,4]], creases:[[1,4] as [number,number]]}
  const joined = (g: PatchGrid) => g.smoothSpans!.flat().filter(Boolean)
  expect(cagePatches(cage,2,undefined,1,true).grids.flatMap(joined)).toHaveLength(0)
  expect(cagePatches({...cage,creases:[]},2,undefined,1,true).grids.flatMap(joined)).toHaveLength(4)
})

it('measures signed offsets on the fitted limit mesh and retains missing correspondences', () => {
  const cage = { positions: Float64Array.of(-2,-2,1, 2,-2,1, 2,2,1, -2,2,1), faces: [[0,1,2,3]], creases: [] }
  const project: ScanProject = p => p[0] < -1 ? null : { point: [p[0],p[1],0], normal: [0,0,1], distance: Math.abs(p[2]) }
  const mesh = surfaceDeviation(cage, project, 1, 2, Infinity, true)
  expect(mesh.edgeSegments.length).toBe(4 * 4 * 2)
  expect(mesh.missed).toBeGreaterThan(0)
  expect(measuredDeviationStats(mesh.signed, 1)).toEqual({ count: mesh.points, missing: mesh.missed, min:-1, max:-1, rms:1, mean:-1, within:mesh.points })
  for (const index of mesh.edgeSegments) expect(mesh.indices.includes(index)).toBe(true)
  expect(measuredDeviationStats(Float32Array.of(-2,0,2,NaN), 1)).toEqual({count:3,missing:1,min:-2,max:2,mean:0,rms:Math.sqrt(8/3),within:1})
  expect(measuredDeviationStats(Float32Array.of(NaN), 1)).toBeNull()
})

it('applies the same fitting correction at a distant modeling origin', () => {
  const solve = (z: number) => {
    const cage = { positions: Float64Array.of(-2,-2,z+.01, 2,-2,z+.01, 2,2,z+.01, -2,2,z+.01), faces: [[0,1,2,3]], creases: [] }
    return fitCageToScan(cage, p=>({point:[p[0],p[1],z],normal:[0,0,1],distance:Math.abs(p[2]-z)}))
  }
  expect(solve(0).stats.rms).toBeLessThan(1e-7)
  expect(solve(1e6).stats.rms).toBeLessThan(1e-7)
})

it('includes missing scan regions in coverage even when every fitted point lies on the scan', () => {
  const indices = Uint32Array.of(0,1,2, 0,2,3)
  const rectangle = (width: number) => ({ positions: Float32Array.of(0,0,0, width,0,0, width,1,0, 0,1,0), indices })
  const scan = rectangle(2)
  const probes = coverageProbes(scan)
  expect(scanCoverage(probes, scan, .01).within).toBe(probes.length/3)
  const partial = scanCoverage(probes, rectangle(1), .01)
  expect(partial.max).toBeGreaterThan(.98)
  expect(partial.rms).toBeCloseTo(Math.sqrt(1/6), 2)
  expect(partial.within / partial.samples).toBeCloseTo(.505, 2)
})

function openTube() {
  const positions: number[] = [], indices: number[] = []
  const cols = 20, rows = 14
  for (let j=0; j<=rows; j++) for(let i=0; i<cols; i++) {
    const angle = 2*Math.PI*i/cols
    positions.push(6*Math.cos(angle), 5*Math.sin(angle), 18*j/rows-9)
  }
  for (let j=0; j<rows; j++) for (let i=0; i<cols; i++) {
    const a=j*cols+i, b=j*cols+(i+1)%cols
    indices.push(a,b,b+cols,a,b+cols,a+cols)
  }
  return { positions: Float32Array.from(positions), indices: Uint32Array.from(indices) }
}
it.each(AUTO_ALGORITHMS)('%s preserves both ends of an open tube through STEP exchange', async algorithm => {
  const r = runAutoFreeform(openTube(), { algorithm, quads:100, hardEdgeAngle:25, details:'low' })
  expect(r.closed).toBe(false)
  expect(rims(r.surface)).toHaveLength(2)
  expect(r.deviation.rms).toBeLessThan(0.05)
  const k=await ReKernel.load()
  const made=freeformBody(k,r.cage,{steps:AUTO_BUILD_STEPS,snap:false})
  let reopened: ReturnType<typeof k.importStep> | undefined
  try {
    expect(made.closed).toBe(false)
    const out=k.exportStepMended([made.shape],[{name:'Open tube'}],[true])
    const check=out.check ?? k.verifyStep(out.text,[made.shape],{sheets:[true]})
    expect(check.ok).toBe(true)
    reopened=k.importStep(out.text)
    expect(k.isValid(reopened)).toBe(true)
    let maxGap=0
    const coords=r.surface.positions
    for(let i=0;i<coords.length;i+=3*17) {
      maxGap=Math.max(maxGap,k.distanceToPoint(reopened,Array.from(coords.subarray(i,i+3)) as Vec3))
    }
    const sides=k.edgeSides(reopened,k.edges(reopened,.05).map(edge=>edge.hash))
    const angles=sides.flatMap(pair=>{
      if(!pair)return []
      const [a,b]=pair.normals
      const cosine=Math.abs(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])
      return [180/Math.PI*Math.acos(Math.min(1,cosine))]
    }).sort((a,b)=>a-b)
    console.info(JSON.stringify({algorithm,quads:r.quads,patches:k.faceCount(reopened),stepGap:check.bodies[0].gap,previewToStepMax:maxGap,
      seamMidpoints:angles.length,medianTangentPlaneDegrees:angles[Math.floor(angles.length/2)],maxTangentPlaneDegrees:angles.at(-1)}))
    expect(maxGap).toBeLessThan(.05)
  } finally { if(reopened!==undefined)k.release(reopened);k.release(made.shape) }
},120000)
