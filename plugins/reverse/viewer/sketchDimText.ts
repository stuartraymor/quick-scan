// SPDX-License-Identifier: AGPL-3.0-only
// A sketch dimension's number on the sheet, in the units shown: as its
// label writes it and as its field opens. The sketch holds millimetres;
// what is typed into the field is read back into them by the label's
// handler, the way every length field of the workspace reads it (see
// ui/reLength.ts). An angle is in degrees whatever the units.

import type { DisplayUnits } from '../../../src/core/units'
import { dimensionKind } from '../core/parameters'
import type { Constraint } from '../core/sketch'
import { lenBare } from '../ui/reLength'

type Dimension = Extract<Constraint, { value: number }>

/** A length held in millimetres as a drawing writes it in `units`: the
 *  decimals a millimetre figure of `mmDecimals` is given there, and no
 *  zeros carried behind — "12.5", "0.4921". No unit word: the drawing
 *  carries it once, not on every number. */
export function bareLength(mm: number, units: DisplayUnits = 'mm', mmDecimals = 3): string {
  return lenBare(mm, units, mmDecimals)
}

/** A dimension's number as a drawing writes it: no letter on a length, R on
 *  a radius, Ø on a diameter, ⌒ on an arc's length, the degree sign on an
 *  angle, and no zeros carried behind — and an ƒ before one an expression
 *  drives, the expression itself being the label's tooltip and what its
 *  field opens with. A driven (reference) dimension is written in
 *  brackets, as a drawing writes one. */
export function dimensionText(c: Dimension, units: DisplayUnits = 'mm'): string {
  const ruled = c.expr ? 'ƒ ' : ''
  const n = c.kind === 'angle' ? `${Number(c.value.toFixed(2))}°` : bareLength(c.value, units)
  const text = c.kind === 'radius' ? `${ruled}R ${n}` : c.kind === 'diameter' ? `${ruled}Ø ${n}` : c.kind === 'arcLength' ? `${ruled}⌒ ${n}` : `${ruled}${n}`
  return c.driven ? `(${text})` : text
}

/** The text the label's field opens with: the expression where one drives
 *  the number; in inches a length's number in inches — undefined where the
 *  sheet's own rounding of the held number is what is shown. */
export function dimensionFieldText(c: Dimension, units: DisplayUnits = 'mm'): string | undefined {
  if (c.expr) return c.expr
  if (units === 'mm' || dimensionKind(c.kind) !== 'length') return undefined
  return bareLength(c.value, units)
}
