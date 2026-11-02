// SPDX-License-Identifier: AGPL-3.0-only
// Real Three geometry and rays; only the drawing surface/renderer are stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { AxisGizmo, gizmoSize, type GizmoTarget } from '../src/viewer/axisGizmo'

beforeEach(() => {
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillText: vi.fn() }) }),
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function rendererStub() {
  return {
    autoClear: true,
    setViewport: vi.fn(),
    setScissor: vi.fn(),
    setScissorTest: vi.fn(),
    clearDepth: vi.fn(),
    render: vi.fn((scene: THREE.Scene, camera: THREE.Camera) => {
      scene.updateMatrixWorld(true)
      camera.updateMatrixWorld(true)
    }),
  }
}

function cameraFrom(normal: readonly number[]) {
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20)
  camera.position.set(normal[0], normal[1], normal[2]).multiplyScalar(6)
  if (Math.abs(normal[1]) > 0.99) camera.up.set(0, 0, 1)
  camera.lookAt(0, 0, 0)
  return camera
}

const faces: { target: GizmoTarget; normal: [number, number, number] }[] = [
  { target: '+x', normal: [1, 0, 0] }, { target: '-x', normal: [-1, 0, 0] },
  { target: '+y', normal: [0, 1, 0] }, { target: '-y', normal: [0, -1, 0] },
  { target: '+z', normal: [0, 0, 1] }, { target: '-z', normal: [0, 0, -1] },
]

describe('orientation cube picking and corner rendering', () => {
  it.each(faces)('raycasts the $target face with an explicit sign', ({ target, normal }) => {
    const gizmo = new AxisGizmo()
    const renderer = rendererStub()
    const width = 900, height = 700
    const size = gizmo.render(renderer as unknown as THREE.WebGLRenderer, cameraFrom(normal), new THREE.Vector3(), width, height)
    const [scene, camera] = renderer.render.mock.calls[0]
    const cube = scene.children.find((object): object is THREE.Mesh<THREE.BoxGeometry> => object instanceof THREE.Mesh && object.geometry instanceof THREE.BoxGeometry)!
    const box = new THREE.Box3().setFromObject(cube)
    const centre = box.getCenter(new THREE.Vector3())
    const dimensions = box.getSize(new THREE.Vector3())
    const face = centre.add(new THREE.Vector3(normal[0] * dimensions.x / 2, normal[1] * dimensions.y / 2, normal[2] * dimensions.z / 2))
    const projected = face.project(camera)
    const x = width - size - 14 + (projected.x + 1) * size / 2
    const y = 14 + (1 - projected.y) * size / 2
    expect(gizmo.hitTest(x, y)).toBe(target)
    // A positive face must not be confused with its unsigned flip-arrow.
    expect(gizmo.hitTest(x, y)?.startsWith(target[0])).toBe(true)
    gizmo.dispose()
  })

  it.each([[900, 700], [320, 240], [2000, 1200], [1100, 500]])('draws in the top-right corner at %i × %i', (width, height) => {
    const gizmo = new AxisGizmo()
    const renderer = rendererStub()
    const size = gizmo.render(renderer as unknown as THREE.WebGLRenderer, cameraFrom([1, -1, 1]), new THREE.Vector3(), width, height)
    expect(size).toBe(gizmoSize(width, height))
    // WebGL measures viewport/scissor Y from the bottom; hitTest takes top Y.
    expect(renderer.setViewport).toHaveBeenLastCalledWith(width - size - 14, height - size - 14, size, size)
    expect(renderer.setScissor).toHaveBeenLastCalledWith(width - size - 14, height - size - 14, size, size)
    expect(renderer.clearDepth).toHaveBeenCalledOnce()
    expect(renderer.setScissorTest.mock.calls).toEqual([[true], [false]])
    expect(renderer.autoClear).toBe(true)
    for (const [x, y] of [[width - size - 15, 14], [width - 13, 14], [width - size / 2 - 14, 13], [width - size / 2 - 14, size + 15], [0, height]]) {
      expect(gizmo.hitTest(x, y)).toBeNull()
    }
    gizmo.dispose()
  })

  it('does not capture clicks before any frame is drawn', () => {
    const gizmo = new AxisGizmo()
    expect(gizmo.hitTest(0, 0)).toBeNull()
    expect(gizmo.hitTest(850, 60)).toBeNull()
    gizmo.dispose()
  })

  it('releases every owned geometry, material and label texture exactly once', () => {
    const gizmo = new AxisGizmo()
    const renderer = rendererStub()
    gizmo.render(renderer as unknown as THREE.WebGLRenderer, cameraFrom([1, -1, 1]), new THREE.Vector3(), 900, 700)
    const scene = renderer.render.mock.calls[0][0]
    const resources = new Set<{ dispose(): void }>()
    scene.traverse(object => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) resources.add(object.geometry)
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Sprite) {
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          resources.add(material)
          if ('map' in material && material.map instanceof THREE.Texture) resources.add(material.map)
        }
      }
    })
    expect([...resources].filter(resource => resource instanceof THREE.BufferGeometry).length).toBeGreaterThan(0)
    expect([...resources].filter(resource => resource instanceof THREE.Texture)).toHaveLength(3)
    const spies = [...resources].map(resource => vi.spyOn(resource, 'dispose'))
    gizmo.dispose()
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce()
  })
})
