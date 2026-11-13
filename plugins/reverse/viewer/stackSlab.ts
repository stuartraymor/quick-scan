// SPDX-License-Identifier: AGPL-3.0-only
// Stacked sections' region in the view: the box between the sketch's plane
// (the lower plane) and the upper plane dragged by its own arrow, over the
// footprint its handles set — translucent, its edges drawn, the planes where
// the cuts fall faint across it, and the scan itself tinted where it lies
// inside, so it reads at a glance which part of the mesh the stack goes
// through — the way Geomagic Design X shows a stacked mesh sketch's range.

import * as THREE from 'three'
import type { SectionFrame } from '../../../src/core/section/frame'

const FILL = 0x2ea8ff
/** The scan inside the box: orange, against the blue scan and box. */
const TINT = 0xff8c1a

export interface StackBox {
  /** The lower plane (the sketch's own), its unit normal and in-plane axes. */
  frame: SectionFrame
  /** The footprint, in the frame's u, v. */
  rect: { u0: number; u1: number; v0: number; v1: number }
  /** Distances along the normal from the frame (the sketch's plane): the
   *  box's lower and upper planes, and each cut's (both ends included). */
  bottom: number
  top: number
  cuts: readonly number[]
}

/** A point of the box: `a`, `b` in the frame's u, v; `h` along its normal. */
export function boxPoint(frame: SectionFrame, a: number, b: number, h: number): THREE.Vector3 {
  const n = new THREE.Vector3(...frame.normal).normalize()
  return new THREE.Vector3(...frame.origin)
    .addScaledVector(new THREE.Vector3(...frame.basisU), a)
    .addScaledVector(new THREE.Vector3(...frame.basisV), b)
    .addScaledVector(n, h)
}

export class StackSlab {
  private group = new THREE.Group()
  private resources: { dispose(): void }[] = []

  constructor(private partGroup: THREE.Object3D, private invalidate: () => void, private scanGeometry: () => THREE.BufferGeometry | null = () => null) {
    this.group.visible = false
    this.group.renderOrder = 4
    partGroup.add(this.group)
  }

  set(spec: StackBox | null): void {
    this.clear()
    const r = spec?.rect
    if (!spec || !r || !Number.isFinite(spec.top) || !Number.isFinite(spec.bottom) || spec.top === spec.bottom || !(r.u1 > r.u0) || !(r.v1 > r.v0)) {
      this.group.visible = false
      this.invalidate()
      return
    }
    const { frame } = spec
    const corner = (h: number, i: number) => boxPoint(frame, i === 0 || i === 3 ? r.u0 : r.u1, i < 2 ? r.v0 : r.v1, h)
    const lo = [0, 1, 2, 3].map((i) => corner(spec.bottom, i)), hi = [0, 1, 2, 3].map((i) => corner(spec.top, i))
    // The box: its two faces and four sides, one translucent fill.
    const quads = [[lo[0], lo[1], lo[2], lo[3]], [hi[0], hi[1], hi[2], hi[3]], ...[0, 1, 2, 3].map((i) => [lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]])]
    const tri: number[] = []
    for (const [a, b, c, d] of quads) tri.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray())
    const fillGeo = new THREE.BufferGeometry()
    fillGeo.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3))
    const fillMat = new THREE.MeshBasicMaterial({ color: FILL, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })
    this.group.add(new THREE.Mesh(fillGeo, fillMat))
    this.resources.push(fillGeo, fillMat)
    const lines = (pts: THREE.Vector3[], opacity: number) => {
      if (!pts.length) return
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const mat = new THREE.LineBasicMaterial({ color: FILL, transparent: true, opacity, depthWrite: false })
      this.group.add(new THREE.LineSegments(geo, mat))
      this.resources.push(geo, mat)
    }
    const ring = (h: number) => { const c = [0, 1, 2, 3].map((i) => corner(h, i)); return [c[0], c[1], c[1], c[2], c[2], c[3], c[3], c[0]] }
    // The box's edges, and each cut's plane faint across it.
    lines([...ring(spec.bottom), ...ring(spec.top), ...[0, 1, 2, 3].flatMap((i) => [lo[i], hi[i]])], 0.9)
    lines(spec.cuts.filter((h) => h !== spec.bottom && h !== spec.top).flatMap(ring), 0.35)
    // The scan inside the box, tinted: the same geometry drawn again, clipped
    // to the box's six faces (world planes, so through the part's pose).
    const scan = this.scanGeometry()
    if (scan) {
      this.partGroup.updateWorldMatrix(true, false)
      const world = this.partGroup.matrixWorld
      const n = new THREE.Vector3(...frame.normal).normalize(), u = new THREE.Vector3(...frame.basisU), v = new THREE.Vector3(...frame.basisV)
      const lowH = Math.min(spec.bottom, spec.top), highH = Math.max(spec.bottom, spec.top)
      // A plane keeps what is on its normal's side.
      const keep = (normal: THREE.Vector3, at: THREE.Vector3) => new THREE.Plane().setFromNormalAndCoplanarPoint(normal.clone(), at).applyMatrix4(world)
      const planes = [
        keep(n, boxPoint(frame, r.u0, r.v0, lowH)), keep(n.clone().negate(), boxPoint(frame, r.u0, r.v0, highH)),
        keep(u, boxPoint(frame, r.u0, r.v0, 0)), keep(u.clone().negate(), boxPoint(frame, r.u1, r.v0, 0)),
        keep(v, boxPoint(frame, r.u0, r.v0, 0)), keep(v.clone().negate(), boxPoint(frame, r.u0, r.v1, 0)),
      ]
      const tintMat = new THREE.MeshBasicMaterial({ color: TINT, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, clippingPlanes: planes, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })
      const tint = new THREE.Mesh(scan, tintMat)
      tint.renderOrder = 3
      this.group.add(tint)
      this.resources.push(tintMat)
    }
    this.group.visible = true
    this.invalidate()
  }

  private clear(): void {
    this.group.clear()
    for (const r of this.resources) r.dispose()
    this.resources = []
  }

  dispose(): void {
    this.clear()
    this.partGroup.remove(this.group)
  }
}
