// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.26: "Select other" where pieces or points lie on top of each other
// (the brief's selection cycling, test C16), the circle and arc right-click
// menu (Part 8.8), and the panel's "Selected only" list.

import { beforeEach, describe, expect, it } from 'vitest'
import { addEntity, emptySketch, type Sketch } from '../core/sketch'
import { picksAt, pickLabel, samePick, type PickMode } from '../core/pickOther'
import type { PickAllow } from '../core/draw'
import { useReverse } from '../state/reStore'
import { useSketchPresentation } from '../state/sketchPresentation'
import { pickModeOf, roundItems } from '../ui/SketchPieceMenu'

const ALL: PickAllow = { endpoint: true, midpoint: false, center: true, quadrant: false, curve: true }
const labels = (s: Sketch, spot: [number, number], mode: PickMode, allow = ALL) => picksAt(s, spot, 1, [], mode, allow).map((c) => c.label)

function rings() {
  const s = emptySketch()
  const a = addEntity(s, { kind: 'circle', c: [0, 0], r: 10 })
  const b = addEntity(s, { kind: 'circle', c: [0, 0], r: 5 })
  return { s, a, b }
}

describe('everything a click at one spot could take', () => {
  it('two concentric circles: at their one centre the arrow is offered both', () => {
    const { s, a, b } = rings()
    const got = labels(s, [0.1, 0], 'select')
    expect(got).toHaveLength(2)
    expect(got).toEqual(expect.arrayContaining([`Circle ${a}`, `Circle ${b}`]))
  })

  it('and Coincident both centres, as points', () => {
    const { s, a, b } = rings()
    expect(labels(s, [0, 0.1], 'coincident')).toEqual(expect.arrayContaining([`Centre of circle ${a}`, `Centre of circle ${b}`]))
  })

  it('the Dimension tool offers centres only with the snap bar\'s Centre on', () => {
    const { s } = rings()
    expect(labels(s, [0, 0.1], 'dimension')).toHaveLength(2)
    expect(labels(s, [0, 0.1], 'dimension', { ...ALL, center: false })).toHaveLength(0)
  })

  it('filters coincident centers and whole curves separately, including Select Other', () => {
    const { s } = rings()
    expect(labels(s, [0, 0.1], 'coincident', { ...ALL, center: false })).toEqual([])
    expect(labels(s, [10, 0.1], 'coincident', { ...ALL, curve: false })).toEqual([])
  })

  it('lists each enabled midpoint at an overlap, across the full pick radius', () => {
    const s = emptySketch()
    for (const length of [10, 20]) addEntity(s, { kind: 'line', a: [-length, 0], b: [length, 0] })
    const allow = { ...ALL, midpoint: true, curve: false }
    for (const mode of ['coincident', 'dimension'] as const)
      expect(labels(s, [0, 0.9], mode, allow).sort()).toEqual(['Middle of line 1', 'Middle of line 2'])
  })

  it('offers both the named quadrant and the whole rim when both are enabled for Coincident', () => {
    const { s, a } = rings()
    expect(labels(s, [10, 0.1], 'coincident', { ...ALL, quadrant: true })).toEqual([
      `Quadrant point of circle ${a}`, `Circle ${a}`
    ])
  })

  it('the one a plain click takes is listed first', () => {
    const s = emptySketch()
    const c = addEntity(s, { kind: 'circle', c: [0, 0], r: 10 })
    const l = addEntity(s, { kind: 'line', a: [10, 0], b: [20, 0] })
    // The line's start lies on the circle's rim: Coincident takes the end.
    const got = picksAt(s, [10.1, 0.05], 1, [], 'coincident', ALL)
    expect(got[0].label).toBe(`Start of line ${l}`)
    expect(got.map((g) => g.label)).toEqual(expect.arrayContaining([`Circle ${c}`, `Line ${l}`]))
    // The arrow takes whole pieces: the nearest of the two first.
    const arrow = picksAt(s, [10.1, 0.05], 1, [], 'select', ALL)
    expect(arrow.map((g) => g.piece).sort()).toEqual([c, l].sort())
  })

  it('a piece alone is one choice: nothing to choose between', () => {
    const s = emptySketch()
    addEntity(s, { kind: 'line', a: [0, 0], b: [20, 0] })
    expect(labels(s, [10, 0.2], 'select')).toHaveLength(1)
    expect(labels(s, [10, 5], 'select')).toHaveLength(0)
  })

  it('names what it lists as the relation rows do', () => {
    const { s, a } = rings()
    expect(pickLabel(s, { kind: 'piece', id: a })).toBe(`Circle ${a}`)
    expect(pickLabel(s, { kind: 'point', anchor: { entity: a, at: 'center' } })).toBe(`Centre of circle ${a}`)
    expect(pickLabel(s, { kind: 'origin', planes: ['xy', 'yz'] })).toBe('Origin')
    expect(samePick({ kind: 'piece', id: a, via: { entity: a, at: 'q0' } }, { kind: 'piece', id: a })).toBe(true)
  })
})

