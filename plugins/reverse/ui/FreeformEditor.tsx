import { NominalSurface } from '../../../src/core/deviation/surface'
import { snapRayReach } from '../core/freeform/snap'
import { regionSnap } from '../core/freeform/wrap'
import { useStore } from '../../../src/state/store'
import { deviationSampler } from '../core/freeform/previewDeviation'
import { useLength } from '../../../src/app/useUnits'
import type { FreeformDeviationRange } from '../viewer/freeformEditorLayer'
// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShell } from '../../../src/state/shellStore'
import * as THREE from 'three'
import type { Vec3 } from '../../../src/core/types'
import { editCage } from '../app/reCommandCore'
import { reverseSession } from '../app/reSession'
import { scanPaths } from '../app/reNetworkCommands'
import type { FreeformFeature } from '../core/features'
import { type Cage, topology, vertexAt } from '../core/freeform/cage'
import { addFace, increaseResolution, movePoints, offsetCage, smooth, snapSelected } from '../core/freeform/edit'
import { cageVertexLimits, vertexNormals } from '../core/freeform/limit'
import { irregularBoundaryVertices, repairBoundary } from '../core/freeform/repair'
import { offsetBoundaryToPlanes, offsetByPrimitives } from '../core/freeform/referenceOffset'
import { surfaceAnchorDrag } from '../viewer/freeformAnchorDrag'
import { regionClosestIn } from '../core/freeform/wrap'
import { applyEditorAction, bridgeCommandAvailable, editorActions, selectedVertices, type EditorAction, type FreeformSelection } from '../core/freeform/editor'
import { useReverse } from '../state/reStore'
import { FreeformEditorLayer, type FreeformSelectionMode } from '../viewer/freeformEditorLayer'
import { reSceneOf } from '../viewer/reScene'
import { FreeformIcon } from './FreeformIcon'
import { FreeformDeviationOptions } from './FreeformDeviationOptions'
import './freeformControls.css'
import type { ManipulatorFrame } from '../viewer/freeformManipulator'
import { useFreeformNavigation } from './useFreeformNavigation'
import { useFreeformEditor } from '../state/freeformEditorStore'

export { useFreeformEditor } from '../state/freeformEditorStore'
const empty = (): Cage => ({ positions: new Float64Array(), faces: [], creases: [] })
const fromFeature = (f: FreeformFeature): Cage => ({ positions: Float64Array.from(f.positions), faces: f.faces.map(x => [...x]), creases: f.creases.map(e => [...e]) })
const labels: Record<EditorAction, string> = { split: 'Split', bridge: 'Bridge Edges', close_hole: 'Close 4-sided hole', crease: 'Crease', remove_crease: 'Remove Crease', delete: 'Delete' }
const FREEFORM_SCAN_TINT = [230, 215, 185] as const
const offsetCommands = {
  offset: { command: 'Offset …', title: 'Offset Quad Surface', field: 'Offset by', initial: 1 },
  boundary: { command: 'Offset boundary to surface …', title: 'Offset boundary to surface', field: 'Extra distance', initial: .5 },
  primitives: { command: 'Offset based on other primitives …', title: 'Offset based on other primitives', field: 'Tolerance ±', initial: .5 },
}
type OffsetCommand = keyof typeof offsetCommands
type SurfaceView = 'solid' | 'solid-edges' | 'transparent'

const selectionModes: { value: FreeformSelectionMode; label: string }[] = [
  { value: 'points-edges', label: 'Points / Edges' }, { value: 'points', label: 'Points only' },
  { value: 'edges', label: 'Edges only' }, { value: 'faces', label: 'Faces only' }, { value: 'all', label: 'Point / Edge / Face' }, { value: 'boundary', label: 'Boundary' },
]

