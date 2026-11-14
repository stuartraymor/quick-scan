// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import { FreeformManipulator, type ManipulatorFrame } from './freeformManipulator'
import type { Vec3 } from '../../../src/core/types'
import type { SceneLayer, SceneLayerHost } from '../../../src/viewer/sceneLayers'
import { type Cage, edgeKey, topology, vertexAt } from '../core/freeform/cage'
import { edgeLine, extrapolateEdges, movePoints } from '../core/freeform/edit'
import { subdivide } from '../core/freeform/subdivide'
import { cageVertexLimits } from '../core/freeform/limit'

export interface FreeformPick { kind: 'vertex' | 'edge' | 'face'; index: number }
export type FreeformSelectionMode = 'points-edges' | 'points' | 'edges' | 'faces' | 'all' | 'boundary'
export interface FreeformEditorOptions {
  enabled?: boolean
  mode?: FreeformSelectionMode
  selection?: FreeformPick[]
  hiddenFaces?: number[]
  manipulator?: ManipulatorFrame
  controlNet?: boolean
  opacity?: number
  extrapolate?: boolean
  duplicateHandle?: boolean
  strength?: number
  neighbourRadius?: number
  creating?: boolean
  onSelection?(selection: FreeformPick[]): void
  onContext?(x: number, y: number, pick: FreeformPick | null): void
  onCommit?(cage: Cage, selection?: FreeformPick[]): void
  onCreatePoint?(point: Vec3): void
  onPreview?(cage: Cage, dragging: boolean): void
  onError?(error: Error): void
  snapPoint?(point: Vec3): Vec3 | null
}
const same = (a: FreeformPick | null, b: FreeformPick | null) => a?.kind === b?.kind && a?.index === b?.index
const YELLOW = 0xffeb00, HOVER = 0x00d9ff, EDGE = 0x26343d, SURFACE = 0x72a8c1

/** Plugin-owned cage selection and direct manipulation. The body remains a
 * kernel feature; this temporary control polygon never enters project state. */
