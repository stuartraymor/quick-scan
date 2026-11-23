// SPDX-License-Identifier: AGPL-3.0-only
// What the 2D Sketch calls solved is solved (1.2.11), from the constrain
// fuzz's shortest reproductions:
//
// - A distance typed to an arc's end: the solve walked the arc's radius
//   through zero, and writing it back made the radius positive without
//   turning the arc, so its ends landed across the centre — "solved" with
//   the distance 60 mm off, or 535 typed and 497 shown.
// - Symmetric with a coordinate plane picked in hand skipped the guard the
//   panel's Symmetric has, and two lines of a polyline were paired end to
//   end the wrong way round: both shrank to the joint, called solved.
// - An angle of 360°, 200° or −30° was taken without a word and wrapped to
//   some other angle, leaving the sketch unsolved; a negative diameter given
//   with the dimension was taken too.

import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_DRAW_MODES, setCircularDimensioning } from '../core/draw'
import { symmetricPairs } from '../core/mirrorRelation'
import { anchorPoint, entityOf, type Anchor, type SketchLine } from '../core/sketch'
import { useRePrefs } from '../state/rePrefs'
import { useReverse } from '../state/reStore'
import { XY } from './reKit'

type V2 = [number, number]
const s = () => useReverse.getState()
const d = () => s().sketchDraft!
const OFF = { off: true }

beforeEach(() => {
  useReverse.setState({ ...useReverse.getInitialState() }, true)
  useRePrefs.setState({ drawModes: { ...DEFAULT_DRAW_MODES }, polygonSides: 6, gridSnap: false })
  setCircularDimensioning('diameter')
  s().startSketch({ kind: 'world', axis: 'z', offset: 0 }, XY)
})

function draw(tool: string, ...pts: V2[]) {
  s().setSketchTool(tool as never)
  for (const p of pts) s().sketchClick(p, 0.5, false, OFF)
}

const at = (a: Anchor): V2 => anchorPoint(entityOf(d().sketch, a.entity)!, a.at) as V2
const gap = (p: Anchor, q: Anchor) => Math.hypot(at(p)[0] - at(q)[0], at(p)[1] - at(q)[1])

describe('a distance typed to an arc end', () => {
  it('is met where the solve walks the radius through zero', () => {
    draw('arc', [10.132245107368247, 11.634611382545309], [2.7603596544812623, 3.296556193171892], [3.8820799928784933, 8.54918174386838])
    draw('line', [71.5806332915802, -61.066504509931335], [74.43205860291343, -56.60007360211435], [73.69656848164752, -44.615662961075536])
    draw('circle', [7.89292654953897, 68.82661553099751], [26.08427101164125, 68.82661553099751])
    s().setSketchTool('select')
    s().sketchClick([73.95447512961807, -48.818111215598705], 0.5, false)
    s().sketchClick([73.18111233312358, -58.52648554599575], 0.5, true)
    s().addRelation('parallel')
    s().setSketchTool('dimension')
    s().sketchClick([72.99447263119879, -61.418876169466046], 0.5, false)
    s().sketchClick([10.132245107368249, 11.634611382545309], 0.5, false)
    const id = d().selectedConstraint!
    s().setDimensionValue(id, 0.001)
    const c = d().sketch.constraints.find((x) => x.id === id)!
    expect(c).toMatchObject({ kind: 'distance', value: 0.001 })
    if (c.kind !== 'distance' || !('entity' in c.q)) throw new Error('not a point distance')
    expect(d().report?.ok).toBe(true)
    // Before 1.2.11: 62.8 mm.
    expect(Math.abs(gap(c.p, c.q) - 0.001)).toBeLessThan(1e-6)
    const arc = entityOf(d().sketch, 1)!
    expect(arc.kind === 'arc' && arc.r > 0 && arc.sweep > 0).toBe(true)
  })

  it('follows the end it names where the solve walks a sweep negative', () => {
    draw('arc', [-97.57939784909759, 6.3952493276198465], [-89.30467864658672, -2.945386428715665], [-95.76773654873398, 2.99215146371594])
    draw('arc', [81.8473095720761, 3.6701559032393902], [84.61106547807042, 8.289202244950237], [83.5111173562366, 5.334060705928168])
    s().setSketchTool('dimension')
    s().sketchClick([-89.30467864658678, -2.945386428715734], 0.5, false)
    s().sketchClick([84.61106547806989, 8.289202244950294], 0.5, false)
    const id = d().selectedConstraint!
    s().setDimensionValue(id, 151.9121772952325)
    const c = d().sketch.constraints.find((x) => x.id === id)!
    if (c.kind !== 'distance' || !('entity' in c.q)) throw new Error('not a point distance')
    expect(d().report?.ok).toBe(true)
    // Before 1.2.11 the arc came back run from its other end, the
    // dimension still naming the old one: it read 154.10.
    expect(Math.abs(gap(c.p, c.q) - 151.9121772952325)).toBeLessThan(1e-6 * 152)
    for (const e of d().sketch.entities) expect(e.kind === 'arc' && e.sweep > 0 && e.r > 0).toBe(true)
  })

  it('reads what was typed, not 497 for 535', () => {
    draw('arc', [76.81404157487077, -3.9336715198846557], [70.7416246490156, 6.440896429923368], [78.06923760111677, 5.942826026794747])
    draw('rectangle', [-90.29142415290698, 59.860489276914805], [-45.76447422942147, 92.20136480710754])
    s().setSketchTool('dimension')
    s().sketchClick([76.81404157487077, -3.9336715198846575], 0.5, false)
    s().sketchClick([-90.29142415290698, 59.860489276914805], 0.5, false)
    const id = d().sketch.constraints.at(-1)!.id
    s().setDimensionValue(id, 535.1639576742559)
    const c = d().sketch.constraints.find((x) => x.id === id)!
    if (c.kind !== 'distance' || !('entity' in c.q)) throw new Error('not a point distance')
    expect(d().report?.ok).toBe(true)
    expect(Math.abs(gap(c.p, c.q) - 535.1639576742559)).toBeLessThan(1e-6 * 535)
  })
})

