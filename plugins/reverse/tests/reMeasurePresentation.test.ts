// SPDX-License-Identifier: AGPL-3.0-only
import {expect,it} from 'vitest'
import {sketchMeasureRows} from '../core/measurePresentation'
import type {MeasureResult} from '../core/measureEval'
const row:MeasureResult={key:'point',label:'Position',value:0,unit:'point',point:[3,4],exact:true}
it('lifts point coordinates into the same tilted world frame as the witness',()=>{
 const rows=sketchMeasureRows([row],p=>[10+p[0],20,30+p[1]],false)
 expect(rows[0].point).toEqual([13,20,34])
 expect(rows[0].label).toContain('world XYZ')
 expect(row.point).toEqual([3,4])
})
it('names the local coordinate frame when measuring on the sketch sheet',()=>{
 const rows=sketchMeasureRows([row],p=>[p[0],p[1],0],true)
 expect(rows[0].point).toEqual([3,4])
 expect(rows[0].label).toContain('sketch XY')
})
