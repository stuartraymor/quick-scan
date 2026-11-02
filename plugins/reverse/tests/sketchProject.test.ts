// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { addEntity, emptySketch } from '../core/sketch'
import { visibleSketchProjection, sketchWithVisibleProjection } from '../core/sketchProject'
import { sketchOf, XY } from './reKit'
import type { Feature } from '../core/features'

const target = () => ({ frame: XY, sketch: emptySketch() })
describe('all-visible sketch projection', () => {
  it('takes visible sketch geometry only, excluding active, hidden and suppressed sketches', () => {
    const a = sketchOf(1, s => addEntity(s, { kind: 'line', a: [1, 2], b: [4, 2] }))
    const hidden = { ...sketchOf(2, s => addEntity(s, { kind: 'circle', c: [0, 0], r: 2 })), visible: false }
    const active = sketchOf(3, s => addEntity(s, { kind: 'line', a: [0, 0], b: [0, 1] }))
    const suppressed = { ...sketchOf(4, s => addEntity(s, { kind: 'point', p: [8, 8] })), suppressed: true }
    const preview = visibleSketchProjection([a, hidden, active, suppressed], { ...target(), featureId: active.id })
    expect(preview.entities).toHaveLength(1); expect(preview.issues).toEqual([])
    expect(preview.entities[0]).toMatchObject({ kind: 'line', a: [1, 2], b: [4, 2], fixed: true, projected: true, source: { sketch: 1, entity: 1 } })
  })
  it('projects through translated source frames and retains construction and source identity', () => {
    const a = sketchOf(1, s => addEntity(s, { kind: 'line', a: [0, 0], b: [4, 0], construction: true }))
    a.frame = { ...XY, origin: [8, 3, 20] }
    const preview = visibleSketchProjection([a], target())
    expect(preview.entities[0]).toMatchObject({ a: [8, 3], b: [12, 3], construction: true, source: { sketch: 1, entity: 1 } })
  })
  it('does not add already projected source/entity pairs again', () => {
    const a = sketchOf(1, s => addEntity(s, { kind: 'circle', c: [2, 3], r: 4 }))
    const t = target(), first = visibleSketchProjection([a], t), committed = sketchWithVisibleProjection(t.sketch, first)!
    const second = visibleSketchProjection([a], { ...t, sketch: committed.sketch })
    expect(second.entities).toHaveLength(0); expect(second.duplicates).toBe(1)
    expect(sketchWithVisibleProjection(committed.sketch, second)).toBeNull()
  })
  it('reports a tilted circle as unsupported and never partially commits supported members', () => {
    const a = sketchOf(1, s => { addEntity(s, { kind: 'line', a: [0, 0], b: [5, 0] }); addEntity(s, { kind: 'circle', c: [0, 0], r: 3 }) })
    a.frame = { origin: [0, 0, 0], normal: [0, Math.SQRT1_2, Math.SQRT1_2], basisU: [1, 0, 0], basisV: [0, Math.SQRT1_2, -Math.SQRT1_2] }
    const t = target(), before = JSON.stringify(t.sketch), p = visibleSketchProjection([a], t)
    expect(p.entities).toHaveLength(1); expect(p.issues[0].message).toContain('ellipse')
    expect(sketchWithVisibleProjection(t.sketch, p)).toBeNull(); expect(JSON.stringify(t.sketch)).toBe(before)
  })
  it('rejects a later visible sketch instead of silently unlinking it', () => {
    const active = sketchOf(1, () => {}), later = sketchOf(2, s => addEntity(s, { kind: 'point', p: [1, 2] }))
    const p = visibleSketchProjection([active, later], { ...target(), featureId: 1 })
    expect(p.entities).toHaveLength(0); expect(p.issues[0].message).toContain('comes after')
  })
  it('does not inspect body geometry when a body feature is visible', () => {
    const body = { id: 5, kind: 'extrude', name: 'Body', visible: true } as unknown as Feature
    expect(visibleSketchProjection([body], target()).entities).toHaveLength(0)
  })
  it('makes a deep independent copy without mutating either input', () => {
    const a = sketchOf(1, s => addEntity(s, { kind: 'line', a: [0, 0], b: [5, 0] }))
    const t = target(), before = JSON.stringify(a), p = visibleSketchProjection([a], t), made = sketchWithVisibleProjection(t.sketch, p)!
    expect(t.sketch.entities).toHaveLength(0); expect(JSON.stringify(a)).toBe(before)
    const line = made.sketch.entities[0]; if (line.kind === 'line') line.a[0] = 999
    expect(p.entities[0]).toMatchObject({ a: [0, 0] })
  })
})
