// SPDX-License-Identifier: AGPL-3.0-only
// Thicken and Offset on a converted freeform (F2 of audit-2026-11-07/
// FREEFORM_ROADMAP.md): an open box cage's sheet and a closed cube cage's
// solid, each offset and thickened; an offset measured by how far its
// points lie from the surface it came from; the walls checked against the
// solids the offsets make; a distance a face bends too tight for refused;
// and the STEP file read back.
import { describe, expect, it, vi } from 'vitest'
import type { Vec3 } from '../../../src/core/types'
import type { Cage } from '../core/freeform/cage'
import { type PatchSet, patchesBody } from '../core/freeform/convert'
import { displacedAlongNormals } from '../core/freeform/limit'
import { cagePatches } from '../core/freeform/patches'
import { freeformShell } from '../core/freeform/shell'
import { ReKernel } from '../core/kernel'

vi.setConfig({ testTimeout: 120_000 })

const kernelPromise = ReKernel.load()
const STEPS = 3

const cage = (v: Vec3[], f: number[][]): Cage => ({ positions: Float64Array.from(v.flat()), faces: f, creases: [] })

/** A cube of side 20 whose faces wind outward; without its top, an open box. */
const cube = (open: boolean): Cage =>
  cage(
    [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]].map((p) => p.map((x) => x * 20) as Vec3),
    [[0, 3, 2, 1], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], ...(open ? [] : [[4, 5, 6, 7]])],
  )

/** The cage's patches with the surface moved `d` mm along its normals. */
function moved(c: Cage, d: number): PatchSet {
  const p = cagePatches(c, STEPS, (fine, limit) => displacedAlongNormals(limit, fine.faces, d))
  return { grids: p.grids, closed: p.closed, blocks: p.blocks.map((b) => ({ rows: b.rows, cols: b.cols, faces: b.faces })) }
}

/** The offset's points lie at the distance: on average within 5 µm of it, and nowhere further than 0.05 mm
 *  (the worst is at a cube corner's extraordinary vertex). */
function expectOffset(dev: { points: number; min: number; max: number; rms: number } | undefined, d: number) {
  expect(dev).toBeDefined()
  expect(dev!.points).toBeGreaterThan(300)
  expect(Math.abs(dev!.rms - d)).toBeLessThan(5e-3)
  expect(dev!.min).toBeGreaterThan(d - 0.05)
  expect(dev!.max).toBeLessThan(d + 0.05)
}

async function body(open: boolean) {
  const k = await kernelPromise
  const c = cube(open)
  const made = patchesBody(k, cagePatches(c, STEPS))
  return { k, c, ...made }
}

describe('offset', () => {
  it('moves a sheet by the distance everywhere, along its normal: outward grows the box', async () => {
    const { k, c, shape, report } = await body(true)
    try {
      for (const d of [1, -1]) {
        const r = freeformShell(k, shape, false, { kind: 'offset', distance: d, patches: moved(c, d) })
        try {
          expect(r.report).toMatchObject({ kind: 'offset', solid: false, valid: true, volume: null })
          expectOffset(r.report.deviation, 1)
          expect(d > 0 ? r.report.area > report.area : r.report.area < report.area).toBe(true)
        } finally {
          k.release(r.shape)
        }
      }
    } finally {
      k.release(shape)
    }
  })

  it('grows and shrinks a closed cage’s solid, every point of it at the distance from the solid’s skin', async () => {
    const { k, c, shape, report } = await body(false)
    try {
      const out = freeformShell(k, shape, true, { kind: 'offset', distance: 1, patches: moved(c, 1) })
      const inn = freeformShell(k, shape, true, { kind: 'offset', distance: -1, patches: moved(c, -1) })
      try {
        expect(out.report).toMatchObject({ solid: true, valid: true })
        expect(inn.report).toMatchObject({ solid: true, valid: true })
        expect(out.report.volume!).toBeGreaterThan(report.volume!)
        expect(inn.report.volume!).toBeLessThan(report.volume!)
        expectOffset(out.report.deviation, 1)
        expectOffset(inn.report.deviation, 1)
      } finally {
        k.release(out.shape, inn.shape)
      }
    } finally {
      k.release(shape)
    }
  })

  it('writes the offset as a STEP file that reads back whole', async () => {
    const sheet = await body(true)
    const solid = await body(false)
    const k = sheet.k
    const r = freeformShell(k, sheet.shape, false, { kind: 'offset', distance: 1, patches: moved(sheet.c, 1) })
    const s = freeformShell(k, solid.shape, true, { kind: 'offset', distance: -1, patches: moved(solid.c, -1) })
    try {
      for (const [made, open] of [[r.shape, true], [s.shape, false]] as const) {
        const out = k.exportStepMended([made], [{ name: 'Offset' }], [open])
        const check = out.check ?? k.verifyStep(out.text, [made], { sheets: [open] })
        expect(check.ok).toBe(true)
        expect(check.bodies[0]).toMatchObject({ valid: true, freeEdgeCount: 0, closed: !open })
      }
    } finally {
      k.release(r.shape, s.shape, sheet.shape, solid.shape)
    }
  })

  it('refuses a distance a face bends too tight for, naming what it does take', async () => {
    const { k, c, shape } = await body(true)
    try {
      expect(() => freeformShell(k, shape, false, { kind: 'offset', distance: 40, patches: moved(c, 40) })).toThrow(/does not offset by 40 mm: a face of it bends tighter/)
      expect(() => freeformShell(k, shape, false, { kind: 'offset', distance: 0, patches: moved(c, 0) })).toThrow(/needs a distance/)
    } finally {
      k.release(shape)
    }
  })
})

