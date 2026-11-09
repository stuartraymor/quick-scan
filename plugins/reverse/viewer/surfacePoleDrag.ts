// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import type { SceneLayer, SceneLayerHost } from '../../../src/viewer/sceneLayers'
import { moveSurfacePole, type PolynomialSurface } from '../core/surfaceStep'
import { ScreenPoleGizmo, screenPoleHandle, screenArrowStep, projectedArrowStep } from './screenPoleGizmo'

import { localPoleFrame } from './localPoleAxis'
import { PoleFrameGizmo, projectedPoleHandle, type PoleFrame, type PoleAxis, type PoleHandle, type ProjectedAxes } from './poleFrameGizmo'

/** Screen-plane pole dragging. Geometry stays in the part's local frame;
 * pointer rays and the fixed drag plane are in the scene's world frame. */
export class SurfacePoleDrag {
  private surface: PolynomialSurface | null = null
  private commit: ((surface: PolynomialSurface) => void) | null = null
  private cancelDrag: (() => void) | null = null
  private strength = 100
  private frame: PoleFrame = 'Screen'
  private frameGizmo: PoleFrameGizmo
  private selected: number | null = null
  private displaySurface: PolynomialSurface | null = null
  private gizmo: ScreenPoleGizmo
  constructor(private host: SceneLayerHost, private draw: (surface: PolynomialSurface, dragging: boolean) => void, private select: (index: number) => void = () => {}) { this.gizmo = new ScreenPoleGizmo(host.container); this.frameGizmo = new PoleFrameGizmo(host.container) }

  set(surface: PolynomialSurface | null, commit: ((surface: PolynomialSurface) => void) | null, strength = 100, frame: PoleFrame = 'Screen') {
    this.cancelDrag?.()
    this.surface = surface
    this.displaySurface = surface
    if (!surface) { this.gizmo.hide(); this.frameGizmo.hide() }
    this.commit = commit
    this.strength = strength
    this.frame = frame
  }

  private anchor(): { x: number; y: number } | null {
    const pole = this.selected === null ? null : this.displaySurface?.poles[this.selected]
    if (!pole) return null
    this.host.partGroup.updateWorldMatrix(true, false)
    const q = this.host.partGroup.localToWorld(new THREE.Vector3(...pole)).project(this.host.camera())
    if (q.z < -1 || q.z > 1) return null
    const r = this.host.canvas.getBoundingClientRect()
    return { x: r.left + (q.x + 1) * r.width / 2, y: r.top + (1 - q.y) * r.height / 2 }
  }

