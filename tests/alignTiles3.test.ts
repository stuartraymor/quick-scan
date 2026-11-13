// SPDX-License-Identifier: AGPL-3.0-only
// The secondary row of Align by Coordinate System as QUICKSURFACE 8.0.128
// shows it while the primary changes: align sweep 3's tile probes (2026-11-12,
// analysis/quick-scan-v0.0.211/align-sweep3, probe-grey.json g1–g13), run in
// QUICKSURFACE's dialog on src-mix.qsf. Tiles: x Right / X Axis, y Front /
// Y Axis, z Top / Z Axis.
import { describe, expect, it } from 'vitest'
import type { FitData } from '../src/core/types'
import type { Element } from '../src/state/elementModel'
import { alignmentReferences, secondaryGreyedTile, withPrimaryTile, withSlotElement, type AlignDraft } from '../src/state/alignModel'

const FITS: Record<string, FitData> = {"Plane(1)": {"kind": "plane", "center": [13, -7, 22], "normal": [-0.22515407439308363, -0.21437916751141228, 0.9504457982027735], "basisU": [-0.9730691528922385, 0, -0.23051339156235812], "basisV": [0.04941726898337055, -0.9767505170395938, -0.20860575492807332], "extentU": 147.81454291094488, "extentV": 147.81454291094488, "sigma": 0, "usedPoints": 0, "regionSize": 0}, "Plane(2)": {"kind": "plane", "center": [26.019949127380258, -47.03175190176057, 37.097674138632044], "normal": [-0.43963694898414696, 0.8920858005131045, 0.1044139722968352], "basisU": [0.8969888111483816, 0.44205324642469607, 0], "basisV": [-0.04615653542591428, 0.09365816487781826, -0.9945339221912926], "extentU": 147.81454291094488, "extentV": 147.81454291094488, "sigma": 0, "usedPoints": 0, "regionSize": 0}, "Plane(3)": {"kind": "plane", "center": [60.7139938769269, 12.373504830428548, 58.71569281517025], "normal": [0.8702845894131428, 0.39435146967761325, 0.29511294751857964], "basisU": [0.412733646443877, -0.9108517646099944, 0], "basisV": [0.2688041490065549, 0.12180304294214388, -0.9554623740403889], "extentU": 147.81454291094488, "extentV": 147.81454291094488, "sigma": 0, "usedPoints": 0, "regionSize": 0}, "Plane(4)": {"kind": "plane", "center": [-9.148435937154794, 11.232959713192752, 62.951263297178514], "normal": [-0.4140270308805059, 0.26114430178711134, 0.872000728981573], "basisU": [-0.9033470767190331, 0, -0.42891031578079036], "basisV": [-0.11200748494386395, -0.9652997739791107, 0.23590394162122003], "extentU": 147.81454291094488, "extentV": 147.81454291094488, "sigma": 0, "usedPoints": 0, "regionSize": 0}, "Cylinder(1)": {"kind": "cylinder", "center": [21.521852646590702, 5.5354881812071, 47.88898537078292], "axis": [-0.22515407439308363, -0.21437916751141228, 0.9504457982027735], "radius": 8, "length": 40, "coverage": 360, "sigma": 9.960639842689009e-07, "usedPoints": 0, "regionSize": 0}, "Cylinder(2)": {"kind": "cylinder", "center": [14.735313389327828, 12.639060771876672, 58.4049359199282], "axis": [0.866428567925104, 0.4021345228751286, 0.29595500028762184], "radius": 5, "length": 80, "coverage": 360, "sigma": 0.020090711992069438, "usedPoints": 0, "regionSize": 0}, "Cylinder(3)": {"kind": "cylinder", "center": [-21.895434007994716, -14.218995052266449, 33.14768940090491], "axis": [-0.2203069335894974, -0.21622465499105667, 0.9511633685053222], "radius": 6, "length": 40, "coverage": 360, "sigma": 0.011675337693941917, "usedPoints": 0, "regionSize": 0}, "Sphere(1)": {"kind": "sphere", "center": [29.04025875526718, 30.22270601296846, 60.499094224880096], "radius": 10, "sigma": 0.019877644324904343, "usedPoints": 0, "regionSize": 0}, "Sphere(2)": {"kind": "sphere", "center": [2.104282775427272, -34.902905344432554, 23.64657811894443], "radius": 7, "sigma": 0.01145449106535122, "usedPoints": 0, "regionSize": 0}, "Cone(1)": {"kind": "cone", "center": [-19.417613555183156, 18.90522674819235, 49.09737180081392], "axis": [0.22515407439308363, 0.21437916751141228, -0.9504457982027735], "halfAngle": 20, "radius": 8.189330270989553, "radius1": 3.6397023426620234, "radius2": 12.738958199317082, "length": 25, "coverage": 360, "sigma": 0.021365010433136433, "usedPoints": 0, "regionSize": 0}, "Cone(2)": {"kind": "cone", "center": [62.37593365391527, -5.536037104346489, 62.20627671041911], "axis": [-0.0360150211351111, 0.09790363125850743, 0.994544014731895], "halfAngle": 14.999999999999998, "radius": 4.823085463760209, "radius1": 2.1435935394489816, "radius2": 7.502577388071435, "length": 20, "coverage": 360, "sigma": 0.2962713619259457, "usedPoints": 0, "regionSize": 0}} as never
const elements = Object.entries(FITS).map(([name, fit], i) => ({ id: i + 1, kind: fit.kind, name, fit, color: '#888888', status: 'done', visible: true, source: { type: 'picked' } }) as unknown as Element)
const id = (name: string) => alignmentReferences(elements).find((e) => e.name === name)!.id
// The dialog opens on Top, as the panel opens it.
const open = (): AlignDraft => ({ primary: null, primaryPicks: [], primaryPickNormals: [], primaryAxis: 'z+', secondary: null, secondaryPicks: [], secondaryAxis: 'y+', origin: null, originPicks: [], pickSlot: null })
const pick = (ad: AlignDraft, slot: 'primary' | 'secondary', name: string) => withSlotElement(ad, slot, id(name), elements)
const tile = (ad: AlignDraft, axis: AlignDraft['primaryAxis']) => withPrimaryTile(ad, axis, elements)
const row = (ad: AlignDraft) => [ad.secondaryAxis, secondaryGreyedTile(ad)]

