// SPDX-License-Identifier: AGPL-3.0-only
// Stacked sections' box handles: a square on each corner and each side of the
// box's footprint and one at its centre, halfway up the box. A corner moves
// its two sides, a side handle its own side, the centre the whole box, across
// the plane — so the box can isolate part of the scan or take in more of it.

import * as THREE from 'three'
import type { SceneLayer, SceneLayerHost } from '../../../src/viewer/sceneLayers'
import type { SectionFrame } from '../../../src/core/section/frame'
import { boxPoint } from './stackSlab'

export interface Rect { u0: number; u1: number; v0: number; v1: number }
/** Which sides a handle moves: −1 the low side, 1 the high side, 0 neither
 *  (u and v); both 0 is the centre, which moves the whole box. */
export interface HandleKind { su: -1 | 0 | 1; sv: -1 | 0 | 1 }
const KINDS: HandleKind[] = [-1, 0, 1].flatMap((su) => [-1, 0, 1].map((sv) => ({ su, sv }) as HandleKind))
const COLOR = 0x2ea8ff, HOVER = 0xffffff
const PIXELS = 14
/** The narrowest the box may be made, mm. */
const MIN_SIDE = 1

/** The rectangle after a handle is dragged to `a`, `b` (the centre: by
 *  `da`, `db` from where it was taken). Sides do not pass each other. */
export function draggedRect(start: Rect, kind: HandleKind, a: number, b: number, from: { a: number; b: number }): Rect {
  const r = { ...start }
  if (kind.su === 0 && kind.sv === 0) {
    const da = a - from.a, db = b - from.b
    return { u0: r.u0 + da, u1: r.u1 + da, v0: r.v0 + db, v1: r.v1 + db }
  }
  if (kind.su < 0) r.u0 = Math.min(a, r.u1 - MIN_SIDE)
  if (kind.su > 0) r.u1 = Math.max(a, r.u0 + MIN_SIDE)
  if (kind.sv < 0) r.v0 = Math.min(b, r.v1 - MIN_SIDE)
  if (kind.sv > 0) r.v1 = Math.max(b, r.v0 + MIN_SIDE)
  return r
}

export class StackHandles {
  private group = new THREE.Group()
  private sprites: THREE.Sprite[] = []
  private materials: THREE.SpriteMaterial[] = []
  private texture: THREE.DataTexture
  private frame: SectionFrame | null = null
  private rect: Rect | null = null
  private height = 0
  private onRect: ((rect: Rect) => void) | null = null
  private hovered = -1
  private dragging = false

