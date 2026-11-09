// SPDX-License-Identifier: AGPL-3.0-only
// Settings → Navigation, the two options QUICKSURFACE's Software options has that Quick Scan lacked:
// Mouse wheel sensitivity (Min … Max, Max to start) and Use navigation cube for setting standard views.
import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrthoNavigator } from '../src/viewer/orthoNav'
import { AxisGizmo } from '../src/viewer/axisGizmo'
import { usePrefs } from '../src/state/prefsStore'

type Listener = (e: Partial<WheelEvent> & { preventDefault?: () => void }) => void

describe('mouse wheel sensitivity', () => {
  let on: Record<string, Listener[]>
  let nav: OrthoNavigator
  let camera: THREE.OrthographicCamera
  const wheel = (deltaY: number) => {
    for (const l of on.wheel ?? []) l({ deltaY, clientX: 400, clientY: 300, preventDefault: () => {} })
  }
  beforeEach(() => {
    on = {}
    const listen = (type: string, l: Listener) => { (on[type] ??= []).push(l) }
    vi.stubGlobal('document', { addEventListener: listen, removeEventListener: () => {} })
    const canvas = {
      addEventListener: listen, removeEventListener: () => {}, clientHeight: 600,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    } as unknown as HTMLCanvasElement
    camera = new THREE.OrthographicCamera(-4 / 3, 4 / 3, 1, -1, 0.01, 100)
    camera.position.set(0, 0, 10)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
    nav = new OrthoNavigator(camera, { target: new THREE.Vector3(), update: () => {} } as unknown as OrbitControls, canvas, () => [], { center: new THREE.Vector3(), radius: 1 })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('Max, the start, zooms by the same notch as before (10 %)', () => {
    expect(nav.wheelSensitivity).toBe(1)
    const before = camera.zoom
    wheel(-100)
    wheel(100)
    expect(camera.zoom).toBeCloseTo(before, 9) // a notch each way cancels
    wheel(-100)
    const ratio = camera.zoom / before
    expect(Math.abs(Math.abs(Math.log(ratio)) - Math.log(1.1))).toBeLessThan(1e-9)
  })

  it('Min zooms by a tenth as much, and nothing outside Min…Max is believed', () => {
    const before = camera.zoom
    nav.wheelSensitivity = 0.1
    wheel(-100)
    const ratio = camera.zoom / before
    expect(Math.abs(Math.abs(Math.log(ratio)) - Math.log(1.01))).toBeLessThan(1e-9)
    const mid = camera.zoom
    nav.wheelSensitivity = -5 // below Min: held at Min
    wheel(-100)
    expect(Math.abs(Math.abs(Math.log(camera.zoom / mid)) - Math.log(1.01))).toBeLessThan(1e-9)
  })
})

describe('the setting', () => {
  it('starts at Max and with the cube on; clamps; Defaults puts both back', () => {
    const s = usePrefs.getState()
    expect(s.wheelSensitivity).toBe(1)
    expect(s.navigationCube).toBe(true)
    s.setWheelSensitivity(0.4)
    s.setNavigationCube(false)
    expect(usePrefs.getState().wheelSensitivity).toBeCloseTo(0.4)
    expect(usePrefs.getState().navigationCube).toBe(false)
    usePrefs.getState().setWheelSensitivity(7)
    expect(usePrefs.getState().wheelSensitivity).toBe(1)
    usePrefs.getState().setWheelSensitivity(Number.NaN)
    expect(usePrefs.getState().wheelSensitivity).toBe(1)
    usePrefs.getState().setWheelSensitivity(0.2)
    usePrefs.getState().navigationDefaults()
    expect(usePrefs.getState().wheelSensitivity).toBe(1)
    expect(usePrefs.getState().navigationCube).toBe(true)
  })
})

describe('the navigation cube switched off', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillText: vi.fn() }) }) })
  })
  afterEach(() => vi.unstubAllGlobals())
  it('draws nothing, takes no clicks, and comes back when switched on', () => {
    const renderer = { autoClear: true, setViewport: vi.fn(), setScissor: vi.fn(), setScissorTest: vi.fn(), clearDepth: vi.fn(), render: vi.fn() }
    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20)
    camera.position.set(0, 0, 6)
    camera.lookAt(0, 0, 0)
    const gizmo = new AxisGizmo()
    const target = new THREE.Vector3()
    expect(gizmo.render(renderer as unknown as THREE.WebGLRenderer, camera, target, 800, 600)).toBeGreaterThan(0)
    gizmo.setShown(false)
    renderer.render.mockClear()
    expect(gizmo.render(renderer as unknown as THREE.WebGLRenderer, camera, target, 800, 600)).toBe(0)
    expect(renderer.render).not.toHaveBeenCalled()
    expect(gizmo.hitTest(780, 20)).toBeNull()
    gizmo.setShown(true)
    expect(gizmo.render(renderer as unknown as THREE.WebGLRenderer, camera, target, 800, 600)).toBeGreaterThan(0)
  })
})
