import { snapRayReach } from '../core/freeform/snap'
import { updateSurfaceAttribute } from './updateSurfaceBuffers'
import { preservesRefitOrientation, refitDirection } from '../core/freeform/smoothSnap'
import { vertexNormals } from '../core/freeform/limit'
import type { PreviewColouring } from '../core/freeform/previewDeviation'
import { refineDeviation, type MeasuredTriangles } from '../core/freeform/deviationRefinement'
// SPDX-License-Identifier: AGPL-3.0-only
import * as THREE from 'three'
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'
import { CENTER, MeshBVH } from 'three-mesh-bvh'
import { FreeformManipulator, type ManipulatorFrame } from './freeformManipulator'
import type { Vec3 } from '../../../src/core/types'
import type { SceneLayer, SceneLayerHost } from '../../../src/viewer/sceneLayers'
import { type Cage, edgeKey, topology, vertexAt } from '../core/freeform/cage'
import { type Corner, addFace, cloneCage, edgeLine, extrapolateEdges, movePoints } from '../core/freeform/edit'
import { previewEvaluation, previewTopologyKey } from '../core/freeform/previewEvaluation'
import { cageVertexLimits } from '../core/freeform/limit'
import { moveSurfaceAnchor, surfaceAnchorDrag } from './freeformAnchorDrag'
import { fitMergedContact, mergeBoundaryEdge, mergeBoundaryPoint, mergeChainEnds } from '../core/freeform/merge'
import { liveDeviationGrid } from '../core/freeform/liveDeviationGrid'
import { deviationAtlasValues } from '../core/freeform/deviationAtlas'
import type { KernelMesh } from '../core/kernel'

export interface FreeformDeviationRange {
  min: number
  max: number
  rms: number
  preview: boolean
}

export interface FreeformPick { kind: 'vertex' | 'edge' | 'face'; index: number }
export type FreeformSelectionMode = 'points-edges' | 'points' | 'edges' | 'faces' | 'all' | 'boundary'
export interface FreeformEditorOptions {
  enabled?: boolean
  rebuilding?: boolean
  mode?: FreeformSelectionMode
  selection?: FreeformPick[]
  hiddenFaces?: number[]
  manipulator?: ManipulatorFrame
  controlNet?: boolean
  opacity?: number
  showEdges?: boolean
  display?: FreeformDisplayMode
  tolerance?: number
  finishedSurface?: THREE.BufferGeometry
  readDeviationMesh?(): Promise<{ positions: Float32Array; indices: Uint32Array; analysisGrid?: KernelMesh['analysisGrid'] }>
  refineDeviation?(data: MeasuredTriangles, tolerance: number): Promise<MeasuredTriangles>
  deviationReference?: object
  colouring?: PreviewColouring
  measureDeviation?(positions: Float32Array): Promise<Float32Array>
  measureLiveDeviation?(positions: Float32Array): Float32Array
  onDeviation?(range: FreeformDeviationRange | null): void
  onDeviationError?(): void
  extrapolate?: boolean
  duplicateHandle?: boolean
  strength?: number
  neighbourRadius?: number
  creating?: boolean
  creationCorners?: readonly Vec3[]
  creationVertices?: readonly (number | undefined)[]
  onSelection?(selection: FreeformPick[]): void
  onContext?(x: number, y: number, pick: FreeformPick | null): void
  onCommit?(cage: Cage, selection?: FreeformPick[]): void
  creationTool?: 'face' | 'rectangle'
  onCreatePoint?(point: Vec3, vertex?: number): void
  onCreateRectangle?(corners: Vec3[]): void
  onCancelCreation?(): void
  brush?: { kind: 'faces' } | { kind: 'smooth'; radius: number; onStroke(vertices: number[]): void }
  onPreview?(cage: Cage, dragging: boolean): void
  onError?(error: Error): void
  snapPoint?(point: Vec3): Vec3 | null
  rayPoint?(point: Vec3, normal: Vec3): Vec3 | null
  refitPoint?(point: Vec3, axis: Vec3, reach: number): Vec3 | null
  fitToScan?: boolean
}
export type FreeformDisplayMode = "shaded" | "deviation" | "zebra"

const same = (a: FreeformPick | null, b: FreeformPick | null) => a?.kind === b?.kind && a?.index === b?.index
const YELLOW = 0xffeb00, HOVER = 0x00d9ff, EDGE = 0x26343d, SURFACE = 0x5598c3

/** Sample corners, shared edge midpoints, and face centres. The painted
 * triangles interpolate the same measurements as the reported range. */
function deviationSamples(positions: Float32Array, indices?: ArrayLike<number>) {
  const corners = indices?.length ?? positions.length / 3
  const samples = new Float32Array(positions.length + 4 * corners)
  samples.set(positions)
  let count = positions.length / 3
  const triangles = new Uint32Array(corners * 6)
  const midpoints = new Map<string, number>()
  const append = (a: number, b: number, c?: number) => {
    const index = count++
    for (let axis = 0; axis < 3; axis++) {
      const sum = positions[a * 3 + axis] + positions[b * 3 + axis]
      samples[index * 3 + axis] = c === undefined ? sum / 2 : (sum + positions[c * 3 + axis]) / 3
    }
    return index
  }
  const midpoint = (a: number, b: number) => {
    const key = edgeKey(a, b)
    let index = midpoints.get(key)
    if (index === undefined) { index = append(a, b); midpoints.set(key, index) }
    return index
  }
  for (let corner = 0; corner < corners; corner += 3) {
    const a = indices?.[corner] ?? corner
    const b = indices?.[corner + 1] ?? corner + 1
    const c = indices?.[corner + 2] ?? corner + 2
    const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a), centre = append(a, b, c)
    triangles.set([a, ab, centre, ab, b, centre, b, bc, centre, bc, c, centre, c, ca, centre, ca, a, centre], corner * 6)
  }
  return { positions: samples.subarray(0, count * 3), triangles }
}

