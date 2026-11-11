// SPDX-License-Identifier: AGPL-3.0-only
// The tertiary row of Align by Coordinate System against QUICKSURFACE 8.0.128
// (2026-11-11, analysis/quick-scan-v0.0.208/tertiary-native): the controlled
// fixtures' planes and cylinders were aligned in QUICKSURFACE with each
// tertiary tile, with and without Flip, applied, saved, and the transform
// read back from the saved mesh (worst residual under 1e-5 mm).
import { describe, expect, it } from 'vitest'
import { computeDatumAlignment, type AxisDir } from '../src/core/alignment'
import { alignmentPreview, chosenTertiaryTile, tertiaryTiles, tertiaryTurnAxis, type AlignDraft } from '../src/state/alignModel'
import type { Element } from '../src/state/elementModel'
import type { FitData, Vec3 } from '../src/core/types'

const rad = (d: number) => (d * Math.PI) / 180
const stats = { sigma: 0, usedPoints: 0, regionSize: 0 }
const plane = (normal: Vec3, center: Vec3): FitData =>
  ({ ...stats, kind: 'plane', normal, center, basisU: [1, 0, 0], basisV: [0, 1, 0], extentU: 35, extentV: 35 }) as unknown as FitData
const cylinder = (axis: Vec3, center: Vec3): FitData =>
  ({ ...stats, kind: 'cylinder', axis, center, radius: 5, length: 20 }) as unknown as FitData
const point = (center: Vec3): FitData => ({ ...stats, kind: 'point', center }) as unknown as FitData

// make-fixtures.py (alignment-review-2026-11-10): Plane(1) the cap at z = 5,
// Plane(2) a wall tilted 3° about X, Cylinder(1) standing on Z through
// (10, 20), Cylinder(2) lying 5° off X.
const P1 = plane([0, 0, 1], [10, 20, 5])
const P2 = plane([0, Math.cos(rad(3)), Math.sin(rad(3))], [10, 7 - 20 * Math.tan(rad(3)), 25])
const P3 = plane([Math.cos(rad(5)), 0, Math.sin(rad(5))], [3 - 15 * Math.tan(rad(5)), 8, 20])
const C1 = cylinder([0, 0, 1], [10, 20, 10])
const a2: Vec3 = [Math.cos(rad(5)), 0, Math.sin(rad(5))]
const C2 = cylinder(a2, [10 + 20 * a2[0], 20, 5 + 20 * a2[2]])
const ORIGIN = point([0, 0, 0])

const on = (t: ReturnType<typeof tertiaryTiles>) => t.enabled
const align = (p: FitData, pAxis: AxisDir, s: FitData, sAxis: AxisDir, t: FitData, tile?: AxisDir, flip = false) => {
  const tiles = tertiaryTiles(p, s, t, pAxis)
  const turn = tertiaryTurnAxis({ tertiaryAxis: tile, tertiaryFlip: flip }, tiles)
  return computeDatumAlignment({ fit: p, axis: pAxis }, { fit: s, axis: sAxis }, t, null, turn)
}
const near = (got: { r: ArrayLike<number>; t: ArrayLike<number> }, r: number[][], t: number[]) => {
  expect(Array.from(got.r).map((v) => Math.round(v * 1e6) / 1e6 + 0)).toEqual(r.flat())
  expect(Array.from(got.t).map((v) => Math.round(v * 1e4) / 1e4 + 0)).toEqual(t)
}

