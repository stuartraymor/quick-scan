// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { type Cage, topology } from '../core/freeform/cage'
import { irregularBoundaryVertices, repairBoundary } from '../core/freeform/repair'
import fixtures from './fixtures/freeform-boundary-repair.json'
import multiple from './fixtures/freeform-multiple-repair.json'
import connected from './fixtures/freeform-connected-repair.json'
import larger from './fixtures/freeform-larger-repair.json'
import creased from './fixtures/freeform-creased-repair.json'
import higher from './fixtures/freeform-higher-repair.json'
import adjacent from './fixtures/freeform-adjacent-repair.json'

const cage = (c: { positions: number[]; faces: number[][] }): Cage => ({ positions: Float64Array.from(c.positions), faces: c.faces.map(f => [...f]), creases: [] })
const canonical = (f: number[]) => { const i = f.indexOf(Math.min(...f)); return [...f.slice(i), ...f.slice(0, i)].join(',') }

describe('native-observed larger and mixed boundary repairs', () => {
  for (const sample of [...larger, ...higher, ...adjacent]) it(`matches ${sample.name} without changing unresolved junctions`, () => {
    const input = cage(sample.before), original = structuredClone(input), out = repairBoundary(input)
    expect(out.positions.length).toBe(sample.after.positions.length)
    expect(Math.max(...out.positions.map((v, i) => Math.abs(v - sample.after.positions[i])))).toBeLessThan(5e-7)
    expect(out.faces.map(canonical)).toEqual(sample.after.faces.map(canonical))
    expect(irregularBoundaryVertices(out)).toEqual(irregularBoundaryVertices(cage(sample.after)))
    expect(input).toEqual(original)
    expect(topology(out).edges.every(e => e.faces.length <= 2)).toBe(true)
  })
})

describe('native-observed isolated irregular boundary repair', () => {
  for (const sample of fixtures) it(`matches saved ${sample.name}-face repair coordinates and oriented connectivity`, () => {
    const input = cage(sample.before), original = Array.from(input.positions)
    expect(irregularBoundaryVertices(input)).toHaveLength(1)
    const out = repairBoundary(input)
    expect(out.positions.length).toBe(sample.after.positions.length)
    expect(Math.max(...out.positions.map((v, i) => Math.abs(v - sample.after.positions[i])))).toBeLessThan(2e-7)
    expect(out.faces.map(canonical)).toEqual(sample.after.faces.map(canonical))
    expect(irregularBoundaryVertices(out)).toEqual([])
    expect(topology(out).edges.every(e => e.faces.length <= 2)).toBe(true)
    expect(Array.from(input.positions)).toEqual(original)
    expect(input.faces).toEqual(sample.before.faces)
    expect(repairBoundary(out)).toEqual(out)
  })

  it('preserves the measured construction under rotation, translation and scale', () => {
    const transform = (p: number[]) => p.map((_, i) => {
      const k = i % 3, at = i - k
      return k === 0 ? 2 * p[at + 2] + 30 : k === 1 ? 2 * p[at] - 10 : 2 * p[at + 1] + 5
    })
    for (const sample of fixtures) {
      const input = cage({ ...sample.before, positions: transform(sample.before.positions) })
      const expected = transform(sample.after.positions), out = repairBoundary(input)
      expect(Math.max(...out.positions.map((v, i) => Math.abs(v - expected[i])))).toBeLessThan(4e-7)
    }
  })

  it('detects a disconnected boundary fan without guessing its repair', () => {
    const c: Cage = { positions: Float64Array.from([0,0,0, 1,0,0, 1,1,0, 0,1,0, -1,0,0, -1,-1,0, 0,-1,0]), faces: [[0,1,2,3], [0,4,5,6]], creases: [] }
    expect(irregularBoundaryVertices(c)).toEqual([0])
    const before = structuredClone(c)
    expect(() => repairBoundary(c)).toThrow(/could not be repaired/)
    expect(c).toEqual(before)
  })

  it('retains a crease on the original edge when its boundary gains a strip', () => {
    const c = cage(fixtures[0].before)
    c.creases = [[7, 8]]
    const before = structuredClone(c)
    expect(repairBoundary(c).creases).toEqual(c.creases)
    expect(c).toEqual(before)
  })

  it('refuses a collapsed repair', () => {
    const c = cage(fixtures[0].before)
    // Collapse the left strip end onto its inward neighbour.
    c.positions.set(c.positions.slice(0, 3), 8 * 3)
    const before = structuredClone(c)
    expect(() => repairBoundary(c)).toThrow(/could not be repaired/)
    expect(c).toEqual(before)
  })
})

