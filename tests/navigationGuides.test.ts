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
  it('is a square symmetric about the origin with exact world-unit spacing', () => {
    const layout = navigationGridLayout(principalCamera(), 7, 2, 103)!
    expect(layout).toEqual({normal: 2, u: 0, v: 1, minU: -105, maxU: 105,
      minV: -105, maxV: 105, firstU: -15, lastU: 15, firstV: -15, lastV: 15})
  })

  it('retains the same square through orbit, edge-on, below-plane, pan and zoom', () => {
    const camera = principalCamera()
    const baseline = navigationGridLayout(camera, 10)
    for (const position of [[100,100,100], [100,0,1e-10], [100,0,0],
      [100,0,-1e-10], [0,0,-100], [30,40,100]]) {
      camera.position.fromArray(position)
      camera.lookAt(0,0,0)
      for (const zoom of [0.01, 1, 100]) {
        camera.zoom = zoom
        camera.updateProjectionMatrix()
        expect(navigationGridLayout(camera, 10)).toEqual(baseline)
      }
    }
    camera.position.set(1000,2000,100)
    camera.lookAt(1000,2000,0)
    camera.rotateZ(Math.PI/4)
    expect(navigationGridLayout(camera, 10)).toEqual(baseline)
  })

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY, 1e-9, Number.MIN_VALUE])(
    'rejects invalid or excessively dense spacing %s without unbounded allocations', (spacing) => {
      expect(navigationGridLayout(principalCamera(), spacing)).toBeNull()
    },
  )
})

describe('navigation guide geometry and lifetime', () => {
  it('keeps enabled grid geometry alive through a complete orbit without rebuilding or disabling depth testing', () => {
    const scene = new THREE.Scene(), guides = new NavigationGuides(scene)
    const camera = principalCamera()
    guides.setCoordinates(true)
    guides.setGrid(true, 10)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    const grid = gridGroup(scene), original = resources(grid)
    for (let degrees = 0; degrees <= 360; degrees += 5) {
      const angle = degrees * Math.PI / 180
      camera.position.set(100 * Math.cos(angle), 40, 100 * Math.sin(angle))
      camera.lookAt(0, 0, 0)
      guides.update(camera, new THREE.Vector3(), 1000, 600)
      expect(grid.visible).toBe(true)
      expect(resources(grid)).toEqual(original)
      for (const child of grid.children) {
        const material = (child as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>).material
        expect(material.depthTest).toBe(true)
        expect(material.depthWrite).toBe(false)
      }
    }
    guides.setGrid(false, 10)
    expect(grid.visible).toBe(false)
    guides.dispose()
  })
  it('draws lines at requested world-unit multiples and leaves the plane at world zero', () => {
    const scene = new THREE.Scene()
    const guides = new NavigationGuides(scene)
    guides.setCoordinates(true)
    guides.setGrid(true, 10)
    guides.update(principalCamera(), new THREE.Vector3(30, 40, 50), 1000, 600)
    const group = gridGroup(scene)
    expect(group.visible).toBe(true)
    // Solid grey lines only: the coordinate system draws the axes.
    expect(group.children).toHaveLength(1)
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

  it('shows the coordinate system’s own solid cells with Grid disabled, fixed through zoom, including isometric XY', () => {
    const scene = new THREE.Scene()
    const guides = new NavigationGuides(scene)
    const camera = principalCamera()
    guides.setCoordinates(true)
    guides.setGrid(false, 10)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    const coarse = scene.getObjectByName('navigation-coordinate-ruling') as THREE.Group
    expect(coarse.visible).toBe(true)
    expect(gridGroup(scene).visible).toBe(false)
    const lines = coarse.children[0] as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
    expect(lines.material.type).toBe('LineBasicMaterial')
    // A 100 mm square: about 16 cells, 12.5 mm -> the next 1/2/5 step, 20 mm,
    // whatever the zoom (QUICKSURFACE's cells stay put as it zooms).
    const before = resources(coarse)
    camera.zoom = 7
    camera.updateProjectionMatrix()
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    expect(resources(coarse)).toEqual(before)
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

  it('draws Grid only with the coordinate system shown, in place of its own cells, as QUICKSURFACE does', () => {
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
    expect(scene.getObjectByName('navigation-coordinate-ruling')!.visible).toBe(false)
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
    // Returning to a principal view must not change the plane or hide the grid.
    camera.position.set(0, 0, 100)
    camera.lookAt(0, 0, 0)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    expect(fine.visible).toBe(true)
    guides.setCoordinates(false)
    guides.update(camera, new THREE.Vector3(), 1000, 600)
    expect(fine.visible).toBe(false)
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