describe('the tertiary row, as QUICKSURFACE shows it', () => {
  it('greys the tiles without a secondary, and has none for a point', () => {
    const t = tertiaryTiles(P1, null, P3, 'z+')
    expect([t.kind, on(t), t.clocks]).toEqual(['plane', [false, false, false], false])
    expect(chosenTertiaryTile({}, t)).toBeNull()
    expect(tertiaryTiles(C1, null, P2, 'z+').enabled).toEqual([false, false, false])
    expect(tertiaryTiles(P1, P2, ORIGIN, 'z+').kind).toBeNull()
  })
  it('keeps a plane’s tiles available after a secondary that turns the part, Top chosen, and greys an axis’s', () => {
    const t = tertiaryTiles(P1, P2, P3, 'z+')
    expect([t.kind, on(t), t.clocks, chosenTertiaryTile({}, t)]).toEqual(['plane', [true, true, true], false, 'z+'])
    const c = tertiaryTiles(P1, P2, C2, 'z+')
    expect([c.kind, on(c), chosenTertiaryTile({}, c)]).toEqual(['axis', [false, false, false], null])
  })
  it('turns the part when the secondary runs the primary’s way: Right first, the primary’s axis greyed', () => {
    const t = tertiaryTiles(C1, P1, P2, 'z+')
    expect([t.kind, on(t), t.clocks, chosenTertiaryTile({}, t)]).toEqual(['plane', [true, true, false], true, 'x+'])
    const c = tertiaryTiles(C1, P1, C2, 'z+')
    expect([c.kind, on(c), c.clocks, chosenTertiaryTile({}, c)]).toEqual(['axis', [true, true, false], true, 'x+'])
  })
})

describe('what the tertiary tiles and Flip do, against QUICKSURFACE’s saved results', () => {
  // Cylinder(1) Z Axis, Plane(1) Top (its own axis), Plane(2) tertiary.
  it('Right puts the side plane’s normal on +X', () => near(align(C1, 'z+', P1, 'z+', P2), [[0, 1, 0], [-1, 0, 0], [0, 0, 1]], [-20, 10, -5]))
  it('Right with Flip on −X', () => near(align(C1, 'z+', P1, 'z+', P2, 'x+', true), [[0, -1, 0], [1, 0, 0], [0, 0, 1]], [20, -10, -5]))
  it('Front on +Y', () => near(align(C1, 'z+', P1, 'z+', P2, 'y+'), [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [-10, -20, -5]))
  it('Front with Flip on −Y', () => near(align(C1, 'z+', P1, 'z+', P2, 'y+', true), [[-1, 0, 0], [0, -1, 0], [0, 0, 1]], [10, 20, -5]))
  it('an axis tertiary on X Axis', () => near(align(C1, 'z+', P1, 'z+', C2), [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [-10, -20, -5]))
  it('changes nothing after a secondary that turns the part (three planes, Right and Flip)', () =>
    near(align(P1, 'z+', P2, 'y+', P3, 'x+', true), [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [-3, -7, -5]))
})

describe('a tertiary with no secondary, as QUICKSURFACE takes it', () => {
  const els = [P1, P3, C1, P2, ORIGIN].map((fit, i) => ({ id: i + 1, kind: (fit as { kind: string }).kind, name: `F${i + 1}`, color: '#888888', status: 'done', visible: true, source: { type: 'picked' }, fit })) as unknown as Element[]
  const draft = (primary: number, origin: number | null, primaryAxis: AxisDir = 'z+'): AlignDraft => ({
    primary, primaryPicks: [], primaryPickNormals: [], primaryAxis, secondary: null, secondaryPicks: [], secondaryAxis: 'x+',
    origin, originPicks: [], pickSlot: null, tertiaryFlip: true,
  })
  const t = (ad: AlignDraft) => Array.from(alignmentPreview(ad, els, 100, null).preview!.rigid.t).map((v) => Math.round(v * 1e4) / 1e4 + 0)
  // p13, c2 and c5: the part lands on the primary alone, Flip and all.
  it('ignores a plane tertiary after a plane primary', () => expect(t(draft(1, 2))).toEqual(t(draft(1, null))))
  it('ignores a plane tertiary after a cylinder primary', () => expect(t(draft(3, 4))).toEqual(t(draft(3, null))))
  it('ignores a point tertiary', () => expect(t(draft(1, 5))).toEqual(t(draft(1, null))))
  it('still moves the zero point with no primary', () => expect(t({ ...draft(1, 5), primary: null })).toEqual([0, 0, 0]))
})
