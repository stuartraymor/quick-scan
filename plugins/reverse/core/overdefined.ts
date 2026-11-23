// SPDX-License-Identifier: AGPL-3.0-only
// The relations and dimensions that overdefine a sketch: what QUICKSURFACE's
// "Select overdefining constraints" finds and offers to delete. A sketch that
// does not solve leaves several equations a little off — the solver spreads
// the contradiction — so the unmet list alone names too many. What overdefines
// it is the smallest late set whose removal lets everything else be met: the
// newest are tried first, since the sketch solved before they were added, and
// any taken out that turn out not to matter are put back.

import { cloneSketch, removeConstraint, type Sketch } from './sketch'
import { solveSketch, type SolveOptions } from './solver'

/** The ids of the constraints that overdefine `sketch`, newest first — empty
 *  when it solves. The sketch is not changed. */
export function overdefiningConstraints(sketch: Sketch, options: SolveOptions = {}): number[] {
  const solve = (without: readonly number[]) => {
    const copy = cloneSketch(sketch)
    for (const id of without) removeConstraint(copy, id)
    return solveSketch(copy, { datums: options.datums })
  }
  let report = solve([])
  if (report.ok) return []
  const out: number[] = []
  // Each round takes out the newest constraint still unmet.
  for (let round = 0; round < 12 && !report.ok; round++) {
    const next = report.unmet
      .map((u) => u.id)
      .filter((id) => id >= 0 && !out.includes(id))
      .sort((a, b) => b - a)[0]
    if (next === undefined) break
    out.push(next)
    report = solve(out)
  }
  if (!report.ok) return out
  // Put back whatever was not needed out.
  for (const id of [...out]) {
    if (out.length === 1) break
    const rest = out.filter((x) => x !== id)
    if (solve(rest).ok) out.splice(out.indexOf(id), 1)
  }
  return out
}
