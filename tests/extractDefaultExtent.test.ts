// SPDX-License-Identifier: AGPL-3.0-only
// Extract primitives draws a new primitive past the selected patch, carried as
// the stored extension: plane edges by 0.55 × the half extent on that axis,
// cylinder ends by 0.55 × the length, a cone's larger end by 0.55 × the
// length. The numbers are the parent's measurement of QUICKSURFACE's saved
// QSF geometry (plane half extent 10 → 15.5, 20 → 31; cylinder length 20 → 42,
// centred; cone r 5→10, length 20 → 31 from the small end). The fit itself
// stays the measurement.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyExtension,
  defaultExtractExtension,
  EXTRACT_EXTENT_FACTOR,
  isExtendable,
  isExtended,
  type Extension,
} from '../src/core/elements/extend'
import { drawnFit } from '../src/core/elements/assumed'
import { elementFromJson, elementToJson } from '../src/core/project/manifest'
import { useStore } from '../src/state/store'
import type { ConeFit, CylinderFit, FitData, PlaneFit, SphereFit, Vec3 } from '../src/core/types'

const NO_STATS = { sigma: 0.002, usedPoints: 100, regionSize: 120 }
const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9))
const along = (c: Vec3, a: Vec3, t: number): Vec3 => [c[0] + a[0] * t, c[1] + a[1] * t, c[2] + a[2] * t]
/** 0.55 × n is not exact in binary: compare extensions side by side. */
function sameExt(got: Extension | undefined, want: Extension) {
  expect(got?.kind).toBe(want.kind)
  for (const [k, v] of Object.entries(want)) if (k !== 'kind') expect((got as unknown as Record<string, number>)[k]).toBeCloseTo(v as number, 12)
}

const plane = (extentU: number, extentV: number): PlaneFit => ({
  kind: 'plane', center: [5, 5, 0], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0], extentU, extentV, ...NO_STATS,
})
const cylinder = (radius: number, length: number): CylinderFit => ({
  kind: 'cylinder', center: [0, 0, 10], axis: [0, 0, 1], radius, length, coverage: 360, ...NO_STATS,
})
/** r 5 → 10 over 20 mm along +z, centred on the origin: the radius grows with the axis. */
const HALF_ANGLE = (Math.atan(5 / 20) * 180) / Math.PI
const cone: ConeFit = {
  kind: 'cone', center: [0, 0, 0], axis: [0, 0, 1], halfAngle: HALF_ANGLE,
  radius: 7.5, radius1: 5, radius2: 10, length: 20, coverage: 360, ...NO_STATS,
}
/** The same physical cone described with the axis the other way: the larger
 *  end is now `radius1`. Not an observed QUICKSURFACE case — the extension
 *  has to be the same surface either way. */
const reversed: ConeFit = { ...cone, axis: [0, 0, -1], radius1: 10, radius2: 5 }