describe('the click takes the choice', () => {
  const frame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] } as never
  const open = () => {
    useReverse.getState().reset()
    useReverse.getState().startSketch({ kind: 'coordinate', plane: 'xy' } as never, frame, [
      { kind: 'circle', c: [0, 0], r: 10 },
      { kind: 'circle', c: [0, 0], r: 5 },
      { kind: 'line', a: [30, 0], b: [40, 0] },
    ])
  }
  const draft = () => useReverse.getState().sketchDraft!
  const ids = () => draft().sketch.entities.map((e) => e.id)
  beforeEach(open)

  it('the arrow selects the piece chosen, not the nearest', () => {
    const [, small] = ids()
    useReverse.getState().setSketchTool('select')
    useReverse.getState().sketchClick([0, 0], 1, false, { prefer: { kind: 'piece', id: small } })
    expect(draft().selection).toEqual([small])
  })

  it('Coincident takes the chosen centre of two that lie on one another', () => {
    const [big, small, line] = ids()
    useReverse.getState().armRelation('coincident')
    useReverse.getState().sketchClick([0, 0], 1, false, { prefer: { kind: 'point', anchor: { entity: small, at: 'center' } } })
    expect(draft().relPicks).toEqual([{ kind: 'point', anchor: { entity: small, at: 'center' } }])
    useReverse.getState().sketchClick([30, 0], 1, false, {})
    const made = draft().sketch.constraints.find((c) => c.kind === 'coincident')
    expect(made).toMatchObject({ p: { entity: small, at: 'center' }, q: { entity: line, at: 'a' } })
    // The first pick stays: the line's end came to the shared centre.
    expect(draft().sketch.entities.find((e) => e.id === big)).toMatchObject({ c: [0, 0] })
  })

  it('the Dimension tool takes the chosen piece', () => {
    const [, small] = ids()
    useReverse.getState().setSketchTool('dimension')
    useReverse.getState().sketchClick([0, 0], 1, false, { prefer: { kind: 'piece', id: small } })
    const held = draft().dimMade
    const c = draft().sketch.constraints.find((x) => x.id === held)
    expect(c && 'entity' in c ? c.entity : null).toBe(small)
  })

  it('the tool in hand decides what the menu offers', () => {
    useReverse.getState().setSketchTool('select')
    expect(pickModeOf(draft())).toBe('select')
    useReverse.getState().armRelation('concentric')
    expect(pickModeOf(draft())).toBe('concentric')
    useReverse.getState().setSketchTool('line')
    expect(pickModeOf(draft())).toBeNull()
  })
})

