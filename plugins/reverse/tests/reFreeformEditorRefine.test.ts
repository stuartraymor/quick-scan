// SPDX-License-Identifier: AGPL-3.0-only
// The editor's joins and displays as a person meets them (2026-11-18): a
// point dropped on another across a slope joins; a control surface is drawn
// and picked on itself, not on a CAD body some quads behind it; a transparent
// surface keeps its front finish; a new face is wound to face the viewer.
import { afterEach, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { SceneLayerHost } from '../../../src/viewer/sceneLayers'
import type { Cage } from '../core/freeform/cage'
import { topology } from '../core/freeform/cage'
import { cageVertexLimits } from '../core/freeform/limit'
import { FreeformEditorLayer, type FreeformEditorOptions } from '../viewer/freeformEditorLayer'

afterEach(() => vi.unstubAllGlobals())

/** A 20 mm square view from +z at 10 px/mm: x → 100 + 10 x, y → 100 − 10 y. */
function setup(options: FreeformEditorOptions, cage: Cage, scan: number[] = [1, 2, 3]) {
  const win = new EventTarget(); vi.stubGlobal('window', win)
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }), setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
  camera.position.z = 20; camera.updateMatrixWorld()
  const partGroup = new THREE.Group(), raycaster = new THREE.Raycaster()
  const host = { canvas, camera: () => camera, partGroup, raycaster, modelRadius: () => 10, modelCenter: () => [0, 0, 0],
    setPickRay: (x: number, y: number) => raycaster.setFromCamera(new THREE.Vector2(x / 100 - 1, 1 - y / 100), camera),
    claimDrag: vi.fn(), setCursor: vi.fn(), invalidate: vi.fn(), pickScan: vi.fn(() => ({ point: scan })),
  } as unknown as SceneLayerHost
  const onCommit = vi.fn()
  const editor = new FreeformEditorLayer(host)
  editor.set(cage, { onCommit, ...options })
  const event = (type: string, x: number, y: number) => Object.assign(new Event(type), { pointerId: 1, button: 0, clientX: x, clientY: y }) as PointerEvent
  return { editor, layer: editor.layer(), canvas, event, onCommit, partGroup }
}

/** Everything the editor has drawn under the part. */
const drawnBy = (part: THREE.Object3D): THREE.Object3D[] => { const all: THREE.Object3D[] = []; part.traverse((o) => { all.push(o) }); return all }

/** Two quads a millimetre apart, the second `rise` mm nearer the viewer. */
const apart = (rise: number): Cage => ({
  positions: Float64Array.from([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0, 6, 0, rise, 9, 0, rise, 9, 5, rise, 6, 5, rise]),
  faces: [[0, 1, 2, 3], [4, 5, 6, 7]], creases: [],
})

it('joins a point dropped on another across a slope', () => {
  // The dragged point keeps its depth, 1.5 mm from its target's: three times
  // the old fixed band of this view (0.01 of a 100 mm depth range).
  const s = setup({ mode: 'points' }, apart(1.5))
  s.layer.pointerDown!(s.event('pointerdown', 160, 100))
  s.canvas.dispatchEvent(s.event('pointermove', 156, 100))
  s.canvas.dispatchEvent(s.event('pointermove', 153, 100))
  s.canvas.dispatchEvent(s.event('pointerup', 153, 100))
  expect(s.onCommit).toHaveBeenCalledOnce()
  const joined = s.onCommit.mock.lastCall?.[0] as Cage
  expect(joined.positions).toHaveLength(21)
  expect(joined.faces).toEqual([[0, 1, 2, 3], [1, 4, 5, 6]])
  s.editor.dispose()
})