describe('the default Extract primitives extent', () => {
  it('uses the measured factor', () => {
    expect(EXTRACT_EXTENT_FACTOR).toBe(0.55)
  })

  it('grows a plane on each edge by 0.55 × the half extent of that axis', () => {
    for (const [h, want] of [[10, 15.5], [20, 31]] as const) {
      const fit = plane(h, h / 2)
      const before = JSON.stringify(fit)
      const out = applyExtension(fit, defaultExtractExtension(fit)) as PlaneFit
      expect(out.extentU).toBeCloseTo(want, 12)
      expect(out.extentV).toBeCloseTo(want / 2, 12)
      // Same middle, same frame: QuickScan's own fitted frame is kept.
      close(out.center, fit.center)
      close(out.basisU, fit.basisU)
      close(out.normal, fit.normal)
      expect(JSON.stringify(fit)).toBe(before)
    }
  })

  it('grows a cylinder by 0.55 × its length at each end, centred, whatever the radius', () => {
    for (const r of [10, 20]) {
      const fit = cylinder(r, 20)
      const out = applyExtension(fit, defaultExtractExtension(fit)) as CylinderFit
      expect(out.length).toBeCloseTo(42, 12)
      close(out.center, fit.center)
      expect(out.radius).toBe(r)
      expect(fit.length).toBe(20)
    }
  })

  it('grows a cone at its larger end only, keeping taper, axis and apex', () => {
    const ext = defaultExtractExtension(cone)
    sameExt(ext, { kind: 'cone', start: 0, end: 11 })
    const out = applyExtension(cone, ext) as ConeFit
    expect(out.length).toBeCloseTo(31, 12)
    // The small end stays where it was; the big end moves 11 mm out.
    close(along(out.center, out.axis, -out.length / 2), along(cone.center, cone.axis, -10))
    close(along(out.center, out.axis, out.length / 2), along(cone.center, cone.axis, 21))
    expect(out.radius1).toBeCloseTo(5, 12)
    expect(out.radius2).toBeCloseTo(10 + 11 * 0.25, 12)
    expect(out.radius).toBeCloseTo(7.5 + 5.5 * 0.25, 12)
    expect(out.halfAngle).toBe(cone.halfAngle)
    expect(out.axis).toEqual(cone.axis)
    // The apex — where the radius reaches zero — has not moved.
    close(along(out.center, out.axis, -out.radius / 0.25), along(cone.center, cone.axis, -cone.radius / 0.25))
    expect(cone.length).toBe(20)
  })

  it('treats a cone described with the reversed axis as the same surface', () => {
    const ext = defaultExtractExtension(reversed)
    sameExt(ext, { kind: 'cone', start: 11, end: 0 })
    const a = applyExtension(cone, defaultExtractExtension(cone)) as ConeFit
    const b = applyExtension(reversed, ext) as ConeFit
    expect(b.length).toBeCloseTo(a.length, 12)
    close(b.center, a.center)
    expect(b.radius).toBeCloseTo(a.radius, 12)
    // The ends swap names with the axis.
    expect(b.radius1).toBeCloseTo(a.radius2, 12)
    expect(b.radius2).toBeCloseTo(a.radius1, 12)
    // Large end at z = 21 in both descriptions.
    close(along(b.center, b.axis, -b.length / 2), [0, 0, 21])
  })

  it('never carries a cone past its apex', () => {
    const out = applyExtension(cone, { kind: 'cone', start: 100, end: 0 }) as ConeFit
    expect(out.radius1).toBeCloseTo(0, 9)
    expect(out.radius1).toBeGreaterThanOrEqual(0)
    expect(out.length).toBeCloseTo(40, 9)
    const rev = applyExtension(reversed, { kind: 'cone', start: 0, end: 100 }) as ConeFit
    expect(rev.radius2).toBeCloseTo(0, 9)
    expect(rev.radius2).toBeGreaterThanOrEqual(0)
    expect(rev.length).toBeCloseTo(40, 9)
  })

  it('rejects an inverted cone interval without producing a negative radius', () => {
    expect(applyExtension(cone, { kind: 'cone', start: -100, end: -200 })).toBe(cone)
  })

  it('is a function of the fit alone, so a refit cannot stack it', () => {
    const free = cylinder(10, 20)
    const held = { ...free, length: 18 }
    expect(defaultExtractExtension(free)).toEqual(defaultExtractExtension(free))
    sameExt(defaultExtractExtension(held), { kind: 'cylinder', start: 9.9, end: 9.9 })
    expect((applyExtension(held, defaultExtractExtension(held)) as CylinderFit).length).toBeCloseTo(18 * 2.1, 12)
  })

  it('leaves the kinds with no drawn size alone', () => {
    const sphere: SphereFit = { kind: 'sphere', center: [0, 0, 0], radius: 3, ...NO_STATS }
    expect(defaultExtractExtension(sphere)).toBeUndefined()
    expect(defaultExtractExtension(undefined)).toBeUndefined()
    expect(defaultExtractExtension(plane(0, 1))).toBeUndefined()
  })

  it('gives a cone no grips or fields — only Extract extends one', () => {
    expect(isExtendable(cone)).toBe(false)
    expect(isExtended({ kind: 'cone', start: 0, end: 11 })).toBe(true)
    expect(isExtended({ kind: 'cone', start: 0, end: 0 })).toBe(false)
    // A cone extension on another kind is ignored.
    const fit: FitData = cylinder(10, 20)
    expect(applyExtension(fit, { kind: 'cone', start: 0, end: 11 })).toBe(fit)
  })
})

