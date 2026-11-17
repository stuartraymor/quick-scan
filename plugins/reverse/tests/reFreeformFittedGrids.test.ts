// SPDX-License-Identifier: AGPL-3.0-only
// An edit to a cage changes one or two of its blocks; the faces of the
// others are taken from the last build instead of fitted again, and the body
// is the same as one built from nothing. The warm-up run when the editor
// opens builds and lets go of everything it made.
import { describe, expect, it } from 'vitest'
import { ReKernel } from '../core/kernel'
import { patchesBody } from '../core/freeform/convert'
import { cagePatches } from '../core/freeform/patches'
import { warmFreeform } from '../core/freeform/warm'
import type { Cage } from '../core/freeform/cage'

/** A strip of quads with creases between them, so each quad is a block. */
function strip(n: number, lift = 0): Cage {
  const positions: number[] = []
  for (let i = 0; i <= n; i++) positions.push(i * 10, 0, 0, i * 10, 10, i === n ? lift : (i % 2) * 2)
  const faces = Array.from({ length: n }, (_, i) => [2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1])
  const creases = Array.from({ length: n - 1 }, (_, i) => [2 * i + 2, 2 * i + 3] as [number, number])
  return { positions: Float64Array.from(positions), faces, creases }
}

function counting(k: ReKernel) {
  let fits = 0
  const real = k.surfaceThrough.bind(k)
  k.surfaceThrough = ((...a: Parameters<ReKernel['surfaceThrough']>) => { fits++; return real(...a) }) as ReKernel['surfaceThrough']
  return () => fits
}

describe('fitted grids reused between builds', () => {
  it('refits only the blocks an edit changed, and makes the same body', async () => {
    const k = await ReKernel.load()
    const fits = counting(k)
    const a = cagePatches(strip(5), 2)
    expect(a.grids.length).toBeGreaterThan(1)
    const first = patchesBody(k, a)
    const firstFits = fits()
    // The same cage again: nothing fitted.
    const again = patchesBody(k, cagePatches(strip(5), 2))
    expect(fits()).toBe(firstFits)
    expect(again.report).toEqual(first.report)
    // The last point lifted: only the blocks it reaches are fitted.
    const b = cagePatches(strip(5, 3), 2)
    const changed = b.grids.filter((g, i) => g.points.length !== a.grids[i].points.length || g.points.some((v, j) => v !== a.grids[i].points[j])).length
    expect(changed).toBeGreaterThan(0)
    expect(changed).toBeLessThan(b.grids.length)
    const edited = patchesBody(k, b)
    expect(fits() - firstFits).toBe(changed)
    // A fresh kernel, nothing cached: the same body.
    const fresh = await ReKernel.load()
    const reference = patchesBody(fresh, b)
    expect(edited.report.faces).toBe(reference.report.faces)
    expect(edited.report.valid).toBe(true)
    expect(edited.report.area).toBeCloseTo(reference.report.area, 9)
    k.release(first.shape, again.shape, edited.shape)
    fresh.release(reference.shape)
  })

  it('the shapes a build hands back stay valid after the cache lets faces go', async () => {
    const k = await ReKernel.load()
    const kept = patchesBody(k, cagePatches(strip(4), 2))
    // Many different cages: the cache trims its oldest grids.
    for (let i = 1; i <= 80; i++) k.release(patchesBody(k, cagePatches(strip(4, i * 0.1), 2)).shape)
    expect(k.isValid(kept.shape)).toBe(true)
    expect(k.surfaceArea(kept.shape)).toBeCloseTo(kept.report.area, 6)
    k.release(kept.shape)
  })
})

describe('freeform warm-up', () => {
  it('runs the freeform build calls once and reports its time', async () => {
    const k = await ReKernel.load()
    const ms = warmFreeform(k)
    expect(ms).toBeGreaterThanOrEqual(0)
  })
})
