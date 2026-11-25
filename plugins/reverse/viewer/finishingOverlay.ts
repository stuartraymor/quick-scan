// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import type { KernelMesh } from '../core/kernel'
import type { MeasuredTriangles } from '../core/freeform/deviationRefinement'
import { previewDeviationColours, type PreviewColouring } from '../core/freeform/previewDeviation'
import { deviationStats } from '../../../src/core/deviation/deviation'

export function finishingStatistics(values: Float32Array, tolerance: number) {
  const stats = deviationStats(values, Number.MAX_VALUE, tolerance)
  if (!stats.measured) return null
  let magnitude = 0
  for (const value of values) if (Number.isFinite(value)) magnitude += Math.abs(value)
  return { ...stats, meanAbsolute: magnitude / stats.measured }
}

export type FinishingStatistics = NonNullable<ReturnType<typeof finishingStatistics>>

export interface FinishingDisplay {
  tolerance: number
  colouring: PreviewColouring
  measure?: (positions: Float32Array, triangles: Uint32Array) => Promise<MeasuredTriangles>
  report(state: 'idle' | 'measuring' | 'ready' | 'unavailable', statistics?: FinishingStatistics): void
}

/** Keep only the generated CAD faces, including their trimmed triangle boundaries. */
export function finishingTriangles(mesh: KernelMesh, faces: readonly number[]) {
  const keep = new Set(faces), vertices = new Map<number, number>()
  const positions: number[] = [], triangles: number[] = []
  if (!mesh.faceHash || !faces.length) return null
  for (let t = 0; t < mesh.faceHash.length; t++) {
    if (!keep.has(mesh.faceHash[t])) continue
    for (let corner = 0; corner < 3; corner++) {
      const index = mesh.indices[3 * t + corner]
      let local = vertices.get(index)
      if (local === undefined) {
        local = vertices.size
        vertices.set(index, local)
        positions.push(mesh.positions[index * 3], mesh.positions[index * 3 + 1], mesh.positions[index * 3 + 2])
      }
      triangles.push(local)
    }
  }
  return triangles.length ? { positions: Float32Array.from(positions), triangles: Uint32Array.from(triangles) } : null
}

/** One measurement in flight. A grip movement replaces any queued reading. */
export class FinishingOverlay {
  private revision = 0
  private busy = false
  private pending: (() => Promise<void>) | null = null
  private overlay?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>

  update(parent: THREE.Mesh | null, mesh: KernelMesh | null, faces: readonly number[], display: FinishingDisplay | null) {
    const revision = ++this.revision
    this.pending = null
    if (this.overlay) {
      this.overlay.removeFromParent()
      this.overlay.geometry.dispose()
      this.overlay.material.dispose()
      this.overlay = undefined
    }
    const measure = display?.measure
    if (!display || !measure || !parent || !mesh) { display?.report('idle'); return }
    display.report('measuring')
    this.pending = async () => {
      const patch = finishingTriangles(mesh, faces)
      if (!patch) { display.report('unavailable'); return }
      try {
        const data = await measure(patch.positions, patch.triangles)
        if (this.revision !== revision) return
        if (data.values.length !== data.positions.length / 3) throw Error('Incomplete finishing deviation field')
        const statistics = finishingStatistics(data.values, display.tolerance)
        if (!statistics) { display.report('unavailable'); return }
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
        geometry.setAttribute('color', new THREE.BufferAttribute(previewDeviationColours(data.values, display.tolerance, display.colouring), 3))
        geometry.setIndex(new THREE.BufferAttribute(data.triangles, 1))
        const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide,
          clippingPlanes: (parent.material as THREE.Material).clippingPlanes, polygonOffset: true, polygonOffsetFactor: -1,
          polygonOffsetUnits: -1, toneMapped: false })
        this.overlay = new THREE.Mesh(geometry, material)
        this.overlay.name = 'Finishing deviation'
        this.overlay.renderOrder = 4
        parent.add(this.overlay)
        display.report('ready', statistics)
      } catch { if (this.revision === revision) display.report('unavailable') }
    }
    void this.drain()
  }

  private async drain() {
    if (this.busy) return
    this.busy = true
    try {
      while (this.pending) {
        const read = this.pending
        this.pending = null
        await read()
      }
    } finally { this.busy = false }
  }
}
