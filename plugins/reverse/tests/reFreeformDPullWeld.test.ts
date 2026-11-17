// SPDX-License-Identifier: AGPL-3.0-only
// A D pull dropped on another boundary welds, as QUICKSURFACE welds it
// (fixtures/freeform-d-pull-merge.json, saved by QUICKSURFACE on 2026-11-17).
// Quick Scan never looked for a contact while the D handle was dragged, so a
// pulled quad could not be joined to the strip it reached.
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import fixture from './fixtures/freeform-d-pull-merge.json'
import { type Cage, edgeKey, topology } from '../core/freeform/cage'
import { extrapolateEdges } from '../core/freeform/edit'
import { weldExtension } from '../core/freeform/merge'
import { FreeformEditorLayer, type FreeformEditorOptions } from '../viewer/freeformEditorLayer'
import type { SceneLayerHost } from '../../../src/viewer/sceneLayers'

afterEach(() => vi.unstubAllGlobals())

const input = (): Cage => ({ positions: Float64Array.from(fixture.input.positions), faces: fixture.input.faces.map((f) => [...f]), creases: [] })
/** A face's corners from its smallest index on, so equal cycles compare equal. */
const canonical = (faces: number[][]) => faces.map((f) => { const k = f.indexOf(Math.min(...f)); return [...f.slice(k), ...f.slice(0, k)] })

describe('a D pull welded onto another boundary, as QUICKSURFACE welds it', () => {
  it('welds both new corners and keeps the existing surface points: native faces, poles within 0.005 mm', () => {
    const c = input(), edge = topology(c).edgeOf.get(edgeKey(5, 10))!
    const extended = extrapolateEdges(c, [edge], [-3.932, 0, 0])
    const welds = [12, 13].map((v) => [v, Math.abs(extended.cage.positions[3 * v + 1] - c.positions[2 * 3 + 1]) < 0.01 ? 2 : 8] as [number, number])
    const out = weldExtension(c, extended.cage, welds).cage
    expect(canonical(out.faces)).toEqual(canonical(fixture.welded.faces))
    expect(Math.max(...Array.from(out.positions, (v, i) => Math.abs(v - fixture.welded.positions[i])))).toBeLessThan(0.005)
  })

  it('refuses a weld onto a pole of the pulled quad itself', () => {
    const c = input(), edge = topology(c).edgeOf.get(edgeKey(5, 10))!
    const extended = extrapolateEdges(c, [edge], [-3.932, 0, 0])
    expect(() => weldExtension(c, extended.cage, [[12, 5]])).toThrow()
  })
})

function setup(options: FreeformEditorOptions, cage: Cage) {
  const win = new EventTarget(); vi.stubGlobal('window', win)
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }), setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
  camera.position.z = 20; camera.updateMatrixWorld()
  const raycaster = new THREE.Raycaster()
  const host = { canvas, camera: () => camera, partGroup: new THREE.Group(), raycaster, modelRadius: () => 10,
    setPickRay: (x: number, y: number) => raycaster.setFromCamera(new THREE.Vector2(x / 100 - 1, 1 - y / 100), camera),
    claimDrag: vi.fn(), setCursor: vi.fn(), invalidate: vi.fn(), pickScan: vi.fn(() => null) } as unknown as SceneLayerHost
  const onCommit = vi.fn(), editor = new FreeformEditorLayer(host)
  editor.set(cage, { onCommit, ...options })
  const event = (type: string, x: number, y: number) => Object.assign(new Event(type), { pointerId: 1, button: 0, clientX: x, clientY: y }) as PointerEvent
  return { editor, layer: editor.layer(), canvas, event, onCommit }
}

describe('dragging the D handle onto another boundary', () => {
  for (const controlNet of [false, true]) it(`joins the pulled quad when its corners reach the other strip (Control Net ${controlNet})`, () => {
    const c = input(), edge = topology(c).edgeOf.get(edgeKey(5, 10))!
    const s = setup({ mode: 'edges', controlNet, selection: [{ kind: 'edge', index: edge }], duplicateHandle: true }, c)
    const at = (s.editor as unknown as { duplicateAnchor(): { at: { x: number; y: number } } }).duplicateAnchor().at
    // 10 px/mm: the strips' facing sides are 39.3 px apart; drop 3 px short.
    s.layer.pointerDown!(s.event('pointerdown', at.x, at.y))
    s.canvas.dispatchEvent(s.event('pointermove', at.x - 20, at.y))
    s.canvas.dispatchEvent(s.event('pointermove', at.x - 36.3, at.y))
    s.canvas.dispatchEvent(s.event('pointerup', at.x - 36.3, at.y))
    expect(s.onCommit).toHaveBeenCalledOnce()
    const out = s.onCommit.mock.lastCall?.[0] as Cage
    expect(out.positions.length / 3).toBe(12)
    expect(canonical(out.faces)).toEqual(canonical(fixture.welded.faces))
    s.editor.dispose()
  })

  it('leaves a pull that stops short of the other strip unwelded', () => {
    const c = input(), edge = topology(c).edgeOf.get(edgeKey(5, 10))!
    const s = setup({ mode: 'edges', controlNet: false, selection: [{ kind: 'edge', index: edge }], duplicateHandle: true }, c)
    const at = (s.editor as unknown as { duplicateAnchor(): { at: { x: number; y: number } } }).duplicateAnchor().at
    s.layer.pointerDown!(s.event('pointerdown', at.x, at.y))
    s.canvas.dispatchEvent(s.event('pointermove', at.x - 20, at.y))
    s.canvas.dispatchEvent(s.event('pointerup', at.x - 20, at.y))
    const out = s.onCommit.mock.lastCall?.[0] as Cage
    expect(out.positions.length / 3).toBe(14)
    expect(out.faces).toHaveLength(5)
    s.editor.dispose()
  })
})
