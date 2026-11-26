// SPDX-License-Identifier: AGPL-3.0-only
import {beforeEach,expect,it} from 'vitest'
import {measuredDistance,useMeasureTool} from '../src/state/measureToolStore'
const t=()=>useMeasureTool.getState()
beforeEach(()=>{useMeasureTool.setState({...useMeasureTool.getInitialState()},true);t().setOpen(true)})
it('opens with adaptive selection rather than requiring a geometry-specific mode',()=>{
 expect(t().mode).toBe('adaptive')
})
it('adaptive mesh point pairs include directional offsets',()=>{
 t().setMode('adaptive')
 expect(t().pick([2,3,4])).toBeNull()
 const measurement=t().pick([5,7,16])
 expect(measurement).toEqual({kind:'extended',a:[2,3,4],b:[5,7,16]})
 expect(measuredDistance([2,3,4],[5,7,16])).toEqual({d:13,dx:3,dy:4,dz:12})
})
it('clearing a measurement also clears its stale hover preview',()=>{
 t().setPreview({outline:[],witness:[[0,0,0]],row:{label:'old',value:1,unit:'length',exact:true}})
 t().deleteAll()
 expect(t().preview).toBeNull()
})
