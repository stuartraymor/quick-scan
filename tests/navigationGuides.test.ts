// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { NavigationGuides, navigationGridLayout } from '../src/viewer/navigationGuides'

function principalCamera(axis: 0 | 1 | 2 = 2, sign = 1) {
  const camera = new THREE.OrthographicCamera(-50, 50, 30, -30, 0.1, 1000)
  camera.position.setComponent(axis, 100 * sign)
  camera.up.set(0, axis === 2 ? 1 : 0, axis === 2 ? 0 : 1)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
  return camera
}

function gridGroup(scene: THREE.Scene) {
  return scene.getObjectByName('navigation-grid') as THREE.Group
}

function resources(group: THREE.Group) {
  const found = new Set<THREE.BufferGeometry | THREE.Material>()
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return
    found.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) found.add(material)
  })
  return [...found]
}

describe('navigation grid in world coordinates', () => {
  it.each([
    [0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1],
  ] as const)('covers the principal view on axis %i from sign %i', (axis, sign) => {
    const layout = navigationGridLayout(principalCamera(axis, sign), 10)
    expect(layout).not.toBeNull()
    expect(layout!.normal).toBe(axis)
    expect([layout!.u, layout!.v]).not.toContain(axis)
    const spans = [layout!.maxU - layout!.minU, layout!.maxV - layout!.minV].sort((a, b) => a - b)
    expect(spans[0]).toBeCloseTo(60)
    expect(spans[1]).toBeCloseTo(100)
    expect(layout!.firstU).toBeLessThanOrEqual(0)
    expect(layout!.lastU).toBeGreaterThanOrEqual(0)
    expect(layout!.firstV).toBeLessThanOrEqual(0)
    expect(layout!.lastV).toBeGreaterThanOrEqual(0)
  })

  it('keeps ruling attached to the world origin as the view pans and zooms', () => {
    const camera = principalCamera()
    camera.position.set(30, 40, 100)
    camera.lookAt(30, 40, 0)
    let layout = navigationGridLayout(camera, 10)!
    expect([layout.firstU, layout.lastU, layout.firstV, layout.lastV]).toEqual([-2, 8, 1, 7])
    camera.zoom = 2
    camera.updateProjectionMatrix()
    layout = navigationGridLayout(camera, 10)!
    expect([layout.firstU, layout.lastU, layout.firstV, layout.lastV]).toEqual([1, 5, 3, 5])
    expect(layout.minU).toBeCloseTo(5)
    expect(layout.maxU).toBeCloseTo(55)
    expect(layout.minV).toBeCloseTo(25)
    expect(layout.maxV).toBeCloseTo(55)
  })

  it('covers the whole rolled viewport while preserving world-aligned ruling', () => {
    const camera = principalCamera()
    camera.rotateZ(Math.PI / 4)
    const layout = navigationGridLayout(camera, 10)!
    const half = 80 / Math.sqrt(2)
    expect(layout.normal).toBe(2)
    expect(layout.minU).toBeCloseTo(-half)
    expect(layout.maxU).toBeCloseTo(half)
    expect(layout.minV).toBeCloseTo(-half)
    expect(layout.maxV).toBeCloseTo(half)
    expect([layout.firstU, layout.lastU, layout.firstV, layout.lastV]).toEqual([-5, 5, -5, 5])
  })

  it('hides ruling in isometric and oblique views', () => {
    const camera = principalCamera()
    camera.position.set(100, 100, 100)
    camera.lookAt(0, 0, 0)
    expect(navigationGridLayout(camera, 10)).toBeNull()
    camera.position.set(1, 0, 100)
    camera.lookAt(0, 0, 0)
    expect(navigationGridLayout(camera, 10)).toBeNull()
  })

  it('projects oblique frustum rays onto an explicitly requested world-zero plane', () => {
    const camera = principalCamera()
    camera.position.set(100, -100, 100)
    camera.lookAt(0, 0, 0)
    const layout = navigationGridLayout(camera, 10, 2)!
    expect(layout.normal).toBe(2)
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const point = new THREE.Vector3(x, y, 0).unproject(camera)
      const ray = camera.getWorldDirection(new THREE.Vector3())
      point.addScaledVector(ray, -point.z / ray.z)
      expect(point.z).toBeCloseTo(0)
      expect(point.x).toBeGreaterThanOrEqual(layout.minU - 1e-10)
      expect(point.x).toBeLessThanOrEqual(layout.maxU + 1e-10)
      expect(point.y).toBeGreaterThanOrEqual(layout.minV - 1e-10)
      expect(point.y).toBeLessThanOrEqual(layout.maxV + 1e-10)
    }
    expect(navigationGridLayout(principalCamera(0), 10, 2)).toBeNull()
  })

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY, 1e-9, Number.MIN_VALUE])(
    'rejects invalid or excessively dense spacing %s without substituting a new spacing', (spacing) => {
      expect(navigationGridLayout(principalCamera(), spacing)).toBeNull()
    },
  )
})

