// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import * as THREE from 'three'
import { rigidFromAxisAngle } from '../../../src/core/deviation/rigid'
import { ReClient } from '../core/reClient'
import type { MeasuredTriangles } from '../core/freeform/deviationRefinement'
import { FinishingOverlay, finishingStatistics } from '../viewer/finishingOverlay'
import { localKernel } from './reLocal'

it('summarizes finite signed samples including both tolerance boundaries', () => {
  const stats = finishingStatistics(Float32Array.of(-3,-1,0,1,2,NaN,Infinity), 1)!
  expect(stats).toMatchObject({ measured: 5, total: 7, min: -3, max: 2, withinTolerance: 3, meanAbsolute: 1.4 })
  expect(stats.rms).toBeCloseTo(Math.sqrt(3))
  expect(finishingStatistics(Float32Array.of(NaN, Infinity), 1)).toBeNull()
})

it('reads against the registered scan, excludes a lateral rim, and retains its winding sign', async () => {
  const client = new ReClient(localKernel())
  const scan = Float32Array.of(-1,-1,0, 1,-1,0, 1,1,0, -1,1,0)
  const index = Uint32Array.of(0,1,2, 0,2,3)
  const move = rigidFromAxisAngle([0,1,0], Math.PI / 2)
  move.t.set([8,-4,11])
  const world = Float32Array.of(10,-4,11, 7,-4,11, 8,-4,8)
  try {
    await client.setScan(scan, move, index)
    expect(Array.from(await client.previewSurfaceDeviation(world, true))).toEqual([2,-1,NaN])
    await client.setScan(undefined, null)
    const local = Float32Array.of(0,0,2, 0,0,-1, 3,0,0)
    expect(Array.from(await client.previewSurfaceDeviation(local, true))).toEqual([2,-1,NaN])
    expect(Array.from(await client.previewSurfaceDeviation(local))).toEqual([2,-1,2])
    await client.setScan(scan, null, Uint32Array.of(2,1,0, 3,2,0))
    expect(Array.from(await client.previewSurfaceDeviation(local, true))).toEqual([-2,1,NaN])
    await client.setScan(null, null)
    await expect(client.previewSurfaceDeviation(local,true)).rejects.toThrow('reference scan')
  } finally { client.dispose() }
}, 120000)

it('discards an older analysis and never reports an all-missing field as ready', async () => {
  const parent = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()), overlay = new FinishingOverlay()
  const positions = Float32Array.of(0,0,0, 1,0,0, 0,1,0), triangles = Uint32Array.of(0,1,2)
  const mesh = {positions, normals:new Float32Array(9), indices:triangles, faceHash:Int32Array.of(7)}
  let resolve!: (data: MeasuredTriangles) => void
  const delayed = new Promise<MeasuredTriangles>(done => { resolve = done })
  const states: string[] = []
  const settings = { tolerance: 1, colouring: 'gradient' as const, report: (state: string) => states.push(state) }
  overlay.update(parent, mesh, [7], { ...settings, measure: () => delayed })
  overlay.update(parent, mesh, [7], { ...settings, measure: async () => ({positions, triangles, values:Float32Array.of(NaN,NaN,NaN)}) })
  resolve({positions, triangles, values:Float32Array.of(1,1,1)})
  await new Promise(done => setTimeout(done, 0))
  expect(states.at(-1)).toBe('unavailable')
  expect(states).not.toContain('ready')
  expect(parent.children).toHaveLength(0)
  overlay.update(null, null, [], null)
  parent.geometry.dispose()
  parent.material.dispose()
})