describe('Symmetric about a coordinate plane picked in hand', () => {
  const V: V2[] = [[-69.02531542535871, 67.46907087350489], [-63.28861882089492, 75.441914550058], [-51.10367439902034, 75.56144730419531]]

  it('refuses, with the reason and nothing changed, a mirror that lays one line on the other', () => {
    draw('line', ...V)
    // The polyline's second line is drawn level, so it is held Horizontal.
    expect(d().sketch.constraints.some((c) => c.kind === 'horizontal')).toBe(true)
    const kept = JSON.stringify(d().sketch.entities)
    const steps = d().history.length
    s().armRelation('symmetric')
    s().sketchClick([-65.76437154066116, 72.02376975444363], 0.5, false)
    s().sketchClick([-58.49294501342804, 75.4817587726314], 0.5, false)
    s().sketchClick([-32.17225872911513, 0], 0.5, false)
    expect(d().error).toBe('Symmetric was not applied: it would lay line 1 on top of line 2. Nothing was changed.')
    expect(JSON.stringify(d().sketch.entities)).toBe(kept)
    expect(d().history.length).toBe(steps)
    expect(d().sketch.constraints.some((c) => c.kind === 'symmetric')).toBe(false)
  })

  it('mirrors a V of two lines about their joint, which goes onto the plane’s line', () => {
    draw('line', [-20, 50], [0, 70], [20, 52])
    expect(d().sketch.constraints.some((c) => c.kind === 'horizontal' || c.kind === 'vertical')).toBe(false)
    s().armRelation('symmetric')
    s().sketchClick([-10, 60], 0.5, false)
    s().sketchClick([10, 61], 0.5, false)
    // The YZ plane's line in the sheet is x = 0.
    s().sketchClick([0, -30], 0.5, false)
    expect(d().error).toBeNull()
    expect(d().report?.ok).toBe(true)
    const [a, b] = [entityOf(d().sketch, 1) as SketchLine, entityOf(d().sketch, 2) as SketchLine]
    expect(Math.abs(a.b[0])).toBeLessThan(1e-6) // the joint on x = 0
    expect(Math.abs(a.a[0] + b.b[0])).toBeLessThan(1e-6) // far ends mirrored
    expect(Math.abs(a.a[1] - b.b[1])).toBeLessThan(1e-6)
    expect(Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1])).toBeGreaterThan(20)
  })

  it('pairs the joined ends with each other', () => {
    const a = { id: 1, kind: 'line' as const, a: [-20, 50] as V2, b: [0, 70] as V2 }
    const b = { id: 2, kind: 'line' as const, a: [0, 70] as V2, b: [20, 52] as V2 }
    // A centre line far from the V, where pairing by the nearest image
    // could go either way.
    const pairs = symmetricPairs(a, b, { id: 3, kind: 'line', a: [500, 0], b: [500, 1] })
    expect(pairs).toEqual([
      { p: { entity: 1, at: 'a' }, q: { entity: 2, at: 'b' } },
      { p: { entity: 1, at: 'b' }, q: { entity: 2, at: 'a' } },
    ])
  })
})

describe('dimension values out of range', () => {
  function twoLines() {
    draw('line', [0, 0], [30, 0.5])
    s().setSketchTool('line')
    s().sketchClick([0, 10], 0.5, false, OFF)
    s().sketchClick([20, 30], 0.5, false, OFF)
    s().setSketchTool('select')
    s().sketchClick([15, 0.25], 0.5, false)
    s().sketchClick([10, 20], 0.5, true)
  }

  it('refuses an angle between two lines above 180° or below 0°', () => {
    twoLines()
    s().addDimension('angle')
    const id = d().selectedConstraint!
    const kept = JSON.stringify(d().sketch)
    for (const v of [360, 200, -30]) {
      s().setDimensionValue(id, v)
      expect(d().error).toBe('The angle between two lines is from 0° to 180°.')
      expect(JSON.stringify(d().sketch)).toBe(kept)
    }
    s().setDimensionValue(id, 120)
    expect(d().error).toBeNull()
    expect(d().report?.ok).toBe(true)
  })

  it('refuses an angle given with the dimension when it is out of range', () => {
    twoLines()
    const steps = d().history.length
    s().addDimension('angle', -30)
    expect(d().error).toBe('The angle between two lines is from 0° to 180°.')
    expect(d().history.length).toBe(steps)
    expect(d().sketch.constraints.some((c) => c.kind === 'angle')).toBe(false)
  })

  it('refuses a negative diameter given with the dimension', () => {
    draw('circle', [0, 0], [10, 0])
    s().setSketchTool('select')
    s().sketchClick([10, 0], 0.5, false)
    const steps = d().history.length
    s().addDimension('diameter', -48)
    expect(d().error).toBe('A diameter must be above zero.')
    expect(d().history.length).toBe(steps)
  })
})
