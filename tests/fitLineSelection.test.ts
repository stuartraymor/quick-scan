// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import type { MeshGraph, Vec3 } from '../src/core/types'
import { fitLineOnSelection } from '../src/core/fit/fitLineOnSelection'
import { getSelectionFitter } from '../src/core/elements/registry'
import { defaultMethod } from '../src/state/elementModel'
import { useStore } from '../src/state/store'

const graph = (points: Vec3[]): MeshGraph => ({ positions: Float32Array.from(points.flat()), normals: new Float32Array(points.length * 3), indices: new Uint32Array(0), adjOffsets: new Uint32Array(points.length + 1), adjList: new Uint32Array(0), vertexCount: points.length, triangleCount: 0, bboxDiag: 100 })
const fit = (points: Vec3[], sigma: 0 | 2 = 0) => fitLineOnSelection(graph(points), Uint32Array.from(points.map((_, i) => i)), { method: 'gaussian', sigma })

describe('orthogonal best-fit line on selected scan points', () => {
  it('recovers an exact sloping line and its drawn extent', () => {
    const result = fit(Array.from({ length: 31 }, (_, i): Vec3 => [100 + 2*i, -20 + 3*i, 8 + 6*i]))
    // Weighted refits leave rounding of the order of 1e-15 mm.
    result.center.forEach((v, i) => expect(v).toBeCloseTo([130, 25, 98][i], 10))
    result.dir.forEach((v, i) => expect(v).toBeCloseTo([2/7,3/7,6/7][i], 10))
    expect(result.length).toBeCloseTo(210, 10)
    expect(result.sigma).toBeLessThan(1e-10)
    expect(result.usedPoints).toBe(31)
  })

  it('measures orthogonal scatter instead of treating a long edge as a cylinder', () => {
    const points: Vec3[] = []
    for (let x = -20; x <= 20; x++) for (const side of [-1, 1]) points.push([x, 20 + side * 0.125, 30])
    const result = fit(points)
    expect(result.dir).toEqual([1,0,0])
    expect(result.center).toEqual([0,20,30])
    expect(result.sigma).toBeCloseTo(0.125, 12)
    expect(result.length).toBe(40)
  })

  it('clips an off-edge outlier with the shared sigma setting', () => {
    const points: Vec3[] = []
    for (let x = -20; x <= 20; x++) for (const side of [-1, 1]) points.push([x, side * 0.01, 0])
    points.push([0,1,0])
    const result = fit(points, 2)
    expect(result.usedPoints).toBe(82)
    expect(result.regionSize).toBe(83)
    expect(result.sigma).toBeCloseTo(0.01, 7)
    expect(result.dir).toEqual([1,0,0])
  })

  it('rejects too few points and coincident or isotropic selections', () => {
    expect(() => fit(Array.from({ length: 19 }, (_, i): Vec3 => [i,0,0]))).toThrow(/at least 20/)
    expect(() => fit(Array.from({ length: 20 }, (): Vec3 => [1,2,3]))).toThrow(/unique line/)
    const sphere: Vec3[] = []
    for (let i = 0; i < 4; i++) sphere.push([1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1])
    expect(() => fit(sphere)).toThrow(/unique line/)
  })

  it('uses the worker selection registry without changing the normal constructor default', () => {
    expect(getSelectionFitter('line')).toBe(fitLineOnSelection)
    expect(defaultMethod('line')).toBe('line-two-points')
  })

  it('commits the original selection as a rebuild recipe', () => {
    const output = fit(Array.from({ length: 25 }, (_, i): Vec3 => [i,0,3]))
    const s = useStore.getState()
    s.startDraft('line')
    s.setDraftMethod('fit')
    s.setDraftSelection(output.region)
    s.resolveDraft(output)
    const id = s.commitDraft()
    const saved = useStore.getState().elements.find(e => e.id === id)!
    expect(saved.source.type).toBe('fitted')
    expect(saved.source.type === 'fitted' && saved.source.selection?.length).toBe(25)
    expect(saved.fit?.kind).toBe('line')
    // As QUICKSURFACE 8.0.128 names it, listed under Ref. geometry.
    expect(saved.name).toMatch(/^Ref\. Line\(\d+\)$/)
    useStore.getState().cancelDraft()
  })
})