type DeviationData = { positions: Float32Array; normals?: Float32Array; triangles: Uint32Array; values: Float32Array; statisticsValues?: Float32Array;
  grid?: { coordinates: Float32Array; values: Float32Array; size: number; faces: number } }

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
  private deviationCache: {
    source: THREE.BufferGeometry
    refinementTolerance?: number
    result: Promise<DeviationData>
    value?: DeviationData
  } | null = null
  private liveDeviationCache: { surface: object; reference?: object; measure: NonNullable<FreeformEditorOptions['measureLiveDeviation']>; value: DeviationData } | null = null
  private paintedDeviation: { data: DeviationData; tolerance: number; geometry: THREE.BufferGeometry } | null = null
  // Hover changes the control overlay, not the analysis shader. Retain its
  // material/program just as we retain the measured vertex buffers.
  private deviationMaterial: THREE.MeshBasicMaterial | null = null
  private deviationColouring: string | null = null
  private deviationTexture: THREE.DataTexture | null = null
  private deviationTextureUniform: {value:THREE.DataTexture|null} = {value:null}
  private deviationTextureData: {grid:NonNullable<DeviationData['grid']>;tolerance:number}|null = null
  private deviationTextureSize = { value: new THREE.Vector2() }
  private pendingDeviation: Promise<DeviationData> | null = null
  private nextDeviation: { run(): void; cancel(): void } | null = null

  private measurePreview(start: () => Promise<DeviationData>): Promise<DeviationData> {
    return new Promise((resolve, reject) => {
      const run = () => {
        this.pendingDeviation = start()
        void this.pendingDeviation.then(resolve, reject).finally(() => {
          this.pendingDeviation = null
          const next = this.nextDeviation
          this.nextDeviation = null
          next?.run()
        })
      }
      if (!this.pendingDeviation) run()
      else {
        this.nextDeviation?.cancel()
        this.nextDeviation = { run, cancel: () => reject(new Error('Deviation preview superseded.')) }
      }
    })
  }
  private preview: { cage: Cage; selection: FreeformPick[]; freePull?: boolean } | null = null
  private placementPoint: Vec3 | null = null
  private placementVertex: number | undefined
  private liveGrid = liveDeviationGrid()
  private warmTimer: ReturnType<typeof setTimeout> | undefined
  private warmRequest: {cage:Cage;reference?:object;measure:NonNullable<FreeformEditorOptions['measureLiveDeviation']>} | null = null
  private prepareFreePull(cage:Cage) {
    const {measureLiveDeviation:measure,measureDeviation:asyncMeasure,deviationReference:reference}=this.options
    if(!measure || !asyncMeasure || this.options.hiddenFaces?.length) return
    if(this.warmRequest?.cage===cage && this.warmRequest.reference===reference && this.warmRequest.measure===measure) return
    if(this.warmTimer!==undefined) clearTimeout(this.warmTimer)
    const request=this.warmRequest={cage,reference,measure}
    // Let the finished field paint first. Worker queries never block pointer motion.
    this.warmTimer=setTimeout(()=>{
      this.warmTimer=undefined
      if(this.disposed || this.cage!==cage || this.cancelDrag || this.options.deviationReference!==reference) {if(this.warmRequest===request)this.warmRequest=null;return}
      const key=previewTopologyKey(cage,2)
      let plan=this.evaluationPlans.get(key)
      if(!plan) {
        plan=previewEvaluation(cage,2)
        if(this.evaluationPlans.size>=2)this.evaluationPlans.delete(this.evaluationPlans.keys().next().value!)
        this.evaluationPlans.set(key,plan)
      }
      void this.liveGrid.warm(plan.evaluate(cage.positions).points,plan.faces,measure,reference,asyncMeasure).catch(()=>{
        if(this.warmRequest===request)this.warmRequest=null
      })
    },0)
  }
  private rectangleStart: { x: number; y: number } | null = null
  private rectanglePreview: Vec3[] | null = null
  private hovered: FreeformPick | null = null
  private group = new THREE.Group()
  private faces: THREE.Mesh[] = []
  private cadSurface: THREE.Mesh | null = null
  /** Raw cage occlusion only; face selection uses the displayed surface. */
  private controlOccluders: THREE.Mesh[] = []
  private cancelDrag: (() => void) | null = null
  private duplicate: HTMLDivElement | null = null
  private dragHint: HTMLDivElement | null = null
  private brushRing: HTMLDivElement | null = null
  private lastEdgeClick: { index: number; x: number; y: number; time: number } | null = null
  private manipulator: FreeformManipulator
  private disposed = false
  private drawError = ''
  private evaluationPlans = new Map<string, ReturnType<typeof previewEvaluation>>()
  private surfaceCache: { cage: Cage; snap: FreeformEditorOptions['snapPoint']; ray: FreeformEditorOptions['rayPoint']; refit: FreeformEditorOptions['refitPoint']; faces: number[][]; owners: number[]; points: Vec3[]; paths: number[][] } | null = null
  private finishedGuides: { geometry: THREE.BufferGeometry; surface: NonNullable<FreeformEditorLayer['surfaceCache']>; tree: MeshBVH; paths: Map<number, Vec3[]> } | null = null
  constructor(private host: SceneLayerHost) {
    this.manipulator = new FreeformManipulator(host)
    host.partGroup.add(this.group)
    if (typeof document !== 'undefined' && host.container) {
      this.duplicate = document.createElement('div')
      this.duplicate.textContent = 'D'
      this.duplicate.dataset.test = 'freeform-duplicate-handle'
      Object.assign(this.duplicate.style, { position: 'absolute', width: '20px', height: '20px', borderRadius: '50%', background: '#fff', color: '#111', border: '1px solid #333', textAlign: 'center', lineHeight: '18px', font: '12px/18px sans-serif', pointerEvents: 'none', display: 'none', zIndex: '5' })
      host.container.append(this.duplicate)
      this.dragHint = document.createElement('div')
      this.dragHint.dataset.test = 'freeform-drag-hint'
      this.dragHint.setAttribute('role', 'status')
      Object.assign(this.dragHint.style, { position: 'absolute', left: '50%', top: '12px', transform: 'translateX(-50%)',
        background: '#202930', color: '#ffe7a2', padding: '6px 10px', border: '1px solid #99753d',
        borderRadius: '4px', pointerEvents: 'none', display: 'none', zIndex: '5' })
      host.container.append(this.dragHint)
      this.brushRing = document.createElement('div')
      this.brushRing.dataset.test = 'freeform-brush-circle'
      Object.assign(this.brushRing.style, { position: 'fixed', pointerEvents: 'none', borderRadius: '50%', border: '1px solid #62c9ff', boxShadow: '0 0 1px #15191e', zIndex: '9999', display: 'none' })
      host.container.append(this.brushRing)
    }
    host.canvas.addEventListener('contextmenu', this.contextMenu)
    host.canvas.addEventListener('dblclick', this.doubleClick)
  }
  set(cage: Cage | null, options: FreeformEditorOptions = {}): void {
    if (options.deviationReference !== this.options.deviationReference) {
      this.deviationCache = null; this.liveDeviationCache = null; this.liveGrid.clear(); this.warmRequest=null
    }
    // React can feed selection callbacks back while a gesture is held.
    // Preserve that gesture when the source cage identity has not changed.
    if (this.cancelDrag && cage === this.cage && options.enabled !== false) { this.options = options; return }
    this.cancelDrag?.()
    if (cage !== this.cage || options.mode !== this.options.mode) this.lastEdgeClick = null
    if (!options.creating || this.options.creationTool !== options.creationTool) this.cancelPlacement()
    this.cage = cage; this.options = options; this.selection = options.selection?.slice() ?? []; this.hovered = null
    if (options.finishedSurface !== this.finishedGuides?.geometry) this.finishedGuides = null
    if (!options.brush || options.enabled === false) this.showBrush()
    this.draw(cage)
  }
  private contextMenu = (event: MouseEvent) => {
    if (this.options.enabled === false || (!this.cage && !this.options.creating)) return
    event.preventDefault(); event.stopPropagation()
    if (this.cancelDrag) { this.cancelDrag(); return }
    if (this.options.creating && this.options.creationTool) {
      this.cancelPlacement()
      this.draw(this.cage)
      this.options.onCancelCreation?.()
      return
    }
    const hit = this.pick(event.clientX, event.clientY)
    // Native Freeform adds a newly right-clicked edge to edges already selected.
    // A different entity type starts a new context selection.
    const picks = hit ? this.expandPick(hit) : []
    if (hit && picks.some(p => !this.selection.some(q => same(p, q)))) {
      const sameKind = this.selection.every(pick => pick.kind === hit.kind)
      this.select(sameKind ? [...this.selection, ...picks.filter(p => !this.selection.some(q => same(p, q)))] : picks)
    }
    this.options.onContext?.(event.clientX, event.clientY, hit)
  }
  private doubleClick = (event: MouseEvent) => {
    if (this.options.enabled === false || this.options.creating || this.options.brush || !this.cage) return
    const hit = this.pick(event.clientX, event.clientY)
    if (hit?.kind !== 'edge') return
    event.preventDefault(); event.stopPropagation(); this.cancelDrag?.()
    const line = this.options.mode === 'boundary' ? this.expandPick(hit)
      : edgeLine(this.cage, hit.index, this.options.hiddenFaces).map(index => ({ kind: 'edge' as const, index }))
    this.select(event.ctrlKey || event.metaKey ? [...line, ...this.selection.filter(p => !line.some(q => same(p, q)))] : line)
  }
  private select(picks: FreeformPick[]) {
    this.selection = picks
    this.draw(this.cage)
    this.options.onSelection?.(picks.slice())
  }
  private expandPick(hit: FreeformPick): FreeformPick[] {
    if (!this.cage || this.options.mode !== 'boundary' || hit.kind !== 'edge') return [hit]
    const top = this.cageTopology(this.cage), visible = this.visible(this.cage), found = new Set<number>(), pending = [hit.index]
    while (pending.length) {
      const index = pending.pop()!
      if (found.has(index) || !visible.edges[index] || top.edges[index].faces.length !== 1) continue
      found.add(index)
      for (const v of [top.edges[index].a, top.edges[index].b]) {
        const adjacent = top.vertexEdges[v].filter(e => visible.edges[e] && top.edges[e].faces.length === 1)
        // A branching irregular boundary has no unambiguous loop to select.
        if (adjacent.length > 2) return [hit]
        pending.push(...adjacent.filter(e => !found.has(e)))
      }
    }
    return [...found].sort((a, b) => a - b).map(index => ({ kind: 'edge', index }))
  }
  private drawingMaterials = new Map<string, { revision: string; material: THREE.Material }>()
  private drawingMaterial<T extends THREE.Material>(slot: string, revision: string, create: () => T): T {
    const previous = this.drawingMaterials.get(slot)
    if (previous?.revision === revision) return previous.material as T
    previous?.material.dispose()
    const material = create()
    this.drawingMaterials.set(slot, { revision, material })
    return material
  }
  private clearDrawing() {
    const retained = new Set([...this.drawingMaterials.values()].map(entry => entry.material))
    for (const object of [...this.group.children]) {
      const mesh = object as THREE.Mesh
      // The finished CAD geometry is owned by the body renderer.
      if (mesh !== this.cadSurface && mesh.geometry !== this.paintedDeviation?.geometry) mesh.geometry?.dispose()
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach(m => { if (m !== this.deviationMaterial && !retained.has(m)) m?.dispose() })
      this.group.remove(object)
    }
    this.faces = []
    this.cadSurface = null
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
      // Native Closest Point pulls stay in the drag plane until release, even with Snap ON.
      // Measure that lifted surface rather than projecting the preview to the scan.
      const snap = this.preview?.freePull || this.options.fitToScan === false ? undefined : this.options.snapPoint
      const ray = snap ? this.options.rayPoint : undefined
      const refit = snap && (this.preview || this.options.rebuilding) ? this.options.refitPoint : undefined
      if (this.surfaceCache?.cage === cage && this.surfaceCache.snap === snap && this.surfaceCache.ray === ray && this.surfaceCache.refit === refit) return this.surfaceCache
      const axis = refit ? refitDirection(cage) : null
      const reach = axis ? snapRayReach(cage) * .35 : 0
      const steps = axis ? 4 : 2, key = previewTopologyKey(cage, steps)
      let plan = this.evaluationPlans.get(key)
      if (!plan) {
        plan = previewEvaluation(cage, steps)
        if (this.evaluationPlans.size >= 2) this.evaluationPlans.delete(this.evaluationPlans.keys().next().value!)
        this.evaluationPlans.set(key, plan)
      }
      const { faces, owners, paths } = plan
      const { points: limit } = plan.evaluate(cage.positions)
      let displayPoints = limit
      if (snap) {
        try {
          const flat = ray ? Float64Array.from(limit.flat()) : null
          const normals = flat && vertexNormals(flat, faces)
          displayPoints = limit.map((p, i) => {
            const q = normals && ray
              ? ray(p, [normals[i*3], normals[i*3+1], normals[i*3+2]])
              : snap(p)
            const projected = axis && refit ? refit(p, axis, reach) : null
            if (projected && q && Math.hypot(projected[0] - p[0], projected[1] - p[1], projected[2] - p[2])
                <= 2 * Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) + .25) return projected
            return q?.every(Number.isFinite) ? q : p
          })
          this.drawError = ''
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (this.drawError !== message) { this.drawError = message; this.options.onError?.(new Error(message)) }
        }
      }
      this.surfaceCache = { cage, snap, ray, refit, faces, owners, points: displayPoints, paths }
      return this.surfaceCache
  }
  private drawPlacement(): void {
    const corners = this.rectanglePreview ?? this.options.creationCorners ?? []
    const hover = this.placementPoint
    const geometry = (points: readonly Vec3[]) => new THREE.BufferGeometry()
      .setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3))
    const marker = (name: string, points: readonly Vec3[], color: number, size: number, order: number) => {
      if (!points.length) return
      const item = new THREE.Points(geometry(points),
        new THREE.PointsMaterial({ color, size, sizeAttenuation: false, depthTest: false, depthWrite: false }))
      item.name = name
      item.renderOrder = order
      this.group.add(item)
    }
    const path = hover && corners.length ? [...corners, hover] : [...corners]
    if ((hover && corners.length === 3) || this.rectanglePreview) path.push(corners[0])
    if (path.length > 1) {
      const line = new THREE.Line(geometry(path),
        new THREE.LineBasicMaterial({ color: 0x202a32, depthTest: false, depthWrite: false }))
      line.name = 'freeform-placement-boundary'
      line.renderOrder = 10
      this.group.add(line)
    }
    marker('freeform-placement-outline', hover ? [...corners, hover] : corners, 0x19232a, 12, 11)
    marker('freeform-placed-corners', corners, 0xffeb00, 8, 12)
    if (hover) marker('freeform-placement-hover', [hover], HOVER, 8, 13)
  }
  private draw(cage: Cage | null) {
    if (this.disposed) return
    this.clearDrawing()
    if (this.options.creating) {
      this.drawPlacement()
      const corners = this.rectanglePreview ?? (this.options.creationCorners?.length === 3 && this.placementPoint
        ? [...this.options.creationCorners, this.placementPoint] : null)
      if (corners) {
        const vertices = this.rectanglePreview ? [] : [...(this.options.creationVertices ?? []), this.placementVertex]
        try { cage = addFace(cage ?? {positions:new Float64Array(),faces:[],creases:[]}, corners.map((p,i) => vertices[i] ?? p)) }
        catch { /* An incomplete/invalid candidate retains the placement markers. */ }
      }
    }
    if (!cage && this.options.display === 'deviation') this.options.onDeviation?.(null)
    if (cage) {
      const visible = this.visible(cage)
      const smooth = this.surface(cage)
      const surfacePositions: number[] = [], surfaceColors: number[] = [], surfaceVertices: number[] = [], faceOwners: number[] = []
      smooth.faces.forEach((face, i) => {
        const owner = smooth.owners[i]
        if (!visible.face[owner]) return
        const color = new THREE.Color(this.color({ kind: 'face', index: owner }, SURFACE))
        for (let k = 1; k + 1 < face.length; k++) {
          faceOwners.push(owner)
          for (const v of [face[0], face[k], face[k + 1]]) {
            surfaceVertices.push(v); surfacePositions.push(...smooth.points[v]); surfaceColors.push(color.r, color.g, color.b)
          }
        }
      })
      const surfaceGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(surfacePositions, 3)).setAttribute('color', new THREE.Float32BufferAttribute(surfaceColors, 3))
      surfaceGeometry.computeVertexNormals()
      const display = this.options.display
      const opacity = this.options.opacity ?? 1
      const parameters = { vertexColors: true, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity === 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }
      const material = this.drawingMaterial('surface', `${display}:${opacity}`, () => new THREE.MeshPhongMaterial({ ...parameters, shininess: 22, specular: 0x222222 }))
      material.colorWrite = true; material.depthWrite = opacity === 1
      // Native visible faces wind clockwise. Keep face selection/hover colors
      // above the reverse-side finish on the interactive cage.
      const reverseFinish = `
        bool plainSurface = true;
        #ifdef USE_COLOR
          plainSurface = distance(vColor, vec3(${new THREE.Color(SURFACE).toArray().join(', ')})) < 0.001;
        #endif
        if (gl_FrontFacing && plainSurface) {
          float backLight = max(0.0, 0.5292 + dot(normalize(normal), vec3(-0.1469, 0.2070, 0.5218))) / 1.051;
          gl_FragColor.rgb = clamp(vec3(242.0, 106.0, 48.0) / 255.0 * backLight, 0.0, 1.0);
        }
      `
      if (display === 'zebra') {
        // Project striped reflections from a finite virtual eye. Scale the
        // setup with the part so zoom and pan leave the band locations alone.
        // The projection was calibrated against two reference cylinder views
        // and checked from a third camera orientation.
        material.onBeforeCompile = shader => {
          shader.uniforms.zebraCentre = { value: new THREE.Vector3(...this.host.modelCenter()) }
          shader.uniforms.zebraRadius = { value: Math.max(this.host.modelRadius(), 1e-6) }
          shader.vertexShader = 'uniform vec3 zebraCentre; uniform float zebraRadius; varying vec3 zebraPoint;\n' +
            shader.vertexShader.replace('#include <project_vertex>', `
              #include <project_vertex>
              zebraPoint = (modelViewMatrix * vec4(transformed - zebraCentre, 0.0)).xyz / zebraRadius;
            `)
          shader.fragmentShader = 'varying vec3 zebraPoint;\n' + shader.fragmentShader.replace('#include <dithering_fragment>', `
            vec3 up = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
            vec3 eye = vec3(-0.0013, -0.1894, 1.7978) + up * 0.1495;
            vec3 reflected = reflect(normalize(zebraPoint - eye), normalize(normal));
            float stripe = dot(reflected, vec3(-0.0015, 1.0, 0.0) + up * 0.5) / sqrt(2.4775 + reflected.z);
            float wave = sin(6.28318531 * (23.3157 * stripe + 0.3102));
            float transition = clamp(fwidth(wave), 0.025, 0.8);
            float band = 1.0 - smoothstep(-transition, transition, wave);
            gl_FragColor.rgb = mix(vec3(0.83), vec3(0.31, 0.54, 0.69), band);
            ${reverseFinish}
            #include <dithering_fragment>
          `)
        }
        material.customProgramCacheKey = () => 'freeform-zebra-studio'
      } else if (display === 'shaded') {
        material.onBeforeCompile = shader => {
          // A soft camera fill keeps side-on patches readable. The left
          // side has a slightly stronger fill in the reference studio.
          shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
            float fill = 0.978 + 0.325 * abs(normal.x) - 0.198 * normal.x;
            gl_FragColor.rgb *= fill;
            // The opaque studio finish is more neutral than the translucent overlay.
            float opaqueFinish = clamp((opacity - 0.72) / 0.28, 0.0, 1.0) * 0.38;
            gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.67, 0.71, 0.692), opaqueFinish);
            ${reverseFinish}
            #include <dithering_fragment>
          `)
        }
        material.customProgramCacheKey = () => 'freeform-shaded-studio'
      }
      if (display === 'zebra' || (display === 'shaded' && cage.creases.length === 0)) {
        const normals = surfaceGeometry.getAttribute('normal')
        const sums = smooth.points.map(() => new THREE.Vector3())
        surfaceVertices.forEach((vertex, i) => { sums[vertex].add(new THREE.Vector3().fromBufferAttribute(normals, i)) })
        surfaceVertices.forEach((vertex, i) => { const n = sums[vertex].normalize(); normals.setXYZ(i, n.x, n.y, n.z) })
      }
      const surfaceMesh = new THREE.Mesh(surfaceGeometry, material)
      surfaceMesh.renderOrder = 2
      surfaceMesh.userData.faceOwners = faceOwners
      this.group.add(surfaceMesh); this.faces.push(surfaceMesh)
      // The manual control surface is the editing authority in every display.
      // Finished CAD is a derived export representation, never a replacement
      // surface arriving halfway through an edit. Legacy fitted projects keep
      // their saved representation until explicitly changed by the user.
      const finished = this.options.fitToScan !== false && cage === this.cage && !this.preview && !this.options.hiddenFaces?.length
        ? this.options.finishedSurface : undefined
      const selection = this.preview?.selection ?? this.selection
      const faceHighlight = this.hovered?.kind === 'face' || selection.some(p => p.kind === 'face')
      if ((display === 'zebra' || (display === 'shaded' && !faceHighlight)) && finished?.hasAttribute('normal')) {
        const sheet = new THREE.Mesh(finished, this.drawingMaterial('finished', material.uuid, () => material.clone()))
        sheet.name = 'freeform-finished-cad'
        sheet.material.vertexColors = false
        sheet.material.color.setHex(SURFACE)
        sheet.material.onBeforeCompile = material.onBeforeCompile
        sheet.material.customProgramCacheKey = material.customProgramCacheKey
        sheet.renderOrder = surfaceMesh.renderOrder
        this.group.add(sheet)
        this.cadSurface = sheet
        material.colorWrite = material.depthWrite = false
      }
      if (display === 'deviation' && this.options.measureDeviation && surfacePositions.length) {
        const { readDeviationMesh, measureDeviation, measureLiveDeviation, refineDeviation: refineAsync, onDeviation, onDeviationError, tolerance = .01 } = this.options
        const source = finished ?? surfaceGeometry
        let analysisGeometry = new THREE.BufferGeometry()
        // The native analysis colors stay opaque when surface transparency changes.
        const analysisMaterial = this.deviationMaterial ??= new THREE.MeshBasicMaterial({
          ...parameters, vertexColors: false, toneMapped: false, opacity: 1, transparent: false, depthWrite: true,
        })
        const analysisMesh = new THREE.Mesh(analysisGeometry, analysisMaterial)
        analysisMesh.name = 'freeform-deviation-surface'
        analysisMesh.renderOrder = 2
        analysisMesh.visible = false
        this.group.add(analysisMesh)
        const paint = (data: DeviationData, preview = !finished) => {
          if (!this.faces.includes(surfaceMesh)) return
          const { positions, triangles, values } = data
          // Missing correspondence is unknown, never a passing subset or an
          // invented large signed value interpolated through neighbouring samples.
          if (!values.length || !values.every(Number.isFinite) || values.length !== positions.length / 3) {
            onDeviationError?.()
            return
          }
          // Edit Surface labels signed scan deviation relative to the CAD.
          // The measurement service returns signed CAD deviation from the scan.
          const previous = this.paintedDeviation
          if (previous?.data === data && previous.tolerance === tolerance) {
            if (analysisGeometry !== previous.geometry) analysisGeometry.dispose()
            analysisGeometry = previous.geometry
          } else {
            const samples = Float32Array.from(values, value => -value / tolerance)
            if (!samples.every(Number.isFinite)) { onDeviationError?.(); return }
            // Preview and finished CAD can have very different sample counts.
            // Reusing the preview normal attribute truncates the finished
            // normals, producing a black surface. New data owns a complete
            // geometry; hover retains those buffers and normals unchanged.
            const sameLayout = previous?.geometry.getAttribute('position')?.count === positions.length / 3 &&
              previous.geometry.getIndex()?.count === triangles.length && !!previous.data.grid === !!data.grid
            const geometry = sameLayout ? previous!.geometry : new THREE.BufferGeometry()
            updateSurfaceAttribute(geometry, 'position', positions, 3)
            updateSurfaceAttribute(geometry, 'index', triangles, 1)
            if (data.normals) updateSurfaceAttribute(geometry, 'normal', data.normals, 3)
            else geometry.computeVertexNormals()
            updateSurfaceAttribute(geometry, 'signedDeviation', samples, 1)
            if (data.grid) updateSurfaceAttribute(geometry, 'analysisCoordinates', data.grid.coordinates, 3)
            geometry.boundingBox = geometry.boundingSphere = null
            if (analysisGeometry !== previous?.geometry) analysisGeometry.dispose()
            if (!sameLayout) previous?.geometry.dispose()
            analysisGeometry = geometry
            this.paintedDeviation = {data, tolerance, geometry}
          }
          analysisMesh.geometry = analysisGeometry
          const passFail = this.options.colouring === 'pass-fail'
          const grid = data.grid
          if (grid && (this.deviationTextureData?.grid !== grid || this.deviationTextureData.tolerance !== tolerance)) {
            const {width,height,columns,data:texels} = deviationAtlasValues(grid.values,grid.size,grid.faces,tolerance)
            // WebGL texture storage is immutable: topology can change the
            // face count, so allocate a new texture when its dimensions change.
            if (this.deviationTexture?.image.width !== width || this.deviationTexture.image.height !== height) {
              this.deviationTexture?.dispose()
              this.deviationTexture = new THREE.DataTexture(undefined,width,height,THREE.RedFormat,THREE.FloatType)
              this.deviationTextureUniform.value = this.deviationTexture
            }
            const texture = this.deviationTexture
            texture.image = { data: texels, width, height }
            texture.needsUpdate = true
            this.deviationTextureSize.value.set(grid.size,columns)
            this.deviationTextureData = {grid,tolerance}
          }
          const colouring = (passFail ? 'pass-fail' : 'gradient') + (grid ? '-grid' : '')
          if (this.deviationColouring !== colouring) {
            this.deviationColouring = colouring
            analysisMaterial.onBeforeCompile = shader => {
              shader.vertexShader = 'attribute float signedDeviation; varying float vSignedDeviation; varying vec3 vAnalysisNormal;\n' + shader.vertexShader.replace(
                '#include <begin_vertex>', '#include <begin_vertex>\nvSignedDeviation = signedDeviation; vAnalysisNormal = normalMatrix * normal;')
              if (grid) {
                shader.uniforms.analysisGrid = this.deviationTextureUniform
                shader.uniforms.analysisGridSize = this.deviationTextureSize
                shader.vertexShader = 'attribute vec3 analysisCoordinates; varying vec3 vAnalysisCoordinates;\n' + shader.vertexShader.replace(
                  '#include <begin_vertex>', '#include <begin_vertex>\nvAnalysisCoordinates = analysisCoordinates;')
              }
              const rampFunction = `vec3 analysisRamp(float deviation) {
                  float ratio = abs(deviation);
                  float t = (ratio - 1.0) / 4.0;
                  vec3 outside = ${passFail ? 'vec3(0.51, 0.0, 0.0)' : `
                    ratio > 5.0 ? vec3(0.25) : deviation > 0.0
                      ? vec3(1.0, 1.0 - t, 0.0)
                      : vec3(0.0, 1.0 - t, 1.0)
                  `};
                  return ratio <= 1.0 ? vec3(0.0, 1.0, 0.0) : outside;
                }`
              const gridFunction = grid ? `
                uniform sampler2D analysisGrid; uniform vec2 analysisGridSize; varying vec3 vAnalysisCoordinates;
                vec3 gridRamp(vec2 p) {
                  int face=int(floor(vAnalysisCoordinates.z+0.5)), columns=int(analysisGridSize.y), size=int(analysisGridSize.x);
                  ivec2 origin=ivec2(face % columns,face / columns)*size;
                  return analysisRamp(texelFetch(analysisGrid,ivec2(p)+origin,0).r);
                }
                vec3 interpolatedRamp() {
                  vec2 q=clamp(vAnalysisCoordinates.xy,0.0,1.0)*(analysisGridSize.x-1.0);
                  vec2 a=min(floor(q),vec2(analysisGridSize.x-2.0)), f=q-a;
                  return mix(mix(gridRamp(a),gridRamp(a+vec2(1,0)),f.x),mix(gridRamp(a+vec2(0,1)),gridRamp(a+vec2(1,1)),f.x),f.y);
                }` : ''
              // Native fades interpolate measured sample colors. Applying the
              // discontinuous pass band after interpolating distance produced
              // hard contours whenever editing switched to the live preview.
              if (!grid) {
                shader.vertexShader = 'varying vec3 vAnalysisColor;\n' + rampFunction + '\n' + shader.vertexShader.replace(
                  '#include <begin_vertex>', '#include <begin_vertex>\nvAnalysisColor = analysisRamp(signedDeviation);')
                shader.fragmentShader = 'varying vec3 vAnalysisColor;\n' + shader.fragmentShader
              }
              shader.fragmentShader = 'varying float vSignedDeviation; varying vec3 vAnalysisNormal;\n' + rampFunction + gridFunction + shader.fragmentShader.replace(
                '#include <color_fragment>', `
                  vec3 ramp = ${grid ? 'interpolatedRamp()' : 'vAnalysisColor'};
                  // Camera-space fill calibrated on independent plane and cylinder
                  // captures. It affects appearance only, never signed samples or
                  // the tolerance threshold. The reverse side is neutral gray;
                  // it must not suggest a passing or failing analysis color.
                  vec3 analysisNormal = normalize(vAnalysisNormal) * (gl_FrontFacing ? 1.0 : -1.0);
                  float illumination = max(0.0, 0.5292 + dot(analysisNormal, vec3(-0.1469, 0.2070, 0.5218)));
                  float highlight = 0.05 * pow(max(0.0, analysisNormal.z), 32.0);
                  vec3 litRamp = clamp(ramp * illumination + vec3(highlight), 0.0, 1.0);
                  if (gl_FrontFacing) litRamp = vec3(clamp(0.4 * illumination / 1.051, 0.0, 1.0));
                  diffuseColor.rgb = sRGBTransferEOTF(vec4(litRamp, 1.0)).rgb;
                `)
            }
            analysisMaterial.customProgramCacheKey = () => 'freeform-tolerance-' + colouring
            analysisMaterial.needsUpdate = true
            }
            analysisMesh.visible = true
            material.colorWrite = material.depthWrite = false
            let min = Infinity, max = -Infinity
            let squared = 0, count = 0
            // Color refinement concentrates probes around tolerance transitions.
            // Keep the reported CAD-sample statistics on the original sampling
            // set, so changing a display threshold cannot bias the reported RMS.
            for (const value of data.statisticsValues ?? values) if (Number.isFinite(value)) {
              const signed = value === 0 ? 0 : -value
              min = Math.min(min, signed); max = Math.max(max, signed)
              squared += value * value; count++
            }
            onDeviation?.(count ? { min, max, rms: Math.sqrt(squared / count), preview } : null)
            this.host.invalidate()
            if (!preview) this.prepareFreePull(cage)
          }
          const fail = () => { if (this.faces.includes(surfaceMesh)) onDeviationError?.() }
          const paintLive = () => {
            if (!measureLiveDeviation) return false
            const cached = this.liveDeviationCache
            if (cached?.surface === smooth && cached.reference === this.options.deviationReference && cached.measure === measureLiveDeviation) {
              paint(cached.value, true); return true
            }
            // Regular color charts are available in this same pointer event,
            // before release or CAD conversion. Only changed evaluated cells
            // query the scan; stationary cells retain their measured field.
            try {
              const value = this.liveGrid(smooth.points, smooth.faces.filter((_,i) => visible.face[smooth.owners[i]]), measureLiveDeviation, this.options.deviationReference)
              this.liveDeviationCache = { surface:smooth, reference:this.options.deviationReference, measure:measureLiveDeviation, value }
              paint(value, true)
            } catch { fail() }
            return true
          }
          if (!finished && paintLive()) {
            // Current evaluated geometry is measured synchronously during editing.
          } else {
            if (!finished) onDeviation?.(null)
            let measured = this.deviationCache
            const refinementTolerance = finished && measureLiveDeviation ? tolerance : undefined
            if (!measured || measured.source !== source || (!measured.value?.grid && measured.refinementTolerance !== refinementTolerance)) {
              const read = async (): Promise<DeviationData> => {
                const mesh = finished && readDeviationMesh ? await readDeviationMesh() : {
                  positions: source.getAttribute('position').array as Float32Array,
                  indices: source.getIndex()?.array,
                }
                const data = deviationSamples(mesh.positions, mesh.indices)
                const measured = { ...data, values: await measureDeviation(data.positions) }
                if ('analysisGrid' in mesh && mesh.analysisGrid) {
                  const grid = mesh.analysisGrid
                  const values = await measureDeviation(grid.positions)
                  if (values.length !== grid.positions.length / 3 || !values.every(Number.isFinite)) throw new Error('Incomplete deviation grid.')
                  return { positions:mesh.positions, triangles:mesh.indices!, values:measured.values.slice(0,mesh.positions.length/3),
                    statisticsValues:measured.values, grid:{coordinates:grid.coordinates,values,size:grid.size,faces:grid.faces} }
                }
                if (finished && refineAsync) return {
                  ...await refineAsync(measured, tolerance), statisticsValues: measured.values,
                }
                return finished && measureLiveDeviation
                  ? { ...refineDeviation(measured, measureLiveDeviation, tolerance), statisticsValues: measured.values } : measured
              }
              const result = finished ? read() : this.measurePreview(read)
              measured = { source, result, refinementTolerance }
              if (finished) this.deviationCache = measured
              const entry = measured
              void result.then(value => { entry.value = value }, () => {})
              void result.catch(() => {
                if (this.deviationCache?.result === result) this.deviationCache = null
              })
            }
            if (measured.value) paint(measured.value)
            else {
              // A new CAD body can arrive after a rebuild. Until its exact samples
              // return, show the measured current preview, never a shaded flash or
              // old-cage colors. Hover reuses resolved measurements synchronously.
              paintLive()
              void measured.result.then(value => paint(value)).catch(fail)
            }
          }
        } else if (display === 'deviation') this.options.onDeviation?.(null)
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
        const controlMesh = new THREE.Mesh(controlGeometry, this.drawingMaterial('occlusion', '', () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false })))
        controlMesh.userData.faceOwners = controlOwners
        this.group.add(controlMesh); this.controlOccluders.push(controlMesh)
        const lines: number[] = [], colors: number[] = [], selectedLines: number[] = [], hoverLines: number[] = []
        const dragging = this.preview !== null || !!this.options.rebuilding && !!this.options.refitPoint
        const showCage = dragging || this.options.showEdges !== false || this.options.controlNet !== false
        const selectedFaces = new Set(selection.filter(p => p.kind === 'face').map(p => p.index))
        visible.top.edges.forEach((e, index) => {
          if (!visible.edges[index]) return
          const edge = { kind: 'edge', index } as const
          const selected = selection.some(p => same(p, edge)) || e.faces.some(face => selectedFaces.has(face))
          const hovered = same(this.hovered, edge) ||
            (this.hovered?.kind === 'face' && e.faces.includes(this.hovered.index))
          if (!showCage && !selected && !hovered) return
          const base = e.crease ? 0xc73737
            : e.faces.length === 1 && this.options.controlNet === false && display !== 'shaded' ? 0xffffff : EDGE
          const color = new THREE.Color(selected ? YELLOW : hovered ? HOVER : base)
          const points = this.edgePath(cage, index)
          for (let i=1;i<points.length;i++) for (const point of [points[i-1],points[i]]) {
            lines.push(...point); colors.push(color.r,color.g,color.b)
            if (selected) selectedLines.push(...point)
            else if (hovered) hoverLines.push(...point)
          }
        })
        const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lines, 3)).setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
        const lineMaterial = this.drawingMaterial('outlines', String(this.options.controlNet === false), () => new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }))
        if (this.options.controlNet === false) {
          // Give the sampled outline a small depth allowance in every mode.
          // Keep depth testing against the scan and neighboring surfaces.
          lineMaterial.onBeforeCompile = shader => {
            shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
              #include <project_vertex>
              gl_Position.z -= gl_Position.w * 0.0001;
            `)
          }
        }
        const outlines = new THREE.LineSegments(geometry, lineMaterial)
        outlines.name = 'freeform-cage-outlines'
        outlines.renderOrder = 3
        this.group.add(outlines)
        // Screen-space selection remains legible against green/yellow analysis
        // colors. The dark halo separates adjacent selected and unselected edges;
        // depth testing still hides geometry behind other surfaces.
        for (const [name, segments, color] of [['selected', selectedLines, YELLOW], ['hover', hoverLines, HOVER]] as const) {
          if (!segments.length) continue
          for (const halo of [true, false]) {
            const geometry = new LineSegmentsGeometry().setPositions(segments)
            const material = this.drawingMaterial(`${name}-${halo}`, '', () => new LineMaterial({color:halo ? 0x171b20 : color, linewidth:halo ? 5 : 3, depthTest:true, depthWrite:false, toneMapped:false}))
            const rect = this.host.canvas.getBoundingClientRect()
            material.resolution.set(rect.width, rect.height)
            material.onBeforeCompile = shader => {
              shader.vertexShader = shader.vertexShader.replace('#include <logdepthbuf_vertex>', `
                gl_Position.z -= gl_Position.w * 0.0001;
                #include <logdepthbuf_vertex>
              `)
            }
            material.customProgramCacheKey = () => 'freeform-highlight-depth'
            const line = new LineSegments2(geometry, material)
            line.name = `freeform-${name}-${halo ? 'halo' : 'highlight'}`
            line.renderOrder = halo ? 4 : 5
            this.group.add(line)
          }
        }
        const points: number[] = [], pointColors: number[] = []
        const mode = this.options.mode ?? 'points-edges'
        const showPoints = mode === 'points-edges' || mode === 'points' || mode === 'all'
        visible.vertices.forEach((on, index) => {
          const vertex = { kind: 'vertex', index } as const
          const highlighted = same(this.hovered, vertex) || selection.some(p => same(p, vertex))
          if (!on || (!highlighted && !showPoints)) return
          const color = new THREE.Color(this.color(vertex, EDGE))
          points.push(...this.displayPoint(cage, index)); pointColors.push(color.r, color.g, color.b)
        })
        const pg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)).setAttribute('color', new THREE.Float32BufferAttribute(pointColors, 3))
        this.group.add(new THREE.Points(pg, this.drawingMaterial('points', '', () => new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, vertexColors: true }))))
      }
      this.tick(); this.host.invalidate()
    }
    cancelPlacement(): void {
      this.placementPoint = null
      this.rectangleStart = null
      this.rectanglePreview = null
    }
    private faceCorner(x: number, y: number): { point: Vec3; corner: Corner } | null {
      // The Add face tool can reuse a pole even when the editor is in an
      // edge-only or face-only selection mode.
      const vertex = this.cage && this.options.creationTool === 'face' ? this.pick(x, y, 'points') : null
      if (this.cage && vertex?.kind === 'vertex') return { point: this.displayPoint(this.cage, vertex.index), corner: vertex.index }
      const hit = this.host.pickScan(x, y)
      return hit ? { point: hit.point, corner: hit.point } : null
    }
    private rectangleAt(x: number, y: number): Vec3[] | null {
      const start = this.rectangleStart
      if (!start || Math.abs(x - start.x) < 2 || Math.abs(y - start.y) < 2) return null
      const points = [[start.x, start.y], [x, start.y], [x, y], [start.x, y]].map(([a, b]) => this.host.pickScan(a, b)?.point)
      return points.every((p): p is Vec3 => p !== undefined) ? points : null
    }
    private displayPoint(cage: Cage, index: number): Vec3 {
      if (this.options.controlNet !== false) return vertexAt(cage, index)
      const point = this.surface(cage).points[index]
      return this.finishedPoint(cage, new THREE.Vector3(...point))?.toArray() ?? point
    }
    private guideSurface(cage: Cage) {
      if (cage !== this.cage || this.preview || this.options.hiddenFaces?.length) return null
      const geometry = this.options.finishedSurface
      if (!geometry?.index?.count) return null
      const surface = this.surface(cage)
      if (this.finishedGuides?.geometry === geometry && this.finishedGuides.surface === surface) return this.finishedGuides
      // This library version implements indirect indexing but omits it from its
      // option declaration. Indirection preserves the body renderer's index.
      const options = { strategy: CENTER, indirect: true }
      return this.finishedGuides = { geometry, surface, tree: new MeshBVH(geometry, options), paths: new Map() }
    }
    private finishedPoint(cage: Cage, point: THREE.Vector3) {
      return this.guideSurface(cage)?.tree.closestPointToPoint(point, undefined, 0, this.host.modelRadius() * .02)?.point
    }
    private edgePath(cage: Cage, index: number): Vec3[] {
      if (this.options.controlNet !== false) {
        const { a, b } = this.cageTopology(cage).edges[index]
        return [vertexAt(cage, a), vertexAt(cage, b)]
      }
      const surface = this.surface(cage)
      const guides = this.guideSurface(cage)
      const path = surface.paths[index].map(v => surface.points[v])
      if (!guides) return path
      const cached = guides.paths.get(index)
      if (cached) return cached
      const vertices = path.map(point => new THREE.Vector3(...point))
      const samples: Vec3[] = []
      const point = new THREE.Vector3()
      for (let segment = 1; segment < vertices.length; segment++) {
        for (let step = 0; step < 4; step++) {
          point.lerpVectors(vertices[segment - 1], vertices[segment], step / 4)
          samples.push((this.finishedPoint(cage, point) ?? point).toArray())
        }
      }
      const end = vertices[vertices.length - 1]
      samples.push((this.finishedPoint(cage, end) ?? end).toArray())
      guides.paths.set(index, samples)
      return samples
    }
    private project(point: Vec3) {
      this.host.partGroup.updateWorldMatrix(true, false)
      const q = this.host.partGroup.localToWorld(new THREE.Vector3(...point)).project(this.host.camera())
      const r = this.host.canvas.getBoundingClientRect()
      return { x: r.left + (q.x + 1) * r.width / 2, y: r.top + (1 - q.y) * r.height / 2, z: q.z }
    }
    private pick(x: number, y: number, mode = this.options.mode ?? 'points-edges'): FreeformPick | null {
      const cage = this.cage
      if (!cage) return null
      const visible = this.visible(cage)
      this.host.setPickRay(x, y); this.group.updateWorldMatrix(true, true)
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
      let distance = Infinity, depth = Infinity, result: FreeformPick | null = null
      // A ray just outside the visible cage may miss both faces while still
      // landing inside the pick radius of two projected corners or edges.
      const nearer = (pixels: number, z: number, radius: number) => {
        if (pixels >= radius) return false
        if (pixels > distance - .5 && (pixels > distance + .5 || z >= depth)) return false
        distance = pixels
        depth = z
        return true
      }
      projected.forEach((p, index) => {
        if (mode === 'edges' || mode === 'boundary') return
        if (!visible.vertices[index] || p.z < -1 || p.z > 1 || !visibleAt(this.displayPoint(cage, index), 9, visible.top.vertexFaces[index])) return
        const d = Math.hypot(p.x - x, p.y - y)
        if (nearer(d, p.z, 9)) result = { kind: 'vertex', index }
      })
      if (result) return result
      distance = depth = Infinity
      visible.top.edges.forEach((edge, index) => {
        if (mode === 'points' || (mode === 'boundary' && edge.faces.length !== 1)) return
        if (!visible.edges[index]) return
        const points = this.edgePath(cage, index)
        for (let i=1;i<points.length;i++) {
          const pa=points[i-1],pb=points[i],a=this.project(pa),b=this.project(pb)
          if (a.z < -1 || a.z > 1 || b.z < -1 || b.z > 1) continue
          const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy
          const t=length?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/length)):0
          const d=Math.hypot(x-a.x-t*dx,y-a.y-t*dy)
          const point=pa.map((p,k)=>p+t*(pb[k]-p)) as Vec3
          if (d < 7 && visibleAt(point, 7, edge.faces) && nearer(d, a.z + t * (b.z - a.z), 7)) result = { kind: 'edge', index }
        }
      })
      // Native mixed-type priority remains under comparison. Keep precise
      // points/edges ahead of face interiors, avoiding accidental face drags.
      return result ?? (mode === 'all' ? pickFace() : null)
    }
    private duplicateAnchor() {
      if (this.options.creating || this.options.brush) return null
      const mode=this.options.mode ?? 'points-edges',cage=this.preview?.cage ?? this.cage,selection=this.preview?.selection ?? this.selection
      if (mode==='points'||mode==='faces'||!cage||!this.options.duplicateHandle||!selection.length||selection.some(p=>p.kind!=='edge')) return null
      const top=this.cageTopology(cage)
      if(selection.some(p=>{const e=top.edges[p.index];return !e||e.faces.length!==1||this.options.hiddenFaces?.includes(e.faces[0])})) return null
      for (const { index } of selection) {
        const edge = top.edges[index]
        let midpoint: Vec3
        if (this.options.controlNet === false) {
          const path = this.edgePath(cage, index)
          midpoint = path[Math.floor(path.length / 2)]
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
      const rect = this.host.canvas.getBoundingClientRect()
      for (const object of this.group.children) if (object instanceof LineSegments2) object.material.resolution.set(rect.width, rect.height)
      const cage = this.preview?.cage ?? this.cage, top = cage ? this.cageTopology(cage) : null
      const ids = cage && top ? [...new Set((this.preview?.selection ?? this.selection).flatMap(p => p.kind === 'vertex' ? [p.index] : p.kind === 'face' ? cage.faces[p.index] ?? [] : top.edges[p.index] ? [top.edges[p.index].a, top.edges[p.index].b] : []))] : []
      this.manipulator.update(cage, ids, this.options.manipulator ?? 'local', !this.options.creating && !this.options.brush && !!this.options.manipulator && this.options.enabled !== false, this.options.controlNet === false)
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
        const path=this.edgePath(cage,i)
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
        if(accept){
          const picks=Math.hypot(lastX-e.clientX,lastY-e.clientY)>=3?this.boxPicks(e.clientX,e.clientY,lastX,lastY):[]
          this.select(e.shiftKey && !e.ctrlKey && !e.metaKey
            ? original.filter(p=>!picks.some(q=>same(p,q)))
            : e.ctrlKey||e.metaKey
              ? [...original,...picks.filter(p=>!original.some(q=>same(p,q)))]
              : picks)
        }
      }
      const up=(ev:PointerEvent)=>{if(ev.pointerId===e.pointerId){move(ev);finish(true)}}
      const cancel=(ev:PointerEvent)=>{if(ev.pointerId===e.pointerId)finish(false)}
      const key=(ev:KeyboardEvent)=>{if(ev.key==='Escape'){ev.preventDefault();ev.stopImmediatePropagation();finish(false)}else if((ev.ctrlKey||ev.metaKey)&&['z','y'].includes(ev.key.toLowerCase()))finish(false)}
      this.cancelDrag=()=>finish(false);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',cancel);window.addEventListener('keydown',key,true);this.host.claimDrag(true)
      try{canvas.setPointerCapture(e.pointerId)}catch{/* forwarding fallback */}
      return true
    }
    private showBrush(at?: { x: number; y: number }) {
      const ring = this.brushRing, brush = this.options.brush
      if (!ring) return
      ring.style.display = at && brush?.kind === 'smooth' ? 'block' : 'none'
      if (at && brush?.kind === 'smooth') {
        const { radius } = brush
        Object.assign(ring.style, { left: `${at.x - radius}px`, top: `${at.y - radius}px`, width: `${2 * radius}px`, height: `${2 * radius}px` })
      }
    }
    private beginBrush(e: PointerEvent, cage: Cage, brush: NonNullable<FreeformEditorOptions['brush']>): boolean {
      const canvas = this.host.canvas
      const original = this.selection.slice()
      const painted = new Set<number>()
      const originalFaces = original.filter(item => item.kind === 'face')
      const vertices = brush.kind === 'smooth' ? this.visible(cage).vertices.flatMap((visible, index) => {
        if (!visible) return []
        const point = this.displayPoint(cage, index)
        return [{ index, point, screen: this.project(point) }]
      }) : []
      const sample = (x: number, y: number) => {
        if (brush.kind === 'faces') {
          const pick = this.pick(x, y, 'faces')
          if (pick) painted.add(pick.index)
          return
        }
        for (const { index, point, screen } of vertices) {
          if (!painted.has(index) && Math.hypot(x - screen.x, y - screen.y) <= brush.radius && this.unobscured(point)) painted.add(index)
        }
      }
      const highlightStroke = () => {
        if (brush.kind !== 'faces' || !painted.size) return
        this.select(e.shiftKey
          ? original.filter(item => item.kind !== 'face' || !painted.has(item.index))
          : [...originalFaces.filter(item => !painted.has(item.index)), ...[...painted].map(index => ({ kind: 'face' as const, index }))])
      }
      let x = e.clientX, y = e.clientY
      const move = (event: PointerEvent) => {
        if (event.pointerId !== e.pointerId) return
        const previous = painted.size
        const steps = Math.max(1, Math.ceil(Math.hypot(event.clientX - x, event.clientY - y) / 4))
        for (let i = 1; i <= steps; i++) sample(x + (event.clientX - x) * i / steps, y + (event.clientY - y) * i / steps)
        if (painted.size !== previous) highlightStroke()
        x = event.clientX; y = event.clientY
        this.showBrush({ x, y })
      }
      const finish = (accept: boolean) => {
        if (!this.cancelDrag) return
        this.cancelDrag = null
        canvas.removeEventListener('pointermove', move)
        canvas.removeEventListener('pointerup', up)
        canvas.removeEventListener('pointercancel', cancel)
        canvas.removeEventListener('lostpointercapture', cancel)
        try { canvas.releasePointerCapture(e.pointerId) } catch { /* already released */ }
        this.host.claimDrag(false)
        if (!accept && brush.kind === 'faces') this.select(original)
        if (accept && brush.kind === 'smooth' && painted.size) brush.onStroke([...painted])
      }
      const up = (event: PointerEvent) => { if (event.pointerId === e.pointerId) { move(event); finish(true) } }
      const cancel = (event: PointerEvent) => { if (event.pointerId === e.pointerId) finish(false) }
      this.cancelDrag = () => finish(false)
      canvas.addEventListener('pointermove', move)
      canvas.addEventListener('pointerup', up)
      canvas.addEventListener('pointercancel', cancel)
      canvas.addEventListener('lostpointercapture', cancel)
      this.host.claimDrag(true)
      try { canvas.setPointerCapture(e.pointerId) } catch { /* canvas-local gestures remain available */ }
      sample(x, y)
      highlightStroke()
      return true
    }
    cancelStroke(): boolean {
      if (!this.options.brush || !this.cancelDrag) return false
      this.cancelDrag()
      return true
    }
    private begin(e: PointerEvent): boolean {
      if (this.options.enabled === false || this.cancelDrag) return e.button === 0
      if (e.button !== 0 || !this.cage || this.options.creating || (e.altKey && e.shiftKey)) return false
      if (this.options.brush) return this.beginBrush(e, this.cage, this.options.brush)
      // Selection modifiers pick geometry even where the existing selection's
      // manipulator or D grip overlaps another point or edge.
      const selecting = e.shiftKey || ((e.ctrlKey || e.metaKey) && !e.altKey)
      const handle = selecting ? null : this.duplicateAnchor()
      let duplicate = handle && Math.hypot(e.clientX - handle.at.x, e.clientY - handle.at.y) <= 11 ? handle : null
      // QUICKSURFACE's D handle translates the copied edge with the pointer.
      // Its contextual Extrapolate tool instead continues the face tangents.
      let tangentExtension = false
      const grip = duplicate || selecting ? null : this.manipulator.hit(e.clientX, e.clientY)
      const hit = grip || duplicate ? this.selection[0] : this.pick(e.clientX, e.clientY)
      if (!hit) {
        if (this.options.mode === 'boundary') { if (!selecting) this.select([]); return true }
        return this.beginBox(e)
      }
      const picks = grip || duplicate ? [hit] : this.expandPick(hit)
      if (e.shiftKey) {
        this.select(this.selection.filter(p => !picks.some(q => same(p, q))))
        return true
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        this.select(picks.every(p => this.selection.some(q => same(p, q))) ? this.selection.filter(p => !picks.some(q => same(p, q))) : [...this.selection, ...picks.filter(p => !this.selection.some(q => same(p, q)))])
        return true
      }
      if (picks.some(p => !this.selection.some(q => same(p, q)))) this.select(picks)
      if (e.altKey && !grip && !duplicate && hit.kind === 'edge') {
        const top = this.cageTopology(this.cage)
        const picks = this.selection.filter(p => p.kind === 'edge')
        if (picks.length !== this.selection.length || picks.some(p => top.edges[p.index].faces.length !== 1)) return true
        duplicate = { edge: top.edges[hit.index], indices: picks.map(p => p.index), at: this.project(vertexAt(this.cage, top.edges[hit.index].a)) }
      }
      if (!grip && !duplicate && this.options.extrapolate && hit.kind === 'edge') {
        const top = this.cageTopology(this.cage)
        const picks = this.selection.filter(p => p.kind === 'edge')
        if (picks.length !== this.selection.length || picks.some(p => top.edges[p.index].faces.length !== 1)) return true
        duplicate = { edge: top.edges[hit.index], indices: picks.map(p => p.index), at: this.project(vertexAt(this.cage, top.edges[hit.index].a)) }
        tangentExtension = true
      }
      const original = this.cage, options = this.options, host = this.host, el = host.canvas
      const top = this.cageTopology(original)
      const vertices = [...new Set(this.selection.flatMap(p => p.kind === 'vertex' ? [p.index] : p.kind === 'face' ? original.faces[p.index] ?? [] : top.edges[p.index] ? [top.edges[p.index].a, top.edges[p.index].b] : []))]
      if (!vertices.length) return true
      const anchors = options.controlNet === false ? cageVertexLimits(original) : null
      // Closest Point snapping retains the observed five-correction surface
      // anchor gesture and contact rule. Ray Projection is not paired here.
      const evaluatedPoint = !!anchors && !grip && !duplicate && (!options.snapPoint || !options.rayPoint) &&
        ((options.neighbourRadius ?? 0) === 0 || !!options.snapPoint) && vertices.length === 1 && hit.kind === 'vertex'
      const anchorSolver = anchors && !duplicate ? surfaceAnchorDrag(original, vertices, options.neighbourRadius ?? 0) : null
      const centre = new THREE.Vector3()
      vertices.forEach(i => centre.add(new THREE.Vector3(...(anchors?.[i] ?? vertexAt(original, i)))))
      centre.divideScalar(vertices.length); host.partGroup.updateWorldMatrix(true, false); host.partGroup.localToWorld(centre)
      const dragNormal = grip?.kind === 'rotate' ? grip.axis.clone().applyQuaternion(host.partGroup.getWorldQuaternion(new THREE.Quaternion())) : host.camera().getWorldDirection(new THREE.Vector3())
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(dragNormal, centre)
      const point = (x: number, y: number) => { host.setPickRay(x, y); const world = host.raycaster.ray.intersectPlane(plane, new THREE.Vector3()); return world ? host.partGroup.worldToLocal(world) : null }
      const start = point(e.clientX, e.clientY)
      if (!start) return true
      const directPole = options.snapPoint && !grip && !duplicate && !anchorSolver &&
        vertices.length === 1 && hit.kind === 'vertex' ? vertexAt(original, vertices[0]) : null
      const deferSnap = !!options.snapPoint && !options.rayPoint
      const anchorHit = directPole ? host.pickScan(e.clientX, e.clientY)?.point : undefined
      const rayReach = anchorHit ? snapRayReach(original) : 0
      const axis = options.refitPoint ? refitDirection(original) : null
      const checkedOrientation = axis && preservesRefitOrientation(original, axis) ? axis : null
      let current = original, changed = false, done = false, blocked = false, merging = false, nextSelection = this.selection.slice()
      let activeContact: { from: number; to: number; otherTo?: number } | null = null
      // Direct point contact is paired in both display modes, including the
      // evaluated no-neighbour rule above. Constrained handles stay excluded.
      const chainEnds = !grip && !duplicate && hit.kind === 'edge' && this.selection.every(p => p.kind === 'edge')
        ? mergeChainEnds(original, this.selection.map(p => p.index)) : []
      const mergeSources = chainEnds.length ? chainEnds : !grip && !duplicate && (!anchors || evaluatedPoint) && vertices.length === 1 && hit.kind === 'vertex' &&
        top.vertexEdges[vertices[0]].some(i => top.edges[i].faces.length === 1) ? [vertices[0]] : []
      const visible = this.visible(original)
      const dragFeedback = (invalid: boolean) => {
        blocked = invalid
        if (this.dragHint) {
          this.dragHint.textContent = invalid ? (duplicate ? 'Pull outward to add a quad' : 'This move would fold a quad') : 'Merge'
          this.dragHint.style.display = invalid || merging ? 'block' : 'none'
        }
        host.setCursor(invalid ? 'not-allowed' : duplicate ? 'copy' : 'grabbing')
      }
      const update = (ev: PointerEvent, releasing = false) => {
        if (ev.pointerId !== e.pointerId) return
        merging = false
        const previousContact = activeContact
        activeContact = null
        let invalidContact = false
        nextSelection = this.selection.slice()
        const next = point(ev.clientX, ev.clientY)
        if (!next) return
        const cursorPoint = next.clone()
        const strength = Math.max(0, Math.min(1, options.strength ?? 1))
        const delta = next.sub(start).multiplyScalar(strength)
        if (grip?.kind === 'move') delta.copy(grip.axis).multiplyScalar(((ev.clientX-e.clientX)*grip.dx+(ev.clientY-e.clientY)*grip.dy)/grip.unit * (options.strength ?? 1))
        changed = delta.lengthSq() > 1e-16 && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) >= 2
        if (changed && directPole && anchorHit && (!deferSnap || releasing)) {
          const target = host.pickScan(e.clientX + (ev.clientX-e.clientX)*strength, e.clientY + (ev.clientY-e.clientY)*strength)?.point
          const projected = target ? new THREE.Vector3(...target).sub(new THREE.Vector3(...anchorHit)) : null
          // A lifted Closest Point gesture can end beyond the scan silhouette.
          // In that case retain its drag-plane position for closest projection,
          // rather than accepting the still-unsnapped held preview.
          if (projected && projected.distanceTo(delta) <= rayReach) delta.copy(projected)
          else if (!deferSnap) { changed = current !== original; return }
        }
        if (changed && duplicate) {
          const edge = new THREE.Vector3(...vertexAt(original, duplicate.edge.b)).sub(new THREE.Vector3(...vertexAt(original, duplicate.edge.a)))
          // Pulling along the source edge creates a zero-area quad, not a
          // surface extension. Keep the source preview and history intact.
          if (edge.clone().cross(delta).lengthSq() <= 1e-20 * Math.max(1, edge.lengthSq() * delta.lengthSq())) changed = false
        }
        if (changed && duplicate) {
          const extended = extrapolateEdges(original, duplicate.indices, delta.toArray(), tangentExtension)
          current = extended.cage; nextSelection = extended.edges.map(index => ({ kind: 'edge', index }))
        } else {
          const travel = anchorSolver ? anchorSolver(vertices.map(() => delta.toArray() as Vec3)) : vertices.map(() => delta.toArray() as Vec3)
          current = !changed ? original : evaluatedPoint ? moveSurfaceAnchor(original, vertices[0], delta.toArray() as Vec3, (options.neighbourRadius ?? 0) === 0)
            : movePoints(original, vertices.map((vertex, i) => ({ vertex, by: travel[i] })), options.neighbourRadius ?? 0)
        }
        if (changed && grip && grip.kind !== 'move') {
          const strength = options.strength ?? 1
          const a = start.clone().sub(grip.centre), b = cursorPoint.sub(grip.centre)
          const angle = Math.atan2(a.clone().cross(b).dot(grip.axis), a.dot(b)) * strength
          const factor = Math.max(.01, 1 + ((ev.clientX-e.clientX)*grip.dx+(ev.clientY-e.clientY)*grip.dy) / 94 * strength)
          const desired = vertices.map(vertex => {
            const old = new THREE.Vector3(...(anchors?.[vertex] ?? vertexAt(original, vertex))), rel = old.clone().sub(grip.centre)
            const moved = grip.kind === 'rotate' ? rel.applyAxisAngle(grip.axis, angle) : rel.addScaledVector(grip.axis, rel.dot(grip.axis)*(factor-1))
            return moved.add(grip.centre).sub(old).toArray() as Vec3
          })
          const travel = anchorSolver ? anchorSolver(desired) : desired
          current = movePoints(original, vertices.map((vertex, i) => ({vertex, by: travel[i]})), options.neighbourRadius ?? 0)
        }
        // Keep the raw gesture for contact: fitting the approaching poles
        // first changes the joined surface on curved scans.
        const contactCage = changed && options.snapPoint && !options.rayPoint && mergeSources.length ? cloneCage(current) : null
        if (changed && options.snapPoint && (!deferSnap || releasing)) {
          for (let i = 0; i < current.positions.length / 3; i++) {
            const moved = i >= original.positions.length / 3 || [0, 1, 2].some(k => current.positions[i * 3 + k] !== original.positions[i * 3 + k])
            if (!moved) continue
            const snapped = options.snapPoint(vertexAt(current, i))
            if (!snapped?.every(Number.isFinite)) {
              // Keep the pull atomic when a restricted scan region has no hit.
              current = original
              nextSelection = this.selection.slice()
              changed = false
              break
            }
            current.positions.set(snapped, i * 3)
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
        if (changed) for (const mergeSource of mergeSources) {
          const at = this.project(evaluatedPoint ? cageVertexLimits(current)[mergeSource] : vertexAt(current, mergeSource))
          const candidates = visible.vertices.flatMap((shown, v) => {
            if (!shown || vertices.includes(v) || !top.vertexEdges[v].some(i => top.edges[i].faces.length === 1)) return []
            const p = evaluatedPoint ? anchors![v] : vertexAt(original, v), screen = this.project(p), distance = Math.hypot(screen.x - at.x, screen.y - at.y)
            // The observed capture band accepts five pixels and rejects six.
            // A depth guard prevents a screen overlap welding unrelated layers.
            // A fitted contact can cover its original target pole. Keep that
            // already-visible target during release, within the same capture
            // band/depth, instead of letting the preview occlude itself.
            const captured = previousContact?.from === mergeSource && previousContact.to === v
            if (distance > 5 || (!captured && !this.unobscured(p)) || Math.abs(screen.z - at.z) > .01) return []
            return [{ v, distance }]
          }).sort((a, b) => a.distance - b.distance)
          for (const candidate of candidates) {
            try {
              // A complete single side captures both matching boundary ends.
              // Test both contacts before changing topology: a partial chain
              // contact still follows the independently observed point path.
              const otherFrom = chainEnds.find(v => v !== mergeSource)
              const otherAt = otherFrom === undefined ? null : this.project(vertexAt(current, otherFrom))
              const otherTo = this.selection.length === 1 && otherAt ? top.vertexEdges[candidate.v]
                .map(i => top.edges[i]).filter(edge => edge.faces.length === 1)
                .map(edge => edge.a === candidate.v ? edge.b : edge.a)
                .find(v => {
                  if (!visible.vertices[v] || vertices.includes(v)) return false
                  const p = vertexAt(original, v), screen = this.project(p)
                  return Math.hypot(screen.x - otherAt.x, screen.y - otherAt.y) <= 5 && Math.abs(screen.z - otherAt.z) <= .01 &&
                    (previousContact?.otherTo === v || this.unobscured(p))
                }) : undefined
              const paired = otherTo !== undefined && otherFrom !== undefined
                ? mergeBoundaryEdge(contactCage ?? current, [mergeSource, otherFrom], [candidate.v, otherTo]) : null
              const result = paired ? { cage: paired.cage, vertex: paired.mapping[candidate.v] }
                : mergeBoundaryPoint(contactCage ?? current, mergeSource, candidate.v, chainEnds.length ? 'chain' : evaluatedPoint ? 'surface-point' : 'point')
              const map = (v: number) => { if (paired) return paired.mapping[v]; const w = v === mergeSource ? candidate.v : v; return w > mergeSource ? w - 1 : w }
              let joined = result.cage
              if (contactCage) {
                const screen = this.project(evaluatedPoint ? anchors![candidate.v] : vertexAt(original, candidate.v))
                const position = !chainEnds.length ? host.pickScan(screen.x, screen.y)?.point : undefined
                if (!chainEnds.length && !position) throw new Error('No valid mesh contact.')
                joined = fitMergedContact(joined, vertices.map(map), options.controlNet !== false,
                  options.snapPoint!, position ? { vertex: result.vertex, position } : undefined)
              }
              current = joined
              if (chainEnds.length) {
                const newEdges = topology(current).edges
                nextSelection = this.selection.map(p => {
                  const old = top.edges[p.index], key = edgeKey(map(old.a), map(old.b))
                  return { kind: 'edge' as const, index: newEdges.findIndex(e => edgeKey(e.a, e.b) === key) }
                }).filter(p => p.index >= 0)
              } else nextSelection = [{ kind: 'vertex', index: result.vertex }]
              merging = true
              activeContact = { from: mergeSource, to: candidate.v, otherTo }
              break
            } catch { /* Try another eligible target before refusing the contact. */ }
          }
          invalidContact ||= candidates.length > 0
          if (merging) { invalidContact = false; break }
        }
        changed = current.faces.length !== original.faces.length || current.positions.length !== original.positions.length || current.positions.some((v, i) => Math.abs(v - original.positions[i]) > 1e-10)
        const folds = invalidContact || (changed && checkedOrientation !== null && !preservesRefitOrientation(current, checkedOrientation))
        dragFeedback(folds)
        if (folds) {
          current = original
          changed = false
          nextSelection = this.selection.slice()
        }
        this.preview = changed ? {cage:current,selection:nextSelection,freePull:deferSnap && !releasing} : null
        this.draw(current); options.onPreview?.(current, true)
      }
      const move = (ev: PointerEvent, releasing = false) => {
        try { update(ev, releasing) } catch (error) { finish(false); options.onError?.(error instanceof Error ? error : new Error(String(error))) }
      }
      const finish = (accept: boolean) => {
        if (done) return
        done = true; this.cancelDrag = null
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', end); el.removeEventListener('pointercancel', cancel); el.removeEventListener('lostpointercapture', cancel)
        window.removeEventListener('keydown', key, true)
        try { el.releasePointerCapture(e.pointerId) } catch { /* capture already released */ }
        host.claimDrag(false)
        if (this.dragHint) this.dragHint.style.display = 'none'
        host.setCursor('default')
        this.preview = null
        // Keep the last measured draft across the handoff to the build. The
        // working editor redraws it until the new CAD tessellation is available.
        if (!accept || !changed || !options.refitPoint) this.draw(accept && changed ? current : original)
        options.onPreview?.(accept && changed ? current : original, false)
        if (accept && changed) {
          try { options.onCommit?.(current, nextSelection) } catch (error) { options.onError?.(error instanceof Error ? error : new Error(String(error))) }
        }
      }
      const end = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return
        move(ev, true)
        const click = !changed && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 2 && hit.kind === 'edge'
        finish(!blocked)
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
          if (this.options.creating) {
            if (this.options.creationTool === 'rectangle') {
              if (!this.rectangleStart) {
                if (this.host.pickScan(x, y)) {
                  this.rectangleStart = { x, y }
                  this.placementPoint = null
                }
              } else {
                const corners = this.rectangleAt(x, y)
                if (corners) {
                  this.cancelPlacement()
                  this.options.onCreateRectangle?.(corners)
                } else this.options.onError?.(new Error('All four rectangle corners must land on the reference mesh.'))
              }
            } else {
              const hit = this.faceCorner(x, y)
              if (typeof hit?.corner === 'number') this.options.onCreatePoint?.(hit.point, hit.corner)
              else if (hit) this.options.onCreatePoint?.(hit.point)
            }
            return true
          }
          if (!this.cage) return false
          this.select([]); return true
        },
        hover: (at, covered) => {
          if (this.options.enabled === false) return false
          if (this.cancelDrag) return true
          if (this.options.brush) {
            this.showBrush(!covered ? at ?? undefined : undefined)
            if (at && !covered) this.host.setCursor('crosshair')
            return !!at && !covered
          }
          if (this.options.creating) {
            if (this.options.creationTool === 'rectangle' && this.rectangleStart) {
              this.rectanglePreview = !covered && at ? this.rectangleAt(at.x, at.y) : null
              this.draw(this.cage)
              this.host.setCursor('crosshair')
              return !!this.rectanglePreview
            }
            const hit = !covered && at ? this.faceCorner(at.x, at.y) : null
            const point = hit?.point ?? null
            this.placementVertex = typeof hit?.corner === 'number' ? hit.corner : undefined
            const previous = this.placementPoint
            if (point ? !previous || point.some((axis, i) => axis !== previous[i]) : previous) {
              this.placementPoint = point
              this.draw(this.cage)
            }
            if (point) this.host.setCursor('crosshair')
            return !!point
          }
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
      this.disposed = true
      if(this.warmTimer!==undefined)clearTimeout(this.warmTimer)
      this.warmRequest=null;this.liveGrid.clear()
      this.nextDeviation?.cancel(); this.nextDeviation = null; this.deviationCache = null; this.liveDeviationCache = null
      this.cancelDrag?.(); this.clearDrawing(); this.surfaceCache = null; this.topologyCache = null; this.evaluationPlans.clear(); this.group.removeFromParent(); this.duplicate?.remove(); this.dragHint?.remove(); this.brushRing?.remove(); this.manipulator.dispose()
      for (const entry of this.drawingMaterials.values()) entry.material.dispose()
      this.drawingMaterials.clear()
      this.paintedDeviation?.geometry.dispose(); this.paintedDeviation = null
      this.deviationMaterial?.dispose(); this.deviationMaterial = null; this.deviationColouring = null
      this.deviationTexture?.dispose(); this.deviationTexture = null
      this.deviationTextureUniform.value = null; this.deviationTextureData = null
      this.host.canvas.removeEventListener('dblclick', this.doubleClick); this.host.canvas.removeEventListener('contextmenu', this.contextMenu); this.host.claimDrag(false)
    }
  }