describe('native-observed independent boundary repairs', () => {
  for (const sample of multiple) it(`matches ${sample.name} in one repair`, () => {
    const input = cage(sample.before), original = structuredClone(input)
    expect(irregularBoundaryVertices(input)).toHaveLength(2)
    const out = repairBoundary(input)
    expect(out.positions.length).toBe(sample.after.positions.length)
    expect(Math.max(...out.positions.map((v, i) => Math.abs(v - sample.after.positions[i])))).toBeLessThan(5e-7)
    expect(out.faces.map(canonical)).toEqual(sample.after.faces.map(canonical))
    expect(irregularBoundaryVertices(out)).toEqual([])
    expect(topology(out).edges.every(e => e.faces.length <= 2)).toBe(true)
    expect(input).toEqual(original)
    expect(repairBoundary(out)).toEqual(out)
  })

  it('keeps the whole input when a later component cannot be repaired', () => {
    const input = cage(multiple[0].before)
    // A collapsed later component still rejects the entire operation.
    input.positions.fill(0, input.positions.length / 2)
    const original = structuredClone(input)
    expect(() => repairBoundary(input)).toThrow(/could not be repaired/)
    expect(input).toEqual(original)
  })
})

describe('native-observed connected boundary repair', () => {
  for (const sample of connected) it(`repairs ${sample.name} through regular boundary rows in native order`, () => {
    const input = cage(sample.before), original = structuredClone(input)
    expect(irregularBoundaryVertices(input).length).toBeGreaterThan(2)
    const out = repairBoundary(input)
    expect(out.positions.length).toBe(sample.after.positions.length)
    expect(Math.max(...out.positions.map((v, i) => Math.abs(v - sample.after.positions[i])))).toBeLessThan(2e-6)
    expect(out.faces.map(canonical)).toEqual(sample.after.faces.map(canonical))
    expect(out.faces.slice(0, input.faces.length)).toEqual(input.faces)
    expect(irregularBoundaryVertices(out)).toEqual([])
    expect(topology(out).edges.every(e => e.faces.length <= 2)).toBe(true)
    expect(input).toEqual(original)
    expect(repairBoundary(out)).toEqual(out)
  })

  it('retains later-strip creases and leaves its connected input unchanged', () => {
    const input = cage(connected[1].before), original = structuredClone(input)
    input.creases = [[139, 141]]; original.creases = [[139, 141]]
    const out = repairBoundary(input)
    expect(out.creases).toEqual(input.creases)
    expect(irregularBoundaryVertices(out)).toEqual([])
    expect(input).toEqual(original)
  })
})

for(const trial of creased) it('repairs '+trial.name+' with native crease placement',()=>{const input={...cage(trial.before),creases:trial.before.creases as [number,number][]},before=structuredClone(input),out=repairBoundary(input);expect(out.faces.map(canonical)).toEqual(trial.after.faces.map(canonical));expect(out.creases).toEqual(trial.after.creases);expect(Math.max(...out.positions.map((v,i)=>Math.abs(v-trial.after.positions[i])))).toBeLessThan(5e-7);expect(input).toEqual(before);expect(irregularBoundaryVertices(out)).toEqual([])})
