// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { SceneLayerHost } from '../../../src/viewer/sceneLayers'
import type { Cage } from '../core/freeform/cage'
import { FreeformEditorLayer, type FreeformEditorOptions, type FreeformSelectionMode } from '../viewer/freeformEditorLayer'

afterEach(() => vi.unstubAllGlobals())

it('axis handles constrain translation and preserve unselected vertices', () => {
  const s = setup({ selection: [{kind:'vertex', index:0}], manipulator:'world' })
  expect(s.layer.pointerDown!(s.event('pointerdown',157,100))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointerup',177,120))
  const result = s.onCommit.mock.calls[0][0] as Cage
  expect(result.positions[0]).toBeCloseTo(2); expect(Array.from(result.positions.slice(1,3))).toEqual([0,0])
  expect(Array.from(result.positions.slice(3))).toEqual(Array.from(s.cage.positions.slice(3)))
  s.editor.dispose()
})
it('Boundary selection excludes a shared internal edge', () => {
  const input: Cage = {positions:Float64Array.from([0,0,0, 5,0,0, 5,5,0, 0,5,0, 10,0,0, 10,5,0]),faces:[[0,1,2,3],[1,4,5,2]],creases:[]}
  const s = setup({mode:'boundary'},input)
  s.canvas.dispatchEvent(s.event('contextmenu',150,75))
  expect(s.onContext.mock.lastCall?.[2]).toBeNull()
  s.canvas.dispatchEvent(s.event('contextmenu',125,100))
  expect(s.onContext.mock.lastCall?.[2]?.kind).toBe('edge')
  expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})
it('refreshes boundary picking after replacing the cage topology', () => {
  const s = setup({mode:'boundary'})
  s.canvas.dispatchEvent(s.event('contextmenu',150,75))
  expect(s.onContext.mock.lastCall?.[2]?.kind).toBe('edge')
  const extended:Cage={positions:Float64Array.from([0,0,0,5,0,0,5,5,0,0,5,0,10,0,0,10,5,0]),faces:[[0,1,2,3],[1,4,5,2]],creases:[]}
  s.editor.set(extended,{mode:'boundary',onContext:s.onContext})
  for(let i=0;i<10;i++)s.layer.tick!(200,200)
  s.canvas.dispatchEvent(s.event('contextmenu',150,75))
  expect(s.onContext.mock.lastCall?.[2]).toBeNull()
  s.canvas.dispatchEvent(s.event('contextmenu',200,75))
  expect(s.onContext.mock.lastCall?.[2]?.kind).toBe('edge')
  s.editor.dispose()
})
it('world and local manipulator frames respect the part rotation', () => {
  for (const frame of ['world','local'] as const) {
    const s = setup({selection:[{kind:'vertex',index:0}],manipulator:frame})
    s.partGroup.rotation.z = Math.PI/2; s.layer.tick!(200,200)
    const x = frame==='world'?157:100, y=frame==='world'?100:43
    s.layer.pointerDown!(s.event('pointerdown',x,y))
    s.canvas.dispatchEvent(s.event('pointerup',x+20,y-20))
    const result = s.onCommit.mock.calls[0][0] as Cage
    expect(result.positions[0]).toBeCloseTo(frame==='world'?0:2)
    expect(result.positions[1]).toBeCloseTo(frame==='world'?-2:0)
    s.editor.dispose()
  }
})
it('view-facing rotation ring rotates a selected face around its centre', () => {
  const s = setup({selection:[{kind:'face',index:0}],manipulator:'world'})
  s.layer.pointerDown!(s.event('pointerdown',125+48/Math.sqrt(2),75-48/Math.sqrt(2)))
  s.canvas.dispatchEvent(s.event('pointerup',125,27))
  const result = s.onCommit.mock.calls[0][0] as Cage
  expect(result.positions[0]).toBeCloseTo(2.5)
  expect(result.positions[1]).toBeCloseTo(2.5-5/Math.sqrt(2))
  expect(result.faces).toEqual(s.cage.faces)
  s.editor.dispose()
})
it('scale handles scale only their axis and Escape cancels a subsequent handle drag', () => {
  const s = setup({selection:[{kind:'face',index:0}],manipulator:'world'})
  s.layer.pointerDown!(s.event('pointerdown',219,75))
  s.canvas.dispatchEvent(s.event('pointerup',313,75))
  const result = s.onCommit.mock.calls[0][0] as Cage
  expect(result.positions[0]).toBeCloseTo(-2.5); expect(result.positions[3]).toBeCloseTo(7.5)
  expect(result.positions[1]).toBe(0); expect(result.positions[7]).toBe(5)
  s.layer.pointerDown!(s.event('pointerdown',182,75)); s.canvas.dispatchEvent(s.event('pointermove',192,75))
  s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}))
  s.canvas.dispatchEvent(s.event('pointerup',192,75))
  expect(s.onCommit).toHaveBeenCalledTimes(1)
  s.editor.dispose()
})
function setup(options: FreeformEditorOptions = {}, input?: Cage) {
  const win = new EventTarget(); vi.stubGlobal('window', win)
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }), setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
  camera.position.z = 20; camera.updateMatrixWorld()
  const partGroup = new THREE.Group(), raycaster = new THREE.Raycaster()
  const host = { canvas, camera: () => camera, partGroup, raycaster, modelRadius: () => 10,
    setPickRay: (x: number, y: number) => raycaster.setFromCamera(new THREE.Vector2(x / 100 - 1, 1 - y / 100), camera),
    claimDrag: vi.fn(), setCursor: vi.fn(), invalidate: vi.fn(), pickScan: vi.fn(() => ({ point: [1, 2, 3] })),
  } as unknown as SceneLayerHost
  const cage: Cage = input ?? { positions: Float64Array.from([0, 0, 0, 5, 0, 0, 5, 5, 0, 0, 5, 0]), faces: [[0, 1, 2, 3]], creases: [] }
  const onCommit = vi.fn(), onSelection = vi.fn(), onPreview = vi.fn(), onContext = vi.fn()
  const editor = new FreeformEditorLayer(host)
  editor.set(cage, { onCommit, onSelection, onPreview, onContext, ...options })
  const event = (type: string, x = 100, y = 100, extra = {}) => Object.assign(new Event(type), { pointerId: 1, button: 0, clientX: x, clientY: y, ...extra }) as PointerEvent
  return { editor, layer: editor.layer(), cage, host, canvas, win, event, onCommit, onSelection, onPreview, onContext, partGroup }
}
it('moves a picked vertex on release only and preserves the source cage', () => {
  const s = setup()
  expect(s.layer.pointerDown!(s.event('pointerdown'))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointermove', 120))
  expect(s.onCommit).not.toHaveBeenCalled()
  s.canvas.dispatchEvent(s.event('pointerup', 120))
  expect(s.onCommit).toHaveBeenCalledTimes(1)
  expect(s.onCommit.mock.calls[0][0].positions[0]).toBeCloseTo(2)
  expect(s.cage.positions[0]).toBe(0)
  s.editor.dispose()
})
it('cancels Escape and pointercancel without a history commit', () => {
  for (const escape of [true, false]) {
    const s = setup()
    s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointermove', 130))
    if (escape) s.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
    else s.canvas.dispatchEvent(s.event('pointercancel', 130))
    s.canvas.dispatchEvent(s.event('pointerup', 130))
    expect(s.onCommit).not.toHaveBeenCalled()
    expect(s.onPreview.mock.lastCall).toEqual([s.cage, false])
    s.editor.dispose()
  }
})
it('does not commit clicks or out-and-back gestures', () => {
  const s = setup()
  s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointerup'))
  s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointermove', 120)); s.canvas.dispatchEvent(s.event('pointerup'))
  expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})
it('moves an edge normally and extends only the enabled duplicate handle', () => {
  for (const duplicateHandle of [false, true]) {
    const s = setup({ selection: [{ kind: 'edge', index: 0 }], duplicateHandle })
    s.layer.pointerDown!(s.event('pointerdown', 125, 100)); s.canvas.dispatchEvent(s.event('pointerup', 125, 120))
    expect(s.onCommit).toHaveBeenCalledTimes(1)
    const result = s.onCommit.mock.calls[0][0] as Cage
    expect(result.faces.length).toBe(duplicateHandle ? 2 : 1)
    expect(result.positions.length).toBe(duplicateHandle ? 18 : 12)
    if (duplicateHandle) expect(Array.from(result.positions.slice(0, 12))).toEqual(Array.from(s.cage.positions))
    else { expect(result.positions[1]).toBeCloseTo(-2); expect(result.positions[4]).toBeCloseTo(-2) }
    s.editor.dispose()
  }
})
it('selects faces and moves all their vertices together', () => {
  const s = setup({ mode: 'faces' })
  expect(s.layer.pointerDown!(s.event('pointerdown', 125, 75))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointerup', 145, 75))
  expect(s.onSelection).toHaveBeenCalledWith([{ kind: 'face', index: 0 }])
  const result = s.onCommit.mock.calls[0][0] as Cage
  for (let i = 0; i < 4; i++) expect(result.positions[i * 3] - s.cage.positions[i * 3]).toBeCloseTo(2)
  s.editor.dispose()
})
it('hidden faces cannot be selected through vertices, edges or face interiors', () => {
  for (const mode of ['points-edges', 'points', 'edges', 'faces', 'all'] as const) {
    const s = setup({ mode, hiddenFaces: [0] })
    for (const [x, y] of [[100, 100], [125, 100], [125, 75]]) { expect(s.layer.pointerDown!(s.event('pointerdown', x, y))).toBe(true);s.canvas.dispatchEvent(s.event('pointercancel',x,y)) }
    expect(s.onSelection).not.toHaveBeenCalled(); s.editor.dispose()
  }
})

it('selects a sloped face boundary a few pixels inside the visible line', () => {
  const sloped:Cage={positions:Float64Array.from([0,0,0,5,0,0,5,5,5,0,5,5]),faces:[[0,1,2,3]],creases:[]}
  const s=setup({mode:'edges'},sloped)
  s.canvas.dispatchEvent(s.event('contextmenu',125,98))
  expect(s.onContext.mock.lastCall?.[2]).toEqual({kind:'edge',index:0})
  s.editor.dispose()
})
it('selects a sloped face corner near its interior without selecting an obscured rear corner', () => {
  const sloped:Cage={positions:Float64Array.from([0,0,0,5,0,0,5,5,5,0,5,5]),faces:[[0,1,2,3]],creases:[]}
  const s=setup({mode:'points'},sloped)
  s.canvas.dispatchEvent(s.event('contextmenu',102,98))
  expect(s.onContext.mock.lastCall?.[2]).toEqual({kind:'vertex',index:0})
  s.editor.dispose()
  // The foreground face is less than the point-pick depth allowance away,
  // so only face ownership can prevent a rear point leaking through.
  const covered:Cage={positions:Float64Array.from([0,0,0,5,0,0,5,5,0,0,5,0,-2,-2,.7,7,-2,.7,7,7,.7,-2,7,.7]),faces:[[0,1,2,3],[4,5,6,7]],creases:[]}
  const rear=setup({mode:'points'},covered)
  rear.canvas.dispatchEvent(rear.event('contextmenu',100,100))
  expect(rear.onContext.mock.lastCall?.[2]).toBeNull()
  rear.editor.dispose()
})

it('selection filters take only their entity types, with points then edges then faces in All', () => {
  const expected: Record<FreeformSelectionMode, (string | null)[]> = {
    'points-edges': ['vertex', 'edge', null], points: ['vertex', null, null],
    edges: ['edge', 'edge', null], boundary: ['edge', 'edge', null], faces: ['face', 'face', 'face'], all: ['vertex', 'edge', 'face'],
  }
  for (const mode of Object.keys(expected) as FreeformSelectionMode[]) {
    const s = setup({ mode })
    for (const [i, [x, y]] of [[100, 100], [125, 100], [125, 75]].entries()) {
      s.canvas.dispatchEvent(s.event('contextmenu', x, y))
      expect(s.onContext.mock.lastCall?.[2]?.kind ?? null, `${mode} at ${x},${y}`).toBe(expected[mode][i])
    }
    expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
  }
})

it('changing filters preserves selected points while hiding unselected point markers in Edges and Faces', () => {
  const selection = [{ kind: 'vertex' as const, index: 0 }], s = setup({ selection })
  const markers = () => (s.partGroup.children[0] as THREE.Group).children.find(object => object instanceof THREE.Points) as THREE.Points
  expect(markers().geometry.getAttribute('position').count).toBe(4)
  for (const mode of ['edges', 'faces', 'points', 'all'] as const) {
    s.editor.set(s.cage, { mode, selection, onSelection: s.onSelection, onCommit: s.onCommit })
    const positions = markers().geometry.getAttribute('position'), colors = markers().geometry.getAttribute('color')
    expect(positions.count).toBe(mode === 'edges' || mode === 'faces' ? 1 : 4)
    expect([positions.getX(0), positions.getY(0), positions.getZ(0)]).toEqual([0, 0, 0])
    expect(colors.getX(0)).toBe(1) // selected yellow remains visible
  }
  expect(s.onSelection).not.toHaveBeenCalled(); expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})

it('a retained selected edge cannot duplicate through Points or Faces filters', () => {
  for (const mode of ['points', 'faces'] as const) {
    const s = setup({ mode, selection: [{ kind: 'edge', index: 0 }], duplicateHandle: true })
    const claimed = s.layer.pointerDown!(s.event('pointerdown', 125, 100))
    if (mode === 'points') {
      expect(claimed).toBe(true)
      // Empty-space box release clears the preserved, filtered-out edge.
      s.canvas.dispatchEvent(s.event('pointerup',125,100))
      expect(s.onSelection).toHaveBeenLastCalledWith([])
    } else {
      expect(claimed).toBe(true)
      expect(s.onSelection).toHaveBeenLastCalledWith([{ kind: 'face', index: 0 }])
    }
    s.canvas.dispatchEvent(s.event('pointerup', 125, 120))
    for (const call of s.onCommit.mock.calls) expect((call[0] as Cage).faces).toHaveLength(1)
    if (mode === 'points') expect(s.onCommit).not.toHaveBeenCalled()
    s.editor.dispose()
  }
})

const roundedCube = (): Cage => ({
  positions: Float64Array.from([-5,-5,-5, 5,-5,-5, 5,5,-5, -5,5,-5, -5,-5,5, 5,-5,5, 5,5,5, -5,5,5]),
  faces: [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]], creases: [],
})

it('curved face picking rejects empty space inside the raw cage silhouette', () => {
  const s = setup({ mode: 'faces' }, roundedCube())
  // A ray at (4.8,4.8) meets the raw cube top, but misses the rounded limit surface.
  expect(s.layer.pointerDown!(s.event('pointerdown', 148, 52))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointerup',148,52))
  s.canvas.dispatchEvent(s.event('contextmenu', 148, 52))
  expect(s.onContext.mock.lastCall?.[2]).toBeNull()
  expect(s.layer.pointerDown!(s.event('pointerdown', 100, 100))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointerup', 100, 100))
  expect(s.onSelection).toHaveBeenLastCalledWith([{ kind: 'face', index: 1 }])
  expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})

it('curved face picking maps the rendered side to its owning cage face and skips a hidden owner', () => {
  const s = setup({ mode: 'faces' }, roundedCube())
  // Near the round-over's right-hand silhouette, the side owns the visible surface,
  // whereas a raw cube proxy would incorrectly report its top face.
  s.canvas.dispatchEvent(s.event('contextmenu', 132.5, 100))
  expect(s.onContext.mock.lastCall?.[2]).toEqual({ kind: 'face', index: 3 })
  s.editor.set(s.cage, { mode: 'faces', hiddenFaces: [3], onContext: s.onContext })
  s.canvas.dispatchEvent(s.event('contextmenu', 132.5, 100))
  expect(s.onContext.mock.lastCall?.[2]?.index).not.toBe(3)
  s.editor.set(s.cage, { mode: 'faces', hiddenFaces: [0, 1, 2], onContext: s.onContext })
  s.canvas.dispatchEvent(s.event('contextmenu', 132.5, 100))
  expect(s.onContext.mock.lastCall?.[2]).toEqual({ kind: 'face', index: 3 })
  s.editor.dispose()
})

it('face picking follows snapped display geometry rather than the original control polygon', () => {
  const s = setup({ mode: 'faces', snapPoint: p => [p[0] + 3, p[1], 0.2 * p[0] * p[0]] })
  s.canvas.dispatchEvent(s.event('contextmenu', 165, 75)) // displayed surface outside raw x <= 5
  expect(s.onContext.mock.lastCall?.[2]).toEqual({ kind: 'face', index: 0 })
  s.canvas.dispatchEvent(s.event('contextmenu', 110, 75)) // old surface footprint is now empty
  expect(s.onContext.mock.lastCall?.[2]).toBeNull()
  expect(s.cage.positions[0]).toBe(0); expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})
it('Ctrl toggles selection without moving geometry', () => {
  const s = setup({ selection: [{ kind: 'vertex', index: 0 }] })
  s.layer.pointerDown!(s.event('pointerdown', 150, 100, { ctrlKey: true }))
  expect(s.onSelection).toHaveBeenLastCalledWith([{ kind: 'vertex', index: 0 }, { kind: 'vertex', index: 1 }])
  s.layer.pointerDown!(s.event('pointerdown', 100, 100, { ctrlKey: true }))
  expect(s.onSelection).toHaveBeenLastCalledWith([{ kind: 'vertex', index: 1 }])
  expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})
it('context click on selected geometry retains the multiple selection', () => {
  const selection = [{ kind: 'vertex' as const, index: 0 }, { kind: 'vertex' as const, index: 1 }]
  const s = setup({ selection })
  s.canvas.dispatchEvent(s.event('contextmenu'))
  expect(s.onSelection).not.toHaveBeenCalled()
  expect(s.onContext).toHaveBeenCalledWith(100, 100, selection[0]); s.editor.dispose()
})
it('right click adds a new entity and keeps the existing context selection', () => {
  const s = setup({ selection: [{ kind: 'vertex', index: 0 }] })
  s.canvas.dispatchEvent(s.event('contextmenu', 150, 100))
  expect(s.onSelection).toHaveBeenLastCalledWith([
    { kind: 'vertex', index: 0 }, { kind: 'vertex', index: 1 },
  ])
  s.canvas.dispatchEvent(s.event('contextmenu', 150, 100))
  s.canvas.dispatchEvent(s.event('contextmenu', 180, 180))
  expect(s.onSelection).toHaveBeenCalledTimes(1)
  s.editor.dispose()
})
it('right click on another edge keeps the original edge selected', () => {
  const s = setup({ selection: [{ kind: 'edge', index: 0 }], mode: 'edges' })
  s.canvas.dispatchEvent(s.event('contextmenu', 150, 75))
  expect(s.onSelection.mock.lastCall?.[0]).toEqual([
    { kind: 'edge', index: 0 }, { kind: 'edge', index: 1 },
  ])
  s.editor.dispose()
})
it('uses scan picks for creation and prevents fall-through', () => {
  const onCreatePoint = vi.fn(), s = setup({ creating: true, onCreatePoint })
  expect(s.layer.click!(130, 130, false)).toBe(true)
  expect(onCreatePoint).toHaveBeenCalledWith([1, 2, 3]); s.editor.dispose()
})
it('converts movement into the part coordinate frame', () => {
  const s = setup(); s.partGroup.rotation.z = Math.PI / 2; s.partGroup.updateMatrixWorld()
  s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointerup', 120))
  const result = s.onCommit.mock.calls[0][0] as Cage
  expect(result.positions[0]).toBeCloseTo(0); expect(result.positions[1]).toBeCloseTo(-2)
  s.editor.dispose()
})
it('zero strength and snapping back to the source do not create history entries', () => {
  for (const options of [{ strength: 0 }, { snapPoint: () => [0, 0, 0] as [number, number, number] }]) {
    const s = setup(options)
    s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointerup', 120))
    expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
  }
})
it('snap failures cancel and release the gesture rather than committing a partial cage', () => {
  const onError = vi.fn(), s = setup({ snapPoint: () => { throw new Error('snap failed') }, onError })
  s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointermove', 120))
  s.canvas.dispatchEvent(s.event('pointerup', 120))
  expect(s.onCommit).not.toHaveBeenCalled()
  expect(onError.mock.calls[0][0].message).toBe('snap failed')
  expect(s.onPreview.mock.lastCall).toEqual([s.cage, false]); s.editor.dispose()
})
it('selection feedback through set does not cancel a drag on the same source cage', () => {
  const s = setup()
  s.layer.pointerDown!(s.event('pointerdown'))
  s.editor.set(s.cage, { selection: [{ kind: 'vertex', index: 0 }], onCommit: s.onCommit })
  s.canvas.dispatchEvent(s.event('pointerup', 120))
  expect(s.onCommit).toHaveBeenCalledTimes(1); s.editor.dispose()
})
it('disabled editor consumes clicks without selecting, creating, or dragging', () => {
  const onCreatePoint = vi.fn(), s = setup({ enabled: false, creating: true, onCreatePoint })
  expect(s.layer.pointerDown!(s.event('pointerdown'))).toBe(true)
  expect(s.layer.click!(100, 100, false)).toBe(true)
  s.canvas.dispatchEvent(s.event('contextmenu'))
  expect(s.onSelection).not.toHaveBeenCalled(); expect(s.onContext).not.toHaveBeenCalled(); expect(onCreatePoint).not.toHaveBeenCalled()
  expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})
it('projects refined preview samples onto the scan without changing the cage', () => {
  const snapPoint = vi.fn((p: [number, number, number]): [number, number, number] => [p[0], p[1], 2])
  const s = setup({ snapPoint })
  const group = s.partGroup.children[0] as THREE.Group
  const surface = group.children[0] as THREE.Mesh
  const positions = surface.geometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) expect(positions.getZ(i)).toBe(2)
  const calls = snapPoint.mock.calls.length
  s.layer.hover!({ x: 100, y: 100 }, false)
  expect(snapPoint).toHaveBeenCalledTimes(calls)
  expect(s.cage.positions[2]).toBe(0); s.editor.dispose()
})
it('rejects an extension parallel to the boundary edge without creating a degenerate face', () => {
  const s = setup({ selection: [{ kind: 'edge', index: 0 }], duplicateHandle: true })
  s.layer.pointerDown!(s.event('pointerdown', 125, 100)); s.canvas.dispatchEvent(s.event('pointerup', 145, 100))
  expect(s.onCommit).not.toHaveBeenCalled(); expect(s.onPreview.mock.lastCall).toEqual([s.cage, false]); s.editor.dispose()
})
it('cancels uncommitted dragging before an undo shortcut and ignores the stale release', () => {
  const s = setup()
  s.layer.pointerDown!(s.event('pointerdown')); s.canvas.dispatchEvent(s.event('pointermove', 120))
  s.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'z', ctrlKey: true }))
  s.canvas.dispatchEvent(s.event('pointerup', 120))
  expect(s.onCommit).not.toHaveBeenCalled(); expect(s.onPreview.mock.lastCall).toEqual([s.cage, false]); s.editor.dispose()
})
it('does not commit an extension when snapping collapses its new edges', () => {
  const s = setup({ selection: [{ kind: 'edge', index: 0 }], duplicateHandle: true, snapPoint: p => [p[0], 0, 0] })
  s.layer.pointerDown!(s.event('pointerdown', 125, 100)); s.canvas.dispatchEvent(s.event('pointerup', 125, 120))
  expect(s.onCommit).not.toHaveBeenCalled(); s.editor.dispose()
})

