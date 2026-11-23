// SPDX-License-Identifier: AGPL-3.0-only
// 1.2.19: a boss extruded from a sketch lying on a solid's face, with
// Combine (Join), becomes one body with it — and a pocket cut from the same
// kind of sketch goes into it.
import { describe, expect, it, vi } from 'vitest'
import { Builder } from '../core/build'
import type { ExtrudeFeature, Feature, ResolveContext, SketchFeature } from '../core/features'
import { resolveFeatures } from '../core/resolve'
import { ReKernel } from '../core/kernel'
import { findRegions } from '../core/regions'
import { addEntity, addRectangle, emptySketch, type Sketch } from '../core/sketch'
import { XY } from './reKit'

vi.setConfig({ testTimeout: 180_000 })
const kernelPromise = ReKernel.load()
const ctx: ResolveContext = { sections: [], elements: [], modelCenter: [0, 0, 0] }
const at = (z: number) => ({ ...XY, origin: [0, 0, z] as [number, number, number] })
function sketchOf(id: number, z: number, fill: (s: Sketch) => void): SketchFeature {
  const sketch = emptySketch()
  fill(sketch)
  return { id, kind: 'sketch', name: `Sketch ${id}`, plane: { kind: 'world', axis: 'z', offset: z }, frame: at(z), sketch, visible: true }
}
const extrude = (id: number, s: SketchFeature, from: number, to: number, op: ExtrudeFeature['op']): ExtrudeFeature => ({ id, kind: 'extrude', name: `E${id}`, sketchId: s.id, regions: findRegions(s.sketch).map((r) => r.key), extent: { kind: 'distance', from, to }, op, visible: true })
async function build(features: Feature[]) {
  const k = await kernelPromise
  const builder = new Builder(k)
  const sketches = new Map<number, Sketch>(features.filter((f): f is SketchFeature => f.kind === 'sketch').map((f) => [f.id, f.sketch]))
  const result = builder.build(resolveFeatures(features, ctx, (f) => findRegions(f.sketch)), (id) => sketches.get(id))
  return { result, builder }
}
const disc = (d: number, h: number) => Math.PI * (d / 2) ** 2 * h

describe('a boss on a face', () => {
  it('joins a round boss standing on the top face of a block with a hole in it', async () => {
    const base = sketchOf(1, 0, (s) => addRectangle(s, [-10, -6], [10, 6]))
    const hole = sketchOf(3, 0, (s) => addEntity(s, { kind: 'circle', c: [-4, 0], r: 3 }))
    const boss = sketchOf(5, 6, (s) => addEntity(s, { kind: 'circle', c: [5, 0], r: 2 }))
    const { result, builder } = await build([base, extrude(2, base, 0, 6, 'join'), hole, extrude(4, hole, 0, 6, 'cut'), boss, extrude(6, boss, 0, 5, 'join')])
    expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(result.bodies.filter((b) => !b.surface).map((b) => +b.volume.toFixed(1))).toEqual([+(1440 - disc(6, 6) + disc(4, 5)).toFixed(1)])
    builder.dispose()
  })

  it('joins it when the pieces were drawn by hand, a pixel off round numbers', async () => {
    const base = sketchOf(1, 0, (s) => addRectangle(s, [-10, -6.000000953674316], [9.999999046325684, 5.999999523162842]))
    const hole = sketchOf(3, 0, (s) => addEntity(s, { kind: 'circle', c: [-4.0000005, 0.0000003], r: 2.9999991 }))
    const boss = sketchOf(5, 6, (s) => addEntity(s, { kind: 'circle', c: [5.0000007, 0], r: 1.9999983 }))
    const { result, builder } = await build([base, extrude(2, base, 0, 6, 'join'), hole, extrude(4, hole, 0, 6, 'cut'), boss, extrude(6, boss, 0, 5, 'join')])
    expect(result.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok'])
    expect(result.bodies.filter((b) => !b.surface)).toHaveLength(1)
    builder.dispose()
  })
})