it('does not join through to a layer far behind the drop', () => {
  // 5 mm of depth across a millimetre: another sheet, not a slope.
  const s = setup({ mode: 'points' }, apart(5))
  s.layer.pointerDown!(s.event('pointerdown', 160, 100))
  s.canvas.dispatchEvent(s.event('pointermove', 156, 100))
  s.canvas.dispatchEvent(s.event('pointermove', 153, 100))
  s.canvas.dispatchEvent(s.event('pointerup', 153, 100))
  expect(s.onCommit).toHaveBeenCalledOnce()
  expect((s.onCommit.mock.lastCall?.[0] as Cage).positions).toHaveLength(24)
  s.editor.dispose()
})

it('draws a control surface\'s points on itself, not on a CAD body built before its last quads', () => {
  const cage: Cage = { positions: Float64Array.from([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0, 10, 0, 0, 10, 5, 0]), faces: [[0, 1, 2, 3], [1, 4, 5, 2]], creases: [] }
  // The body of the first quad alone, as it was built: 0.15 mm above it.
  const finished = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, .15, 5, 0, .15, 5, 5, .15, 0, 5, .15], 3))
  finished.setIndex([0, 1, 2, 0, 2, 3])
  const s = setup({ fitToScan: false, controlNet: false, finishedSurface: finished }, cage)
  const points = drawnBy(s.partGroup).find((o): o is THREE.Points => o instanceof THREE.Points)!
  const drawn = Array.from(points.geometry.getAttribute('position').array)
  expect(drawn).toHaveLength(18)
  cageVertexLimits(cage).flat().forEach((v, i) => expect(drawn[i]).toBeCloseTo(v, 5))
  s.editor.dispose(); finished.dispose()
})