describe('navigation guide geometry and lifetime', () => {
  it('draws lines at requested world-unit multiples and leaves the plane at world zero', () => {
    const scene = new THREE.Scene()
    const guides = new NavigationGuides(scene)
    guides.setGrid(true, 10)
    guides.update(principalCamera(), new THREE.Vector3(30, 40, 50), 1000, 600)
    const group = gridGroup(scene)
    expect(group.visible).toBe(true)
    expect(group.children).toHaveLength(4)
    for (const child of group.children) {
      const points = (child as THREE.LineSegments).geometry.getAttribute('position')
      for (let i = 0; i < points.count; i += 2) {
        const x1 = points.getX(i), x2 = points.getX(i + 1)
        const y1 = points.getY(i), y2 = points.getY(i + 1)
        expect(points.getZ(i)).toBe(0)
        expect(points.getZ(i + 1)).toBe(0)
        if (x1 === x2) expect(x1 / 10).toBeCloseTo(Math.round(x1 / 10))
        else {
          expect(y1).toBe(y2)
          expect(y1 / 10).toBeCloseTo(Math.round(y1 / 10))
        }
      }
    }
    guides.dispose()
  })

  it('extends colored positive and neutral negative world axes and hides each aid independently', () => {
    const scene = new THREE.Scene()
    const guides = new NavigationGuides(scene)
    const camera = principalCamera()
    const coordinates = scene.getObjectByName('navigation-coordinate-system')!
    guides.setCoordinates(true)
    guides.setGrid(true, 10)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    expect(coordinates.visible).toBe(true)
    expect(coordinates.position.toArray()).toEqual([0, 0, 0])
    expect(coordinates.children).toHaveLength(6)
    expect(coordinates.scale.x).toBeGreaterThan(100)
    for (let axis = 0; axis < 3; axis++) {
      const negative = coordinates.children[axis * 2] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
      const positive = coordinates.children[axis * 2 + 1] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
      expect(negative.geometry.getAttribute('position').getComponent(1, axis)).toBe(-1)
      expect(positive.geometry.getAttribute('position').getComponent(1, axis)).toBe(1)
      expect(negative.material.color.getHex()).toBe(0x8a9096)
      expect(positive.material.color.getHex()).toBe([0xd7191c, 0x20ad36, 0x1515cb][axis])
    }
    const extent = coordinates.scale.x
    camera.zoom = 2
    camera.updateProjectionMatrix()
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    expect(coordinates.scale.x).toBeGreaterThan(100)
    expect(coordinates.scale.x).toBeLessThan(extent)
    guides.setGrid(false, 10)
    expect(gridGroup(scene).visible).toBe(false)
    expect(coordinates.visible).toBe(true)
    guides.setCoordinates(false)
    expect(coordinates.visible).toBe(false)
    guides.dispose()
  })

  it('shows automatic coarse coordinate ruling with Grid disabled, including isometric XY', () => {
    const scene = new THREE.Scene()
    const guides = new NavigationGuides(scene)
    const camera = principalCamera()
    guides.setCoordinates(true)
    guides.setGrid(false, 10)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    const coarse = scene.getObjectByName('navigation-coordinate-ruling') as THREE.Group
    expect(coarse.visible).toBe(true)
    expect(gridGroup(scene).visible).toBe(false)
    const lines = coarse.children[0] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineDashedMaterial>
    expect(lines.material.isLineDashedMaterial).toBe(true)
    // 0.1 mm/pixel -> 15 mm desired -> next 1/2/5 spacing, 20 mm.
    const points = lines.geometry.getAttribute('position')
    for (let i = 0; i < points.count; i += 2) {
      const sameX = points.getX(i) === points.getX(i + 1)
      const ruling = sameX ? points.getX(i) : points.getY(i)
      expect(ruling / 20).toBeCloseTo(Math.round(ruling / 20))
      expect(ruling).not.toBe(0)
    }
    camera.position.set(100, -100, 100)
    camera.lookAt(0, 0, 0)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    expect(coarse.visible).toBe(true)
    expect(gridGroup(scene).visible).toBe(false)
    guides.setCoordinates(false)
    expect(coarse.visible).toBe(false)
    guides.dispose()
  })

  it('adds exact fine XY ruling in iso only while the coordinate system is shown', () => {
    const scene = new THREE.Scene()
    const guides = new NavigationGuides(scene)
    const camera = principalCamera()
    camera.position.set(100, -100, 100)
    camera.lookAt(0, 0, 0)
    guides.setGrid(true, 7)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    expect(gridGroup(scene).visible).toBe(false)
    guides.setCoordinates(true)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    const fine = gridGroup(scene)
    expect(fine.visible).toBe(true)
    expect(scene.getObjectByName('navigation-coordinate-ruling')!.visible).toBe(true)
    expect(fine.children).toHaveLength(1)
    const lines = fine.children[0] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
    expect(lines.material.type).toBe('LineBasicMaterial')
    const points = lines.geometry.getAttribute('position')
    for (let i = 0; i < points.count; i += 2) {
      expect(points.getZ(i)).toBe(0)
      expect(points.getZ(i + 1)).toBe(0)
      const sameX = points.getX(i) === points.getX(i + 1)
      const ruling = sameX ? points.getX(i) : points.getY(i)
      expect(ruling / 7).toBeCloseTo(Math.round(ruling / 7))
    }
    guides.setCoordinates(false)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    expect(fine.visible).toBe(false)
    // Principal-only Grid remains available when coordinates are hidden.
    camera.position.set(0, 0, 100)
    camera.lookAt(0, 0, 0)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    expect(fine.visible).toBe(true)
    guides.dispose()
  })

  it('reuses unchanged ruling, disposes replaced resources, and preserves unrelated scene objects', () => {
    const scene = new THREE.Scene()
    const unrelated = new THREE.Group()
    scene.add(unrelated)
    const guides = new NavigationGuides(scene)
    const camera = principalCamera()
    guides.setCoordinates(true)
    guides.setGrid(true, 10)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    const grid = gridGroup(scene)
    const oldResources = resources(grid)
    const oldDisposers = oldResources.map((resource) => vi.spyOn(resource, 'dispose'))
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    expect(resources(grid)).toEqual(oldResources)
    expect(oldDisposers.every((spy) => spy.mock.calls.length === 0)).toBe(true)
    guides.setGrid(true, 5)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    expect(oldDisposers.every((spy) => spy.mock.calls.length === 1)).toBe(true)
    const liveResources = [
      ...resources(grid),
      ...resources(scene.getObjectByName('navigation-coordinate-system') as THREE.Group),
      ...resources(scene.getObjectByName('navigation-coordinate-ruling') as THREE.Group),
    ]
    const liveDisposers = liveResources.map((resource) => vi.spyOn(resource, 'dispose'))
    guides.dispose()
    expect(liveDisposers.every((spy) => spy.mock.calls.length === 1)).toBe(true)
    expect(scene.children).toEqual([unrelated])
  })
})