const strip: Cage = { positions: Float64Array.from([0,0,0, 5,0,0, 10,0,0, 0,5,0, 5,5,0, 10,5,0]), faces:[[0,1,4,3],[1,2,5,4]], creases:[] }
it('double-click selects the boundary line, stops at corners and does not change geometry', () => {
  const s=setup({},strip)
  s.canvas.dispatchEvent(s.event('dblclick',125,100))
  expect(s.onSelection.mock.lastCall?.[0]).toEqual([{kind:'edge',index:0},{kind:'edge',index:4}])
  expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})
it('double-click cannot traverse a hidden face and respects the points-only filter', () => {
  for(const options of [{hiddenFaces:[1]}, {mode:'points' as const}]) {
    const s=setup(options,strip);s.canvas.dispatchEvent(s.event('dblclick',125,100))
    if(options.mode) expect(s.onSelection).not.toHaveBeenCalled()
    else expect(s.onSelection.mock.lastCall?.[0]).toEqual([{kind:'edge',index:0}])
    s.editor.dispose()
  }
})
it('D drag extends an entire boundary line with a welded shared vertex and selects the new boundary', () => {
  const s=setup({duplicateHandle:true},strip)
  s.canvas.dispatchEvent(s.event('dblclick',125,100))
  s.layer.pointerDown!(s.event('pointerdown',125,100));s.canvas.dispatchEvent(s.event('pointerup',125,120))
  expect(s.onCommit).toHaveBeenCalledTimes(1)
  const [next,picks]=s.onCommit.mock.calls[0] as [Cage,{kind:string;index:number}[]]
  expect(next.faces).toHaveLength(4);expect(next.positions.length/3).toBe(9)
  expect(next.faces[2].filter(v=>next.faces[3].includes(v))).toHaveLength(2)
  expect(picks).toHaveLength(2);expect(picks.every(p=>p.kind==='edge')).toBe(true)
  expect(Array.from(next.positions.slice(0,18))).toEqual(Array.from(strip.positions))
  s.editor.dispose()
})
it('multi-edge D drag cancellation preserves the original cage and creates no commit', () => {
  const s=setup({duplicateHandle:true},strip);s.canvas.dispatchEvent(s.event('dblclick',125,100))
  s.layer.pointerDown!(s.event('pointerdown',125,100));s.canvas.dispatchEvent(s.event('pointermove',125,120))
  s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}));s.canvas.dispatchEvent(s.event('pointerup',125,120))
  expect(s.onCommit).not.toHaveBeenCalled();expect(s.onPreview.mock.lastCall?.[0]).toBe(strip);s.editor.dispose()
})
it('D handle has copy cursor while plain edge dragging still moves existing vertices', () => {
  const s=setup({duplicateHandle:true},strip);s.canvas.dispatchEvent(s.event('dblclick',125,100))
  s.layer.hover!({x:125,y:100},false);expect(s.host.setCursor).toHaveBeenCalledWith('copy')
  s.layer.pointerDown!(s.event('pointerdown',110,100));s.canvas.dispatchEvent(s.event('pointerup',110,120))
  expect(s.onCommit.mock.calls[0][0].faces).toHaveLength(2);s.editor.dispose()
})

