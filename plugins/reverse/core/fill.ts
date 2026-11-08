// SPDX-License-Identifier: AGPL-3.0-only
// Fill Surface (F8 of audit-2026-11-07/FREEFORM_ROADMAP.md), the part that
// QUICKSURFACE 8.0.128's Fill Surface does with the default settings: a
// four-sided region whose boundary curves are all picked as Contact (G0) is
// filled with a surface through them and nothing else — not taken onto the
// scan. Measured on its output (analysis/freeform-2026-11-09/): the surface
// it makes on the four curves of the basic_part wall loop is a 43 × 43
// degree-3 B-spline that is, to 0.000 mm, the bilinearly blended Coons patch
// of its own four boundary curves in their own parameter, and lies up to
// 7.7 mm off the scan inside the loop (mean 0.8 mm), so it follows the
// boundary alone. This is that patch, by the share of each side's length:
// the curves' own parameter is not known here, which is where it parts from
// the native one (0.21 mm mean, 0.44 mm at most on the measured loop, all of
// it parameter).

import type { PatchGrid } from './freeform/patches'
import { type SidePath, SketchError } from './freeform/sketch'

/** Samples along a side of the grid the kernel's surface is made through: 41, a patch of 40 × 40 spans, near the native 43 control points a side. */
export const FILL_SAMPLES = 41

/** The fewest and most samples a side may be given. */
export const FILL_SAMPLES_MIN = 5
export const FILL_SAMPLES_MAX = 129

export const FILL_SIDES_REFUSAL = 'Fill Surface fills a region of four sides; three, five and six sides are not filled here (Freeform ▸ From 3D Sketch makes a cage over those).'

/** The Coons patch of a four-sided region's boundary, `samples` × `samples` points: bottom = side 0 and right = side 1 as they run, top = side 2 and left = side 3 run the other way. Rows run along the left side, columns along the bottom. */
export function fillGrid(sides: readonly SidePath[], samples = FILL_SAMPLES): PatchGrid {
  if (sides.length !== 4) throw new SketchError(FILL_SIDES_REFUSAL)
  if (!Number.isInteger(samples) || samples < FILL_SAMPLES_MIN || samples > FILL_SAMPLES_MAX) throw new SketchError(`${samples} samples a side: from ${FILL_SAMPLES_MIN} to ${FILL_SAMPLES_MAX}.`)
  const m = samples - 1
  const bottom = (s: number) => sides[0].at(s)
  const right = (s: number) => sides[1].at(s)
  const top = (s: number) => sides[2].at(1 - s)
  const left = (s: number) => sides[3].at(1 - s)
  const c00 = bottom(0)
  const c10 = bottom(1)
  const c01 = top(0)
  const c11 = top(1)
  const points = new Float64Array(samples * samples * 3)
  for (let j = 0; j <= m; j++) {
    const v = j / m
    for (let i = 0; i <= m; i++) {
      const u = i / m
      const o = (j * samples + i) * 3
      // The boundary is the sides themselves, the corners shared: the patch holds the curves to the last digit.
      if (j === 0) points.set(bottom(u), o)
      else if (j === m) points.set(top(u), o)
      else if (i === 0) points.set(left(v), o)
      else if (i === m) points.set(right(v), o)
      else {
        const b = bottom(u)
        const t = top(u)
        const l = left(v)
        const r = right(v)
        for (let k = 0; k < 3; k++) points[o + k] = (1 - v) * b[k] + v * t[k] + (1 - u) * l[k] + u * r[k] - ((1 - u) * (1 - v) * c00[k] + u * (1 - v) * c10[k] + (1 - u) * v * c01[k] + u * v * c11[k])
      }
    }
  }
  return { points, rows: samples, cols: samples, faces: [] }
}
