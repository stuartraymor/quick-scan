// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { useShell } from '../../../src/state/shellStore'
import * as THREE from 'three'
import type { Vec3 } from '../../../src/core/types'
import { change } from '../app/reCommandCore'
import { reverseSession } from '../app/reSession'
import { scanPaths } from '../app/reNetworkCommands'
import type { FreeformFeature } from '../core/features'
import { type Cage, topology, vertexAt } from '../core/freeform/cage'
import { addFace, increaseResolution, smooth } from '../core/freeform/edit'
import { regionClosestIn } from '../core/freeform/wrap'
import { applyEditorAction, editorActions, selectedVertices, type EditorAction, type FreeformSelection } from '../core/freeform/editor'
import { useReverse } from '../state/reStore'
import { FreeformEditorLayer, type FreeformSelectionMode } from '../viewer/freeformEditorLayer'
import { reSceneOf } from '../viewer/reScene'
import { FreeformIcon } from './FreeformIcon'
import './freeformControls.css'
import type { ManipulatorFrame } from '../viewer/freeformManipulator'
import { useFreeformNavigation } from './useFreeformNavigation'

export const useFreeformEditor = create<{ open: boolean; controlNet: boolean; setControlNet(value:boolean):void; setOpen(open: boolean): void }>(set => ({ open: false, controlNet:true, setControlNet:controlNet=>set({controlNet}), setOpen: open => set({ open }) }))
const empty = (): Cage => ({ positions: new Float64Array(), faces: [], creases: [] })
const fromFeature = (f: FreeformFeature): Cage => ({ positions: Float64Array.from(f.positions), faces: f.faces.map(x => [...x]), creases: f.creases.map(e => [...e]) })
const labels: Record<EditorAction, string> = { split: 'Split', bridge: 'Bridge Edges', close_hole: 'Close 4-sided hole', crease: 'Crease', remove_crease: 'Remove Crease', delete: 'Delete' }
const FREEFORM_SCAN_TINT = [230, 215, 185] as const

const selectionModes: { value: FreeformSelectionMode; label: string }[] = [
  { value: 'points-edges', label: 'Points / Edges' }, { value: 'points', label: 'Points only' },
  { value: 'edges', label: 'Edges only' }, { value: 'faces', label: 'Faces only' }, { value: 'all', label: 'Point / Edge / Face' }, { value: 'boundary', label: 'Boundary' },
]