it('gives the side facing the viewer its front finish in both passes of a transparent surface', () => {
  const cage: Cage = { positions: Float64Array.from([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0]), faces: [[0, 1, 2, 3]], creases: [] }
  for (const display of ['shaded', 'zebra'] as const) {
    const s = setup({ fitToScan: false, display, opacity: .5 }, cage)
    const surface = drawnBy(s.partGroup).find((o): o is THREE.Mesh => o instanceof THREE.Mesh && (o.material as THREE.Material).transparent && (o.material as THREE.Material).opacity === .5)!
    const shader = { vertexShader: '#include <project_vertex>', fragmentShader: '#include <dithering_fragment>', uniforms: {} }
    ;(surface.material as THREE.Material).onBeforeCompile(shader as never, null as never)
    // The first pass turns the front-face sense round; the finish reads it back.
    expect(shader.fragmentShader).toMatch(/#ifdef FLIP_SIDED\s+reverseSide = !reverseSide;/)
    expect(shader.fragmentShader).not.toMatch(/if \(gl_FrontFacing && plainSurface\)/)
    s.editor.dispose()
  }
})

it('tells a new face which way the viewer looks, in the part\'s own frame', () => {
  const cage: Cage = { positions: Float64Array.from([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0]), faces: [[0, 1, 2, 3]], creases: [] }
  const s = setup({}, cage)
  const along = s.editor.seenAlong([[1, 1, 0]])
  expect(along[0]).toBeCloseTo(0); expect(along[1]).toBeCloseTo(0); expect(along[2]).toBeCloseTo(-1)
  // The part turned over about x: the same view looks along its +z.
  s.partGroup.rotation.x = Math.PI; s.partGroup.updateMatrixWorld(true)
  expect(s.editor.seenAlong([[1, 1, 0]])[2]).toBeCloseTo(1)
  s.editor.dispose()
})

/** Q1 on (0,0)–(5,5) with Q3 above it on (0,5)–(5,9). */
const stacked = (): Cage => ({
  positions: Float64Array.from([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0, 5, 9, 0, 0, 9, 0]),
  faces: [[0, 1, 2, 3], [3, 2, 4, 5]], creases: [],
})

it('refuses a join that would turn the dragged quad over on its neighbour', () => {
  // Q1's corner (0,0) pulled through Q1 and dropped on Q3's far corner (5,9).
  const s = setup({ mode: 'points' }, stacked())
  s.layer.pointerDown!(s.event('pointerdown', 100, 100))
  s.canvas.dispatchEvent(s.event('pointermove', 130, 50))
  s.canvas.dispatchEvent(s.event('pointermove', 150, 10))
  s.canvas.dispatchEvent(s.event('pointerup', 150, 10))
  expect(s.onCommit).not.toHaveBeenCalled()
  s.editor.dispose()
})

it('joins a rectangle to the open points its corners land on', () => {
  const cage: Cage = { positions: Float64Array.from([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0]), faces: [[0, 1, 2, 3]], creases: [] }
  const onCreateRectangle = vi.fn()
  const s = setup({ creating: true, creationTool: 'rectangle', onCreateRectangle }, cage, [7, 7, .1])
  // From 3 px off the corner (5,0) to (9,5): the side x = 5 is the quad's own.
  s.layer.click!(152, 102, false)
  s.layer.click!(190, 52, false)
  expect(onCreateRectangle).toHaveBeenCalledOnce()
  const [points, vertices] = onCreateRectangle.mock.lastCall as [number[][], (number | undefined)[]]
  expect(vertices).toEqual([1, undefined, undefined, 2])
  expect(points[0]).toEqual([5, 0, 0]); expect(points[3]).toEqual([5, 5, 0]); expect(points[1]).toEqual([7, 7, .1])
  s.editor.dispose()
})

it('leaves a rectangle drawn clear of the surface on the scan alone', () => {
  const cage: Cage = { positions: Float64Array.from([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0]), faces: [[0, 1, 2, 3]], creases: [] }
  const onCreateRectangle = vi.fn()
  const s = setup({ creating: true, creationTool: 'rectangle', onCreateRectangle }, cage)
  s.layer.click!(170, 100, false)
  s.layer.click!(195, 60, false)
  expect(onCreateRectangle.mock.lastCall?.[1]).toEqual([undefined, undefined, undefined, undefined])
  s.editor.dispose()
})

it('does not join a rectangle to a point lying behind the scan under its corner', () => {
  const cage: Cage = { positions: Float64Array.from([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0]), faces: [[0, 1, 2, 3]], creases: [] }
  const onCreateRectangle = vi.fn()
  // The scan under every corner is 3 mm nearer the viewer than the quad.
  const s = setup({ creating: true, creationTool: 'rectangle', onCreateRectangle }, cage, [7, 7, 3])
  s.layer.click!(152, 102, false)
  s.layer.click!(190, 52, false)
  expect(onCreateRectangle.mock.lastCall?.[1]).toEqual([undefined, undefined, undefined, undefined])
  s.editor.dispose()
})

it('keeps the join a held D pull was showing when the release snaps its corners to the scan', () => {
  // Q1 on (0,0)–(5,5) and Q2 two millimetres above it. Q1's top side pulled up
  // 2 mm lays its new corners on Q2's lower ones; on release the scan snap
  // carries the new corners 1.5 mm (15 px) sideways, out of the 11 px band.
  const cage: Cage = { positions: Float64Array.from([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0, 0, 7, 0, 5, 7, 0, 5, 12, 0, 0, 12, 0]), faces: [[0, 1, 2, 3], [4, 5, 6, 7]], creases: [] }
  const side = topology(cage).edges.findIndex(e => (e.a === 2 && e.b === 3) || (e.a === 3 && e.b === 2))
  const s = setup({ mode: 'edges', duplicateHandle: true, selection: [{ kind: 'edge', index: side }], snapPoint: p => [p[0] + 1.5, p[1], p[2]] }, cage)
  s.layer.pointerDown!(s.event('pointerdown', 125, 50))
  s.canvas.dispatchEvent(s.event('pointermove', 125, 40))
  s.canvas.dispatchEvent(s.event('pointermove', 125, 30))
  s.canvas.dispatchEvent(s.event('pointerup', 125, 30))
  expect(s.onCommit).toHaveBeenCalledOnce()
  const joined = s.onCommit.mock.lastCall?.[0] as Cage
  expect(joined.faces).toHaveLength(3)
  expect(joined.positions).toHaveLength(24)
  s.editor.dispose()
})
