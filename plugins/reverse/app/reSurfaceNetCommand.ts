// SPDX-License-Identifier: AGPL-3.0-only
// reverse.surface.net: a Fit Surface's control net, read (F8 of
// audit-2026-11-07/FREEFORM_ROADMAP.md). QUICKSURFACE 8.0.128's Fit Surface
// dialog has a Control Net tick that draws the surface's U × V poles as a
// grid of lines and points over it (measured on the wall: a Refined 5 × 5,
// degree 4 net, the poles' grid joined row by row and column by column,
// the corners on the surface's corners). This is the same net as numbers:
// the poles in space, the surface being their B-spline.

import { invalid } from '../../../src/commands/core/common'
import { obj } from '../../../src/commands/schema'
import { round3 } from '../../../src/core/round'
import type { Vec3 } from '../../../src/core/types'
import { type Command } from '../../../src/plugins/api'
import { featureNamed, type Json, re, ready, type Ref } from './reCommandCore'
import { featureRef } from './reSchemas'

export const surfaceNet: Command<{ surface: Ref }> = {
  name: 'net',
  title: 'Read a fitted surface’s control net',
  description:
    'The control net of a Fit Surface: its `rows` × `cols` poles in space (rows along the surface’s u, columns along v), the degree, and how far the net stands past the surface, as QUICKSURFACE’s Fit Surface shows with Control Net ticked. The surface is the B-spline of these poles over the plane it was fitted in; the kernel’s face is made through a grid sampled from it and follows it within a thousandth of a millimetre. Read-only: a pole is not moved by this. A plane or a cylinder fit has no net; a surface that failed to build has none yet. Returns { surface, rows, cols, degree, poles: [row][col] → [x, y, z] }.',
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
    return out
  },
}
