// SPDX-License-Identifier: AGPL-3.0-only
// World-coordinate viewing aids, independent of measured/aligned geometry.
import * as THREE from 'three'

const COLORS = [0xd7191c, 0x20ad36, 0x1515cb] as const
const MAX_GRID_LINES = 4000
type Axis = 0 | 1 | 2
type Disposable = { dispose(): void }

export interface NavigationGridLayout {
  normal: Axis
  u: Axis
  v: Axis
  minU: number
  maxU: number
  minV: number
  maxV: number
  firstU: number
  lastU: number
  firstV: number
  lastV: number
}

/** A finite world-zero square. Camera motion must never change its plane,
 * bounds or visibility: a ray/frustum intersection becomes singular near
 * edge-on and made the old grid disappear while orbiting. */
export function navigationGridLayout(_camera: THREE.OrthographicCamera, spacing: number, normal: Axis = 2, halfExtent = 100): NavigationGridLayout | null {
  if (!Number.isFinite(spacing) || spacing <= 0 || !Number.isFinite(halfExtent) || halfExtent <= 0) return null
  const last = Math.max(1, Math.ceil(halfExtent / spacing))
  if (!Number.isSafeInteger(last) || 4 * last + 2 > MAX_GRID_LINES) return null
  const extent = last * spacing
  if (!Number.isFinite(extent)) return null
  const [u, v] = ([0, 1, 2] as Axis[]).filter((axis) => axis !== normal)
  return { normal, u, v, minU: -extent, maxU: extent, minV: -extent, maxV: extent,
    firstU: -last, lastU: last, firstV: -last, lastV: last }
}

/** Rounded 1/2/5 scale, independent of the user's exact fine-grid spacing. */
function coarseSpacing(worldPerPixel: number): number {
  const wanted = worldPerPixel * 150
  const power = 10 ** Math.floor(Math.log10(wanted))
  const fraction = wanted / power
  return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power
}

export class NavigationGuides {
  private coordinates = new THREE.Group()
  private coarseGrid = new THREE.Group()
  private grid = new THREE.Group()
  private coordinateResources: Disposable[] = []
  private coarseResources: Disposable[] = []
  private gridResources: Disposable[] = []
  private gridEnabled = false
  private spacing = 10
  private gridKey = ''
  private coarseKey = ''

