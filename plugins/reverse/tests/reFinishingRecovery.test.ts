// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import type { BuildStep } from '../core/features'
import { angledAsk } from '../core/chamferSides'
import { ReKernel } from '../core/kernel'
import { KernelTrap } from '../core/kernelOps'
import { ReClient } from '../core/reClient'
import { localKernel } from './reLocal'

it('rejects a chamfer that cannot reach its other face in either reference orientation', () => {
  const angle = Math.atan(3/5)
  for (const first of [true,false]) {
    expect(angledAsk({ mode: 'distanceAngle', distance: 1, angleDeg: 32 }, first,
      [[1,0,0], [Math.cos(angle),Math.sin(angle),0]])).toMatch(/does not reach/)
  }
})

it('rebuilds an imported body after a preview stops the kernel and accepts a changed draft', async () => {
  const k = await ReKernel.load()
  const box = k.box([0,0,0],[12,16,20])
  const files = new Map([['source',k.exportStep([box])]])
  k.release(box)
  let loads = 0
  const client = new ReClient(localKernel(async () => {
    const fresh = await ReKernel.load()
    if (++loads === 1) fresh.chamferAngled = () => { throw new KernelTrap('test interruption') }
    return fresh
  }))
  let restarts = 0
  client.onPreviewRestart = () => { restarts++ }
  const base: BuildStep[] = [{id:1,kind:'import',file:'source',name:'Stock'}]
  try {
    const initial = await client.build(base,new Map(),files)
    const body = initial!.bodies[0]
    const step: BuildStep = {id:2,kind:'chamfer',body:1,name:'Bevel',edges:[body.topology.edges[0].fingerprint],
      distance:1,angleDeg:35,mode:'distanceAngle',chain:false}
    await expect(client.preview(step,undefined)).rejects.toThrow(/Change the edge selection/)
    expect(restarts).toBe(1)
    const restored = await client.build(base,new Map())
    expect(restored!.changed).toContain(1)
    expect(restored!.bodies[0].volume).toBeCloseTo(12*16*20,8)
    await expect(client.preview(step,undefined)).rejects.toThrow(/Change the edge selection/)
    expect(restarts).toBe(1)
    const next = {...step,distance:.7}
    expect((await client.preview(next,undefined))?.closed).toBe(true)
    const committed = await client.build([...base,next],new Map())
    expect(committed!.results.at(-1)?.status).toBe('ok')
    expect(committed!.bodies[0].volume).toBeLessThan(body.volume)
    expect(loads).toBe(2)
  } finally { client.dispose() }
},60_000)
