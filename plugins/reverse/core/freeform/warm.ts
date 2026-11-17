// SPDX-License-Identifier: AGPL-3.0-only
// The freeform build's kernel calls run once on a small curved cage when the
// New Freeform editor opens. A browser compiles the kernel's WebAssembly
// function by function as each is first called, and optimises the busy ones
// later; untouched, the first edit pays for all of that (about twice the time
// of the edits after it). Nothing is kept and nothing is said: a warm-up that
// fails leaves the first edit as it was.

import type { ReKernel, Shape } from '../kernel'
import { meshDeflection, diagonalOf } from '../buildTypes'
import { freeformBody } from './make'

/** A 3 × 3 cage of quads, bowed so its blocks are true B-spline faces. */
function warmCage() {
  const positions: number[] = []
  for (let j = 0; j <= 3; j++) for (let i = 0; i <= 3; i++) positions.push(i * 10, j * 10, ((i - 1.5) ** 2 + (j - 1.5) ** 2) * 0.8)
  const faces: number[][] = []
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) faces.push([j * 4 + i, j * 4 + i + 1, (j + 1) * 4 + i + 1, (j + 1) * 4 + i])
  return { positions: Float64Array.from(positions), faces, creases: [] as [number, number][] }
}

/** Milliseconds the warm-up took; -1 when it could not run. */
export function warmFreeform(k: ReKernel): number {
  const began = performance.now()
  let shape: Shape | undefined
  try {
    shape = freeformBody(k, warmCage(), { steps: 2, snap: false }).shape
    const deflection = meshDeflection(diagonalOf(k, shape))
    const areas = new Map<number, number>()
    k.mesh(shape, deflection, 0.15, areas)
    k.faces(shape, areas)
    k.edges(shape, deflection, true)
    k.isValid(shape)
    return performance.now() - began
  } catch {
    return -1
  } finally {
    if (shape !== undefined) k.release(shape)
  }
}