describe('the default extent in the store and the project', () => {
  const store = () => useStore.getState()
  beforeEach(() => {
    store().beginLoad('test.stl')
    store().finishLoad(0, 0, 100, [0, 0, 0])
  })

  /** What handleExtractType does: fit, then set the default as the draft's extension. */
  function extract(fit: PlaneFit | CylinderFit | ConeFit): number {
    store().startDraft(fit.kind)
    store().setDraftPicks([[1, 2, 3]])
    store().resolveDraft({ ...fit, region: new Uint32Array([1, 2, 3]) })
    const ext = defaultExtractExtension(store().draft!.fit) as Extension
    useStore.setState((s) => (s.draft ? { draft: { ...s.draft, extend: ext } } : {}))
    return store().commitDraft()!
  }

  it('creates each kind with its measured fit and the default carried beside it', () => {
    for (const [fit, size] of [
      [plane(10, 10), (f: FitData) => (f as PlaneFit).extentU],
      [cylinder(10, 20), (f: FitData) => (f as CylinderFit).length],
      [cone, (f: FitData) => (f as ConeFit).length],
    ] as const) {
      const id = extract(fit)
      const el = store().elements.find((e) => e.id === id)!
      expect(size(el.fit!)).toBe(size(fit))
      expect(el.extend?.kind).toBe(fit.kind)
      expect(size(drawnFit(el.fit!, el.assumed, el.extend))).toBeCloseTo(fit.kind === 'plane' ? 15.5 : fit.kind === 'cylinder' ? 42 : 31, 12)
    }
  })

  it('keeps a cone extension through save and load', () => {
    const id = extract(cone)
    const el = store().elements.find((e) => e.id === id)!
    const back = elementFromJson(JSON.parse(JSON.stringify(elementToJson(el))), store().settings)
    expect(back.extend).toEqual(el.extend)
    sameExt(back.extend, { kind: 'cone', start: 0, end: 11 })
    expect((drawnFit(back.fit!, back.assumed, back.extend) as ConeFit).length).toBeCloseTo(31, 12)
  })

  it('does not apply itself to an element that has none — an old project or a hand-made fit', () => {
    store().startDraft('cylinder')
    store().setDraftPicks([[1, 2, 3]])
    store().resolveDraft({ ...cylinder(10, 20), region: new Uint32Array([1, 2, 3]) })
    const id = store().commitDraft()!
    const el = store().elements.find((e) => e.id === id)!
    expect(el.extend).toBeUndefined()
    expect((drawnFit(el.fit!, el.assumed, el.extend) as CylinderFit).length).toBe(20)
    // Re-opened for editing it brings its own (none) — nothing is added.
    store().editElement(id)
    expect(store().draft!.extend).toBeUndefined()
  })

  it('keeps a hand resize made on the Extract preview', () => {
    store().startDraft('plane')
    store().setDraftPicks([[1, 2, 3]])
    store().resolveDraft({ ...plane(10, 10), region: new Uint32Array([1, 2, 3]) })
    useStore.setState((s) => (s.draft ? { draft: { ...s.draft, extend: defaultExtractExtension(s.draft.fit) } } : {}))
    store().setDraftExtend('uMax', 2)
    const id = store().commitDraft()!
    sameExt(store().elements.find((e) => e.id === id)!.extend, { kind: 'plane', uMin: 5.5, uMax: 2, vMin: 5.5, vMax: 5.5 })
  })
})
