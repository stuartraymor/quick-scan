// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from 'vitest'
import { Builder } from '../core/build'
import type { Feature } from '../core/features'
import { ReKernel } from '../core/kernel'
import { addEntity, emptySketch } from '../core/sketch'
import { build, XY } from './reKit'

it('finishes the shared bend of a sketch sheet, rejects its free boundary and thickens the result', async () => {
  const k = await ReKernel.load()
  const b = new Builder(k)
  const sketch = emptySketch()
  addEntity(sketch, { kind: 'line', a: [20, 0], b: [0, 0] })
  addEntity(sketch, { kind: 'line', a: [0, 0], b: [0, 12] })
  const base: Feature[] = [
    { id: 1, kind: 'sketch', name: 'Bracket', plane: { kind: 'world', axis: 'z', offset: 0 }, frame: XY, sketch, visible: true },
    { id: 2, kind: 'sheet', name: 'Fold', sketchId: 1, from: 0, to: 10, visible: true },
  ]
  try {
    const body = (await build(b, base)).bodies[0]
    const bend = body.topology.edges.find(e => new Set(e.faces).size === 2)!.fingerprint
    const boundary = body.topology.edges.find(e => e.faces.length === 1)!.fingerprint
    const feature: Feature = { id: 3, kind: 'fillet', name: 'Bend radius', body: 2, edges: [bend], radius: 2, chain: false, visible: true }
    const invalid = await build(b, [...base, { ...feature, edges: [boundary] }])
    expect(invalid.results.at(-1)?.message).toMatch(/free boundary/)
    expect(k.surfaceArea(b.body(2)!)).toBeCloseTo(320, 6)
    const rounded = await build(b, [...base, feature])
    expect(rounded.results.at(-1)?.status).toBe('ok')
    expect(k.surfaceArea(b.body(2)!)).toBeCloseTo((32 - 4 + Math.PI) * 10, 6)
    const thickened = await build(b, [...base, feature, { id: 4, kind: 'thicken', name: 'Wall', sheet: 2, thickness: 0.75, side: 'out', op: 'new', visible: true }])
    expect(thickened.results.at(-1)?.status, thickened.results.at(-1)?.message).toBe('ok')
    expect(thickened.bodies.some(output => output.closed)).toBe(true)
  } finally { b.dispose() }
})
