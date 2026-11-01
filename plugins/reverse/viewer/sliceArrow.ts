// SPDX-License-Identifier: AGPL-3.0-only
// The arrow on a sketch's plane: dragged along the plane's normal it carries
// the plane through the part, the way QUICKSURFACE's 2D Sketch lets the slice
// be walked through the scan. The arrow only reports an offset; the sketch's
// own offset, section and outline follow from that as they do when a number is
// typed into the offset field.

import * as THREE from 'three'
import type { SceneLayer, SceneLayerHost } from '../../../src/viewer/sceneLayers'
import type { Vec3 } from '../../../src/core/types'

const COLOR = 0xffd400
const HOVER = 0xffffff

export interface SliceArrowSpec {
  /** A point on the plane, in the part's coordinates — where the arrow stands. */
  origin: Vec3
  /** The plane's unit normal, which the arrow points along. */
  normal: Vec3
  /** The plane's offset along its normal now. */
  offset: number
}

export class SliceArrow {
  private group = new THREE.Group()
  private materials: THREE.MeshBasicMaterial[] = []
  private spec: SliceArrowSpec | null = null
  private onOffset: ((offset: number) => void) | null = null
  private hovered = false
  private dragging = false
  private length = 1
  private scratch = new THREE.Vector3()

  constructor(private host: SceneLayerHost) {
    this.group.visible = false
    host.partGroup.add(this.group)
  }

  /** Stand the arrow on a plane (or, with null, take it away). `onOffset` is
   *  told the offset the arrow has been dragged to. */
  set(spec: SliceArrowSpec | null, onOffset?: (offset: number) => void): void {
    this.onOffset = onOffset ?? null
    if (!spec || spec.normal.some((c) => !Number.isFinite(c)) || spec.origin.some((c) => !Number.isFinite(c))) {
      this.spec = null
      this.group.visible = false
      this.release()
      this.host.invalidate()
      return
    }
    const n = new THREE.Vector3(...spec.normal)
    if (!(n.length() > 0)) return this.set(null)
    n.normalize()
    this.spec = { origin: spec.origin, normal: [n.x, n.y, n.z], offset: spec.offset }
    const length = Math.max(this.host.modelRadius() * 0.45, 1)
    if (Math.abs(length - this.length) > 1e-9 || this.group.children.length === 0) this.build(length)
    this.group.position.set(...spec.origin)
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
    this.group.visible = true
    this.host.invalidate()
  }

  private build(length: number): void {
    this.length = length
    for (const child of [...this.group.children]) {
      this.group.remove(child)
      ;(child as THREE.Mesh).geometry.dispose()
    }
    for (const m of this.materials) m.dispose()
    this.materials = []
    const material = new THREE.MeshBasicMaterial({ color: COLOR, depthTest: false, toneMapped: false })
    this.materials.push(material)
    const shaftLength = length * 0.72
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(length * 0.025, length * 0.025, shaftLength, 12), material)
    shaft.rotation.x = Math.PI / 2
    shaft.position.z = shaftLength / 2
    const head = new THREE.Mesh(new THREE.ConeGeometry(length * 0.11, length * 0.28, 16), material)
    head.rotation.x = Math.PI / 2
    head.position.z = shaftLength + length * 0.14
    shaft.renderOrder = head.renderOrder = 12
    // A generous, invisible target round the tip: the shaft is thin on screen, and
    // seen end-on (the sketch view looks straight down the normal) the arrow is a dot.
    const grab = new THREE.Mesh(new THREE.SphereGeometry(length * 0.14, 12, 8), new THREE.MeshBasicMaterial({ visible: false }))
    grab.position.z = shaftLength
    this.materials.push(grab.material as THREE.MeshBasicMaterial)
    this.group.add(shaft, head, grab)
  }

  private paint(): void {
    for (const m of this.materials) m.color.setHex(this.hovered || this.dragging ? HOVER : COLOR)
    this.host.invalidate()
  }

  private under(clientX: number, clientY: number): boolean {
    if (!this.spec || !this.group.visible) return false
    this.host.setPickRay(clientX, clientY)
    // A generous pick: the shaft is thin on screen.
    const hits = this.host.raycaster.intersectObject(this.group, true)
    return hits.length > 0
  }

  /** The client-pixel vector of the arrow's own length, for turning a mouse
   *  move into millimetres along the normal. */
  private screenAxis(): { x: number; y: number } | null {
    if (!this.spec) return null
    const camera = this.host.camera()
    const rect = this.host.canvas.getBoundingClientRect()
    const base = new THREE.Vector3(...this.spec.origin)
    const tip = base.clone().addScaledVector(new THREE.Vector3(...this.spec.normal), this.length)
    this.host.partGroup.updateWorldMatrix(true, false)
    const toClient = (p: THREE.Vector3) => {
      const v = this.scratch.copy(p)
      this.host.partGroup.localToWorld(v).project(camera)
      return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height }
    }
    const a = toClient(base)
    const b = toClient(tip)
    return { x: b.x - a.x, y: b.y - a.y }
  }

  private release(): void {
    if (this.dragging) {
      this.dragging = false
      this.host.claimDrag(false)
    }
  }

  layer(): SceneLayer {
    return {
      order: 5,
      dispose: () => {},
      covers: true,
      hover: (at, covered) => {
        const on = !!at && !covered && !this.dragging && this.under(at.x, at.y)
        if (on !== this.hovered) {
          this.hovered = on
          this.host.setCursor(on ? 'grab' : '')
          this.host.claimDrag(on)
          this.paint()
        }
        return on
      },
      pointerDown: (e) => {
        if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || !this.spec || !this.under(e.clientX, e.clientY)) return false
        const axis = this.screenAxis()
        if (!axis) return false
        const px = axis.x * axis.x + axis.y * axis.y
        // Foreshortened (seen nearly end-on): the drag is vertical instead — up
        // carries the plane along its normal — at the scale the view is drawn at.
        const camera = this.host.camera()
        const mmPerPx = (camera.top - camera.bottom) / camera.zoom / Math.max(1, this.host.canvas.getBoundingClientRect().height)
        const endOn = px < 40 * 40
        const start = { x: e.clientX, y: e.clientY, offset: this.spec.offset }
        this.dragging = true
        this.host.claimDrag(true)
        this.host.setCursor('grabbing')
        this.paint()
        const move = (ev: PointerEvent) => {
          if (endOn) this.onOffset?.(start.offset + (start.y - ev.clientY) * mmPerPx)
          else this.onOffset?.(start.offset + (((ev.clientX - start.x) * axis.x + (ev.clientY - start.y) * axis.y) / px) * this.length)
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
          this.hovered = false
          this.release()
          this.host.setCursor('')
          this.paint()
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
        return true
      },
    }
  }

  dispose(): void {
    this.release()
    this.host.partGroup.remove(this.group)
    for (const child of this.group.children) (child as THREE.Mesh).geometry.dispose()
    for (const m of this.materials) m.dispose()
  }
}
