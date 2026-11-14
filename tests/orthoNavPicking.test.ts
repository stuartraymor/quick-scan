// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { afterEach, expect, it, vi } from 'vitest'
import { OrthoNavigator } from '../src/viewer/orthoNav'

afterEach(() => vi.unstubAllGlobals())

function setup() {
  vi.stubGlobal('document', new EventTarget())
  let rect = { left: 0, top: 0, width: 800, height: 600 }
  const canvas = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ ...rect }) }) as unknown as HTMLCanvasElement
  const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 100)
  camera.position.z = 20; camera.updateMatrixWorld()
  const nav = new OrthoNavigator(camera, { target: new THREE.Vector3(), update: () => {} } as unknown as OrbitControls, canvas, () => [], { center: new THREE.Vector3(), radius: 10 })
  const ray = new THREE.Raycaster()
  const project = (p: THREE.Vector3) => {
    const q = p.clone().project(camera)
    return [rect.left + (q.x + 1) * rect.width / 2, rect.top + (1 - q.y) * rect.height / 2] as const
  }
  // Populate any coordinate cache. No animation frame or clip-plane update
  // runs between this initial pick and the subsequent changed layout.
  nav.setPickRay(ray, 400, 300)
  return { nav, ray, camera, project, layout: (next: typeof rect) => { rect = next } }
}

it.each([
  { label: 'relocated', rect: { left: 240, top: 120, width: 800, height: 600 } },
  { label: 'resized', rect: { left: 0, top: 0, width: 1200, height: 900 } },
  { label: 'relocated and resized', rect: { left: 234, top: 165, width: 1266, height: 755 } },
])('picks the displayed world point after the canvas is $label before any animation frame', ({ rect }) => {
  const s = setup(), intended = new THREE.Vector3(2, 1, 0)
  s.layout(rect)
  s.nav.setPickRay(s.ray, ...s.project(intended))
  const hit = s.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3())!
  expect(hit.distanceTo(intended)).toBeLessThan(1e-10)
  s.nav.dispose()
})

it('keeps the correct frontmost occluder after layout changes without waiting for rendering', () => {
  const s = setup()
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  front.position.set(2, 1, 2); front.updateMatrixWorld()
  const back = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  back.updateMatrixWorld()
  s.layout({ left: 240, top: 120, width: 1000, height: 750 })
  s.nav.setPickRay(s.ray, ...s.project(front.position))
  const hits = s.ray.intersectObjects([back, front], false)
  expect(hits[0]?.object).toBe(front)
  expect(hits[0]?.point.distanceTo(front.position)).toBeLessThan(1e-10)
  expect(hits.some(hit => hit.object === back)).toBe(true)
  front.geometry.dispose(); front.material.dispose(); back.geometry.dispose(); back.material.dispose(); s.nav.dispose()
})