describe('the secondary row as the primary changes, as in QUICKSURFACE', () => {
  it('greys the primary’s tile from when the secondary was chosen, and re-defaults from the previous tile (g1)', () => {
    let ad = pick(pick(open(), 'primary', 'Plane(1)'), 'secondary', 'Plane(2)')
    expect(row(ad)).toEqual(['y+', 2]) // Front, Top greyed
    ad = tile(ad, 'x+')
    expect(row(ad)).toEqual(['y+', 2]) // Right: still Front, Top greyed
    ad = tile(ad, 'y+')
    expect(row(ad)).toEqual(['z+', 0]) // Front: the secondary on Top, Right greyed
  })
  it('back to Top from Right puts a plane secondary on Top (g5)', () => {
    const ad = tile(tile(pick(pick(open(), 'primary', 'Plane(1)'), 'secondary', 'Plane(2)'), 'x+'), 'z+')
    expect(row(ad)).toEqual(['z+', 0])
  })
  it('a secondary moved to Right goes back to Front when the primary leaves Top (g6)', () => {
    let ad = pick(pick(open(), 'primary', 'Plane(1)'), 'secondary', 'Plane(2)')
    ad = { ...ad, secondaryAxis: 'x+' }
    expect(row(tile(ad, 'y+'))).toEqual(['y+', 2])
  })
  it('an axis secondary goes back to X Axis (g3, g8)', () => {
    let ad = pick(pick(open(), 'primary', 'Plane(1)'), 'secondary', 'Cylinder(2)')
    expect(row(ad)).toEqual(['x+', 2])
    ad = { ...ad, secondaryAxis: 'y+' }
    expect(row(tile(ad, 'y+'))).toEqual(['x+', 2])
  })
  it('another primary starts on Top, its Flip off; the secondary row stays (g1, g12)', () => {
    let ad = pick(open(), 'primary', 'Plane(1)')
    ad = tile({ ...ad, primaryAxis: 'z-' }, 'x+')
    expect(ad.primaryAxis).toBe('x+')
    ad = pick(ad, 'primary', 'Plane(4)')
    expect(ad.primaryAxis).toBe('z+')
    expect(pick(ad, 'primary', 'Cylinder(2)').primaryAxis).toBe('z+')
  })
  it('keeps the secondary’s Flip when another feature is chosen there (g13)', () => {
    let ad = pick(pick(open(), 'primary', 'Plane(1)'), 'secondary', 'Plane(2)')
    ad = { ...ad, secondaryAxis: 'x-' }
    expect(pick(ad, 'secondary', 'Plane(3)').secondaryAxis).toBe('y-')
  })
  it('starts a plane secondary on Top after a sphere or Origin primary (e6, g7)', () => {
    expect(pick(pick(open(), 'primary', 'Sphere(1)'), 'secondary', 'Plane(1)').secondaryAxis).toBe('z+')
    expect(pick(pick(open(), 'primary', 'Origin'), 'secondary', 'Plane(1)').secondaryAxis).toBe('z+')
  })
})