  private frameData(index: number) {
    const surface=this.displaySurface
    if (!surface || this.frame==='Screen') return null
    const local=this.frame==='Local' ? localPoleFrame(surface,Math.floor(index/surface.v.count),index%surface.v.count) : null
    if(this.frame==='Local' && !local) return null
    this.host.partGroup.updateWorldMatrix(true,false)
    const world = {x:new THREE.Vector3(1,0,0),y:new THREE.Vector3(0,1,0),z:new THREE.Vector3(0,0,1)}
    if(local) for(const key of ['x','y','z'] as const) world[key].fromArray(local[key]).transformDirection(this.host.partGroup.matrixWorld)
    const pole=this.host.partGroup.localToWorld(new THREE.Vector3(...surface.poles[index]))
    const camera=this.host.camera(), rect=this.host.canvas.getBoundingClientRect(), origin=pole.clone().project(camera)
    const project=(axis: THREE.Vector3)=>{
      const q=pole.clone().add(axis).project(camera)
      return {x:(q.x-origin.x)*rect.width/2,y:-(q.y-origin.y)*rect.height/2}
    }
    const projected={x:project(world.x),y:project(world.y),z:project(world.z)}
    const right=project(new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion))
    const scale=122/Math.hypot(right.x,right.y)
    const display={} as ProjectedAxes
    for(const key of ['x','y','z'] as const) display[key]={x:projected[key].x*scale,y:projected[key].y*scale}
    return {world,projected,display}
  }

  private handle(x:number,y:number): PoleHandle | 'plane' | null {
    const at=this.anchor()
    if(!at) return null
    if(this.frame==='Screen') return screenPoleHandle(x-at.x,y-at.y)
    const data=this.selected===null ? null : this.frameData(this.selected)
    return data ? projectedPoleHandle(x-at.x,y-at.y,data.display) : null
  }

  clearSelection(): void { this.cancelDrag?.(); this.selected = null; this.gizmo.hide(); this.frameGizmo.hide() }

  private pick(x: number, y: number): number | null {
    if (!this.surface || !this.commit) return null
    const r = this.host.canvas.getBoundingClientRect(), camera = this.host.camera()
    this.host.partGroup.updateWorldMatrix(true, false)
    let best = 10, index: number | null = null
    this.surface.poles.forEach((p, i) => {
      const q = this.host.partGroup.localToWorld(new THREE.Vector3(...p)).project(camera)
      if (q.z < -1 || q.z > 1) return
      const distance = Math.hypot(r.left + (q.x + 1) * r.width / 2 - x, r.top + (1 - q.y) * r.height / 2 - y)
      if (distance < best) { best = distance; index = i }
    })
    return index
  }

  layer(): SceneLayer {
    return {
      order: 14, covers: true,
      hover: (at, covered) => {
        const handle = at ? this.handle(at.x,at.y) : null
        const hit = !covered && at !== null && (handle !== null || this.pick(at.x, at.y) !== null)
        this.host.claimDrag(hit)
        if (hit) this.host.setCursor('move')
        return hit
      },
      pointerDown: e => this.begin(e),
      tick: () => {
        const at=this.anchor(), data=this.selected===null ? null : this.frameData(this.selected)
        if(at && this.frame==='Screen') {this.gizmo.show(at.x,at.y);this.frameGizmo.hide()}
        else if(at && data) {this.gizmo.hide();this.frameGizmo.show(at.x,at.y,data.display)}
        else {this.gizmo.hide();this.frameGizmo.hide()}
      },
      dispose: () => { this.cancelDrag?.(); this.gizmo.hide(); this.frameGizmo.hide(); this.host.claimDrag(false) },
    }
  }

  private begin(e: PointerEvent): boolean {
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false
    const handle = this.handle(e.clientX,e.clientY)
    const index = handle ? this.selected : this.pick(e.clientX, e.clientY)
    if (index === null || !this.surface || !this.commit) return false
    this.select(index)
    this.selected = index
    this.host.invalidate()
    const original = this.surface, commit = this.commit, host = this.host, el = host.canvas
    const strength = this.strength
    const frameData = this.frameData(index)
    const axisKey = handle && handle.length===1 ? handle as PoleAxis : null
    const pole = host.partGroup.localToWorld(new THREE.Vector3(...original.poles[index]))
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(host.camera().getWorldDirection(new THREE.Vector3()), pole)
    const point = (x: number, y: number) => {
      host.setPickRay(x, y)
      const world = host.raycaster.ray.intersectPlane(plane, new THREE.Vector3())
      return world ? host.partGroup.worldToLocal(world) : null
    }
    const start = point(e.clientX, e.clientY)
    if (!start) return false
    let current = original, changed = false
    let lastX = e.clientX, lastY = e.clientY, along = 0
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      if(frameData && axisKey) {
        const projected=frameData.projected[axisKey]
        along+=projectedArrowStep(ev.clientX-lastX,ev.clientY-lastY,projected.x,projected.y)
      } else if (handle === 'x' || handle === 'y') along += screenArrowStep(ev.clientX - lastX, ev.clientY - lastY, handle)
      lastX = ev.clientX; lastY = ev.clientY
      const next = frameData && axisKey ? host.partGroup.worldToLocal(pole.clone().addScaledVector(frameData.world[axisKey],along)) : point(handle === 'x' ? e.clientX + along : handle === 'y' ? e.clientX : ev.clientX, handle === 'y' ? e.clientY + along : handle === 'x' ? e.clientY : ev.clientY)
      if (!next) return
      const delta = next.sub(frameData && axisKey ? new THREE.Vector3(...original.poles[index]) : start)
      if(frameData && handle && handle.length===2) {
        // Native plane handles project free screen-plane motion onto the
        // selected plane; they do not intersect the pointer ray with it.
        const a=handle[0] as PoleAxis,b=handle[1] as PoleAxis
        const normal=frameData.world[a].clone().cross(frameData.world[b]).normalize()
        const worldDelta=delta.clone().applyMatrix3(new THREE.Matrix3().setFromMatrix4(host.partGroup.matrixWorld)).projectOnPlane(normal)
        delta.copy(host.partGroup.worldToLocal(pole.clone().add(worldDelta))).sub(new THREE.Vector3(...original.poles[index]))
      }
      changed = strength > 0 && delta.lengthSq() > 1e-20
      current = moveSurfacePole(original, Math.floor(index / original.v.count), index % original.v.count, delta.toArray(), strength)
      this.displaySurface = current
      this.draw(current, true)
    }
    const finish = (accept: boolean) => {
      this.cancelDrag = null
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', cancel)
      el.removeEventListener('lostpointercapture', cancel)
      window.removeEventListener('keydown', key, true)
      try { el.releasePointerCapture(e.pointerId) } catch { /* Already released. */ }
      host.claimDrag(false)
      this.displaySurface = accept && changed ? current : original
      this.draw(this.displaySurface, false)
      if (accept && changed) { this.surface = current; commit(current) }
    }
    const end = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) { move(ev); finish(true) } }
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) finish(false) }
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); finish(false) } }
    this.cancelDrag = () => finish(false)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', cancel)
    el.addEventListener('lostpointercapture', cancel)
    window.addEventListener('keydown', key, true)
    try { el.setPointerCapture(e.pointerId) } catch { /* Canvas-local drag remains available. */ }
    return true
  }
}
