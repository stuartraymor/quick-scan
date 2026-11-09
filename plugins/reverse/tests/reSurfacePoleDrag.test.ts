// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { SceneLayerHost } from '../../../src/viewer/sceneLayers'
import { SurfacePoleDrag } from '../viewer/surfacePoleDrag'

afterEach(() => vi.unstubAllGlobals())
function setup(strength = 100, frame: 'World' | 'Screen' | 'Local' = 'Screen') {
  const win = new EventTarget(); vi.stubGlobal('window', win)
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(),
  })
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100)
  camera.position.z = 20; camera.updateMatrixWorld()
  const partGroup = new THREE.Group(); partGroup.rotation.z = Math.PI / 2; partGroup.updateMatrixWorld()
  const raycaster = new THREE.Raycaster()
  const host = { canvas, camera: () => camera, partGroup, raycaster,
    setPickRay: (x: number, y: number) => raycaster.setFromCamera(new THREE.Vector2(x / 100 - 1, 1 - y / 100), camera),
    claimDrag: vi.fn(), setCursor: vi.fn(), invalidate: vi.fn(),
  } as unknown as SceneLayerHost
  const draw = vi.fn(), commit = vi.fn()
  const drag = new SurfacePoleDrag(host, draw)
  const axis = { degree: 1, count: 2, knots: [0, 1], mults: [2, 2] }
  const surface = { u: axis, v: axis, poles: [[0, 0, 0], [0, 5, 0], [5, 0, 0], [5, 5, 0]] }
  drag.set(surface, commit, strength, frame)
  const event = (type: string, x = 100) => Object.assign(new Event(type), { pointerId: 1, button: 0, clientX: x, clientY: 100 }) as PointerEvent
  return { canvas, draw, commit, layer: drag.layer(), surface, event, win, camera, drag }
}

it('converts a screen-plane drag to the rotated part frame and commits once on release', () => {
  const s = setup()
  expect(s.layer.pointerDown!(s.event('pointerdown'))).toBe(true)
  s.canvas.dispatchEvent(s.event('pointermove', 120))
  expect(s.commit).not.toHaveBeenCalled()
  s.canvas.dispatchEvent(s.event('pointerup', 120))
  expect(s.commit).toHaveBeenCalledTimes(1)
  const moved = s.commit.mock.calls[0][0]
  expect(moved.poles[0][0]).toBeCloseTo(0, 12)
  expect(moved.poles[0][1]).toBeCloseTo(-2, 12)
  expect(moved.poles.slice(1)).toEqual(s.surface.poles.slice(1))
  expect(s.surface.poles[0]).toEqual([0, 0, 0])
  s.canvas.dispatchEvent(s.event('pointerup', 140))
  expect(s.commit).toHaveBeenCalledTimes(1)
  s.layer.dispose()
})

it('restores the original net on pointer cancellation and removes drag listeners', () => {
  const s = setup()
  s.layer.pointerDown!(s.event('pointerdown'))
  s.canvas.dispatchEvent(s.event('pointermove', 120))
  s.canvas.dispatchEvent(s.event('pointercancel'))
  expect(s.draw).toHaveBeenLastCalledWith(s.surface, false)
  s.canvas.dispatchEvent(s.event('pointerup', 120))
  expect(s.commit).not.toHaveBeenCalled()
  s.layer.dispose()
})

it('halves a drag at strength 50 and commits no change at zero strength', () => {
  for (const strength of [50, 0]) {
    const s = setup(strength)
    s.layer.pointerDown!(s.event('pointerdown'))
    s.canvas.dispatchEvent(s.event('pointerup', 120))
    if (strength) expect(s.commit.mock.calls[0][0].poles[0][1]).toBeCloseTo(-1, 12)
    else expect(s.commit).not.toHaveBeenCalled()
    s.layer.dispose()
  }
})

it('Escape restores the original net and a later pointer release cannot commit', () => {
  const s = setup()
  s.layer.pointerDown!(s.event('pointerdown'))
  s.canvas.dispatchEvent(s.event('pointermove', 120))
  s.win.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
  expect(s.draw).toHaveBeenLastCalledWith(s.surface, false)
  s.canvas.dispatchEvent(s.event('pointerup', 120))
  expect(s.commit).not.toHaveBeenCalled()
  s.layer.dispose()
})

