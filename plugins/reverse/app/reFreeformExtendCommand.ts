// SPDX-License-Identifier: AGPL-3.0-only
// reverse.freeform.extend: Extend Surface (F8 of audit-2026-11-07/FREEFORM_ROADMAP.md).
// A sheet of one whole patch — a fitted surface, a Fill, a freeform patch —
// is run on past its edges by an offset, Natural, Soft or Linear, as
// QUICKSURFACE 8.0.128's dialog does with an edge chain, a type and an
// Offset. The extension is a sheet body of its own (core/extend.ts); the
// sheet it was made from is put out of view, as native replaces it.

import { invalid } from '../../../src/commands/core/common'
import { arr, enumOf, int, num, obj, str } from '../../../src/commands/schema'
import { type Command } from '../../../src/plugins/api'
import { EXTEND_SAMPLES, EXTEND_SAMPLES_MAX, EXTEND_SAMPLES_MIN, EXTEND_SIDES, EXTEND_TYPES, type ExtendSide, type ExtendType } from '../core/extend'
import { bodiesChanged, bodyRows } from './reCommandAnswers'
import { bodyNamed, change, featureNamed, type Json, re, ready, type Ref } from './reCommandCore'
import { requireFreeName } from './reFeatureCommands'
import { featureBrief, resultOut } from './reReadout'
import { bodyRef } from './reSchemas'

export const freeformExtend: Command<{ sheet: Ref; offset: number; type?: ExtendType; sides?: ExtendSide[]; name?: string; samples?: number }> = {
  name: 'extend',
  title: 'Extend a sheet past its edges',
  description: `Extend Surface (Surfacing ▸ Extend Surface): a sheet of one whole patch — a surface fitted to the scan, a Fill (reverse.freeform.fill), a freeform patch — run on \`offset\` mm past its edges, as QUICKSURFACE 8.0.128 does with its edge chain, Extend type and Offset. \`type\`: natural (the default) runs each edge on along the curve of its end, tangent and curvature held; linear along its end tangent; soft with that curvature fading to straight over the offset. \`sides\`: the edges of the patch’s parameter box to run on — u0, u1 (the two ends of a row), v0, v1 — all four by default, the whole chain round the sheet. The sheet is read at \`samples\` × \`samples\` points (${EXTEND_SAMPLES} by default, ${EXTEND_SAMPLES_MIN}–${EXTEND_SAMPLES_MAX}), the edges run on, and the kernel’s surface made through the longer grid: a sheet body of its own, the sheet it was made from put out of view as the native one replaces it (the body list’s eye brings it back). Measured on QUICKSURFACE’s own: a 10 mm extension of the whole edge chain of a fitted wall in each type puts the new edges 10 mm past the old along the surface, and the three types lie within 0.8 mm of one another there; on that gentle surface these three ways of running an edge on cannot be told apart further, and the types here are the three readings above. Not compared with QUICKSURFACE: a partial edge chain, offsets other than 10 mm, a sheet strongly curved at its edge. Refused: a solid, a sheet of more than one face or a trimmed face, a seam (a closed cylinder), an offset over half the sheet. Returns the feature and its body.`,
  input: obj(
    {
      sheet: bodyRef,
      offset: num('Millimetres past each edge named in `sides`; above nothing.', { exclusiveMinimum: 0 }),
      type: enumOf(EXTEND_TYPES, 'How an edge is run on: natural (the default), soft or linear.'),
      sides: arr(enumOf(EXTEND_SIDES), 'The edges run on: u0, u1, v0, v1; all four when left out.', { minItems: 1, maxItems: 4 }),
      name: str('The feature’s name; “Extend surface n” when left out. Unique across sketches and features.', { minLength: 1 }),
      samples: int(`Grid points along a side the sheet is read at, ${EXTEND_SAMPLES_MIN}–${EXTEND_SAMPLES_MAX}; ${EXTEND_SAMPLES} unless given.`, { minimum: EXTEND_SAMPLES_MIN, maximum: EXTEND_SAMPLES_MAX }),
    },
    ['sheet', 'offset'],
  ),
  label: ({ name }) => `extend surface${typeof name === 'string' ? ` “${name}”` : ''}`,
  run: async ({ sheet, offset, type = 'natural', sides = [...EXTEND_SIDES], name, samples = EXTEND_SAMPLES }) => {
    const s = await ready()
    requireFreeName(name)
    if (!(typeof offset === 'number' && Number.isFinite(offset) && offset > 0)) invalid('offset: a number above nothing, in mm.')
    if (!EXTEND_TYPES.includes(type)) invalid(`type: ${EXTEND_TYPES.join(', ')}.`)
    if (!Number.isInteger(samples) || samples < EXTEND_SAMPLES_MIN || samples > EXTEND_SAMPLES_MAX) invalid(`${samples} samples a side: from ${EXTEND_SAMPLES_MIN} to ${EXTEND_SAMPLES_MAX}.`)
    const wanted = [...new Set(sides)]
    if (wanted.length === 0 || !wanted.every((x) => EXTEND_SIDES.includes(x))) invalid(`sides: any of ${EXTEND_SIDES.join(', ')}.`)
    const body = bodyNamed(sheet)
    if (!body.surface) invalid(`${body.name} is a solid, not a sheet — an extension runs on the edges of a sheet.`)
    const before = bodyRows(s)
    const id = await change(() => re().addExtend({ sheet: body.id, offset, type, sides: wanted, samples }, name))
    const f = featureNamed(id)
    const r = re().results[id]
    const out: Json = {
      feature: featureBrief(f, false),
      result: resultOut(r),
      extend: { sheet: { id: body.id, name: body.name }, offset, type, sides: wanted, samples },
      bodies: bodiesChanged(s, before),
    }
    return out
  },
}
