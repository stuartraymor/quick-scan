// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import type { SceneLayerHost } from '../../../src/viewer/sceneLayers'
import type { Cage } from '../core/freeform/cage'
import { vertexAt } from '../core/freeform/cage'
export type ManipulatorFrame = 'world' | 'screen' | 'local'
export type ManipulatorHit = { kind: 'move' | 'rotate' | 'scale'; axis: THREE.Vector3; centre: THREE.Vector3; x: number; y: number; dx: number; dy: number; unit: number }
const colors = ['#d51515', '#14a51c', '#1515bd']
const ns = 'http://www.w3.org/2000/svg'
export class FreeformManipulator {
  private lastCage: Cage | null = null
  private lastKey = ""
  private svg: SVGSVGElement | null = null
  private hits: (ManipulatorHit & { px: number; py: number; radius: number })[] = []
  constructor(private host: SceneLayerHost) {
    if (typeof document === 'undefined' || !host.container) return
    this.svg = document.createElementNS(ns, 'svg')
    this.svg.dataset.test = 'freeform-manipulator'
    Object.assign(this.svg.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex: '6' })
    host.container.append(this.svg)
  }
  update(cage: Cage | null, ids: number[], frame: ManipulatorFrame, enabled: boolean) {
    const camera = this.host.camera(), rectKey = this.host.canvas.getBoundingClientRect()
    this.host.partGroup.updateWorldMatrix(true, false)
    const key = [enabled, frame, ids.join(','), ...camera.matrixWorld.elements, ...camera.projectionMatrix.elements, ...this.host.partGroup.matrixWorld.elements, rectKey.left, rectKey.top, rectKey.width, rectKey.height].join('|')
    if (cage === this.lastCage && key === this.lastKey) return
    this.lastCage = cage; this.lastKey = key
    this.hits = []; this.svg?.replaceChildren()
    if (this.svg) this.svg.style.display = enabled && ids.length ? 'block' : 'none'
    if (!enabled || !cage || !ids.length) return
    const host = this.host, centre = new THREE.Vector3()
    ids.forEach(i => centre.add(new THREE.Vector3(...vertexAt(cage, i)))); centre.divideScalar(ids.length)
    host.partGroup.updateWorldMatrix(true, false)
    const inverse = host.partGroup.getWorldQuaternion(new THREE.Quaternion()).invert()
    let axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
    if (frame === 'screen') axes.forEach(a => a.applyQuaternion(host.camera().quaternion).applyQuaternion(inverse))
    else if (frame === 'world') axes.forEach(a => a.applyQuaternion(inverse))
    else {
      const chosen = new Set(ids), normal = new THREE.Vector3(); let tangent: THREE.Vector3 | null = null
      for (const f of cage.faces) if (f.some(i => chosen.has(i))) {
        const a = new THREE.Vector3(...vertexAt(cage, f[0])), b = new THREE.Vector3(...vertexAt(cage, f[1])), c = new THREE.Vector3(...vertexAt(cage, f[2]))
        const edge = b.sub(a); normal.add(edge.clone().cross(c.sub(a)))
        if (!tangent && edge.lengthSq() > 1e-20) tangent = edge.normalize()
      }
      if (normal.lengthSq() > 1e-20 && tangent) {
        normal.normalize(); const x = tangent.addScaledVector(normal, -tangent.dot(normal)).normalize()
        if (x.lengthSq() > .5) axes = [x, normal.clone().cross(x).normalize(), normal]
      }
    }
    const rect = host.canvas.getBoundingClientRect(), container = host.container?.getBoundingClientRect() ?? rect
    const project = (v: THREE.Vector3) => { const q = host.partGroup.localToWorld(v.clone()).project(host.camera()); return { x: rect.left + (q.x + 1) * rect.width / 2, y: rect.top + (1 - q.y) * rect.height / 2, z: q.z } }
    const p = project(centre)
    if (p.z < -1 || p.z > 1) { if (this.svg) this.svg.style.display = 'none'; return }
    const add = (tag: string, attrs: Record<string, string | number>) => { if (!this.svg) return; const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); this.svg.append(e) }
    const origin = { x: p.x - container.left, y: p.y - container.top }
    axes.forEach((axis, index) => {
      const end = project(centre.clone().add(axis)), dx = end.x - p.x, dy = end.y - p.y, unit = Math.hypot(dx, dy)
      const drawable = unit >= .01
      const ux = drawable ? dx / unit : 0, uy = drawable ? dy / unit : 0, x = origin.x, y = origin.y, color = colors[index]
      if (drawable) {
      add('line', { x1: x + ux * 14, y1: y + uy * 14, x2: x + ux * 64, y2: y + uy * 64, stroke: color, 'stroke-width': 4 })
      add('polygon', { points: `${x+ux*75},${y+uy*75} ${x+ux*59-uy*7},${y+uy*59+ux*7} ${x+ux*59+uy*7},${y+uy*59-ux*7}`, fill: color })
      }
      const base = { axis, centre, x: p.x, y: p.y, dx: ux, dy: uy, unit }
      if (drawable) {
      this.hits.push({ ...base, kind: 'move', px: p.x + ux * 57, py: p.y + uy * 57, radius: 20 })
      if (ids.length > 1) {
      add('circle', { cx: x + ux * 94, cy: y + uy * 94, r: 6, fill: color, 'data-handle': `scale-${index}` })
      this.hits.push({ ...base, kind: 'scale', px: p.x + ux * 94, py: p.y + uy * 94, radius: 9 })
      }
      }
      // Project a quarter-circle in the plane perpendicular to this axis.
      if (ids.length > 1) {
        const a = axes[(index+1)%3], b = axes[(index+2)%3]
        const pa = project(centre.clone().add(a)), pb = project(centre.clone().add(b))
        const planeUnit = Math.max(Math.hypot(pa.x-p.x,pa.y-p.y), Math.hypot(pb.x-p.x,pb.y-p.y))
        if (planeUnit < .01) return
        const worldRadius = 48 / planeUnit
        const pts = Array.from({length: 17}, (_, i) => project(centre.clone().addScaledVector(a, Math.cos(i*Math.PI/32)*worldRadius).addScaledVector(b, Math.sin(i*Math.PI/32)*worldRadius)))
        add('polyline', { points: pts.map(q=>`${q.x-container.left},${q.y-container.top}`).join(' '), fill:'none', stroke:color, 'stroke-width':4 })
        for (const q of pts.slice(2,-2)) this.hits.push({...base,kind:'rotate',px:q.x,py:q.y,radius:6})
      }
    })
    add('circle', {cx:origin.x,cy:origin.y,r:4,fill:'#fff',stroke:'#555'})
  }
  hit(x: number, y: number): ManipulatorHit | null {
    let best = Infinity, result: ManipulatorHit | null = null
    for (const h of this.hits) { const distance = Math.hypot(x-h.px,y-h.py); if (distance <= h.radius && distance < best) { best = distance; result = h } }
    return result
  }
  dispose() { this.svg?.remove(); this.hits = [] }
}
