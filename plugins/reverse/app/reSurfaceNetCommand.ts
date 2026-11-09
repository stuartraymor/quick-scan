// SPDX-License-Identifier: AGPL-3.0-only
// reverse.surface.net: a Fit Surface's control net, read (F8 of
// audit-2026-11-07/FREEFORM_ROADMAP.md). QUICKSURFACE 8.0.128's Fit Surface
// dialog has a Control Net tick that draws the surface's U × V poles as a
// grid of lines and points over it (measured on the wall: a Refined 5 × 5,
// degree 4 net, the poles' grid joined row by row and column by column,
// the corners on the surface's corners). This is the same net as numbers:
// the poles in space, the surface being their B-spline.

import { invalid } from '../../../src/commands/core/common'
import { obj, int, num, vec3 } from '../../../src/commands/schema'
import { round3 } from '../../../src/core/round'
import type { Vec3 } from '../../../src/core/types'
import { type Command } from '../../../src/plugins/api'
import { featureNamed, type Json, re, ready, change, type Ref } from './reCommandCore'
import { moveSurfacePole } from '../core/surfaceStep'
import { resultOut } from './reReadout'
import { featureRef } from './reSchemas'

export const surfaceNet: Command<{ surface: Ref }> = {
  name: 'net',
  title: 'Read a fitted surface’s control net',
  description:
    'The control net of a Fit Surface: its `rows` × `cols` poles in space (rows along the surface’s u, columns along v), the degree, and how far the net stands past the surface, as QUICKSURFACE’s Fit Surface shows with Control Net ticked. The CAD face is constructed from the exact polynomial B-spline control net, including edited XYZ poles. The legacy poles array is rounded to three decimal places; exact includes unrounded flat poles in u-major order plus separate u/v degrees, counts, knots and multiplicities when available. Read-only: a pole is not moved by this. A plane or a cylinder fit has no net; a surface that failed to build has none yet. Returns { surface, rows, cols, degree, poles: [row][col] → [x, y, z] }.',
  input: obj({ surface: featureRef('Fit Surface feature') }, ['surface']),
  label: ({ surface }) => `read control net of ${typeof surface === 'string' ? `“${surface}”` : `#${String(surface)}`}`,
  run: async ({ surface }) => {
    await ready()
    const f = featureNamed(surface)
    if (f.kind !== 'surface') invalid(`${f.name} is a ${f.kind}, not a Fit Surface.`)
    const net = re().results[f.id]?.surface?.controlNet
    if (!net) return invalid(`${f.name} has no control net: it is a plane or a cylinder, or it has not built.`)
    const poles: Vec3[][] = []
    for (let r = 0; r < net.rows; r++) {
      const row: Vec3[] = []
      for (let c = 0; c < net.cols; c++) {
        const o = (r * net.cols + c) * 3
        row.push([round3(net.points[o]), round3(net.points[o + 1]), round3(net.points[o + 2])])
      }
      poles.push(row)
    }
    const out: Json = { surface: { id: f.id, name: f.name }, rows: net.rows, cols: net.cols, degree: net.degree, poles }
    const exact = re().results[f.id]?.surface?.controlSurface
    if (exact) out.exact = JSON.parse(JSON.stringify(exact))
    return out
  },
}

/** The viewport's exact pole edit, through the shared command history. */
export const surfaceMovePole: Command<{ surface: Ref; u: number; v: number; by: Vec3; strength?: number }> = {
  name: 'move_pole',
  title: 'Move a fitted surface control point',
  description: 'Move one control pole of a fitted freeform surface, preserving every other pole, degree and knot. u and v are zero-based row/column indices from reverse.surface.net. by is an XYZ displacement in document geometry coordinates, millimetres; strength is 0–100 percent (100 by default). This is one undo step and rebuilds the exact CAD face and deviation report. Explicit refitting replaces these pole edits. Returns the surface, indices, resulting unrounded position and build result.',
  input: obj({surface:featureRef('Fit Surface feature'),u:int('Zero-based u row',{minimum:0}),v:int('Zero-based v column',{minimum:0}),by:vec3('XYZ displacement in document coordinates, mm'),strength:num('Percent of displacement;100 unless given',{minimum:0,maximum:100})},['surface','u','v','by']),
  label: ({u,v}) => `move surface control pole ${u},${v}`,
  run: async ({surface,u,v,by,strength=100}) => {
    await ready()
    const f=featureNamed(surface)
    if(f.kind!=='surface') return invalid(`${f.name} is not a Fit Surface.`)
    if(!re().features.includes(f)) return invalid(`${f.name} is below the rollback bar.`)
    const net=f.controlSurface ?? re().results[f.id]?.surface?.controlSurface
    if(!net || (f.shape && f.shape!=='freeform')) return invalid(`${f.name} has no editable freeform control net.`)
    let moved
    try { moved=moveSurfacePole(net,u,v,by,strength) }
    catch(error) { return invalid((error as Error).message) }
    if(strength!==0 && by.some(x=>x!==0)) await change(()=>{
      re().editFeature(f.id)
      re().setFeatureDraft({controlSurface:moved})
      if(re().commitFeature()===null) return invalid('Could not commit the control-pole edit.')
    })
    return {surface:{id:f.id,name:f.name},u,v,position:moved.poles[u*net.v.count+v],result:resultOut(re().results[f.id])}
  },
}