/** The panel owns editing state; committed cages use the existing document history. */
export function FreeformEditor() {
  const backdrop = useFreeformNavigation(true)
  const state = useReverse()
  const [id, setId] = useState<number | null>(null)
  const feature = state.features.find(f => f.id === id && f.kind === 'freeform') as FreeformFeature | undefined
  const cage = useMemo(() => feature ? fromFeature(feature) : null, [feature])
  const selectionHistory = useRef(new WeakMap<FreeformFeature, FreeformSelection[]>())
  const [picked, setPicked] = useState<{ feature: FreeformFeature | undefined; items: FreeformSelection[] }>({ feature, items: [] })
  const selection = picked.feature === feature ? picked.items : feature ? selectionHistory.current.get(feature) ?? [] : []
  const setSelection = (items: FreeformSelection[]) => setPicked({ feature, items })
  const [mode, setMode] = useState<FreeformSelectionMode>('points-edges')
  const [corners, setCorners] = useState<Vec3[]>([])
  const [hidden, setHidden] = useState<number[]>([])
  const [duplicate, setDuplicate] = useState(true)
  const [tool, setTool] = useState<'manipulate' | 'extrapolate'>('manipulate')
  const [menuText, setMenuText] = useState(true)
  const toolbarHover = useRef(false)
  const [strength, setStrength] = useState(100)
  const [neighbours, setNeighbours] = useState(false)
  const [snap, setSnap] = useState(true)
  const controlNet=useFreeformEditor(s=>s.controlNet), setControlNet=useFreeformEditor(s=>s.setControlNet)
  const [opacity, setOpacity] = useState(.72)
  const [frame, setFrame] = useState<ManipulatorFrame>('local')
  const [manipMenu, setManipMenu] = useState<{x:number;y:number} | null>(null)
  const manipTrigger = useRef<HTMLButtonElement>(null)
  const manipPopup = useRef<HTMLDivElement>(null)
  const [pending, setWorking] = useState(false)
  const working = pending || state.building
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; hit: boolean } | null>(null)
  const contextRef = useRef<HTMLDivElement>(null)
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
  const layer = useRef<FreeformEditorLayer | null>(null)
  const busy = useRef(false)
  const alive = useRef(true)
  const current = useRef({ cage, id, selection, corners, working })
  current.current = { cage, id, selection, corners, working }
  const scene = reverseSession()?.sceneRef.current
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
    scene.setScanOpacityOverride(cage ? 0.85 : 1)
    return () => scene.setScanOpacityOverride(null)
  }, [scene, Boolean(cage)])
  const available = cage ? editorActions(cage, selection) : null
  const close = () => { if (!busy.current) useFreeformEditor.getState().setOpen(false) }
  useEffect(() => {
    const wasOpen = useShell.getState().inspectorOpen
    useShell.getState().setInspectorOpen(false)
    return () => { useShell.getState().setInspectorOpen(wasOpen) }
  }, [])
  async function commit(next: Cage, nextSelection: FreeformSelection[] = [], snapMode = snap) {
    if (busy.current || useReverse.getState().building) return
    const target = current.current.id
    busy.current = true; setWorking(true); setError(''); setMenu(null)
    try {
      topology(next)
      if (next.faces.length > 200_000) throw new Error('The cage exceeds the 200,000-face editing limit.')
      const data = { positions: Array.from(next.positions), faces: next.faces, creases: next.creases }
      const result = await change(() => {
        const st = useReverse.getState()
        if (target === null) {
          const created = st.addFreeform({ ...data, steps: 2, snap: snapMode })
          // A failed kernel build retains its document feature for Undo.
          // Keep that feature selected rather than creating it again on retry.
          if (alive.current) { setId(created); setCorners([]) }
          return created
        }
        if (feature) selectionHistory.current.set(feature, current.current.selection)
        if (!st.updateFreeform(target, { ...data, snap: snapMode, fromSketch: undefined })) throw new Error('The surface is no longer available.')
        const edited = useReverse.getState().features.find(f => f.id === target)
        if (edited?.kind === 'freeform') selectionHistory.current.set(edited, nextSelection)
        return target
      })
      if (alive.current) { setId(result); setCorners([]); if(!cage || cage.positions.length!==next.positions.length || JSON.stringify(cage.faces)!==JSON.stringify(next.faces)) setHidden([]) }
      const built = useReverse.getState().results[result]
      if (built?.status === 'failed' && alive.current) setError(`The cage was saved, but its CAD surface could not be built: ${built.message ?? 'Build failed'}. Undo is available.`)
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : String(e)) }
    finally { busy.current = false; if (alive.current) setWorking(false) }
  }
  const snapMode = (on: boolean) => { if (busy.current || on === snap) return; setSnap(on); if (cage) void commit(cage, selection, on) }
  function action(name: EditorAction) {
    if (!cage || busy.current) return
    try { const result = applyEditorAction(cage, selection, name); void commit(result.cage, name === 'crease' ? [] : result.selection) }
    catch (e) { setError((e as Error).message) }
  }
  function smoothSelection() {
    if (!cage || working || !selection.length) return
    try {
      const next = smooth(cage, selectedVertices(cage, selection))
      setMenu(null)
      if (next.positions.some((v,i)=>Math.abs(v-cage.positions[i])>1e-12)) void commit(next, selection)
    } catch(e) { setError((e as Error).message) }
  }
  function snapSelection() {
    if (!cage || working || !selection.length) return
    try {
      const session=reverseSession()
      if (!session) throw new Error('The reference mesh is unavailable.')
      const positions=cage.positions.slice(), paths=scanPaths(session)
      for(const index of selectedVertices(cage,selection)) {
        const result=paths.closest(vertexAt(cage,index))
        if(!result?.point?.every(Number.isFinite)) throw new Error('No reference mesh point was found for this selection.')
        positions.set(result.point,index*3)
      }
      setMenu(null)
      if(positions.some((v,i)=>Math.abs(v-cage.positions[i])>1e-12)) void commit({...cage,positions},selection)
    } catch(e) { setError((e as Error).message) }
  }
  const chooseTool = (value: typeof tool) => {setTool(value);setMenu(null)}
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
    const points = ids.map(i => host.partGroup.localToWorld(new THREE.Vector3(...vertexAt(cage, i))))
    const mean = points.reduce((a, p) => a + p.dot(axis), 0) / points.length
    const positions = cage.positions.slice()
    points.forEach((p, n) => { p.addScaledVector(axis, mean - p.dot(axis)); host.partGroup.worldToLocal(p); positions.set(p.toArray(), ids[n] * 3) })
    void commit({ ...cage, positions }, selection)
  }
  useEffect(() => {
    alive.current = true
    if (!scene) return
    const editor = new FreeformEditorLayer(scene.layerHost()); layer.current = editor
    const remove = scene.addLayer(editor.layer())
    return () => { alive.current = false; remove(); layer.current = null }
  }, [scene])
  useEffect(() => {
    if (!scene || !layer.current) return
    const editor = layer.current
    editor.set(cage, {
      enabled: !working, extrapolate: tool === 'extrapolate', mode, selection, hiddenFaces: hidden, duplicateHandle: duplicate, controlNet, opacity, manipulator: snap ? undefined : frame,
      strength: strength / 100, neighbourRadius: neighbours ? 0 : scene.layerHost().modelRadius() * .1,
      creating: !cage && !working,
      onSelection: picks => { setSelection(picks); setMenu(null) },
      onContext: (x, y, hit) => {toolbarHover.current=false;setMenuText(true);setMenu({ x, y, hit: !!hit || selection.length > 0 })},
      onCommit: (next, picks) => { if (!busy.current) void commit(next, picks) },
      onError: e => setError(e.message),
      onCreatePoint: point => {
        if (busy.current) return
        const next = [...current.current.corners, point]
        if (next.length === 4) { try { void commit(addFace(empty(), next)) } catch (e) { setError((e as Error).message); setCorners([]) } }
        else setCorners(next)
      },
      snapPoint: snap ? point => {
        const session = reverseSession()
        if (!session) return null
        const closest = (p: Vec3) => scanPaths(session).closest(p)
        return (feature?.snapRegion ? regionClosestIn(feature.snapRegion, closest)(point) : closest(point))?.point ?? null
      } : undefined,
    })
    // The editable subdivision display replaces this feature's committed body.
    const view = reSceneOf(scene)
    const ids = state.bodies.filter(b => Math.floor(b.id) === id).map(b => b.id)
    view.setEditingBodies(ids)
    return () => { view.setEditingBodies([]) }
  }, [scene, cage, tool, mode, selection, hidden, duplicate, strength, neighbours, snap, frame, controlNet, opacity, working, state.bodies])
  useEffect(() => { setPicked({ feature, items: feature ? selectionHistory.current.get(feature) ?? [] : [] }); setMenu(null) }, [feature])
  const topologyKey=cage?JSON.stringify([cage.positions.length,cage.faces]):''
  useEffect(()=>{setHidden([])},[id,topologyKey])
  useEffect(() => {
    if (id !== null && !feature && !working) { setId(null); setCorners([]) }
  }, [id, feature, working])
  useEffect(() => { if (feature) setSnap(feature.snap) }, [id, feature?.snap])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
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
        if (manipMenu) {setManipMenu(null);manipTrigger.current?.focus()}
        else if (selectionMenu) { setSelectionMenu(null); selectionTrigger.current?.focus() }
        else if(menu && menuText && toolbarHover.current) {setMenuText(false)}
        else { setMenu(null); setCorners([]) }
        return
      }
      if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); scene?.fitToView(); setMenu(null); return }
      if(e.key.toLowerCase()==='q' && !e.ctrlKey && !e.metaKey && !e.altKey) {e.preventDefault();e.stopImmediatePropagation();smoothSelection();return}
      const command = e.key.toLowerCase() === 's' ? 'split' : e.key.toLowerCase() === 'd' ? 'bridge' : e.key === 'Delete' ? 'delete' : null
      if (command && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); action(command) }
    }
    document.addEventListener('keydown', key, true)
    return () => document.removeEventListener('keydown', key, true)
  }, [cage, selection, selectionMenu, manipMenu, menu, menuText, working])
  const history = (redo: boolean) => { if (busy.current || useReverse.getState().building) return; setMenu(null); redo ? state.redoFeatures() : state.undoFeatures() }
  const pickMode = (value: typeof mode) => { setMode(value); setSelectionMenu(null); setMenu(null) }
  const commandButtons = (context = false) => (['crease', 'remove_crease', 'split', 'bridge', 'close_hole', 'delete'] as EditorAction[]).flatMap(name => [...(context && ['split','delete'].includes(name) ? [<hr key={`separator-${name}`} />] : []), <button key={name} type="button" role={context ? 'menuitem' : undefined} data-test={`freeform-${name}`} aria-label={labels[name]} title={labels[name]} disabled={working || !available?.[name]} onClick={() => action(name)}>{context ? <><span>{labels[name]}</span><span className="ff-shortcut">{name === 'split' ? 'S' : name === 'delete' ? 'Del' : name === 'bridge' ? 'D' : ''}</span></> : <FreeformIcon name={name} />}</button>])
  return <div ref={backdrop} className="modalback" data-test="freeform-editor" style={{ background: 'transparent', alignItems: 'flex-start', justifyContent: 'flex-start', paddingTop: 'min(176px, 25dvh)', paddingLeft: 'min(224px, max(8px, calc(100vw - 306px)))' }} onPointerDown={e => { if (e.target === e.currentTarget) setMenu(null) }}>
    <form tabIndex={-1} className="modal ff-editor" role="dialog" aria-label="Edit Surface" style={{ width: 290, maxHeight: 'calc(100dvh - min(176px, 25dvh) - 8px)', boxSizing: 'border-box', overflowY: 'auto', padding: 12, display: 'grid', gap: 8 }} onSubmit={e => e.preventDefault()} onKeyDown={e => e.stopPropagation()}>
      <header className="ff-title"><span>Edit Surface</span><button type="button" aria-label="Close Edit Surface" disabled={working} onClick={close}>×</button></header>
      <div className="ff-main-tools" role="toolbar" aria-label="Surface editing tools">
        <div className="ff-icon-toolbar"><button type="button" aria-label="Manipulate" title="Manipulate" aria-pressed={tool==='manipulate'} onClick={()=>chooseTool('manipulate')}><FreeformIcon name="select" /></button>{selectionModes.slice(1,4).map(m => <button type="button" key={m.value} title={m.label} aria-label={m.label} aria-pressed={mode===m.value} onClick={()=>pickMode(m.value)}><FreeformIcon name={m.value==='points-edges'?'select':m.value} /></button>)}
        <button type="button" title="Align Horizontally" aria-label="Align Horizontally" disabled={!cage || selectedVertices(cage,selection).length<2 || working} onClick={()=>alignScreen(true)}><FreeformIcon name="align-h" /></button>
        <button type="button" title="Align Vertically" aria-label="Align Vertically" disabled={!cage || selectedVertices(cage,selection).length<2 || working} onClick={()=>alignScreen(false)}><FreeformIcon name="align-v" /></button>
        <button type="button" title="Increase Resolution" aria-label="Increase Resolution" disabled={!cage || working} onClick={()=>cage && void commit(increaseResolution(cage))}><FreeformIcon name="faces" /></button>
        <button type="button" title="Undo" aria-label="Undo" disabled={!state.canUndo() || working} onClick={()=>history(false)}><FreeformIcon name="undo" /><span className="ff-accessible-label">Undo</span></button>
        <button type="button" title="Redo" aria-label="Redo" disabled={!state.canRedo() || working} onClick={()=>history(true)}><FreeformIcon name="redo" /><span className="ff-accessible-label">Redo</span></button></div>
        <div className="ff-icon-toolbar">
        <button type="button" aria-label="Extrapolate" title="Extrapolate" aria-pressed={tool==='extrapolate'} disabled={!cage || working} onClick={()=>chooseTool('extrapolate')}><FreeformIcon name="extrapolate" /></button>

        <button type="button" aria-label="Smooth" title="Smooth (Q)" disabled={!selection.length || working} onClick={smoothSelection}><FreeformIcon name="smooth" /></button>
        <button type="button" aria-label="Snap to Mesh" title="Snap to Mesh" disabled={!selection.length || working} onClick={snapSelection}><FreeformIcon name="snap" /></button>{commandButtons()}</div>
      </div>
      {feature?.fromSketch && <small>Manual edits detach this surface from its generating sketch.</small>}
      <label>Selection <select aria-label="Freeform selection" value={mode} onChange={e => pickMode(e.target.value as typeof mode)}>{selectionModes.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label>Drag Strength <input aria-label="Drag Strength" type="range" min="0" max="100" value={strength} onChange={e => setStrength(Number(e.target.value))} /></label>
      <div className="ff-snap-row"><span>Snap Mode</span><span><button type="button" disabled={working} aria-pressed={!snap} onClick={() => snapMode(false)}>OFF</button> <button type="button" disabled={working} aria-pressed={snap} onClick={() => snapMode(true)}>ON</button></span></div>
      {snap ? <label>Snapping Type <select aria-label="Snapping Type" value="closest" onChange={()=>{}}><option value="closest">Closest Point</option></select></label> : <label>Manipulator <select aria-label="Manipulator" value={frame} onChange={e=>setFrame(e.target.value as ManipulatorFrame)}>{['world','screen','local'].map(f=><option key={f} value={f}>{f[0].toUpperCase()+f.slice(1)}</option>)}</select></label>}
      <label><input type="checkbox" checked={duplicate} onChange={e => setDuplicate(e.target.checked)} /> Show DUPLICATE handle</label>
      <label><input type="checkbox" checked={neighbours} onChange={e => setNeighbours(e.target.checked)} /> Don't move neighbours</label>
      <button className="ff-right-control" type="button" aria-pressed={controlNet} onClick={() => setControlNet(!controlNet)}>Control Net</button>
      <div className="ff-editor-display" role="group" aria-label="Surface display">
        <button type="button" className="ff-display-current" data-test="freeform-display-shaded" aria-label="Shaded display (current)" aria-pressed="true" disabled><FreeformIcon name="shaded" /></button>
        <button type="button" data-test="freeform-display-deviation" aria-label="Tolerance display (planned)" title="Tolerance display is planned" disabled><FreeformIcon name="deviation" /></button>
        <button type="button" data-test="freeform-display-zebra" aria-label="Zebra and shadow display (planned)" title="Zebra and shadow display is planned" disabled><FreeformIcon name="zebra" /></button>
        <button type="button" className="ff-display-options" data-test="freeform-display-options" title="Surface display options are planned" disabled>Options …</button>
      </div>
      <label className="ff-transparency">Surface Transparency <input aria-label="Surface Transparency" type="range" min="0" max="100" value={Math.round((1-opacity)*100)} onChange={e => setOpacity(1-Number(e.target.value)/100)} /></label>
      <div className="ff-mesh-row"><label htmlFor="freeform-mesh-display">Mesh Display</label><select id="freeform-mesh-display" aria-label="Mesh Display (planned)" disabled><option>Offset</option></select></div>
      <div className="ff-mesh-row ff-mesh-shading"><select aria-label="Mesh shading (planned)" disabled><option>Shaded</option></select><input aria-label="Mesh display level (planned)" type="range" min="0" max="100" defaultValue="70" disabled /></div>
      <div className="ff-symmetry-row"><label><input type="checkbox" aria-label="Symmetry (planned)" disabled /> Symmetry</label><select aria-label="Symmetry plane (planned)" disabled><option value=""></option></select></div>
      <button type="button" className="ff-symmetry-set" data-test="freeform-set-symmetry" title="Symmetry-plane placement is planned" disabled>Set on Symmetry Plane</button>
      <small className="ff-planned-note">Tolerance, mesh display and symmetry controls are planned.</small>
      <label>Surface <select aria-label="Freeform surface" disabled={working} value={id ?? ''} onChange={e => { setId(e.target.value === '' ? null : Number(e.target.value)); setCorners([]) }}><option value="">New Freeform</option>{state.features.filter((f): f is FreeformFeature => f.kind === 'freeform').map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      <small data-test="freeform-status">{working ? 'Building surface…' : cage ? `${cage.faces.length} faces · ${selection.length} selected` : `Pick four corners on the scan (${corners.length}/4).`}</small>
      {error && <small role="alert">{error}</small>}
      <footer className="ff-editor-footer"><button type="button" className="ff-help-placeholder" aria-label="Freeform help (planned)" title="Freeform help is planned" disabled>?</button><button type="button" disabled={working} onClick={close}>Close</button></footer>
    </form>
    {menu?.hit && <div role="toolbar" aria-label="Freeform contextual tools" className="ff-icon-toolbar ff-floating-tools" onMouseEnter={()=>{toolbarHover.current=true}} onMouseLeave={()=>{toolbarHover.current=false}} style={{position:'fixed',left:menu.x,top:Math.max(0,menu.y-28),display:'flex',gap:2,zIndex:10001}}>
        <button type="button" aria-label="Manipulate" title="Manipulate" aria-pressed={tool==='manipulate'} onClick={()=>chooseTool('manipulate')}><FreeformIcon name="select" /></button>
        <button type="button" aria-label="Extrapolate" title="Extrapolate" aria-pressed={tool==='extrapolate'} disabled={!cage || working} onClick={()=>chooseTool('extrapolate')}><FreeformIcon name="extrapolate" /></button>
        <button type="button" aria-label="Increase Resolution" title="Increase Resolution (Ctrl+R)" disabled={!cage || working} onClick={()=>cage && void commit(increaseResolution(cage))}><FreeformIcon name="resolution" /></button>
        <button type="button" aria-label="Smooth" title="Smooth (Q)" disabled={!selection.length || working} onClick={smoothSelection}><FreeformIcon name="smooth" /></button>
        <button type="button" aria-label="Snap to Mesh" title="Snap to Mesh" disabled={!selection.length || working} onClick={snapSelection}><FreeformIcon name="snap" /></button>
    </div>}
    {menu && menuText && <div ref={contextRef} role="menu" tabIndex={-1} onKeyDown={e => {
      if (!['ArrowDown','ArrowUp','Home','End'].includes(e.key)) return
      e.preventDefault(); e.stopPropagation()
      const buttons=Array.from(contextRef.current?.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)')??[])
      const index=buttons.indexOf(document.activeElement as HTMLButtonElement)
      const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:e.key==='ArrowDown'?(index+1)%buttons.length:index<0?buttons.length-1:(index-1+buttons.length)%buttons.length
      buttons[next]?.focus()
    }} className="freeform-context-menu ff-native-menu" data-test="freeform-context" style={{ position: 'fixed', left: menu.x, top: menu.y, width: 212, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100dvh - 38px)', overflowY: 'auto', boxSizing: 'border-box', padding: 4, display: 'grid', gap: 1, fontSize: 12, background: 'var(--panel, #25282c)', border: '1px solid #777', zIndex: 10000 }}>

      <button role="menuitem" onClick={() => { scene?.fitToView(); setMenu(null) }}><span>Zoom to Fit</span><span className="ff-shortcut">A</span></button>
      <button role="menuitem" disabled={!state.canUndo() || working} onClick={() => history(false)}><span>Undo</span><span className="ff-shortcut">Ctrl+Z</span></button><button role="menuitem" disabled={!state.canRedo() || working} onClick={() => history(true)}><span>Redo</span><span className="ff-shortcut">Ctrl+Y</span></button>
      <hr />
      <button role="menuitem" disabled={!cage || selectedVertices(cage, selection).length < 2} onClick={() => alignScreen(true)}>Align Horizontally</button><button role="menuitem" disabled={!cage || selectedVertices(cage, selection).length < 2} onClick={() => alignScreen(false)}>Align Vertically</button>
      <button ref={selectionTrigger} role="menuitem" aria-haspopup="menu" aria-expanded={!!selectionMenu} aria-controls="freeform-selection-submenu" data-test="freeform-selection-submenu-trigger" onMouseEnter={() => openSelectionMenu(false)} onClick={() => openSelectionMenu()} onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); openSelectionMenu() } }}>Selection &#9656;</button>
      <button ref={manipTrigger} role="menuitem" aria-haspopup="menu" aria-expanded={!!manipMenu} aria-controls="freeform-manipulator-submenu" data-test="freeform-manipulator-submenu-trigger" onMouseEnter={() => openManipMenu(false)} onClick={() => openManipMenu()} onKeyDown={e=>{if(e.key==='ArrowRight'){e.preventDefault();openManipMenu()}}}>Manipulator ▸</button>
      <hr />
      <button role="menuitem" disabled={!selection.length} onClick={() => visibility(true)}>Isolate</button><button role="menuitem" disabled={!selection.length} onClick={() => visibility(false)}>Hide Selected</button><button role="menuitem" onClick={() => { if (hidden.length) setHidden([]); setMenu(null) }}>Show Hidden</button>
      <hr />
      {commandButtons(true)}
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