/** The panel owns editing state; committed cages use the existing document history. */
export function FreeformEditor() {
  const backdrop = useFreeformNavigation(true)
  const state = useReverse()
  const id = useFreeformEditor(s => s.targetId)
  const setId = useFreeformEditor(s => s.setTargetId)
  const feature = state.features.find(f => f.id === id && f.kind === 'freeform') as FreeformFeature | undefined
  const cage = useMemo(() => feature?.faces.length ? fromFeature(feature) : null, [feature])
  const irregular = useMemo(() => cage ? irregularBoundaryVertices(cage) : [], [cage])
  const editedBodies = useMemo(() => state.bodies.filter(b => Math.floor(b.id) === id).map(b => b.id), [id, state.bodies])
  const selectionHistory = useRef(new WeakMap<FreeformFeature, FreeformSelection[]>())
  const [picked, setPicked] = useState<{ feature: FreeformFeature | undefined; items: FreeformSelection[] }>({ feature, items: [] })
  const selection = picked.feature === feature ? picked.items : feature ? selectionHistory.current.get(feature) ?? [] : []
  const setSelection = (items: FreeformSelection[]) => setPicked({ feature, items })
  const [mode, setMode] = useState<FreeformSelectionMode>('points-edges')
  const [corners, setCorners] = useState<Vec3[]>([])
  const [hidden, setHidden] = useState<number[]>([])
  const [duplicate, setDuplicate] = useState(true)
  const [tool, setTool] = useState<'manipulate' | 'extrapolate' | 'add-face' | 'rectangle' | 'brush-faces' | 'brush-smooth'>('manipulate')
  const placementVertices = useRef<(number | undefined)[]>([])
  const [brushArea, setBrushArea] = useState<'all' | 'convex' | 'concave'>('all')
  const [brushRadius, setBrushRadius] = useState(25)
  const [brushStrength, setBrushStrength] = useState(20)
  const [brushFixBoundary, setBrushFixBoundary] = useState(false)
  const [menuText, setMenuText] = useState(true)
  const toolbarHover = useRef(false)
  const [strength, setStrength] = useState(100)
  const [neighbours, setNeighbours] = useState(false)
  const [snap, setSnap] = useState(true)
  const controlNet=useFreeformEditor(s=>s.controlNet), setControlNet=useFreeformEditor(s=>s.setControlNet)
  const [surfaceOnly, setSurfaceOnly] = useState(false)
  const [surfaceView, setSurfaceView] = useState<SurfaceView>('solid-edges')
  const [transparency, setTransparency] = useState(28)
  const opacity = surfaceView === 'transparent' ? 1 - transparency / 100 : 1
  const [meshDisplay, setMeshDisplay] = useState<'offset' | 'transparent'>('offset')
  const [meshOpacity, setMeshOpacity] = useState(85)
  const [meshOffset, setMeshOffset] = useState(70)
  const [frame, setFrame] = useState<ManipulatorFrame>('local')
  const [manipMenu, setManipMenu] = useState<{x:number;y:number} | null>(null)
  const manipTrigger = useRef<HTMLButtonElement>(null)
  const manipPopup = useRef<HTMLDivElement>(null)
  const [pending, setWorking] = useState(false)
  const working = pending || state.kernelStatus !== 'ready'
  const rebuilding = state.building
  const [error, setError] = useState('')
  const [commandDialog, setCommandDialog] = useState<'delete-all' | OffsetCommand | null>(null)
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null)
  const [offsetText, setOffsetText] = useState('')
  const elements = useStore(s => s.elements)
  const primitives = useMemo(() => elements.flatMap(({ fit }) =>
    fit && fit.kind !== 'point' && fit.kind !== 'line' && fit.kind !== 'circle' ? [fit] : []), [elements])
  const planes = useMemo(() => primitives.filter(fit => fit.kind === 'plane'), [primitives])
  const offsetDialog = commandDialog && commandDialog !== 'delete-all' ? offsetCommands[commandDialog] : null
  const [menu, setMenu] = useState<{ x: number; y: number; hit: boolean; commands?: boolean } | null>(null)
  const contextRef = useRef<HTMLDivElement>(null)
  const commandsTrigger = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (!menu || !contextRef.current) return
    const r = contextRef.current.getBoundingClientRect()
    const x = Math.max(8, Math.min(menu.x, window.innerWidth-r.width-8))
    const y = Math.max(30, Math.min(menu.y, window.innerHeight-r.height-8))
    if (x !== menu.x || y !== menu.y) setMenu({...menu,x,y})
  }, [menu])
  useLayoutEffect(() => { if(menu) contextRef.current?.focus() }, [menu])
  const [selectionMenu, setSelectionMenu] = useState<{ x: number; y: number } | null>(null)
  const focusSubmenu = useRef(true)
  const openManipMenu = (focus = true) => {
    focusSubmenu.current = focus
    const r=manipTrigger.current?.getBoundingClientRect()
    if (!r) return
    const width=Math.min(130,window.innerWidth-16)
    setSelectionMenu(null)
    setManipMenu({x:Math.max(8,r.right+width+8<=window.innerWidth?r.right:r.left-width),y:Math.max(8,Math.min(r.top,window.innerHeight-88))})
  }
  useLayoutEffect(()=>{ if(manipMenu && focusSubmenu.current) manipPopup.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus() },[manipMenu])
  const selectionTrigger = useRef<HTMLButtonElement>(null)
  const selectionPopup = useRef<HTMLDivElement>(null)
  const openSelectionMenu = (focus = true) => {
    focusSubmenu.current = focus
    const r = selectionTrigger.current?.getBoundingClientRect()
    if (!r) return
    const width = Math.min(166, window.innerWidth - 16)
    setManipMenu(null)
    setSelectionMenu({ x: Math.max(8, r.right + width + 8 <= window.innerWidth ? r.right : r.left - width), y: Math.max(8, Math.min(r.top, window.innerHeight - 160)) })
  }
  useEffect(() => { if (!menu) { setSelectionMenu(null); setManipMenu(null) } }, [menu])
  useLayoutEffect(() => { if (selectionMenu && focusSubmenu.current) selectionPopup.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus() }, [selectionMenu])
  useEffect(() => {
    const dismiss = () => {setSelectionMenu(null);setManipMenu(null)}
    window.addEventListener('resize', dismiss)
    return () => window.removeEventListener('resize', dismiss)
  }, [])
  const [range, setRange] = useState<FreeformDeviationRange | null>(null)
  const [deviationError, setDeviationError] = useState(false)
  const [displayOptions, setDisplayOptions] = useState(false)
  const { display, setDisplay, tolerance, colouring, setDeviationOptions } = useFreeformEditor()
  const displayOptionsButton = useRef<HTMLButtonElement>(null)
  const closeDisplayOptions = () => { setDisplayOptions(false); displayOptionsButton.current?.focus() }
  const length = useLength()
  const layer = useRef<FreeformEditorLayer | null>(null)
  const busy = useRef(false)
  const alive = useRef(true)
  const current = useRef({ cage, id, selection, corners, working })
  current.current = { cage, id, selection, corners, working }
  const scene = reverseSession()?.sceneRef.current
  const [bodyGeometryVersion, setBodyGeometryVersion] = useState(0)
  useEffect(() => scene
    ? reSceneOf(scene).subscribeBodyGeometry(() => setBodyGeometryVersion(version => version + 1))
    : undefined, [scene])
  const inspectWithoutScan = surfaceOnly && !!cage
  useEffect(() => {
    if (!scene || !inspectWithoutScan) return
    scene.setScanVisible(false)
    const unsubscribe = useStore.subscribe((next, previous) => {
      if (next.scanHidden !== previous.scanHidden) scene.setScanVisible(false)
    })
    return () => { unsubscribe(); scene.setScanVisible(!useStore.getState().scanHidden) }
  }, [scene, inspectWithoutScan])
  const [newSnapType, setNewSnapType] = useState<'closest' | 'ray'>('closest')
  const snapType = feature ? feature.snapType ?? 'closest' : newSnapType
  const snapRegion = feature?.snapRegion
  const scanName = useStore(state => state.fileName)
  const scanTriangles = useStore(state => state.triangleCount)
  const scanAlignment = useStore(state => state.appliedAlignment)
  const deviationReference = useMemo(() => ({}), [scene, scanName, scanTriangles, scanAlignment])
  const refitPreview = !!feature?.refitTolerance && !feature.ask && !snapRegion && feature.fitToScan !== false && snapType !== 'ray'
  const raySurface = useMemo(() => {
    if ((!snap || (snapType !== 'ray' && !refitPreview)) && display !== 'deviation' || !scanName || !scanTriangles) return null
    const session = reverseSession()
    if (!session) return null
    const paths = scanPaths(session)
    return new NominalSurface(paths.positions, paths.indices.slice())
  }, [snap, snapType, refitPreview, display, scene, scanName, scanTriangles, scanAlignment])
  const refitProjector = useMemo(() => refitPreview && raySurface
    ? raySurface.projectAlong.bind(raySurface) : undefined, [refitPreview, raySurface])
  const measureLiveDeviation = useMemo(() => raySurface
    ? deviationSampler(raySurface) : undefined, [raySurface])
  const rayProjector = useMemo(() => {
    if (snapType !== 'ray' || !raySurface || !cage) return undefined
    const reach = snapRayReach(cage)
    return (p: Vec3, n: Vec3) => {
      const cast = (point: Vec3) => raySurface.projectAlong(point, n, reach)
      return snapRegion ? regionSnap(snapRegion, cast)(p) : cast(p)
    }
  }, [cage, raySurface, snapRegion, snapType])
  const snapProjector = useMemo(() => {
    if (!snap) return undefined
    const session = reverseSession()
    if (!session) return undefined
    const closest = (point: Vec3) => scanPaths(session).closest(point)
    const project = snapRegion ? regionClosestIn(snapRegion, closest) : closest
    return (point: Vec3) => project(point)?.point ?? null
  }, [snap, snapRegion, scene])
  useEffect(() => {
    if (!scene) return
    const previousFlatShading = scene.scanFlatShading()
    if (!previousFlatShading) scene.setScanFlatShading(true)
    const previousTint = scene.scanTintColor()
    if (!previousTint) scene.setScanTint(FREEFORM_SCAN_TINT)
    scene.setScanMatteOverride(true)
    return () => {
      scene.setScanMatteOverride(false)
      if (scene.scanTintColor() === FREEFORM_SCAN_TINT) scene.setScanTint(null)
      if (!previousFlatShading) scene.setScanFlatShading(false)
    }
  }, [scene])
  useEffect(() => {
    if (!scene) return
    scene.setScanOpacityOverride(meshDisplay === 'offset' ? 1 : meshOpacity / 100)
    scene.setScanDepthOffset(meshDisplay === 'offset' ? scene.layerHost().modelRadius() * .06 * meshOffset / 100 : 0)
    return () => { scene.setScanOpacityOverride(null); scene.setScanDepthOffset(0) }
  }, [scene, Boolean(cage), meshDisplay, meshOpacity, meshOffset])
  const available = cage ? editorActions(cage, selection) : null
  const close = () => { if (!busy.current) useFreeformEditor.getState().setOpen(false) }
  useEffect(() => {
    const wasOpen = useShell.getState().inspectorOpen
    useShell.getState().setInspectorOpen(false)
    return () => { useShell.getState().setInspectorOpen(wasOpen) }
  }, [])
  async function commit(next: Cage, nextSelection: FreeformSelection[] = [], snapMode = snap, projection = snapType, fitToScan = feature ? feature.fitToScan : false, refitTolerance = feature?.refitTolerance) {
    if (busy.current || useReverse.getState().kernelStatus !== 'ready') return
    const target = current.current.id
    busy.current = true; setWorking(true); setError(''); setMenu(null)
    try {
      topology(next)
      if (next.faces.length > 200_000) throw new Error('The cage exceeds the 200,000-face editing limit.')
      const data = { positions: Array.from(next.positions), faces: next.faces, creases: next.creases,
        ...(fitToScan === undefined ? {} : { fitToScan }), ...(refitTolerance === undefined ? {} : { refitTolerance }) }
      const result = editCage(() => {
        const st = useReverse.getState()
        if (target === null) {
          const created = st.addFreeform({ ...data, steps: 2, snap: snapMode, snapType: projection === 'ray' ? 'ray' : undefined })
          // A failed kernel build retains its document feature for Undo.
          // Keep that feature selected rather than creating it again on retry.
          if (alive.current) { setId(created); setCorners([]) }
          return created
        }
        if (feature) selectionHistory.current.set(feature, current.current.selection)
        if (!st.updateFreeform(target, { ...data, snap: snapMode, snapType: projection === 'ray' ? 'ray' : undefined, fromSketch: undefined })) throw new Error('The surface is no longer available.')
        const edited = useReverse.getState().features.find(f => f.id === target)
        if (edited?.kind === 'freeform') selectionHistory.current.set(edited, nextSelection)
        return target
      })
      if (alive.current) { setId(result); setCorners([]); if(!cage || cage.positions.length!==next.positions.length || JSON.stringify(cage.faces)!==JSON.stringify(next.faces)) setHidden([]) }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { busy.current = false; if (alive.current) setWorking(false) }
  }
  useEffect(() => {
    if (rebuilding || id === null) return
    const built = state.results[id]
    if (built?.status === 'failed') setError(`The cage was saved, but its CAD surface could not be built: ${built.message ?? 'Build failed'}. Undo is available.`)
  }, [rebuilding, id, state.results])
  const snapMode = (on: boolean) => { if (busy.current || on === snap) return; setSnap(on); if (cage) void commit(cage, selection, on) }
  const applyOffset = () => {
    if (!cage || !offsetText.trim() || !commandDialog || commandDialog === 'delete-all') return
    const distance = length.fromDisplay(Number(offsetText))
    if (!Number.isFinite(distance) || (commandDialog !== 'offset' && distance < 0)) return
    setCommandDialog(null)
    if (distance === 0) return
    try {
      const next = commandDialog === 'boundary' ? offsetBoundaryToPlanes(cage, planes, distance)
        : commandDialog === 'primitives' ? offsetByPrimitives(cage, primitives, distance) : offsetCage(cage, distance)
      if (next.positions.some((coordinate, i) => coordinate !== cage.positions[i])) {
        const nextSelection: FreeformSelection[] = commandDialog === 'boundary'
          ? topology(next).edges.flatMap((edge, index) => edge.faces.length === 1 ? [{ kind: 'edge', index }] : [])
          : selection
        void commit(next, nextSelection, snap, snapType, false)
      } else if (commandDialog === 'boundary') {
        setError('No boundary edges are within the extra distance of the reference planes.')
      }
    } catch (e) { setError((e as Error).message) }
  }
  function action(name: EditorAction) {
    if (!cage || busy.current) return
    if (name === 'delete' && !selection.length) { setMenu(null); return }
    if (name === 'bridge' && !bridgeCommandAvailable(cage, selection)) return
    try {
      const result = applyEditorAction(cage, selection, name)
      if (name === 'split' && snapProjector) {
        // Snap the new limit-surface anchors. Their poles can lie outside
        // the scan because subdivision pulls the boundary back inward.
        const next = result.cage
        const first = cage.positions.length / 3
        const vertices = Array.from({ length: next.positions.length / 3 - first }, (_, i) => first + i)
        const anchors = cageVertexLimits(next)
        const normals = rayProjector ? vertexNormals(next.positions, next.faces) : null
        const travel = vertices.map(i => {
          const point = anchors[i]
          const projected = normals && rayProjector
            ? rayProjector(point, [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]])
            : snapProjector(point)
          return projected?.every(Number.isFinite) ? projected.map((p, axis) => p - point[axis]) as Vec3 : [0, 0, 0] as Vec3
        })
        const poleTravel = surfaceAnchorDrag(next, vertices, 0)?.(travel) ?? travel
        result.cage = movePoints(next, vertices.map((vertex, i) => ({ vertex, by: poleTravel[i] })), 0)
      }
      void commit(result.cage, name === 'crease' ? [] : result.selection)
    }
    catch (e) {
      if (name === 'bridge') { setMenu(null); setBridgeMessage((e as Error).message) }
      else setError((e as Error).message)
    }
  }
  function smoothSelection() {
    if (!cage?.faces.length || working) return
    try {
      // Native Smooth takes a 10% neighbour step, using the whole cage when
      // nothing is selected. Control Net and drag falloff do not change it.
      const next = smooth(cage, selection.length ? selectedVertices(cage, selection) : undefined, 0.1)
      setMenu(null)
      if (next.positions.some((v,i)=>Math.abs(v-cage.positions[i])>1e-12)) void commit(next, selection)
    } catch(e) { setError((e as Error).message) }
  }
  function snapSelection() {
    if (!cage?.faces.length || working) return
    try {
      const session=reverseSession()
      if (!session) throw new Error('The reference mesh is unavailable.')
      const paths=scanPaths(session)
      const vertices=selection.length ? selectedVertices(cage,selection) : Array.from({length:cage.positions.length/3},(_,i)=>i)
      const next=snapSelected(cage,vertices,p=>paths.closest(p))
      setMenu(null)
      if(next.positions.some((v,i)=>Math.abs(v-cage.positions[i])>1e-12)) void commit(next,selection)
    } catch(e) { setError((e as Error).message) }
  }
  const chooseTool = (value: typeof tool) => {
    if (value !== tool) {
      current.current.corners = []
      placementVertices.current = []
      layer.current?.cancelPlacement()
      setCorners([])
      setError('')
    }
    setTool(value)
    setMenu(null)
  }
  function visibility(isolate: boolean) {
    if (!cage) return
    const top = topology(cage), faces = new Set<number>()
    for (const s of selection) for (const f of s.kind === 'face' ? [s.index] : s.kind === 'edge' ? top.edges[s.index].faces : top.vertexFaces[s.index]) faces.add(f)
    setHidden(isolate ? cage.faces.map((_, i) => i).filter(i => !faces.has(i)) : [...new Set([...hidden, ...faces])])
    setSelection([]); setMenu(null)
  }
  function alignScreen(horizontal: boolean) {
    if (!cage || !scene) return
    const ids = selectedVertices(cage, selection)
    if (ids.length < 2) return
    const host = scene.layerHost(), camera = host.camera()
    host.partGroup.updateWorldMatrix(true, false)
    const axis = new THREE.Vector3(horizontal ? 0 : 1, horizontal ? 1 : 0, 0).applyQuaternion(camera.quaternion)
    const anchors = controlNet ? null : cageVertexLimits(cage)
    const points = ids.map(i => host.partGroup.localToWorld(new THREE.Vector3(...(anchors?.[i] ?? vertexAt(cage, i)))))
    const mean = points.reduce((a, p) => a + p.dot(axis), 0) / points.length
    const targets = points.map(p => host.partGroup.worldToLocal(p.addScaledVector(axis, mean - p.dot(axis))).toArray() as Vec3)
    if (anchors) {
      const radius = neighbours ? 0 : host.modelRadius() * .1
      const travel = targets.map((p, n) => p.map((v, k) => v - anchors[ids[n]][k]) as Vec3)
      const poleTravel = surfaceAnchorDrag(cage, ids, radius)?.(travel) ?? travel
      void commit(movePoints(cage, ids.map((vertex, n) => ({ vertex, by: poleTravel[n] })), radius), selection)
    } else {
      const positions = cage.positions.slice()
      targets.forEach((p, n) => positions.set(p, ids[n] * 3))
      void commit({ ...cage, positions }, selection)
    }
  }
  useEffect(() => {
    alive.current = true
    if (!scene) return
    const editor = new FreeformEditorLayer(scene.layerHost()); layer.current = editor
    const remove = scene.addLayer(editor.layer())
    return () => { alive.current = false; remove(); layer.current = null }
  }, [scene])
  useEffect(() => {
    if (!scene) return
    const view = reSceneOf(scene)
    view.setEditingBodies(editedBodies)
    return () => { view.setEditingBodies([]) }
  }, [scene, editedBodies])
  useEffect(() => {
    if (!scene || !layer.current) return
    const editor = layer.current
    const view = reSceneOf(scene)
    const candidate = !rebuilding && !working && editedBodies.length === 1 ? view.bodyMeshes.get(editedBodies[0])?.geometry : undefined
    // The document's finished build can render before the scene effect has
    // installed its mesh. Never label the previous revision's colors as CAD.
    const finishedSurface = candidate?.getAttribute('position').array === reverseSession()?.meshes.get(editedBodies[0])?.positions
      ? candidate : undefined
    if (display === 'deviation') { setRange(null); setDeviationError(false) }
    editor.set(cage, {
      enabled: !working && commandDialog === null && bridgeMessage === null, rebuilding, extrapolate: tool === 'extrapolate', mode, selection, hiddenFaces: hidden, duplicateHandle: duplicate, controlNet, opacity, showEdges: surfaceView === 'solid-edges', manipulator: snap ? undefined : frame,
      strength: strength / 100, neighbourRadius: neighbours ? 0 : scene.layerHost().modelRadius() * .1,
      creating: (!cage || tool === 'add-face' || tool === 'rectangle') && !working, creationCorners: corners, creationVertices: placementVertices.current,
      creationTool: tool === 'rectangle' ? 'rectangle' : tool === 'add-face' ? 'face' : undefined,
      onCancelCreation: () => chooseTool('manipulate'),
      brush: tool === 'brush-faces' ? { kind: 'faces' } : tool === 'brush-smooth' ? {
        kind: 'smooth', radius: brushRadius, onStroke: vertices => {
          if (!cage || brushStrength === 0) return
          try {
            const next = smooth(cage, vertices, brushStrength / 100, 1, { area: brushArea, fixBoundary: brushFixBoundary })
            setSelection([])
            if (next.positions.some((v, i) => Math.abs(v - cage.positions[i]) > 1e-12)) void commit(next)
          } catch (e) { setError((e as Error).message) }
        },
      } : undefined,
      onSelection: picks => { setSelection(picks); setMenu(null) },
      onContext: (x, y, hit) => {toolbarHover.current=false;setMenuText(true);setMenu({ x, y, hit: !!hit || selection.length > 0 })},
      onCommit: (next, picks) => { if (!busy.current) void commit(next, picks) },
      onError: e => setError(e.message),
      onCreateRectangle: points => {
        try {
          const next = addFace(cage ?? empty(), points)
          chooseTool('manipulate')
          void commit(next)
        } catch (e) { setError((e as Error).message) }
      },
      onCreatePoint: (point, vertex) => {
        if (busy.current) return
        const placed = current.current.corners
        if (placed.some(p => Math.hypot(p[0]-point[0], p[1]-point[1], p[2]-point[2]) <= 1e-6)) {
          setError('Choose a different point on the scan.')
          return
        }
        setError('')
        const next = [...placed, point]
        const vertices = [...placementVertices.current, vertex]
        // Keep rapid clicks in order before React has committed another render.
        current.current.corners = next
        if (next.length === 4) {
          try {
            const result = addFace(cage ?? empty(), next.map((p, i) => vertices[i] ?? p))
            chooseTool('manipulate')
            placementVertices.current = []
            void commit(result)
          }
          catch (e) { current.current.corners = placed; setError((e as Error).message) }
        } else {
          placementVertices.current = vertices
          setCorners(next)
        }
      },
      snapPoint: snapProjector, rayPoint: rayProjector, refitPoint: refitProjector, fitToScan: feature ? feature.fitToScan : false, display, tolerance, colouring, finishedSurface, deviationReference,
      measureLiveDeviation,
      refineDeviation: async (data, threshold) => {
        const client = reverseSession()?.client()
        if (!client) throw new Error('Reference scan unavailable')
        return client.refineSurfaceDeviation(data, threshold)
      },
      readDeviationMesh: async () => {
        const client = reverseSession()?.client()
        if (!client) throw new Error('Finished CAD unavailable')
        const [mesh] = await client.referenceMeshes(editedBodies, .001, true, true)
        if (!mesh?.indices.length) throw new Error('Finished CAD has no triangles')
        return mesh
      },
      measureDeviation: async positions => {
        const client = reverseSession()?.client()
        if (!client) throw new Error('Reference scan unavailable')
        return client.previewSurfaceDeviation(positions)
      },
      onDeviation: value => { setRange(value); setDeviationError(false) },
      onDeviationError: () => { setRange(null); setDeviationError(true) },
    })
  }, [scene, cage, corners, tool, mode, selection, hidden, duplicate, strength, neighbours, snap, snapProjector, rayProjector, refitProjector, frame, controlNet, opacity, surfaceView, display, tolerance, colouring, working, rebuilding, editedBodies, bodyGeometryVersion, brushArea, brushRadius, brushStrength, brushFixBoundary, commandDialog, bridgeMessage, feature?.fitToScan, measureLiveDeviation, deviationReference])
  useEffect(() => { setPicked({ feature, items: feature ? selectionHistory.current.get(feature) ?? [] : [] }); setMenu(null) }, [feature])
  const topologyKey=cage?JSON.stringify([cage.positions.length,cage.faces]):''
  useEffect(()=>{setHidden([])},[id,topologyKey])
  useEffect(() => {
    if (id !== null && !feature && !working) { setId(null); setCorners([]) }
  }, [id, feature, working])
  useEffect(() => { if (feature) setSnap(feature.snap) }, [id, feature?.snap])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (displayOptions) return
      if (bridgeMessage) {
        e.stopImmediatePropagation()
        if (e.key === 'Escape') { e.preventDefault(); setBridgeMessage(null) }
        else if (e.key === 'Tab' || e.ctrlKey || e.metaKey) e.preventDefault()
        return
      }
      if (commandDialog) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setCommandDialog(null) }
        return
      }
      if ((e.target as HTMLElement)?.closest('input,select,textarea')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase()==='r') {
        e.preventDefault();e.stopImmediatePropagation()
        if(cage && !working) void commit(increaseResolution(cage))
        return
      }
      if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
        e.preventDefault(); e.stopImmediatePropagation()
        history(e.key.toLowerCase() === 'y' || e.shiftKey); return
      }
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation()
        if (layer.current?.cancelStroke()) return
        if (manipMenu) {setManipMenu(null);manipTrigger.current?.focus()}
        else if (selectionMenu) { setSelectionMenu(null); selectionTrigger.current?.focus() }
        else if (menu?.commands) { setMenu(null); commandsTrigger.current?.focus() }
        else if(menu && menuText && toolbarHover.current) {setMenuText(false)}
        else { chooseTool('manipulate'); current.current.corners = []; placementVertices.current = []; setCorners([]); setError('') }
        return
      }
      if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); scene?.fitToView(); setMenu(null); return }
      if(e.key.toLowerCase()==='q' && !e.ctrlKey && !e.metaKey && !e.altKey) {e.preventDefault();e.stopImmediatePropagation();smoothSelection();return}
      const command = e.key.toLowerCase() === 's' ? 'split' : e.key.toLowerCase() === 'd' ? 'bridge' : e.key === 'Delete' ? 'delete' : null
      if (command && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); action(command) }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [cage, selection, selectionMenu, manipMenu, menu, menuText, working, tool, commandDialog, bridgeMessage, displayOptions])
  const history = (redo: boolean) => { if (busy.current) return; setMenu(null); redo ? state.redoFeatures() : state.undoFeatures() }
  const pickMode = (value: typeof mode) => { setMode(value); setSelectionMenu(null); setMenu(null) }
  const commandButton = (name: EditorAction, context = false) => <button key={name} type="button" role={context ? 'menuitem' : undefined}
    data-test={`freeform-${name}`} aria-label={labels[name]} title={labels[name]} disabled={working || (name === 'bridge' ? !cage || !bridgeCommandAvailable(cage, selection) : context && name === 'delete' && !selection.length ? !cage : !available?.[name])}
    onClick={() => action(name)}>{context ? <><span>{labels[name]}</span><span className="ff-shortcut">{name === 'split' ? 'S' : name === 'delete' ? 'Del' : name === 'bridge' ? 'D' : ''}</span></> : <FreeformIcon name={name} />}</button>
  const visibilityItems = <>
    <button role="menuitem" disabled={!selection.length} onClick={() => visibility(true)}><span className="ff-visibility-label"><FreeformIcon name="isolate" size={16} />Isolate</span></button>
    <button role="menuitem" disabled={!selection.length} onClick={() => visibility(false)}><span className="ff-visibility-label"><FreeformIcon name="hide" size={16} />Hide Selected</span></button>
    <button role="menuitem" onClick={() => { if (hidden.length) setHidden([]); setMenu(null) }}><span className="ff-visibility-label"><FreeformIcon name="show" size={16} />Show Hidden</span></button>
  </>
  return <div ref={backdrop} className="modalback" data-test="freeform-editor" style={{ background: 'transparent', alignItems: 'flex-start', justifyContent: 'flex-start', paddingTop: 'min(176px, 25dvh)', paddingLeft: 'min(224px, max(8px, calc(100vw - 306px)))' }} onPointerDown={e => { if (e.target === e.currentTarget) setMenu(null) }}>
    <form tabIndex={-1} className="modal ff-editor" role="dialog" aria-label="Edit Surface" style={{ width: 290, maxHeight: 'calc(100dvh - min(176px, 25dvh) - 8px)', boxSizing: 'border-box', overflowY: 'auto', padding: 12, display: 'grid', gap: 8 }} onSubmit={e => e.preventDefault()} onKeyDown={e => e.stopPropagation()}>
      {tool === 'brush-smooth' ? <>
        <header className="ff-title">Smooth</header>
        <select aria-label="Smooth areas" value={brushArea} onChange={event => setBrushArea(event.target.value as typeof brushArea)}>
          <option value="all">All visible points within the circle</option><option value="convex">Convex areas only</option><option value="concave">Concave areas only</option>
        </select>
        <label>Circle size <input aria-label="Circle size" type="range" min="5" max="160" value={brushRadius} onChange={event => setBrushRadius(Number(event.target.value))} /></label>
        <label>Smooth strength <input aria-label="Smooth strength" type="range" min="0" max="100" value={brushStrength} onChange={event => setBrushStrength(Number(event.target.value))} /></label>
        <label><input type="checkbox" checked={brushFixBoundary} onChange={event => setBrushFixBoundary(event.target.checked)} /> Fix boundary points</label>
        {error && <small role="alert">{error}</small>}
        <button type="button" className="ff-right-control" disabled={working} onClick={() => chooseTool('manipulate')}>Back</button>
      </> : <>
      <header className="ff-title"><span>Edit Surface</span><button type="button" aria-label="Close Edit Surface" disabled={working} onClick={close}>×</button></header>
      <div className="ff-main-tools" role="toolbar" aria-label="Surface editing tools">
        <div className="ff-icon-toolbar"><button type="button" aria-label="Manipulate" title="Manipulate" aria-pressed={tool==='manipulate'} onClick={()=>chooseTool('manipulate')}><FreeformIcon name="select" /></button>
        <button type="button" aria-label="Add face" title="Add face" aria-pressed={tool==='add-face'} disabled={working || !scanTriangles && !cage} onClick={()=>chooseTool('add-face')}><FreeformIcon name="add-face" /></button>
        <button type="button" aria-label="Add rectangular face" title="Add rectangular face" aria-pressed={tool==='rectangle'} disabled={working || !scanTriangles} onClick={()=>chooseTool('rectangle')}><FreeformIcon name="rectangle" /></button>
        <button type="button" aria-label="Brush select faces" title="Brush select faces" aria-pressed={tool==='brush-faces'} disabled={working || !cage} onClick={()=>chooseTool('brush-faces')}><FreeformIcon name="brush-faces" /></button>
        <button type="button" aria-label="Brush smooth" title="Brush smooth" disabled={working || !cage} onClick={()=>chooseTool('brush-smooth')}><FreeformIcon name="brush-smooth" /></button>
        <button type="button" className="ff-extrapolate-tool" aria-label="Extrapolate" title="Extrapolate" aria-pressed={tool==='extrapolate'} disabled={!cage || working} onClick={()=>chooseTool('extrapolate')}><FreeformIcon name="extrapolate" /></button>
        <button type="button" title="Align Horizontally" aria-label="Align Horizontally" disabled={!cage || selectedVertices(cage,selection).length<2 || working} onClick={()=>alignScreen(true)}><FreeformIcon name="align-h" /></button>
        <button type="button" title="Align Vertically" aria-label="Align Vertically" disabled={!cage || selectedVertices(cage,selection).length<2 || working} onClick={()=>alignScreen(false)}><FreeformIcon name="align-v" /></button>
        <button ref={commandsTrigger} type="button" aria-label="Commands" title="Commands" aria-haspopup="menu" aria-expanded={!!menu?.commands}
          onClick={event => {
            if (menu?.commands) { setMenu(null); return }
            const bounds = event.currentTarget.getBoundingClientRect()
            setMenuText(true)
            setMenu({ x: bounds.left, y: bounds.bottom, hit: false, commands: true })
          }}><FreeformIcon name="commands" /></button></div>
        <div className="ff-icon-toolbar">
        {(['split', 'crease', 'remove_crease'] as const).map(name => commandButton(name))}
        <button type="button" title="Increase Resolution" aria-label="Increase Resolution" disabled={!cage || working} onClick={()=>cage && void commit(increaseResolution(cage))}><FreeformIcon name="resolution" /></button>
        <button type="button" aria-label="Smooth" title="Smooth (Q)" disabled={!cage?.faces.length || working} onClick={smoothSelection}><FreeformIcon name="smooth" /></button>
        <button type="button" aria-label="Snap to Mesh" title="Snap to Mesh" disabled={!cage?.faces.length || working} onClick={snapSelection}><FreeformIcon name="snap" /></button>{commandButton('bridge')}</div>
      </div>
      {feature?.fromSketch && <small>Manual edits detach this surface from its generating sketch.</small>}
      <label>Selection <select aria-label="Freeform selection" value={mode} onChange={e => pickMode(e.target.value as typeof mode)}>{selectionModes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>Drag Strength <input aria-label="Drag Strength" type="range" min="0" max="100" value={strength} onChange={e => setStrength(Number(e.target.value))} /></label>
      <div className="ff-snap-row"><span>Snap Mode</span><span><button type="button" disabled={working} aria-pressed={!snap} onClick={() => snapMode(false)}>OFF</button> <button type="button" disabled={working} aria-pressed={snap} onClick={() => snapMode(true)}>ON</button></span></div>
      {snap ? <label>Snapping Type <select aria-label="Snapping Type" value={snapType} disabled={working} onChange={event => {
        const next = event.target.value === 'ray' ? 'ray' : 'closest'
        if (cage) void commit(cage, selection, snap, next)
        else setNewSnapType(next)
      }}><option value="closest">Closest Point</option><option value="ray">Ray Projection</option></select></label> : <label>Manipulator <select aria-label="Manipulator" value={frame} onChange={e=>setFrame(e.target.value as ManipulatorFrame)}>{['world','screen','local'].map(f=><option key={f} value={f}>{f[0].toUpperCase()+f.slice(1)}</option>)}</select></label>}
      {feature && feature.fitToScan !== false && <button type="button" data-test="freeform-use-control-surface"
        title="Shape the surface from its control points. Point snapping remains a separate setting."
        disabled={!cage || working} onClick={() => cage && void commit(cage, selection, snap, snapType, false)}>Use control surface</button>}
      <label><input type="checkbox" checked={duplicate} onChange={e => setDuplicate(e.target.checked)} /> Show DUPLICATE handle</label>
      <label><input type="checkbox" checked={neighbours} onChange={e => setNeighbours(e.target.checked)} /> Don't move neighbours</label>
      <button className="ff-right-control" type="button" aria-pressed={controlNet} onClick={() => setControlNet(!controlNet)}>Control Net</button>
      <div className="ff-editor-display" role="group" aria-label="Surface display">
        {(['shaded', 'deviation', 'zebra'] as const).map(value => {
          const label = { shaded: 'Shaded', deviation: 'Tolerance', zebra: 'Zebra' }[value]
          return <button key={value} type="button" data-test={`freeform-display-${value}`} aria-label={label}
            title={label} aria-pressed={display === value} disabled={working}
            onClick={() => { if (display !== value) setRange(null); setDisplay(value); setDisplayOptions(false) }}><FreeformIcon name={value} /></button>
        })}
        <button ref={displayOptionsButton} type="button" className="ff-display-options" data-test="freeform-display-options" disabled={display !== 'deviation'} aria-haspopup="dialog" aria-expanded={displayOptions}
          onClick={() => setDisplayOptions(true)}>Options …</button>
      </div>
      {display === 'deviation' && <div className="ff-tolerance">
          <button type="button" data-test="freeform-refit-tolerance"
            title="Refit an open, uncreased quad surface using Closest Point snapping"
            disabled={!cage || !snap || working || snapType === 'ray' || !!feature?.ask || !!feature?.snapRegion ||
              cage.creases.length > 0 || cage.faces.length > 32 || cage.faces.some(face => face.length !== 4) || topology(cage).closed || tolerance <= .001}
            onClick={() => cage && void commit(cage, selection, snap, snapType, true, tolerance)}>Refit to tolerance</button>
        <div className="ff-tolerance-ramp" aria-hidden="true" />
        <small className="ff-tolerance-ticks">
          <span>{length.fmt(-5 * tolerance)}</span><span>{length.fmt(-tolerance)}</span>
          <span>{length.fmt(tolerance)}</span><span>{length.fmt(5 * tolerance)}</span>
        </small>
        <small>{range ? `${range.preview ? feature?.fitToScan === false ? 'Surface' : 'Preview' : 'CAD'} samples: Min ${length.fmt(range.min)} · Max ${length.fmt(range.max)} · RMS ${length.fmt(range.rms)}` : !cage?.faces.length ? 'Place three corners to preview the surface.' : deviationError ? 'Deviation measurement unavailable' : 'Measuring visible surface…'}</small>
        {range && <small className="ff-tolerance-result" data-outside={Math.max(-range.min, range.max) > tolerance}>
          {range.preview && feature?.fitToScan !== false ? rebuilding ? 'Updating finished CAD measurements…' : 'Release to measure the finished CAD surface'
            : Math.max(-range.min, range.max) > tolerance ? 'Sampled surface exceeds tolerance' : 'Sampled surface within tolerance'}
        </small>}
      </div>}
      <button className="ff-right-control" type="button" aria-pressed={inspectWithoutScan} disabled={!cage}
        onClick={() => setSurfaceOnly(!inspectWithoutScan)}>Surface Only</button>
      <div className="ff-mesh-row"><label htmlFor="freeform-surface-view">Surface View</label>
        <select id="freeform-surface-view" value={surfaceView} onChange={e => setSurfaceView(e.target.value as SurfaceView)}>
          <option value="solid">Solid</option><option value="solid-edges">Solid with edges</option><option value="transparent">Transparent</option>
        </select>
      </div>
      <label className="ff-transparency">Surface Transparency <input aria-label="Surface Transparency" type="range" dir="rtl" min="0" max="100" value={surfaceView === 'transparent' ? transparency : 0} onChange={e => {
        const value = e.currentTarget.valueAsNumber
        if (value > 0) { setTransparency(value); setSurfaceView('transparent') }
        else if (surfaceView === 'transparent') setSurfaceView('solid-edges')
      }} /></label>
      <div className="ff-mesh-row"><label htmlFor="freeform-mesh-display">Mesh Display</label>
        <select id="freeform-mesh-display" value={meshDisplay} onChange={e => setMeshDisplay(e.target.value === 'transparent' ? 'transparent' : 'offset')}>
          <option value="offset">Offset</option><option value="transparent">Transparent</option>
        </select>
      </div>
      {meshDisplay === 'offset'
        ? <label className="ff-mesh-row">Mesh Offset <input type="range" min="0" max="100" value={meshOffset} onChange={e => setMeshOffset(e.currentTarget.valueAsNumber)} /></label>
        : <label className="ff-mesh-row">Mesh Opacity <input type="range" min="0" max="100" value={meshOpacity} onChange={e => setMeshOpacity(e.currentTarget.valueAsNumber)} /></label>}
      <div className="ff-symmetry-row"><label><input type="checkbox" aria-label="Symmetry (planned)" disabled /> Symmetry</label><select aria-label="Symmetry plane (planned)" disabled><option value=""></option></select></div>
      <button type="button" className="ff-symmetry-set" data-test="freeform-set-symmetry" title="Symmetry-plane placement is planned" disabled>Set on Symmetry Plane</button>
      <small className="ff-planned-note">Symmetry controls are planned.</small>
      <label>Surface <select aria-label="Freeform surface" disabled={working} value={id ?? ''} onChange={e => { chooseTool('manipulate'); layer.current?.cancelPlacement(); placementVertices.current = []; setId(e.target.value === '' ? null : Number(e.target.value)); setCorners([]) }}><option value="">New Freeform</option>{state.features.filter((f): f is FreeformFeature => f.kind === 'freeform').map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <small data-test="freeform-status">{working ? 'Building surface…' : tool === 'rectangle' ? 'Pick opposite corners on the scan.' : cage && tool !== 'add-face' ? `${cage.faces.length} faces · ${selection.length} selected` : `Pick four corners on the scan (${corners.length}/4).`}</small>
      {error && <small role="alert">{error}</small>}
      <footer className="ff-editor-footer"><button type="button" className="ff-help-placeholder" aria-label="Freeform help (planned)" title="Freeform help is planned" disabled>?</button>
        <div className="ff-editor-history">
          <button type="button" title="Undo" aria-label="Undo" disabled={!state.canUndo() || working} onClick={()=>history(false)}><FreeformIcon name="undo" /><span className="ff-accessible-label">Undo</span></button>
          <button type="button" title="Redo" aria-label="Redo" disabled={!state.canRedo() || working} onClick={()=>history(true)}><FreeformIcon name="redo" /><span className="ff-accessible-label">Redo</span></button>
        </div>
        <button type="button" disabled={working} onClick={close}>Close</button></footer>
      </>}
    </form>
    {!!irregular.length && <button type="button" className="ff-irregular-warning" data-test="freeform-repair-boundary" disabled={working}
      onClick={() => {
        if (!cage || working) return
        try { void commit(repairBoundary(cage)) } catch (e) { setError((e as Error).message) }
      }}>The surface contains irregular points<br />Click here to repair.</button>}
    {displayOptions && <FreeformDeviationOptions tolerance={tolerance} colouring={colouring}
      onApply={setDeviationOptions} onClose={closeDisplayOptions} />}
    {menu && !menu.commands && <div role="toolbar" aria-label="Freeform contextual tools" className="ff-icon-toolbar ff-floating-tools" onMouseEnter={()=>{toolbarHover.current=true}} onMouseLeave={()=>{toolbarHover.current=false}} style={{position:'fixed',left:menu.x,top:Math.max(0,menu.y-28),display:'flex',gap:2,zIndex:10001}}>
        <button type="button" aria-label="Manipulate" title="Manipulate" aria-pressed={tool==='manipulate'} onClick={()=>chooseTool('manipulate')}><FreeformIcon name="select" /></button>
        <button type="button" aria-label="Extrapolate" title="Extrapolate" aria-pressed={tool==='extrapolate'} disabled={!cage || working} onClick={()=>chooseTool('extrapolate')}><FreeformIcon name="extrapolate" /></button>
        <button type="button" aria-label="Increase Resolution" title="Increase Resolution (Ctrl+R)" disabled={!cage || working} onClick={()=>cage && void commit(increaseResolution(cage))}><FreeformIcon name="resolution" /></button>
        <button type="button" aria-label="Smooth" title="Smooth (Q)" disabled={!cage?.faces.length || working} onClick={smoothSelection}><FreeformIcon name="smooth" /></button>
        <button type="button" aria-label="Snap to Mesh" title="Snap to Mesh" disabled={!cage?.faces.length || working} onClick={snapSelection}><FreeformIcon name="snap" /></button>
    </div>}
    {menu && menuText && <div ref={contextRef} role="menu" tabIndex={-1} onKeyDown={e => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return
      e.preventDefault(); e.stopPropagation()
      const buttons=Array.from(contextRef.current?.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)')??[])
      const index=buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:e.key==='ArrowDown'?(index+1)%buttons.length:index<0?buttons.length-1:(index-1+buttons.length)%buttons.length
      buttons[next]?.focus()
    }} className={menu.commands ? 'freeform-context-menu ff-native-menu ff-commands-menu' : 'freeform-context-menu ff-native-menu'} data-test="freeform-context" style={{ position: 'fixed', left: menu.x, top: menu.y, width: menu.commands ? 278 : 212, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100dvh - 38px)', overflowY: 'auto', boxSizing: 'border-box', padding: 4, display: 'grid', gap: 1, fontSize: 12, background: 'var(--panel, #25282c)', border: '1px solid #777', zIndex: 10000 }}>

      {menu.commands ? <>{visibilityItems}<hr />{commandButton('close_hole', true)}<hr />
        {(Object.keys(offsetCommands) as OffsetCommand[]).map(command => <button key={command} role="menuitem"
          disabled={working || !cage || (command === 'boundary' && !planes.length) || (command === 'primitives' && !primitives.length)}
          onClick={() => {
          setOffsetText(length.toDisplay(offsetCommands[command].initial).toFixed(length.decimals(3)))
          setMenu(null)
          setError('')
          setCommandDialog(command)
        }} title={offsetCommands[command].command}><span className="ff-offset-label">{offsetCommands[command].command}</span></button>)}
        <hr />
        <button role="menuitem" disabled={working || !cage} onClick={() => { setMenu(null); setCommandDialog('delete-all') }}>Delete All …</button>
      </> : <>
      <button role="menuitem" onClick={() => { scene?.fitToView(); setMenu(null) }}><span>Zoom to Fit</span><span className="ff-shortcut">A</span></button>
      <button role="menuitem" disabled={!state.canUndo() || working} onClick={() => history(false)}><span>Undo</span><span className="ff-shortcut">Ctrl+Z</span></button><button role="menuitem" disabled={!state.canRedo() || working} onClick={() => history(true)}><span>Redo</span><span className="ff-shortcut">Ctrl+Y</span></button>
      <hr />
      <button role="menuitem" disabled={!cage || selectedVertices(cage, selection).length < 2} onClick={() => alignScreen(true)}>Align Horizontally</button><button role="menuitem" disabled={!cage || selectedVertices(cage, selection).length < 2} onClick={() => alignScreen(false)}>Align Vertically</button>
      <button ref={selectionTrigger} role="menuitem" aria-haspopup="menu" aria-expanded={!!selectionMenu} aria-controls="freeform-selection-submenu" data-test="freeform-selection-submenu-trigger" onMouseEnter={() => openSelectionMenu(false)} onClick={() => openSelectionMenu()} onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); openSelectionMenu() } }}>Selection &#9656;</button>
      <button ref={manipTrigger} role="menuitem" aria-haspopup="menu" aria-expanded={!!manipMenu} aria-controls="freeform-manipulator-submenu" data-test="freeform-manipulator-submenu-trigger" onMouseEnter={() => openManipMenu(false)} onClick={() => openManipMenu()} onKeyDown={e=>{if(e.key==='ArrowRight'){e.preventDefault();openManipMenu()}}}>Manipulator ▸</button>
      <hr />
      {visibilityItems}
      <hr />
      {commandButton('crease', true)}{commandButton('remove_crease', true)}<hr />
      {commandButton('split', true)}{commandButton('bridge', true)}{commandButton('close_hole', true)}<hr />{commandButton('delete', true)}
      </>}
    </div>}
    {bridgeMessage && <div className="modalback ff-command-backdrop">
      <section className="modal ff-command-dialog" role="alertdialog" aria-modal="true" aria-label="Bridge Edges" aria-describedby="freeform-bridge-message">
        <p id="freeform-bridge-message">{bridgeMessage}</p>
        <footer><button type="button" autoFocus onClick={() => setBridgeMessage(null)}>OK</button></footer>
      </section>
    </div>}
    {commandDialog === 'delete-all' && <div className="modalback ff-command-backdrop">
      <section className="modal ff-command-dialog" role="alertdialog" aria-modal="true" aria-label="Delete all Freeform faces">
        <p>Are you sure you want to delete all faces?</p>
        <footer>
            <button type="button" onClick={() => { setCommandDialog(null); chooseTool('manipulate'); void commit(empty(), [], snap, snapType, false) }}>Yes</button>
          <button type="button" autoFocus onClick={() => setCommandDialog(null)}>No</button>
        </footer>
      </section>
    </div>}
    {offsetDialog && <div className="modalback ff-command-backdrop">
      <form className="modal ff-command-dialog" role="dialog" aria-modal="true" aria-label={offsetDialog.title} onSubmit={event => { event.preventDefault(); applyOffset() }}>
        <h3>{offsetDialog.title}</h3>
        <label>{offsetDialog.field} <input autoFocus type="number" min={commandDialog === 'offset' ? undefined : 0} step="any" required value={offsetText} onFocus={event => event.currentTarget.select()} onChange={event => setOffsetText(event.target.value)} /> {length.word()}</label>
        <footer><button type="submit">OK</button><button type="button" onClick={() => setCommandDialog(null)}>Cancel</button></footer>
      </form>
    </div>}
    {menu && manipMenu && <div ref={manipPopup} id="freeform-manipulator-submenu" role="menu" aria-label="Manipulator" data-test="freeform-manipulator-submenu" className="freeform-context-menu ff-native-menu" style={{position:'fixed',left:manipMenu.x,top:manipMenu.y,width:130,maxWidth:'calc(100vw - 16px)',maxHeight:`calc(100dvh - ${manipMenu.y+8}px)`,overflowY:'auto',display:'grid',zIndex:10001}} onKeyDown={e=>{
      const buttons=Array.from(manipPopup.current?.querySelectorAll<HTMLButtonElement>('button')??[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement)
      if(e.key==='ArrowLeft'){e.preventDefault();setManipMenu(null);manipTrigger.current?.focus()}
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}
    }}>{(['world','screen','local'] as const).map(f=><button key={f} role="menuitemradio" disabled={snap} aria-checked={frame===f} onClick={()=>{setFrame(f);setMenu(null)}}>{frame===f?'✓ ':'　'}{f[0].toUpperCase()+f.slice(1)}</button>)}</div>}
    {menu && selectionMenu && <div ref={selectionPopup} id="freeform-selection-submenu" role="menu" aria-label="Selection" data-test="freeform-selection-submenu" className="freeform-context-menu ff-native-menu" style={{ position: 'fixed', left: selectionMenu.x, top: selectionMenu.y, width: 166, maxWidth: 'calc(100vw - 16px)', maxHeight: `calc(100dvh - ${selectionMenu.y + 8}px)`, overflowY: 'auto', boxSizing: 'border-box', padding: 4, display: 'grid', gap: 1, fontSize: 10, background: 'var(--panel, #25282c)', border: '1px solid #777', zIndex: 10001 }} onKeyDown={e => {
      const buttons = Array.from(selectionPopup.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
      if (e.key === 'ArrowLeft') { e.preventDefault(); setSelectionMenu(null); selectionTrigger.current?.focus() }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault()
        buttons[e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }}>
      {selectionModes.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={mode === option.value} data-test={`freeform-selection-${option.value}`} onClick={() => pickMode(option.value)}>{mode === option.value ? '\u2713 ' : '\u3000'}{option.label}</button>)}
    </div>}
  </div>
}