describe('the circle and arc menu', () => {
  const frame = { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1] } as never
  const open = (pieces: Parameters<ReturnType<typeof useReverse.getState>['startSketch']>[2]) => {
    useReverse.getState().reset()
    useReverse.getState().startSketch({ kind: 'coordinate', plane: 'xy' } as never, frame, pieces)
    useReverse.getState().setSketchTool('select')
  }
  const draft = () => useReverse.getState().sketchDraft!
  const item = (id: number, test: string) => roundItems(draft(), id, [10, 0], 1).find((i) => i.test === test)!
  beforeEach(() => useSketchPresentation.getState().setRelationsOfSelection(false))

  it('offers what the brief lists, in its order', () => {
    open([{ kind: 'circle', c: [0, 0], r: 10 }])
    const [id] = draft().sketch.entities.map((e) => e.id)
    expect(roundItems(draft(), id, [10, 0], 1).map((i) => i.label)).toEqual(['Select centrepoint', 'Concentric with…', 'Equal radius with…', 'Fix', 'Dimension diameter', 'Dimension radius', 'View relations'])
  })

  it('greys Concentric and Equal with no other round piece, and a second size dimension', () => {
    open([{ kind: 'circle', c: [0, 0], r: 10 }])
    const [id] = draft().sketch.entities.map((e) => e.id)
    expect(item(id, 'sketch-menu-concentric').enabled).toBe(false)
    expect(item(id, 'sketch-menu-equal').enabled).toBe(false)
    item(id, 'sketch-menu-diameter').run()
    useReverse.getState().putDownDimension()
    useReverse.getState().setSketchTool('select')
    expect(item(id, 'sketch-menu-radius').enabled).toBe(false)
    expect(item(id, 'sketch-menu-radius').title).toMatch(/has a diameter dimension already/)
  })

  it('Concentric with… holds the circle and waits for the other', () => {
    open([{ kind: 'circle', c: [0, 0], r: 10 }, { kind: 'circle', c: [30, 5], r: 4 }])
    const [a, b] = draft().sketch.entities.map((e) => e.id)
    item(a, 'sketch-menu-concentric').run()
    expect(draft().tool).toBe('relation')
    expect(draft().armedRelation).toBe('concentric')
    expect(draft().selection).toEqual([a])
    useReverse.getState().sketchClick([34, 5], 1, false, {})
    expect(draft().sketch.constraints.some((c) => c.kind === 'concentric')).toBe(true)
    const moved = draft().sketch.entities.find((e) => e.id === b) as { c: [number, number] }
    expect(moved.c[0]).toBeCloseTo(0, 6)
    expect(moved.c[1]).toBeCloseTo(0, 6)
  })

  it('Equal radius with… gives the second circle the first one\'s radius', () => {
    open([{ kind: 'circle', c: [0, 0], r: 10 }, { kind: 'circle', c: [30, 5], r: 4 }])
    const [a, b] = draft().sketch.entities.map((e) => e.id)
    item(a, 'sketch-menu-equal').run()
    useReverse.getState().sketchClick([34, 5], 1, false, {})
    const rs = draft().sketch.entities.map((e) => (e as { r: number }).r)
    expect(rs[0]).toBeCloseTo(rs[1], 6)
    expect(draft().sketch.constraints.some((c) => c.kind === 'equal')).toBe(true)
    void b
  })

  it('Select centrepoint arms Coincident with the centre picked', () => {
    open([{ kind: 'arc', c: [0, 0], r: 10, start: 0, sweep: Math.PI / 2 }])
    const [id] = draft().sketch.entities.map((e) => e.id)
    item(id, 'sketch-menu-centre').run()
    expect(draft().armedRelation).toBe('coincident')
    expect(draft().relPicks).toEqual([{ kind: 'point', anchor: { entity: id, at: 'center' } }])
  })

  it('Dimension radius puts a radius in hand, Fix holds the circle, View relations narrows the list', () => {
    open([{ kind: 'circle', c: [0, 0], r: 10 }])
    const [id] = draft().sketch.entities.map((e) => e.id)
    item(id, 'sketch-menu-radius').run()
    const held = draft().sketch.constraints.find((c) => c.id === draft().dimMade)
    expect(held?.kind).toBe('radius')
    useReverse.getState().putDownDimension()
    item(id, 'sketch-menu-fix').run()
    expect(draft().sketch.entities[0].fixed).toBe(true)
    expect(item(id, 'sketch-menu-fix').label).toBe('Unfix')
    useReverse.getState().clearSelection()
    item(id, 'sketch-menu-relations').run()
    expect(draft().selection).toEqual([id])
    expect(useSketchPresentation.getState().relationsOfSelection).toBe(true)
  })
})