it('two released pointer clicks select a line even when the scene suppresses mouse events', () => {
 const s=setup({},strip)
 for(let i=0;i<2;i++){s.layer.pointerDown!(s.event('pointerdown',125,100));s.canvas.dispatchEvent(s.event('pointerup',125,100))}
 expect(s.onSelection.mock.lastCall?.[0]).toEqual([{kind:'edge',index:0},{kind:'edge',index:4}]);expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})

it('Control Net off keeps unselected boundary edges available to context selection', () => {
 const s=setup({controlNet:false,mode:'edges'})
 s.canvas.dispatchEvent(s.event('contextmenu',125,100));expect(s.onContext.mock.lastCall?.[2]).toEqual({kind:'edge',index:0});s.editor.dispose()
})
it('Control Net off picks a deformed boundary anchor at the surface limit, not the raw pole', () => {
 const bent:Cage={...strip,positions:strip.positions.slice()};bent.positions[4]=-12
 const s=setup({controlNet:false,mode:'points'},bent)
 // Boundary limit mask: (left + 4*middle + right)/6 -> (5,-8,0).
 s.canvas.dispatchEvent(s.event('contextmenu',150,180));expect(s.onContext.mock.lastCall?.[2]).toEqual({kind:'vertex',index:1})
 s.canvas.dispatchEvent(s.event('contextmenu',150,220));expect(s.onContext.mock.lastCall?.[2]).toBeNull();s.editor.dispose()
})
it('hidden surface-mode geometry remains unpickable', () => {
 const s=setup({controlNet:false,hiddenFaces:[0],mode:'edges'});s.canvas.dispatchEvent(s.event('contextmenu',125,100));expect(s.onContext.mock.lastCall?.[2]).toBeNull();s.editor.dispose()
})
it('surface-mode boundary line can be duplicated without revealing the raw control net', () => {
 const s=setup({controlNet:false,duplicateHandle:true},strip);s.canvas.dispatchEvent(s.event('dblclick',125,100))
 s.layer.pointerDown!(s.event('pointerdown',125,100));s.canvas.dispatchEvent(s.event('pointermove',125,120));s.canvas.dispatchEvent(s.event('pointerup',125,120))
 expect(s.onCommit).toHaveBeenCalledTimes(1);expect(s.onCommit.mock.calls[0][0].faces).toHaveLength(4);expect(s.onCommit.mock.calls[0][0].positions.length/3).toBe(9);s.editor.dispose()
})