describe('thicken', () => {
  it('makes a sheet a closed solid of its thickness: outward, inward and half each way', async () => {
    const { k, shape, report } = await body(true)
    try {
      const volumes: Record<string, number> = {}
      for (const side of ['out', 'in', 'both'] as const) {
        const r = freeformShell(k, shape, false, { kind: 'thicken', thickness: 1, side, direction: 'auto' })
        try {
          expect(r.report).toMatchObject({ kind: 'thicken', solid: true, valid: true, side })
          expect(r.report.wall!).toBeGreaterThan(0.99)
          // A wall of 1 mm over the sheet's area, give or take its curvature.
          expect(r.report.volume! / report.area).toBeGreaterThan(0.8)
          expect(r.report.volume! / report.area).toBeLessThan(1.25)
          volumes[side] = r.report.volume!
        } finally {
          k.release(r.shape)
        }
      }
      // Out is the bigger side of the box (it is convex); both lies between.
      expect(volumes.out).toBeGreaterThan(volumes.both)
      expect(volumes.both).toBeGreaterThan(volumes.in)
    } finally {
      k.release(shape)
    }
  })

  it('takes the side whose normal leans to an axis: the box’s floor faces down, so z grows it inward', async () => {
    const { k, shape } = await body(true)
    try {
      const z = freeformShell(k, shape, false, { kind: 'thicken', thickness: 1, side: 'out', direction: 'z' })
      expect(z.report.side).toBe('in')
      k.release(z.shape)
      const same = freeformShell(k, shape, false, { kind: 'thicken', thickness: 1, side: 'out', direction: 'auto' })
      expect(same.report.side).toBe('out')
      k.release(same.shape)
    } finally {
      k.release(shape)
    }
  })

  it('makes a closed cage’s solid a hollow wall between it and its offset, STEP and all', async () => {
    const { k, c, shape, report } = await body(false)
    const big = patchesBody(k, moved(c, 1))
    const small = patchesBody(k, moved(c, -1))
    const out = freeformShell(k, shape, true, { kind: 'thicken', thickness: 1, side: 'out', direction: 'auto', walls: { outer: moved(c, 1) } })
    const inn = freeformShell(k, shape, true, { kind: 'thicken', thickness: 1, side: 'in', direction: 'auto', walls: { inner: moved(c, -1) } })
    const both = freeformShell(k, shape, true, { kind: 'thicken', thickness: 1, side: 'both', direction: 'auto', walls: { outer: moved(c, 0.5), inner: moved(c, -0.5) } })
    try {
      for (const r of [out, inn, both]) expect(r.report).toMatchObject({ solid: true, valid: true })
      expect(Math.abs(out.report.volume! - (big.report.volume! - report.volume!))).toBeLessThan(1e-3 * report.volume!)
      expect(Math.abs(inn.report.volume! - (report.volume! - small.report.volume!))).toBeLessThan(1e-3 * report.volume!)
      // The wall is bigger the further out it lies (the solid is convex): out > both > in.
      expect(out.report.volume!).toBeGreaterThan(both.report.volume!)
      expect(both.report.volume!).toBeGreaterThan(inn.report.volume!)
      const step = k.exportStepMended([out.shape], [{ name: 'Wall' }], [false])
      const check = step.check ?? k.verifyStep(step.text, [out.shape], { sheets: [false] })
      expect(check.ok).toBe(true)
      expect(check.bodies[0]).toMatchObject({ closed: true, valid: true, freeEdgeCount: 0 })
    } finally {
      k.release(big.shape, small.shape, out.shape, inn.shape, both.shape, shape)
    }
  })

  it('refuses a thickness a face bends too tight for', async () => {
    const { k, shape } = await body(true)
    try {
      expect(() => freeformShell(k, shape, false, { kind: 'thicken', thickness: 40, side: 'out', direction: 'auto' })).toThrow(/does not thicken by 40 mm: a face of it bends tighter/)
      expect(() => freeformShell(k, shape, false, { kind: 'thicken', thickness: 0, side: 'out', direction: 'auto' })).toThrow(/must be positive/)
    } finally {
      k.release(shape)
    }
  })

  it('keeps the thickened sheet whole in the kernel, its STEP file a closed solid with the volume nearly right', async () => {
    const { k, shape } = await body(true)
    const r = freeformShell(k, shape, false, { kind: 'thicken', thickness: 1, side: 'out', direction: 'auto' })
    try {
      const out = k.exportStepMended([r.shape], [{ name: 'Thicken' }], [false])
      const check = out.check ?? k.verifyStep(out.text, [r.shape], { sheets: [false] })
      // The inner skin is the kernel's offset surface, which the file holds
      // within a quarter of a millimetre at the box corners (F2 finding);
      // the file still reads back as a closed valid solid of the same volume to 1 %.
      expect(check.bodies[0]).toMatchObject({ closed: true, valid: true })
      const [was, back] = check.bodies[0].volume
      expect(Math.abs(back - was) / was).toBeLessThan(0.01)
    } finally {
      k.release(r.shape, shape)
    }
  })
})