  constructor(private host: SceneLayerHost) {
    // A filled square with a darker rim: readable on the scan and on the box.
    const size = 16, px = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const rim = x < 2 || y < 2 || x > size - 3 || y > size - 3, i = (y * size + x) * 4
      const c = rim ? 40 : 255
      px[i] = px[i + 1] = px[i + 2] = c; px[i + 3] = 255
    }
    this.texture = new THREE.DataTexture(px, size, size)
    this.texture.needsUpdate = true
    for (let k = 0; k < KINDS.length; k++) {
      const m = new THREE.SpriteMaterial({ map: this.texture, color: COLOR, depthTest: false, depthWrite: false, toneMapped: false })
      const s = new THREE.Sprite(m)
      s.renderOrder = 13
      s.userData.kind = k
      this.group.add(s)
      this.sprites.push(s)
      this.materials.push(m)
    }
    this.group.visible = false
    host.partGroup.add(this.group)
  }

  /** Put the handles on a box (or take them away with null). `height` is the
   *  distance along the normal they stand at — halfway up the box. */
  set(frame: SectionFrame | null, rect: Rect | null, height: number, onRect?: (rect: Rect) => void): void {
    this.onRect = onRect ?? null
    if (!frame || !rect) {
      this.frame = this.rect = null
      this.group.visible = false
      if (this.dragging) { this.dragging = false; this.host.claimDrag(false) }
      this.host.invalidate()
      return
    }
    this.frame = frame; this.rect = rect; this.height = height
    this.place()
    this.group.visible = true
    this.host.invalidate()
  }

  /** Where each handle stands, in the part's coordinates — for a script
   *  driving them as a person would, and for the tests. */
  positions(): { kind: HandleKind; point: [number, number, number] }[] {
    if (!this.frame || !this.rect || !this.group.visible) return []
    return KINDS.map((kind) => ({ kind, point: this.pointOf(kind).toArray() as [number, number, number] }))
  }

  private pointOf(kind: HandleKind): THREE.Vector3 {
    const r = this.rect!, mid = (lo: number, hi: number, s: number) => (s < 0 ? lo : s > 0 ? hi : (lo + hi) / 2)
    return boxPoint(this.frame!, mid(r.u0, r.u1, kind.su), mid(r.v0, r.v1, kind.sv), this.height)
  }

  private place(): void {
    if (!this.frame || !this.rect) return
    KINDS.forEach((kind, k) => this.sprites[k].position.copy(this.pointOf(kind)))
    this.scale()
  }

  private scale(): void {
    const camera = this.host.camera(), rect = this.host.canvas.getBoundingClientRect()
    const mmPerPx = (camera.top - camera.bottom) / camera.zoom / Math.max(1, rect.height)
    for (const s of this.sprites) s.scale.set(PIXELS * mmPerPx, PIXELS * mmPerPx, 1)
  }

  private paint(): void {
    this.materials.forEach((m, k) => m.color.setHex(k === this.hovered ? HOVER : COLOR))
    this.host.invalidate()
  }

  private under(x: number, y: number): number {
    if (!this.group.visible) return -1
    this.host.setPickRay(x, y)
    const hit = this.host.raycaster.intersectObjects(this.sprites, false)[0]
    return hit ? (hit.object.userData.kind as number) : -1
  }

  /** Where the pick ray through a client point meets the handles' plane, in
   *  the frame's u, v. */
  private planeAt(x: number, y: number): { a: number; b: number } | null {
    if (!this.frame) return null
    this.host.setPickRay(x, y)
    this.host.partGroup.updateWorldMatrix(true, false)
    const ray = this.host.raycaster.ray.clone().applyMatrix4(this.host.partGroup.matrixWorld.clone().invert())
    const f = this.frame, n = new THREE.Vector3(...f.normal).normalize()
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, boxPoint(f, 0, 0, this.height))
    const p = ray.intersectPlane(plane, new THREE.Vector3())
    if (!p) return null
    const d = p.sub(new THREE.Vector3(...f.origin))
    return { a: d.dot(new THREE.Vector3(...f.basisU)), b: d.dot(new THREE.Vector3(...f.basisV)) }
  }

  layer(): SceneLayer {
    return {
      order: 6,
      tick: () => { if (this.group.visible) this.scale() },
      dispose: () => {},
      covers: true,
      hover: (at, covered) => {
        const k = at && !covered && !this.dragging ? this.under(at.x, at.y) : -1
        if (k !== this.hovered && !this.dragging) {
          this.hovered = k
          const kind = k >= 0 ? KINDS[k] : null
          this.host.setCursor(!kind ? '' : kind.su === 0 && kind.sv === 0 ? 'move' : kind.su !== 0 && kind.sv !== 0 ? 'nwse-resize' : 'ew-resize')
          this.host.claimDrag(k >= 0)
          this.paint()
        }
        return k >= 0
      },
      pointerDown: (e) => {
        if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || !this.rect) return false
        const k = this.under(e.clientX, e.clientY)
        const from = k >= 0 ? this.planeAt(e.clientX, e.clientY) : null
        if (k < 0 || !from) return false
        const kind = KINDS[k], start = { ...this.rect }
        this.dragging = true; this.hovered = k
        this.host.claimDrag(true)
        this.paint()
        const move = (ev: PointerEvent) => {
          const at = this.planeAt(ev.clientX, ev.clientY)
          if (!at) return
          const next = draggedRect(start, kind, at.a, at.b, from)
          this.rect = next
          this.place()
          this.host.invalidate()
          this.onRect?.(next)
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
          this.dragging = false; this.hovered = -1
          this.host.claimDrag(false)
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
    this.host.partGroup.remove(this.group)
    this.materials.forEach((m) => m.dispose())
    this.texture.dispose()
    this.group.clear()
  }
}