it('Extrapolate mode extends an edge away from the D handle and Undo source remains immutable', () => {
 const s=setup({extrapolate:true,duplicateHandle:false,selection:[{kind:'edge',index:0}]})
 s.layer.pointerDown!(s.event('pointerdown',115,100));s.canvas.dispatchEvent(s.event('pointerup',115,130))
 const result=s.onCommit.mock.calls[0][0] as Cage
 expect(result.faces).toHaveLength(2);expect(Array.from(result.positions.slice(0,12))).toEqual(Array.from(s.cage.positions));s.editor.dispose()
})
it('Extrapolate mode rejects internal edges instead of moving them', () => {
 const s=setup({extrapolate:true,duplicateHandle:false},strip)
 s.layer.pointerDown!(s.event('pointerdown',150,75));s.canvas.dispatchEvent(s.event('pointerup',175,75))
 expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})
it('Extrapolate mode cancellation leaves no geometry or history change', () => {
 const s=setup({extrapolate:true,duplicateHandle:false})
 s.layer.pointerDown!(s.event('pointerdown',115,100));s.canvas.dispatchEvent(s.event('pointermove',115,130));s.canvas.dispatchEvent(s.event('pointercancel',115,130))
 expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})

it('box selection encloses edges in either direction and excludes partial edges', () => {
 for(const reverse of [false,true]){
 const s=setup({mode:'edges'});const a: [number,number]=reverse?[160,110]:[90,40],b: [number,number]=reverse?[90,40]:[160,110]
 s.layer.pointerDown!(s.event('pointerdown',...a));s.canvas.dispatchEvent(s.event('pointerup',...b));expect(s.onSelection.mock.lastCall?.[0]).toHaveLength(4)
 s.layer.pointerDown!(s.event('pointerdown',90,65));s.canvas.dispatchEvent(s.event('pointerup',110,85));expect(s.onSelection.mock.lastCall?.[0]).toEqual([]);expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
 }
})
it('box selection filters points and faces and excludes hidden geometry', () => {
 for(const mode of ['points','faces'] as const){const s=setup({mode});s.layer.pointerDown!(s.event('pointerdown',90,40));s.canvas.dispatchEvent(s.event('pointerup',160,110));expect(s.onSelection.mock.lastCall?.[0]).toHaveLength(mode==='points'?4:1);s.editor.dispose()}
 const s=setup({mode:'all',hiddenFaces:[0]});s.layer.pointerDown!(s.event('pointerdown',90,40));s.canvas.dispatchEvent(s.event('pointerup',160,110));expect(s.onSelection.mock.lastCall?.[0]).toEqual([]);s.editor.dispose()
})
it('Escape cancels a box without replacing the existing selection', () => {
 const s=setup({mode:'points',selection:[{kind:'vertex',index:0}]});s.layer.pointerDown!(s.event('pointerdown',90,40));s.canvas.dispatchEvent(s.event('pointermove',160,110));s.win.dispatchEvent(Object.assign(new Event('keydown'),{key:'Escape'}));s.canvas.dispatchEvent(s.event('pointerup',160,110));expect(s.onSelection).not.toHaveBeenCalled();expect(s.onCommit).not.toHaveBeenCalled();s.editor.dispose()
})
it('a selected rear boundary does not expose a D handle through a foreground face', () => {
 const input:Cage={positions:Float64Array.from([0,0,0,5,0,0,5,5,0,0,5,0,-2,-2,2,7,-2,2,7,7,2,-2,7,2]),faces:[[0,1,2,3],[4,5,6,7]],creases:[]}
 const s=setup({duplicateHandle:true,selection:[{kind:'edge',index:0}]},input)
 expect((s.editor as any).duplicateAnchor()).toBeNull();s.editor.dispose()
})
