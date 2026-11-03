// SPDX-License-Identifier: AGPL-3.0-only
// Surfacing → Pipe: the circle's sheet stands square to the path where it
// starts, centred on the start, and the circle has the typed diameter.
import { describe, expect, it } from 'vitest'
import { pipeFrame, pipePaths, pipeSketch } from '../core/pipe'
import type { SketchFeature } from '../core/features'

const onXY = (name: string, entities: SketchFeature['sketch']['entities']): SketchFeature => ({
  id: 1,
  kind: 'sketch',
  name,
  plane: { kind: 'world', axis: 'z', offset: 0 },
  frame: { origin: [0, 0, 5], normal: [0, 0, 1], basisU: [1, 0, 0], basisV: [0, 1, 0] },
  sketch: { entities, constraints: [], nextId: entities.length + 1 },
  visible: true,
})

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

describe('Pipe', () => {
  it('puts the circle square to a straight path at its start', () => {
    const f = pipeFrame(onXY('Path', [{ id: 1, kind: 'line', a: [10, 0], b: [40, 0] }]))
    if (typeof f === 'string') throw new Error(f)
    expect(f.origin[0]).toBeCloseTo(10)
    expect(f.origin[2]).toBeCloseTo(5)
    expect(Math.abs(f.normal[0])).toBeCloseTo(1)
    // A right-handed sheet: u × v is the normal, all three square.
    expect(dot(f.basisU, f.normal)).toBeCloseTo(0)
    expect(dot(f.basisV, f.normal)).toBeCloseTo(0)
    expect(dot(f.basisU, f.basisV)).toBeCloseTo(0)
    const c = [f.basisU[1] * f.basisV[2] - f.basisU[2] * f.basisV[1], f.basisU[2] * f.basisV[0] - f.basisU[0] * f.basisV[2], f.basisU[0] * f.basisV[1] - f.basisU[1] * f.basisV[0]]
    expect(dot(c, f.normal)).toBeCloseTo(1)
  })

  it('follows the tangent of an arc path', () => {
    const f = pipeFrame(onXY('Bend', [{ id: 1, kind: 'arc', c: [0, 0], r: 20, start: 0, sweep: Math.PI / 2 }]))
    if (typeof f === 'string') throw new Error(f)
    // Leaving (20, 0) or (0, 20): the way on is along Y or X there.
    const atX = Math.abs(f.origin[0] - 20) < 1e-6
    expect(Math.abs(atX ? f.normal[1] : f.normal[0])).toBeCloseTo(1)
  })

  it('draws one circle of the diameter, and offers only sketches a sweep can follow', () => {
    expect(pipeSketch(8).entities).toEqual([{ id: 1, kind: 'circle', c: [0, 0], r: 4 }])
    const ring = onXY('Ring', [{ id: 1, kind: 'circle', c: [0, 0], r: 4 }])
    const path = { ...onXY('Path', [{ id: 1, kind: 'line', a: [0, 0], b: [9, 0] }]), id: 2 }
    expect(typeof pipeFrame(ring)).toBe('string')
    expect(pipePaths([ring, path]).map((p) => p.name)).toEqual(['Path'])
  })
})
