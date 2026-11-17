// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { ReKernel } from '../core/kernel'
import { freeformBody } from '../core/freeform/make'
import { limitMesh } from '../core/freeform/limit'
import type { Vec3 } from '../../../src/core/types'

it('exports a nonplanar control quad as a valid STEP sheet with the same evaluated surface', async () => {
  const k = await ReKernel.load()
  const cage = { positions: new Float64Array([-10,-10,0,10,-10,1,10,10,4,-10,10,-2]), faces: [[0,1,2,3]], creases: [] }
  const made = freeformBody(k, cage, { steps: 2, snap: false })
  let reopened: ReturnType<typeof k.importStep> | undefined
  try {
    const out = k.exportStepMended([made.shape], [{ name: 'Nonplanar control quad' }], [true])
    const verified = out.check ?? k.verifyStep(out.text, [made.shape], { sheets: [true] })
    expect(verified.ok).toBe(true)
    expect(verified.bodies[0].valid).toBe(true)
    expect(out.text).toMatch(/B_SPLINE_SURFACE/)
    reopened = k.importStep(out.text)
    const samples = limitMesh(cage, 4).positions
    let max = 0
    for (let i=0;i<samples.length;i+=3) max=Math.max(max,k.distanceToPoint(reopened,Array.from(samples.subarray(i,i+3)) as Vec3))
    expect(max).toBeLessThan(1e-5)
    expect(Math.max(...samples.filter((_,i)=>i%3===2))-Math.min(...samples.filter((_,i)=>i%3===2))).toBeGreaterThan(5)
  } finally { if(reopened!==undefined) k.release(reopened);k.release(made.shape) }
},120000)