export class FreeformEditorLayer {
  private cage: Cage | null = null
  private topologyCache: {cage:Cage;value:ReturnType<typeof topology>} | null = null
  private cageTopology(cage:Cage) {
    if(this.topologyCache?.cage!==cage) this.topologyCache={cage,value:topology(cage)}
    return this.topologyCache.value
  }
  private options: FreeformEditorOptions = {}
  private selection: FreeformPick[] = []
  private preview: { cage: Cage; selection: FreeformPick[] } | null = null
  private hovered: FreeformPick | null = null
  private group = new THREE.Group()
  private faces: THREE.Mesh[] = []
  /** Raw cage occlusion only; face selection uses the displayed surface. */
  private controlOccluders: THREE.Mesh[] = []
  private cancelDrag: (() => void) | null = null
  private duplicate: HTMLDivElement | null = null
  private lastEdgeClick: { index: number; x: number; y: number; time: number } | null = null
  private manipulator: FreeformManipulator
  private disposed = false
  private drawError = ''
  private surfaceCache: { cage: Cage; snap: FreeformEditorOptions['snapPoint']; faces: number[][]; owners: number[]; points: Vec3[]; paths: number[][] } | null = null
  constructor(private host: SceneLayerHost) {
    this.manipulator = new FreeformManipulator(host)
    host.partGroup.add(this.group)
    if (typeof document !== 'undefined' && host.container) {
      this.duplicate = document.createElement('div')
      this.duplicate.textContent = 'D'
      this.duplicate.dataset.test = 'freeform-duplicate-handle'
      Object.assign(this.duplicate.style, { position: 'absolute', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', color: '#111', border: '1px solid #333', textAlign: 'center', lineHeight: '18px', font: '12px/18px sans-serif', pointerEvents: 'none', display: 'none', zIndex: '5' })
      host.container.append(this.duplicate)
    }
    host.canvas.addEventListener('contextmenu', this.contextMenu)
    host.canvas.addEventListener('dblclick', this.doubleClick)
  }
  set(cage: Cage | null, options: FreeformEditorOptions = {}): void {
    // React can feed selection callbacks back while a gesture is held.
    // Preserve that gesture when the source cage identity has not changed.
    if (this.cancelDrag && cage === this.cage && options.enabled !== false) { this.options = options; return }
    this.cancelDrag?.()
    if (cage !== this.cage || options.mode !== this.options.mode) this.lastEdgeClick = null
    this.cage = cage; this.options = options; this.selection = options.selection?.slice() ?? []; this.hovered = null
    this.draw(cage)
  }
  private contextMenu = (event: MouseEvent) => {
    if (this.options.enabled === false || (!this.cage && !this.options.creating)) return
    event.preventDefault(); event.stopPropagation()
    if (this.cancelDrag) { this.cancelDrag(); return }
    const hit = this.pick(event.clientX, event.clientY)
    // Native Freeform adds a newly right-clicked edge to edges already selected.
    // A different entity type starts a new context selection.
    if (hit && !this.selection.some(p => same(p, hit))) {
      const sameKind = this.selection.every(pick => pick.kind === hit.kind)
      this.select(sameKind ? [...this.selection, hit] : [hit])
    }
    this.options.onContext?.(event.clientX, event.clientY, hit)
  }
  private doubleClick = (event: MouseEvent) => {
    if (this.options.enabled === false || this.options.creating || !this.cage) return
    const hit = this.pick(event.clientX, event.clientY)
    if (hit?.kind !== 'edge') return
    event.preventDefault(); event.stopPropagation(); this.cancelDrag?.()
    const line = edgeLine(this.cage, hit.index, this.options.hiddenFaces).map(index => ({ kind: 'edge' as const, index }))
    this.select(event.ctrlKey || event.metaKey ? [...line, ...this.selection.filter(p => !line.some(q => same(p, q)))] : line)
  }
  private select(picks: FreeformPick[]) {
    this.selection = picks
    this.draw(this.cage)
    this.options.onSelection?.(picks.slice())
  }
  private clearDrawing() {
    for (const object of [...this.group.children]) {
      const mesh = object as THREE.Mesh
      mesh.geometry?.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach(m => m?.dispose())
      this.group.remove(object)
    }
    this.faces = []
    this.controlOccluders = []
  }
  private visible(cage: Cage) {
    const hidden = new Set(this.options.hiddenFaces ?? [])
    const top = this.cageTopology(cage)
    const face = cage.faces.map((_, i) => !hidden.has(i))
    const edges = top.edges.map(e => e.faces.some(i => face[i]))
    const vertices = top.vertexFaces.map(fs => fs.some(i => face[i]))
    return { top, face, edges, vertices }
  }
  private color(pick: FreeformPick, base: number) {
    return (this.preview?.selection ?? this.selection).some(p => same(p, pick)) ? YELLOW : same(this.hovered, pick) ? HOVER : base
  }
  private surface(cage: Cage) {
      if (this.surfaceCache?.cage === cage && this.surfaceCache.snap === this.options.snapPoint) return this.surfaceCache
      let smooth = cage, owners = cage.faces.map((_, i) => i)
      let paths = this.cageTopology(cage).edges.map(e => [e.a, e.b])
      for (let step = 0; step < 2; step++) {
        const top = topology(smooth), offset = smooth.positions.length / 3 + smooth.faces.length
        paths = paths.map(path => path.flatMap((v, i) => i === path.length - 1 ? [v] : [v, offset + top.edgeOf.get(edgeKey(v, path[i + 1]))!]))
        owners = smooth.faces.flatMap((face, i) => face.map(() => owners[i]))
        smooth = subdivide(smooth)
      }
      const limit = cageVertexLimits(smooth)
      let displayPoints = limit
      if (this.options.snapPoint) {
        try {
          displayPoints = limit.map(p => {
            const q = this.options.snapPoint!(p)
            return q?.every(Number.isFinite) ? q : p
          })
          this.drawError = ''
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (this.drawError !== message) { this.drawError = message; this.options.onError?.(new Error(message)) }
        }
      }
      this.surfaceCache = { cage, snap: this.options.snapPoint, faces: smooth.faces, owners, points: displayPoints, paths }
      return this.surfaceCache
  }
  private draw(cage: Cage | null) {
    this.clearDrawing()
    if (cage) {
      const visible = this.visible(cage)
      const smooth = this.surface(cage)
      const surfacePositions: number[] = [], surfaceColors: number[] = [], faceOwners: number[] = []
      smooth.faces.forEach((face, i) => {
        const owner = smooth.owners[i]
        if (!visible.face[owner]) return
        const color = new THREE.Color(this.color({ kind: 'face', index: owner }, SURFACE))
        for (let k = 1; k + 1 < face.length; k++) {
          faceOwners.push(owner)
          for (const v of [face[0], face[k], face[k + 1]]) {
            surfacePositions.push(...smooth.points[v]); surfaceColors.push(color.r, color.g, color.b)
          }
        }
      })
      const surfaceGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(surfacePositions, 3)).setAttribute('color', new THREE.Float32BufferAttribute(surfaceColors, 3))
      surfaceGeometry.computeVertexNormals()
      const surfaceMesh = new THREE.Mesh(surfaceGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: this.options.opacity ?? 0.72, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }))
      surfaceMesh.userData.faceOwners = faceOwners
      this.group.add(surfaceMesh); this.faces.push(surfaceMesh)
      // A single raw proxy retains control-point/edge occlusion semantics;
      // it is never offered as a face selection target.
      const controlPositions: number[] = [], controlOwners: number[] = []
      cage.faces.forEach((face, index) => {
        if (!visible.face[index]) return
        for (let k = 1; k + 1 < face.length; k++) {
          controlOwners.push(index)
          for (const v of [face[0], face[k], face[k + 1]]) controlPositions.push(...vertexAt(cage, v))
        }
      })
      const controlGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(controlPositions, 3))
      const controlMesh = new THREE.Mesh(controlGeometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false }))
      controlMesh.userData.faceOwners = controlOwners
      this.group.add(controlMesh); this.controlOccluders.push(controlMesh)
      const lines: number[] = [], colors: number[] = []
      visible.top.edges.forEach((e, index) => {
        if (!visible.edges[index]) return
        const color = new THREE.Color(this.color({ kind: 'edge', index }, e.crease ? 0xc73737 : e.faces.length === 1 && this.options.controlNet === false ? 0xffffff : EDGE))
        const points = this.options.controlNet === false ? smooth.paths[index].map(v => smooth.points[v]) : [vertexAt(cage,e.a),vertexAt(cage,e.b)]
        for (let i=1;i<points.length;i++) for (const point of [points[i-1],points[i]]) { lines.push(...point); colors.push(color.r,color.g,color.b) }
      })
      const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)).setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
      this.group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true })))
      const points: number[] = [], pointColors: number[] = []
      const mode = this.options.mode ?? 'points-edges'
      const showPoints = mode === 'points-edges' || mode === 'points' || mode === 'all'
      visible.vertices.forEach((on, index) => {
        if (!on || (!showPoints && !this.selection.some(p => p.kind === 'vertex' && p.index === index))) return
        const color = new THREE.Color(this.color({ kind: 'vertex', index }, EDGE))
        points.push(...this.displayPoint(cage, index)); pointColors.push(color.r, color.g, color.b)
      })
      const pg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)).setAttribute('color', new THREE.Float32BufferAttribute(pointColors, 3))
      this.group.add(new THREE.Points(pg, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true })))
    }
    this.tick(); this.host.invalidate()
  }
  private displayPoint(cage: Cage, index: number): Vec3 {
    return this.options.controlNet === false ? this.surface(cage).points[index] : vertexAt(cage,index)
  }
  private project(point: Vec3) {
    this.host.partGroup.updateWorldMatrix(true, false)
    const q = this.host.partGroup.localToWorld(new THREE.Vector3(...point)).project(this.host.camera())
    const r = this.host.canvas.getBoundingClientRect()
    return { x: r.left + (q.x + 1) * r.width / 2, y: r.top + (1 - q.y) * r.height / 2, z: q.z }
  }
  private pick(x: number, y: number): FreeformPick | null {
    const cage = this.cage
    if (!cage) return null
    const visible = this.visible(cage)
    this.host.setPickRay(x, y); this.group.updateWorldMatrix(true, true)
    const mode = this.options.mode ?? 'points-edges'
    const pickFace = (): FreeformPick | null => {
      const hit = this.host.raycaster.intersectObjects(this.faces, false)[0]
      const index = hit?.faceIndex == null ? undefined : hit.object.userData.faceOwners[hit.faceIndex]
      return index === undefined ? null : { kind: 'face', index }
    }
    if (mode === 'faces') return pickFace()
    const hit = this.host.raycaster.intersectObjects(this.options.controlNet === false ? this.faces : this.controlOccluders, false)[0]
    // Reject points and edges behind this cage. Hidden faces have no pick mesh.
    const camera = this.host.camera(), height = Math.max(1, this.host.canvas.getBoundingClientRect().height)
    const worldPerPixel = !hit ? 0 : camera instanceof THREE.PerspectiveCamera
      ? 2 * hit.distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / (height * camera.zoom)
      : camera instanceof THREE.OrthographicCamera
        ? (camera.top - camera.bottom) / (height * camera.zoom)
        : this.host.modelRadius() / height
    const hitOwner: number | undefined = hit?.faceIndex == null ? undefined : hit.object.userData.faceOwners?.[hit.faceIndex]
    const visibleAt = (point: Vec3, pickRadiusPixels: number, incidentFaces: number[]) => {
      const world = this.host.partGroup.localToWorld(new THREE.Vector3(...point))
      if (!hit) return true
      // An edge or point can project a few pixels inside its own sloping
      // face. Give that projected pick radius the same depth allowance so
      // the face does not mask its own border, while rejecting deeper parts.
      const allowance = hitOwner !== undefined && incidentFaces.includes(hitOwner)
        ? Math.max(this.host.modelRadius() * 1e-4, pickRadiusPixels * worldPerPixel)
        : this.host.modelRadius() * 1e-4
      return world.clone().sub(this.host.raycaster.ray.origin).dot(this.host.raycaster.ray.direction) <= hit.distance + allowance
    }
    const projected = Array.from({ length: cage.positions.length / 3 }, (_, i) => this.project(this.displayPoint(cage, i)))
    let distance = 9, result: FreeformPick | null = null
    projected.forEach((p, index) => {
      if (mode === 'edges' || mode === 'boundary') return
      if (!visible.vertices[index] || p.z < -1 || p.z > 1 || !visibleAt(this.displayPoint(cage, index), 9, visible.top.vertexFaces[index])) return
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < distance) { distance = d; result = { kind: 'vertex', index } }
    })
    if (result) return result
    distance = 7
    visible.top.edges.forEach((edge, index) => {
      if (mode === 'points' || (mode === 'boundary' && edge.faces.length !== 1)) return
      if (!visible.edges[index]) return
      const points = this.options.controlNet === false ? this.surface(cage).paths[index].map(v => this.surface(cage).points[v]) : [vertexAt(cage,edge.a),vertexAt(cage,edge.b)]
      for (let i=1;i<points.length;i++) {
        const pa=points[i-1],pb=points[i],a=this.project(pa),b=this.project(pb)
        if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) continue
        const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy
        const t=length?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/length)):0
        const d=Math.hypot(x-a.x-t*dx,y-a.y-t*dy)
        const point=pa.map((p,k)=>p+t*(pb[k]-p)) as Vec3
        if(d<distance && visibleAt(point, 7, edge.faces)){distance=d;result={kind:'edge',index}}
      }
    })
    // Native mixed-type priority remains under comparison. Keep precise
    // points/edges ahead of face interiors, avoiding accidental face drags.
    return result ?? (mode === 'all' ? pickFace() : null)
  }
  private duplicateAnchor() {
    const mode=this.options.mode ?? 'points-edges',cage=this.preview?.cage ?? this.cage,selection=this.preview?.selection ?? this.selection
    if (mode==='points'||mode==='faces'||!cage||!this.options.duplicateHandle||!selection.length||selection.some(p=>p.kind!=='edge')) return null
    const top=this.cageTopology(cage)
    if(selection.some(p=>{const e=top.edges[p.index];return !e||e.faces.length!==1||this.options.hiddenFaces?.includes(e.faces[0])})) return null
    for (const { index } of selection) {
      const edge = top.edges[index]
      let midpoint: Vec3
      if (this.options.controlNet === false) {
        const surface = this.surface(cage)
        const path = surface.paths[index]
        midpoint = surface.points[path[Math.floor(path.length / 2)]]
      } else {
        const a = vertexAt(cage, edge.a), b = vertexAt(cage, edge.b)
        midpoint = a.map((value, axis) => (value + b[axis]) / 2) as Vec3
      }
      if (this.preview || this.unobscured(midpoint)) {
        return { edge, indices: selection.map(pick => pick.index), at: this.project(midpoint) }
      }
    }
    return null
  }
  private tick() {
    const cage = this.preview?.cage ?? this.cage, top = cage ? this.cageTopology(cage) : null
    const ids = cage && top ? [...new Set((this.preview?.selection ?? this.selection).flatMap(p => p.kind === 'vertex' ? [p.index] : p.kind === 'face' ? cage.faces[p.index] ?? [] : top.edges[p.index] ? [top.edges[p.index].a, top.edges[p.index].b] : []))] : []
    this.manipulator.update(cage, ids, this.options.manipulator ?? 'local', !!this.options.manipulator && this.options.enabled !== false)
    const handle = this.duplicateAnchor()
    if (!this.duplicate) return
    if (!handle || handle.at.z < -1 || handle.at.z > 1) { this.duplicate.style.display = 'none'; return }
    const r = this.host.container.getBoundingClientRect()
    Object.assign(this.duplicate.style, { display: 'block', left: `${handle.at.x - r.left - 10}px`, top: `${handle.at.y - r.top - 10}px` })
  }
  private unobscured(point: Vec3) {
    const p=this.project(point)
    if(p.z < -1 || p.z > 1) return false
    this.host.setPickRay(p.x,p.y);this.group.updateWorldMatrix(true,true)
    const hit=this.host.raycaster.intersectObjects(this.options.controlNet===false?this.faces:this.controlOccluders,false)[0]
    const world=this.host.partGroup.localToWorld(new THREE.Vector3(...point))
    return !hit || world.sub(this.host.raycaster.ray.origin).dot(this.host.raycaster.ray.direction)<=hit.distance+this.host.modelRadius()*1e-4
  }
  private boxPicks(x0:number,y0:number,x1:number,y1:number): FreeformPick[] {
    const cage=this.cage
    if(!cage) return []
    const visible=this.visible(cage), mode=this.options.mode??'points-edges', result:FreeformPick[]=[]
    const inside=(p:Vec3)=>{const q=this.project(p);return q.x>=Math.min(x0,x1)&&q.x<=Math.max(x0,x1)&&q.y>=Math.min(y0,y1)&&q.y<=Math.max(y0,y1)&&this.unobscured(p)}
    const point=(i:number)=>this.displayPoint(cage,i)
    if(!['edges','boundary','faces'].includes(mode)) visible.vertices.forEach((v,i)=>{if(v&&inside(point(i)))result.push({kind:'vertex',index:i})})
    if(!['points','faces'].includes(mode)) visible.top.edges.forEach((e,i)=>{
      if(!visible.edges[i] || mode==='boundary'&&e.faces.length!==1)return
      const path=this.options.controlNet===false?this.surface(cage).paths[i].map(v=>this.surface(cage).points[v]):[vertexAt(cage,e.a),vertexAt(cage,e.b)]
      if(path.every(inside))result.push({kind:'edge',index:i})
    })
    if(mode==='faces'||mode==='all') cage.faces.forEach((f,i)=>{if(visible.face[i]&&f.every(v=>inside(point(v))))result.push({kind:'face',index:i})})
    return result
  }
  private beginBox(e:PointerEvent): boolean {
    const canvas=this.host.canvas, original=this.selection.slice()
    let lastX=e.clientX,lastY=e.clientY,done=false
    const rectangle=typeof document!=='undefined'?document.createElement('div'):null
    if(rectangle){rectangle.dataset.test='freeform-selection-box';Object.assign(rectangle.style,{position:'fixed',pointerEvents:'none',zIndex:'9999',border:'1px solid #56b8ef',background:'#56b8ef22'});document.body.append(rectangle)}
    const move=(ev:PointerEvent)=>{if(ev.pointerId!==e.pointerId)return;lastX=ev.clientX;lastY=ev.clientY;if(rectangle)Object.assign(rectangle.style,{left:Math.min(e.clientX,lastX)+'px',top:Math.min(e.clientY,lastY)+'px',width:Math.abs(lastX-e.clientX)+'px',height:Math.abs(lastY-e.clientY)+'px'})}
    const finish=(accept:boolean)=>{
      if(done)return;done=true;this.cancelDrag=null;rectangle?.remove()
      canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('lostpointercapture',cancel);window.removeEventListener('keydown',key,true)
      try{canvas.releasePointerCapture(e.pointerId)}catch{/* already released */}
      this.host.claimDrag(false)
      if(accept){const picks=Math.hypot(lastX-e.clientX,lastY-e.clientY)>=3?this.boxPicks(e.clientX,e.clientY,lastX,lastY):[];this.select(e.ctrlKey||e.metaKey?[...original,...picks.filter(p=>!original.some(q=>same(p,q)))]:picks)}
    }
    const up=(ev:PointerEvent)=>{if(ev.pointerId===e.pointerId){move(ev);finish(true)}}
    const cancel=(ev:PointerEvent)=>{if(ev.pointerId===e.pointerId)finish(false)}
    const key=(ev:KeyboardEvent)=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();finish(false)}else if((ev.ctrlKey||ev.metaKey)&&['z','y'].includes(ev.key.toLowerCase()))finish(false)}
    this.cancelDrag=()=>finish(false);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',cancel);window.addEventListener('keydown',key,true);this.host.claimDrag(true)
    try{canvas.setPointerCapture(e.pointerId)}catch{/* forwarding fallback */}
    return true
  }
  private begin(e: PointerEvent): boolean {
    if (this.options.enabled === false || this.cancelDrag) return e.button === 0
    if (e.button !== 0 || e.shiftKey || e.altKey || !this.cage || this.options.creating) return false
    const handle = this.duplicateAnchor()
    let duplicate = handle && Math.hypot(e.clientX - handle.at.x, e.clientY - handle.at.y) <= 11 ? handle : null
    const grip = duplicate ? null : this.manipulator.hit(e.clientX, e.clientY)
    const hit = grip || duplicate ? this.selection[0] : this.pick(e.clientX, e.clientY)
    if (!hit) return this.beginBox(e)
    if (e.ctrlKey || e.metaKey) {
      this.select(this.selection.some(p => same(p, hit)) ? this.selection.filter(p => !same(p, hit)) : [...this.selection, hit])
      return true
    }
    if (!this.selection.some(p => same(p, hit))) this.select([hit])
    if (!grip && !duplicate && this.options.extrapolate && hit.kind === 'edge') {
      const top = this.cageTopology(this.cage)
      const picks = this.selection.filter(p => p.kind === 'edge')
      if (picks.length !== this.selection.length || picks.some(p => top.edges[p.index].faces.length !== 1)) return true
      duplicate = { edge: top.edges[hit.index], indices: picks.map(p => p.index), at: this.project(vertexAt(this.cage, top.edges[hit.index].a)) }
    }
    const original = this.cage, options = this.options, host = this.host, el = host.canvas
    const top = this.cageTopology(original)
    const vertices = [...new Set(this.selection.flatMap(p => p.kind === 'vertex' ? [p.index] : p.kind === 'face' ? original.faces[p.index] ?? [] : top.edges[p.index] ? [top.edges[p.index].a, top.edges[p.index].b] : []))]
    if (!vertices.length) return true
    const centre = new THREE.Vector3()
    vertices.forEach(i => centre.add(new THREE.Vector3(...vertexAt(original, i))))
    centre.divideScalar(vertices.length); host.partGroup.updateWorldMatrix(true, false); host.partGroup.localToWorld(centre)
    const dragNormal = grip?.kind === 'rotate' ? grip.axis.clone().applyQuaternion(host.partGroup.getWorldQuaternion(new THREE.Quaternion())) : host.camera().getWorldDirection(new THREE.Vector3())
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dragNormal, centre)
    const point = (x: number, y: number) => { host.setPickRay(x, y); const world = host.raycaster.ray.intersectPlane(plane, new THREE.Vector3()); return world ? host.partGroup.worldToLocal(world) : null }
    const start = point(e.clientX, e.clientY)
    if (!start) return true
    let current = original, changed = false, done = false, nextSelection = this.selection.slice()
    const update = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      const next = point(ev.clientX, ev.clientY)
      if (!next) return
      const cursorPoint = next.clone()
      const delta = next.sub(start).multiplyScalar(Math.max(0, Math.min(1, options.strength ?? 1)))
      if (grip?.kind === 'move') delta.copy(grip.axis).multiplyScalar(((ev.clientX-e.clientX)*grip.dx+(ev.clientY-e.clientY)*grip.dy)/grip.unit * (options.strength ?? 1))
      changed = delta.lengthSq() > 1e-16 && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) >= 2
      if (changed && duplicate) {
        const edge = new THREE.Vector3(...vertexAt(original, duplicate.edge.b)).sub(new THREE.Vector3(...vertexAt(original, duplicate.edge.a)))
        // Pulling along the source edge creates a zero-area quad, not a
        // surface extension. Keep the source preview and history intact.
        if (edge.clone().cross(delta).lengthSq() <= 1e-20 * Math.max(1, edge.lengthSq() * delta.lengthSq())) changed = false
      }
      if (changed && duplicate) {
        const extended = extrapolateEdges(original, duplicate.indices, delta.toArray(), true)
        current = extended.cage; nextSelection = extended.edges.map(index => ({ kind: 'edge', index }))
      } else current = changed ? movePoints(original, vertices.map(vertex => ({ vertex, by: delta.toArray() })), options.neighbourRadius ?? 0) : original
      if (changed && grip && grip.kind !== 'move') {
        const strength = options.strength ?? 1
        const a = start.clone().sub(grip.centre), b = cursorPoint.sub(grip.centre)
        const angle = Math.atan2(a.clone().cross(b).dot(grip.axis), a.dot(b)) * strength
        const factor = Math.max(.01, 1 + ((ev.clientX-e.clientX)*grip.dx+(ev.clientY-e.clientY)*grip.dy) / 94 * strength)
        current = movePoints(original, vertices.map(vertex => {
          const old = new THREE.Vector3(...vertexAt(original, vertex)), rel = old.clone().sub(grip.centre)
          const moved = grip.kind === 'rotate' ? rel.applyAxisAngle(grip.axis, angle) : rel.addScaledVector(grip.axis, rel.dot(grip.axis)*(factor-1))
          return {vertex, by: moved.add(grip.centre).sub(old).toArray() as Vec3}
        }), options.neighbourRadius ?? 0)
      }
      if (changed && options.snapPoint) {
        for (let i = 0; i < current.positions.length / 3; i++) {
          const moved = i >= original.positions.length / 3 || [0, 1, 2].some(k => current.positions[i * 3 + k] !== original.positions[i * 3 + k])
          if (!moved) continue
          const snapped = options.snapPoint(vertexAt(current, i))
          if (snapped?.every(Number.isFinite)) current.positions.set(snapped, i * 3)
        }
      }
      if (changed && duplicate) {
        for (const face of current.faces.slice(original.faces.length)) {
        const points = face.map(i => new THREE.Vector3(...vertexAt(current, i)))
        const collapsedEdge = points.some((p, i) => p.distanceToSquared(points[(i + 1) % points.length]) < 1e-20)
        const area = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).length() + points[2].clone().sub(points[0]).cross(points[3].clone().sub(points[0])).length()
        if (collapsedEdge || area < 1e-12) { current = original; changed = false; break }
        }
      }
      changed = current.faces.length !== original.faces.length || current.positions.some((v, i) => Math.abs(v - original.positions[i]) > 1e-10)
      this.preview = changed ? {cage:current,selection:nextSelection} : null
      this.draw(current); options.onPreview?.(current, true)
    }
    const move = (ev: PointerEvent) => {
      try { update(ev) } catch (error) { finish(false); options.onError?.(error instanceof Error ? error : new Error(String(error))) }
    }
    const finish = (accept: boolean) => {
      if (done) return
      done = true; this.cancelDrag = null
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', cancel); el.removeEventListener('lostpointercapture', cancel)
      window.removeEventListener('keydown', key, true)
      try { el.releasePointerCapture(e.pointerId) } catch { /* capture already released */ }
      host.claimDrag(false)
      this.preview = null
      this.draw(accept && changed ? current : original); options.onPreview?.(accept && changed ? current : original, false)
      if (accept && changed) {
        try { options.onCommit?.(current, nextSelection) } catch (error) { options.onError?.(error instanceof Error ? error : new Error(String(error))) }
      }
    }
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      move(ev)
      const click = !changed && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 2 && hit.kind === 'edge'
      finish(true)
      // The scene owns/prevents pointerdown for direct manipulation, which
      // suppresses browser mouse/dblclick events. Recognize the two released
      // clicks here as well; never interpret a completed drag as a click.
      const previous = this.lastEdgeClick
      if (click && (ev.detail === 2 || (previous?.index === hit.index && ev.timeStamp - previous.time <= 500 && Math.hypot(ev.clientX - previous.x, ev.clientY - previous.y) <= 5))) {
        this.lastEdgeClick = null
        this.select(edgeLine(original, hit.index, options.hiddenFaces).map(index => ({kind:'edge', index})))
      } else this.lastEdgeClick = click ? {index:hit.index,x:ev.clientX,y:ev.clientY,time:ev.timeStamp} : null
    }
    const cancel = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) finish(false) }
    const key = (ev: KeyboardEvent) => {
      if (done) return
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); finish(false) }
      // Undo/redo operates on committed history; discard the uncommitted
      // drag first, then let the normal history shortcut propagate.
      else if ((ev.ctrlKey || ev.metaKey) && ['z', 'y'].includes(ev.key.toLowerCase())) finish(false)
    }
    this.cancelDrag = () => finish(false)
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', end); el.addEventListener('pointercancel', cancel); el.addEventListener('lostpointercapture', cancel)
    window.addEventListener('keydown', key, true); host.claimDrag(true)
    try { el.setPointerCapture(e.pointerId) } catch { /* canvas-local gestures remain available */ }
    return true
  }
  layer(): SceneLayer {
    return { order: 13, covers: true, pointerDown: e => this.begin(e),
      click: (x, y) => {
        if (this.options.enabled === false) return true
        if (this.options.creating) { const hit = this.host.pickScan(x, y); if (hit) this.options.onCreatePoint?.(hit.point); return true }
        if (!this.cage) return false
        this.select([]); return true
      },
      hover: (at, covered) => {
        if (this.options.enabled === false) return false
        if (this.cancelDrag) return true
        const grip = !covered && at ? this.manipulator.hit(at.x, at.y) : null
        if (grip) { this.host.setCursor(grip.kind === 'rotate' ? 'grab' : 'move'); return true }
        const handle = !covered && at ? this.duplicateAnchor() : null
        if (handle && at && Math.hypot(at.x - handle.at.x, at.y - handle.at.y) <= 11) { this.host.setCursor('copy'); return true }
        const next = !covered && at ? this.pick(at.x, at.y) : null
        if (!same(next, this.hovered)) { this.hovered = next; this.draw(this.cage) }
        if (next) this.host.setCursor(this.options.extrapolate && next.kind === 'edge' && this.cage && this.cageTopology(this.cage).edges[next.index].faces.length === 1 ? 'copy' : 'move')
        return !!next
      }, tick: () => this.tick(), scanReplaced: () => this.set(null), dispose: () => this.dispose() }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true; this.cancelDrag?.(); this.clearDrawing(); this.surfaceCache = null; this.topologyCache = null; this.group.removeFromParent(); this.duplicate?.remove(); this.manipulator.dispose()
    this.host.canvas.removeEventListener('dblclick', this.doubleClick); this.host.canvas.removeEventListener('contextmenu', this.contextMenu); this.host.claimDrag(false)
  }
}
