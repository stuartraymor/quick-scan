// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { NominalSurface } from '../../../src/core/deviation/surface'
import { previewDeviation, previewDeviationColours } from '../core/freeform/previewDeviation'
describe('Freeform surface deviation', () => {
  const p = new Float32Array([-10,-10,0, 10,-10,0, 10,10,0, -10,10,0])
  const triangles = new Uint32Array([0,1,2, 0,2,3])
  it('samples the preview vertices against the scan with winding-dependent sign', () => {
    const points = new Float32Array([0,0,2, 0,0,-3, 1,1,0])
    expect(Array.from(previewDeviation(points, new NominalSurface(p, triangles)))).toEqual([2,-3,0])
    expect(Array.from(previewDeviation(points, new NominalSurface(p, new Uint32Array([2,1,0,3,2,0]))))).toEqual([-2,3,0])
  })
  it('keeps invalid samples unmeasured and rejects malformed coordinates', () => {
    const scan = new NominalSurface(p, triangles)
    expect(previewDeviation(new Float32Array([NaN,0,0]), scan)[0]).toBeNaN()
    expect(() => previewDeviation(new Float32Array([0]), scan)).toThrow('XYZ')
  })
  it('uses inclusive tolerance boundaries, signed end colours and off-scale caps', () => {
    const rgb = previewDeviationColours(new Float32Array([-6,-5,-1,0,1,5,6,NaN]), 1, 'gradient')
    const c = (i: number) => Array.from(rgb.slice(i*3,i*3+3))
    expect(c(0)).toEqual([0,0,0]); expect(c(1)).toEqual([0,0,1])
    for (const i of [2,3,4]) expect(c(i)).toEqual([0,1,0])
    expect(c(5)).toEqual([1,0,0]); expect(c(6)).toEqual([0,0,0]); expect(c(7)).toEqual([.25,.25,.25])
  })
  it('distinguishes pass/fail from gradient caps and rejects invalid tolerance', () => {
    expect(Array.from(previewDeviationColours(new Float32Array([-100,100]), 1, 'pass-fail'))).toEqual([1,0,0,1,0,0])
    for (const tolerance of [0,-1,NaN,Infinity]) expect(() => previewDeviationColours(new Float32Array([0]), tolerance, 'gradient')).toThrow('Tolerance')
  })
})


it('measures through the worker protocol, keeps caller data, and follows scan replacement/removal', async () => {
  const { ReClient } = await import('../core/reClient')
  const { localKernel } = await import('./reLocal')
  const client = new ReClient(localKernel())
  const points = new Float32Array([0,0,2, 0,0,-3])
  const scan = (z: number) => new Float32Array([-10,-10,z, 10,-10,z, 10,10,z, -10,10,z])
  const triangles = () => new Uint32Array([0,1,2, 0,2,3])
  try {
    await expect(client.previewSurfaceDeviation(points)).rejects.toThrow('reference scan')
    await client.setScan(scan(0), null, triangles())
    expect(Array.from(await client.previewSurfaceDeviation(points))).toEqual([2,-3])
    expect(Array.from(points)).toEqual([0,0,2,0,0,-3])
    await client.setScan(scan(1), null, triangles())
    expect(Array.from(await client.previewSurfaceDeviation(points))).toEqual([1,-4])
    await client.setScan(null, null)
    await expect(client.previewSurfaceDeviation(points)).rejects.toThrow('reference scan')
  } finally { client.dispose() }
}, 120000)