it('takes a selected pole horizontal arrow and accumulates its constrained gesture', () => {
  const s = setup()
  s.layer.pointerDown!(s.event('pointerdown'))
  s.canvas.dispatchEvent(s.event('pointerup'))
  expect(s.commit).not.toHaveBeenCalled()
  expect(s.layer.pointerDown!(s.event('pointerdown', 180))).toBe(true)
  const end = s.event('pointerup', 250)
  Object.assign(end, { clientY: 65 })
  s.canvas.dispatchEvent(end)
  const moved = s.commit.mock.calls[0][0]
  // 70,-35 is 87.5 effective horizontal screen pixels, 8.75 model mm.
  expect(moved.poles[0][0]).toBeCloseTo(0, 10)
  expect(moved.poles[0][1]).toBeCloseTo(-8.75, 10)
  expect(moved.poles.slice(1)).toEqual(s.surface.poles.slice(1))
  s.layer.dispose()
})

it.each(['World','Local'] as const)('drags the %s red arrow in a rotated part', frame=>{
 const s=setup(100,frame)
 s.layer.pointerDown!(s.event('pointerdown'));s.canvas.dispatchEvent(s.event('pointerup'))
 expect(s.layer.pointerDown!(s.event('pointerdown',180))).toBe(true)
 const end=s.event('pointerup',250);Object.assign(end,{clientY:65});s.canvas.dispatchEvent(end)
 const moved=s.commit.mock.calls[0][0]
 expect(moved.poles[0][0]).toBeCloseTo(0,10)
 expect(moved.poles[0][1]).toBeCloseTo(-8.75,10)
 expect(moved.poles.slice(1)).toEqual(s.surface.poles.slice(1))
 s.layer.dispose()
})
it('drags Local green along its frame axis',()=>{
 const s=setup(100,'Local')
 s.layer.pointerDown!(s.event('pointerdown'));s.canvas.dispatchEvent(s.event('pointerup'))
 const down=s.event('pointerdown');Object.assign(down,{clientY:20})
 expect(s.layer.pointerDown!(down)).toBe(true)
 const end=s.event('pointerup',135);Object.assign(end,{clientY:-50});s.canvas.dispatchEvent(end)
 const p=s.commit.mock.calls[0][0].poles[0]
 expect(p[0]).toBeCloseTo(8.75,10);expect(p[1]).toBeCloseTo(0,10);expect(p[2]).toBe(0)
 s.layer.dispose()
})
it('drags the World XY plane with projected screen motion',()=>{
 const s=setup(100,'World')
 s.layer.pointerDown!(s.event('pointerdown'));s.canvas.dispatchEvent(s.event('pointerup'))
 const down=s.event('pointerdown',140);Object.assign(down,{clientY:60})
 expect(s.layer.pointerDown!(down)).toBe(true)
 const end=s.event('pointerup',160);Object.assign(end,{clientY:70});s.canvas.dispatchEvent(end)
 const p=s.commit.mock.calls[0][0].poles[0]
 expect(p[0]).toBeCloseTo(-1,10);expect(p[1]).toBeCloseTo(-2,10);expect(p[2]).toBe(0)
 s.layer.dispose()
})

it('projects free screen motion onto an oblique World plane instead of intersecting rays',()=>{
 const s=setup(100,'World')
 s.camera.position.set(0,12,16);s.camera.lookAt(0,0,0);s.camera.updateMatrixWorld()
 s.layer.pointerDown!(s.event('pointerdown'));s.canvas.dispatchEvent(s.event('pointerup'))
 // World X projects right; World Y projects up by 0.8 at this camera angle.
 const down=s.event('pointerdown',140);Object.assign(down,{clientY:68})
 expect(s.layer.pointerDown!(down)).toBe(true)
 const end=s.event('pointerup',160);Object.assign(end,{clientY:58});s.canvas.dispatchEvent(end)
 const p=s.commit.mock.calls[0][0].poles[0]
 // Free camera-plane delta is world(2,0.8,-0.6); drop Z for XY.
 // With the part rotated90deg, this is local(0.8,-2,0).
 expect(p[0]).toBeCloseTo(.8,10);expect(p[1]).toBeCloseTo(-2,10);expect(p[2]).toBeCloseTo(0,10)
 s.layer.dispose()
})
