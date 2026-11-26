// SPDX-License-Identifier: AGPL-3.0-only
import type {Vec2} from '../../../src/core/flat/types'
import type {Vec3} from '../../../src/core/types'
import type {MeasureRow} from '../../../src/state/measureToolStore'
import type {MeasureResult} from './measureEval'

/** Sketch evaluation is local XY. Point readouts on the 3D part must use
 * the same lift as the witnesses; an open 2D sheet explicitly names XY. */
export function sketchMeasureRows(rows:readonly MeasureResult[],place:(p:Vec2)=>Vec3,onSheet:boolean):MeasureRow[]{
 return rows.map(r=>({label:r.unit==='point'?`${r.label.startsWith('Position of')?'Position':r.label} (${onSheet?'sketch XY':'world XYZ'})`:r.label,value:r.value,unit:r.unit,exact:r.exact,note:r.note,...(r.point?{point:onSheet?[...r.point]:place(r.point)}:{})}))
}