  constructor(private scene: THREE.Scene) {
    this.coordinates.name = 'navigation-coordinate-system'
    this.coarseGrid.name = 'navigation-coordinate-ruling'
    this.grid.name = 'navigation-grid'
    this.coordinates.visible = this.coarseGrid.visible = this.grid.visible = false
    // Whole origin axes rather than a second, viewport-sized arrow triad.
    // Positive halves carry their axis colour; negative halves stay neutral.
    for (const axis of [0, 1, 2] as Axis[]) {
      for (const sign of [-1, 1]) {
        const end = new THREE.Vector3().setComponent(axis, sign)
        const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), end])
        const material = new THREE.LineBasicMaterial({
          color: sign > 0 ? COLORS[axis] : 0x8a9096,
          transparent: true, opacity: sign > 0 ? 0.85 : 0.6, depthWrite: false,
        })
        this.coordinates.add(new THREE.LineSegments(geometry, material))
        this.coordinateResources.push(geometry, material)
      }
    }
    scene.add(this.coordinates, this.coarseGrid, this.grid)
  }

  setCoordinates(on: boolean): void {
    this.coordinates.visible = on
    if (!on) this.coarseGrid.visible = false
  }

  setGrid(on: boolean, spacing: number): void {
    this.gridEnabled = on && Number.isFinite(spacing) && spacing > 0
    if (this.spacing !== spacing) this.gridKey = ''
    this.spacing = spacing
    if (!this.gridEnabled) this.grid.visible = false
  }

  update(camera: THREE.OrthographicCamera, target: THREE.Vector3, w: number, h: number, halfExtent = 100): void {
    if (w <= 0 || h <= 0) return
    const worldPerPixel = Math.abs(camera.top - camera.bottom) / (camera.zoom * h)
    if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0) return
    const coordinatesOn = this.coordinates.visible
    // Extend each origin half-axis beyond the visible frustum; renderer
    // clipping supplies the viewport edge without attaching the axis to it.
    const extent = camera.position.length() + target.length() + worldPerPixel * Math.hypot(w, h)
    this.coordinates.scale.setScalar(extent)
    const coarseStep = coarseSpacing(worldPerPixel)
    const coarseLayout = coordinatesOn ? navigationGridLayout(camera, coarseStep, 2, halfExtent) : null
    this.coarseGrid.visible = coarseLayout !== null
    if (coarseLayout) {
      const key = JSON.stringify([coarseLayout, coarseStep])
      if (key !== this.coarseKey) {
        this.coarseKey = key
        this.clear(this.coarseGrid, this.coarseResources)
        this.coarseResources = this.drawGrid(this.coarseGrid, coarseLayout, coarseStep, true, false, worldPerPixel)
      }
    }
    const layout = this.gridEnabled ? navigationGridLayout(camera, this.spacing, 2, halfExtent) : null
    this.grid.visible = layout !== null
    if (!layout) return
    const key = JSON.stringify([layout, this.spacing, coordinatesOn])
    if (key === this.gridKey) return
    this.gridKey = key
    this.clear(this.grid, this.gridResources)
    this.gridResources = this.drawGrid(this.grid, layout, this.spacing, false, !coordinatesOn, worldPerPixel)
  }

  private drawGrid(group: THREE.Group, layout: NavigationGridLayout, spacing: number, dashed: boolean, axes: boolean, worldPerPixel: number): Disposable[] {
    const { u, v, minU, maxU, minV, maxV, firstU, lastU, firstV, lastV } = layout
    const regular: number[] = [], alongU: number[] = [], alongV: number[] = [], negative: number[] = []
    const append = (array: number[], a: number, b: number, c: number, d: number) => {
      if (a === c && b === d) return
      const start = new THREE.Vector3().setComponent(u, a).setComponent(v, b)
      const end = new THREE.Vector3().setComponent(u, c).setComponent(v, d)
      array.push(...start.toArray(), ...end.toArray())
    }
    for (let i = firstU; i <= lastU; i++) {
      if (i !== 0) append(regular, i * spacing, minV, i * spacing, maxV)
      else if (axes) {
        if (maxV > 0) append(alongV, 0, Math.max(0, minV), 0, maxV)
        if (minV < 0) append(negative, 0, minV, 0, Math.min(0, maxV))
      }
    }
    for (let i = firstV; i <= lastV; i++) {
      if (i !== 0) append(regular, minU, i * spacing, maxU, i * spacing)
      else if (axes) {
        if (maxU > 0) append(alongU, Math.max(0, minU), 0, maxU, 0)
        if (minU < 0) append(negative, minU, 0, Math.min(0, maxU), 0)
      }
    }
    const resources: Disposable[] = []
    for (const [vertices, color, opacity] of [
      [regular, 0x818891, dashed ? 0.4 : 0.45],
      [alongU, COLORS[u], 0.8], [alongV, COLORS[v], 0.8], [negative, 0x818891, 0.55],
    ] as const) {
      if (vertices.length === 0) continue
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      const options = { color, transparent: true, opacity, depthWrite: false }
      const material = dashed
        ? new THREE.LineDashedMaterial({ ...options, dashSize: worldPerPixel * 4, gapSize: worldPerPixel * 3 })
        : new THREE.LineBasicMaterial(options)
      const lines = new THREE.LineSegments(geometry, material)
      if (dashed) lines.computeLineDistances()
      group.add(lines)
      resources.push(geometry, material)
    }
    return resources
  }

  private clear(group: THREE.Group, resources: Disposable[]): void {
    group.clear()
    for (const resource of resources) resource.dispose()
  }

  dispose(): void {
    this.clear(this.grid, this.gridResources)
    this.clear(this.coarseGrid, this.coarseResources)
    this.clear(this.coordinates, this.coordinateResources)
    this.gridResources = this.coarseResources = this.coordinateResources = []
    this.scene.remove(this.coordinates, this.coarseGrid, this.grid)
  }
}
