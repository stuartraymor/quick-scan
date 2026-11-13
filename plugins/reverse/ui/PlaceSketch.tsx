// SPDX-License-Identifier: AGPL-3.0-only
// "Create Sketch": the stage before a sketch is drawn, as in QUICKSURFACE's 2D
// Sketch dialog (Pro 8.0.127 photos). The plane is chosen — OXY / OYZ / OXZ,
// or picked from the planes and sections already made — and carried through
// the part by the offset or by dragging the yellow arrow, with the scan's cut
// outlined in yellow where it lies. Create opens the sketch editor on that
// plane; Create & Stay makes the sketch from the cut there and stays, for the
// next. Stacked sections collect projected reference points into ONE sketch;
// fitting remains an explicit later operation in the sketch editor.

import { useSectionLine } from '../state/sectionLineStore'
import { useEffect, useRef, useState } from 'react'
import { useReverse } from '../state/reStore'
import { planeAtOffset, planeOffset, planeTakesOffset, type PlaneRef } from '../core/features'
import { placementPlaneRef, resolvePlaneFrame } from '../core/resolve'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { PlaneSelect } from './PlaneSelect'
import { usePlacePick } from '../state/placePickStore'
import { createPortal } from 'react-dom'
import { cornerBoxPlace } from '../../../src/ui/cornerBox'
import { commandHost } from '../../../src/commands/host'
import { cloneSketch } from '../core/sketch'
import { clipChainsToRect, collectExtrudedReference, ReferenceCancelled, stackExtentOf, type StackExtent } from '../core/stackedReference'
import { useStack } from '../state/stackStore'
import { chainsOfEdges } from '../core/segment'
import { longChains } from '../core/selectionCut'
import { projectCut } from '../../../src/core/section/slice'
import { sectionModeKey } from '../core/selectionCut'
import type { SketchChains } from '../app/useReverseWorkspace'
import { frameKey } from '../../../src/core/section/frame'
import type { Vec2 } from '../../../src/core/flat/types'

const TILES: { axis: 'z' | 'x' | 'y'; label: string; title: string }[] = [
  { axis: 'z', label: '(OXY)', title: 'A plane parallel to OXY — normal along Z' },
  { axis: 'x', label: '(OYZ)', title: 'A plane parallel to OYZ — normal along X' },
  { axis: 'y', label: '(OXZ)', title: 'A plane parallel to OXZ — normal along Y' },
]

const world = (plane: PlaneRef) => (plane.kind === 'world' ? plane : null)
const AXES: { axis: 'x' | 'y' | 'z'; label: string; title: string }[] = [
  { axis: 'x', label: 'X Axis', title: 'Revolve about the X axis: the sketch plane passes through it' },
  { axis: 'y', label: 'Y Axis', title: 'Revolve about the Y axis: the sketch plane passes through it' },
  { axis: 'z', label: 'Z Axis', title: 'Revolve about the Z axis: the sketch plane passes through it' },
]
/** A plane through a coordinate axis, turned about it — QUICKSURFACE's
 *  "For Revolved Surface" plane. */
const radialOn = (axis: 'x' | 'y' | 'z', angleDeg = 0): PlaneRef => ({ kind: 'radial', axis: { kind: 'world', axis }, angleDeg })
/** Aligned parts use their coordinate origin. Before alignment the middle
 * of an arbitrarily positioned scan gives a useful initial section. */
export const throughPart = (axis: 'x' | 'y' | 'z'): PlaneRef => {
  const store = useStore.getState()
  const c = store.fileName && store.appliedAlignment === null ? store.modelCenter : [0, 0, 0]
  return { kind: 'world', axis, offset: c[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] }
}
const placing = () => useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, placing: true } } : {}))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Wait for the slice chains of the sketch draft as it stands now. */
async function chainsNow(chainsOf: () => SketchChains | null): Promise<Vec2[][] | null> {
  const version = useReverse.getState().chainsVersion
  const draft = useReverse.getState().sketchDraft
  const { throughSelection, outline, outlineMinPoints } = useSectionLine.getState()
  const modes = sectionModeKey(throughSelection, outline, outlineMinPoints)
  const expected = draft ? `${JSON.stringify(draft.plane)}|${frameKey(draft.frame)}|${draft.level ?? 0}${modes}` : null
  for (let i = 0; i < 400; i++) {
    const s = useReverse.getState()
    if (s.sketchDraft !== draft) return null
    if (s.chainsStatus === 'failed') return null
    const chains = chainsOf()
    if (s.chainsStatus === 'ready' && chains && chains.key === expected && (s.chainsVersion !== version || i > 2)) return chains.chains
    await sleep(50)
  }
  return null
}

/** Original coordinate-plane glyphs; the highlighted sheet identifies the normal. */
function PlaneTile({ axis }: { axis: 'x' | 'y' | 'z' }) {
  const sheets = { z: '4,19 15,13 27,20 16,27', x: '15,4 15,18 27,25 27,11', y: '4,10 15,4 15,18 4,25' }
  return <svg className="plane-tile-icon" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
    <path d="M15 18 29 26 M15 18 2 25 M15 18V2" fill="none" stroke="#777" strokeWidth=".8" />
    <polygon points={sheets[axis]} fill="#d5d0c6" stroke="#777" strokeWidth=".7" />
    <text x="26" y="31" fontSize="6" fill="#555">X</text><text x="0" y="29" fontSize="6" fill="#555">Y</text><text x="17" y="6" fontSize="6" fill="#555">Z</text>
  </svg>
}

export function PlaceSketch({ chainsOf }: { chainsOf: () => SketchChains | null }) {
  const draft = useReverse((s) => s.sketchDraft)
  const len = useLength()
  const [typed, setTyped] = useState<string | null>(null)
  const [onSlicingPlane, setOnSlicingPlane] = useState(true)
  const stacked = useStack((s) => s.on), count = useStack((s) => s.count), upper = useStack((s) => s.upper), lower = useStack((s) => s.lower), rect = useStack((s) => s.rect)
  const setStacked = (on: boolean) => useStack.getState().setOn(on)
  const setCount = (n: number) => useStack.getState().setCount(n)
  const [hideScan, setHideScan] = useState(false)
  const [ignoreScan, setIgnoreScan] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  const sectionLine = useSectionLine()
  const [referenceMessage, setReferenceMessage] = useState<string | null>(null)
  const run = useRef(0)
  const appliedStack = useRef<string | null>(null)
  const stackKeyRef = useRef<(() => string) | null>(null)
  const collectStack = useRef<(() => Promise<boolean>) | null>(null)
  const previousFrame = useRef<string | null>(null)
  const [typedAngle, setTypedAngle] = useState<string | null>(null)
  // The upper plane's distance as typed: kept while the field is in use, so a
  // half-typed "12." is not tidied away under the cursor.
  const [upperText, setUpperText] = useState<string | null>(null)
  const [lowerText, setLowerText] = useState<string | null>(null)
  useEffect(() => () => { run.current++ }, [])
  // Leaving Create Sketch puts the stack's planes away.
  useEffect(() => () => useStack.getState().setOn(false), [])
  const pickArmed = usePlacePick((s) => s.armed)
  const picked = usePlacePick((s) => s.picked)
  // Leaving Create Sketch lets go of an armed pick.
  useEffect(() => () => usePlacePick.getState().setArmed(false), [])
  // A plane clicked in the view while "Pick ..." is armed becomes the plane.
  const placeRef = useRef<((ref: PlaneRef) => void) | null>(null)
  useEffect(() => { if (picked) { const ref = usePlacePick.getState().take(); if (ref) placeRef.current?.(ref) } }, [picked])
  const currentFrame = draft?.placing ? frameKey(draft.frame) : null
  useEffect(() => {
    previousFrame.current = currentFrame
    if (!currentFrame || !stacked || ignoreScan || draft?.plane.kind === 'radial') return
    run.current++; setWorking(null); appliedStack.current = null
    // Live: the cuts follow either plane and the count, collected again once
    // the drag or the typing settles; no per-slice feature/history revisions.
    // Skipped when Apply has already cut this very stack meanwhile.
    const timer = setTimeout(() => { if (appliedStack.current !== stackKeyRef.current?.()) void collectStack.current?.() }, 250)
    return () => clearTimeout(timer)
  }, [currentFrame, stacked, ignoreScan, count, upper, lower, rect, sectionLine.outline, sectionLine.outlineMinPoints])
  if (!draft?.placing) return null
  const re = useReverse.getState()
  const plane = world(draft.plane)
  const offset = planeOffset(draft.plane)
  const radial = draft.plane.kind === 'radial' ? draft.plane : null
  const radialAxis = radial && radial.axis.kind === 'world' ? radial.axis.axis : null
  const pendingOffset = typed !== null && typed.trim() !== '' ? len.fromDisplay(Number(typed)) : NaN
  const canApplyOffset = Number.isFinite(pendingOffset) && pendingOffset !== offset
  const commitAngle = () => {
    run.current++; setWorking(null); appliedStack.current = null
    const v = Number(typedAngle)
    setTypedAngle(null)
    if (typedAngle !== null && typedAngle.trim() !== '' && Number.isFinite(v)) re.setSketchAngle(v)
  }
  const referenceName = draft.plane.kind === 'plane' ? useStore.getState().elements.find((e) => e.id === (draft.plane as { id: number }).id)?.name
    : draft.plane.kind === 'section' ? useStore.getState().sections.find((x) => x.id === (draft.plane as { id: number }).id)?.name : undefined
  const place = (ref: PlaneRef) => {
    run.current++; setWorking(null); setStacked(false); setReferenceMessage(null); appliedStack.current = null
    // A new plane, the sketch drafted afresh on it, still placing.
    const { sections, elements, modelCenter } = useStore.getState()
    if (re.startSketchOn(placementPlaneRef(ref, { sections, elements, modelCenter }))) placing()
  }
  placeRef.current = place
  const commit = () => {
    run.current++; setWorking(null); appliedStack.current = null
    const v = len.fromDisplay(Number(typed))
    setTyped(null)
    if (typed !== null && typed.trim() !== '' && Number.isFinite(v)) re.setSketchOffset(v)
  }
  const stackKey = () => {
    const d = useReverse.getState().sketchDraft
    const { outline, outlineMinPoints } = useSectionLine.getState()
    return JSON.stringify([d?.plane, d?.frame, useStack.getState().count, useStack.getState().upper, useStack.getState().lower, useStack.getState().rect, outline, outlineMinPoints])
  }
  /** Apply is one provisional reference-data change, never a feature loop. */
  const createStacked = async (): Promise<boolean> => {
    const d = useReverse.getState().sketchDraft
    if (!d?.placing) return false
    if (d.plane.kind === 'radial') {
      setReferenceMessage('Revolved stacked-section projection is awaiting reference verification. Use a single revolved section or an extruded stack.')
      return false
    }
    let worker
    try { worker = commandHost().session.clientRef.current } catch { worker = null }
    if (!worker || !useStore.getState().fileName) { setReferenceMessage('Load a scan before collecting stacked reference points.'); return false }
    const token = ++run.current, version = worker.scanVersion
    const current = () => run.current === token && useReverse.getState().sketchDraft === d && worker.scanVersion === version
    const count = useStack.getState().count
    setWorking(`Stacked sections: 0 of ${count}`); setReferenceMessage(null)
    try {
      // The upper plane starts just inside the far side of the scan from the
      // sketch's plane — a cut exactly on the outermost face finds little.
      const at = planeOffset(d.plane)
      let up = useStack.getState().upper
      let box = useStack.getState().rect
      // The box's lower plane starts on the sketch's plane.
      let down = useStack.getState().lower
      if (down === null) { down = at; useStack.getState().setLower(down) }
      if (up === null || box === null) {
        const bounds = await worker.bounds()
        if (!current()) return false
        if (up === null) {
          const e = stackExtentOf(bounds, d.frame)
          const far = Math.abs(e.max) >= Math.abs(e.min) ? e.max : e.min
          up = at + far * 0.98
          useStack.getState().setUpper(up)
        }
        if (box === null) {
          // The box starts on the part's own footprint on the plane, a little
          // wider all round; its handles then size it.
          const f = d.frame, us: number[] = [], vs: number[] = []
          for (let c = 0; c < 8; c++) {
            const p = [0, 1, 2].map((k) => ((c & (1 << k)) ? bounds.max[k] : bounds.min[k]) - f.origin[k])
            us.push(p[0] * f.basisU[0] + p[1] * f.basisU[1] + p[2] * f.basisU[2]); vs.push(p[0] * f.basisV[0] + p[1] * f.basisV[1] + p[2] * f.basisV[2])
          }
          const pad = 0.05 * Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs), 1)
          box = { u0: Math.min(...us) - pad, u1: Math.max(...us) + pad, v0: Math.min(...vs) - pad, v1: Math.max(...vs) + pad }
          useStack.getState().setRect(box)
        }
      }
      const relUp = up - at, relDown = down - at
      if (!(Math.abs(relUp - relDown) > 1e-6)) { setReferenceMessage('Drag the two planes apart to stack sections between them.'); return false }
      const extent: StackExtent = { min: Math.min(relDown, relUp), max: Math.max(relDown, relUp) }
      // Outline Mesh: the outline of the part between the two planes, seen
      // along the normal, flattened onto the sketch — its short pieces left
      // out as for a single section.
      const { outline, outlineMinPoints } = useSectionLine.getState()
      if (outline) {
        setWorking('Stacked sections: outline between the planes…')
        const cut = await worker.meshOutline(d.frame, extent)
        if (!current()) return false
        const chains = clipChainsToRect(chainsOfEdges(longChains(projectCut(cut, d.frame), outlineMinPoints)), box)
        useReverse.setState((s) => (s.sketchDraft === d ? { sketchDraft: { ...d, sketch: { ...cloneSketch(d.sketch), referenceChains: chains } } } : {}))
        appliedStack.current = JSON.stringify([d.plane, d.frame, count, up, down, box, true, outlineMinPoints])
        const points = chains.reduce((sum, c) => sum + c.length, 0)
        const message = `Outline of the part between the planes · ${points.toLocaleString()} reference points in one sketch. No primitives fitted.`
        setReferenceMessage(message); useStore.getState().setStatus(message)
        return true
      }
      const result = await collectExtrudedReference(worker, d.frame, count, { extent, isCurrent: current, onProgress: (done, total) => { if (current()) setWorking(`Stacked sections: ${done} of ${total}`) } })
      if (!current()) return false
      // Reference points only, re-cut as the planes move: written into the
      // draft without an undo step each time.
      // Only what lies inside the box: its handles isolate part of the scan.
      const kept = clipChainsToRect(result.chains, box)
      useReverse.setState((s) => (s.sketchDraft === d ? { sketchDraft: { ...d, sketch: { ...cloneSketch(d.sketch), referenceChains: kept } } } : {}))
      appliedStack.current = JSON.stringify([d.plane, d.frame, count, up, down, box, false, useSectionLine.getState().outlineMinPoints])
      const message = `${result.sections} sections · ${kept.reduce((n, c) => n + c.length, 0).toLocaleString()} reference points in one sketch, inside the box. No primitives fitted.`
      setReferenceMessage(message); useStore.getState().setStatus(message)
      return true
    } catch (error) {
      if (!(error instanceof ReferenceCancelled) && current()) setReferenceMessage(error instanceof Error ? error.message : 'Reference points could not be collected.')
      return false
    } finally {
      if (run.current === token) setWorking(null)
    }
  }
  collectStack.current = createStacked
  stackKeyRef.current = stackKey
  const prepareReference = async (): Promise<boolean> => {
    const d = useReverse.getState().sketchDraft
    if (!d?.placing) return false
    if (ignoreScan) {
      const sketch = cloneSketch(d.sketch); sketch.referenceChains = []
      useReverse.getState().setSketch(sketch); return true
    }
    if (stacked) return appliedStack.current === stackKey() && d.sketch.referenceChains !== undefined ? true : createStacked()
    // Preserve the current single cut too, so reference points survive a
    // project round trip without requiring the scan worker to recut it.
    const token = ++run.current
    setWorking('Collecting sketch reference points…')
    try {
      const chains = useStore.getState().fileName ? await chainsNow(chainsOf) : []
      if (run.current !== token || useReverse.getState().sketchDraft !== d) return false
      if (chains === null) { setReferenceMessage('The section is not ready. Move the plane through the scan and try again.'); return false }
      const sketch = cloneSketch(d.sketch); sketch.referenceChains = chains.map((chain) => chain.map((p) => [...p]))
      useReverse.getState().setSketch(sketch); return true
    } finally { if (run.current === token) setWorking(null) }
  }
  // The collected points are local to the slice. Projecting them onto
  // its parallel datum preserves those coordinates and the sketch axes.
  const preparePlacement = async () => {
    if (!await prepareReference()) return false
    const d = useReverse.getState().sketchDraft
    if (!d?.placing) return false
    if (onSlicingPlane || !planeOffset(d.plane)) return true
    const plane = planeAtOffset(d.plane, 0)
    const { sections, elements, modelCenter } = useStore.getState()
    const base = resolvePlaneFrame(plane, { sections, elements, modelCenter })
    if (!base) {
      setReferenceMessage('The selected drawing plane is no longer available.')
      return false
    }
    useReverse.setState({ sketchDraft: { ...d, plane, frame: { ...d.frame, origin: base.origin } } })
    return true
  }
  const create = async () => {
    if (!await preparePlacement()) return
    if (hideScan) useReverse.getState().setSketchModelShown(false)
    useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, placing: false } } : {}))
    useStore.getState().setStatus('')
  }
  const createAndStay = async () => {
    const d = useReverse.getState().sketchDraft
    if (!d || !await preparePlacement()) return
    const id = useReverse.getState().commitSketch()
    if (id !== null && re.startSketchOn(d.plane)) { placing(); appliedStack.current = null }
    useStore.getState().setStatus(id !== null ? 'One reference sketch created. No primitives fitted; move the plane for the next sketch.' : 'No reference points on this plane; no sketch created.')
  }
  return (
    <section className="re-place" data-test="place-sketch" aria-label="Create Sketch">
      <div className="moderow">
        <button className={radial ? undefined : 'on'} aria-pressed={!radial} data-test="place-mode-extruded" title="Sketch a profile to extrude: a plane parallel to a coordinate plane" onClick={() => radial && place(throughPart('z'))}>For Extruded Surface</button>
        <button className={radial ? 'on' : undefined} aria-pressed={!!radial} data-test="place-mode-revolved" title="Sketch a profile to revolve: a plane through an axis, turned about it" onClick={() => !radial && place(radialOn('z'))}>For Revolved Surface</button>
      </div>
      {radial ? (
        <div className="moderow" data-test="place-planes">
          {AXES.map((t) => (
            <button key={t.axis} className={radialAxis === t.axis ? 'on' : undefined} aria-pressed={radialAxis === t.axis} title={t.title} data-test={`place-axis-${t.axis}`} onClick={() => place(radialOn(t.axis))}>
              {t.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="moderow" data-test="place-planes">
          {TILES.map((t) => (
            <button key={t.axis} className={plane?.axis === t.axis ? 'on' : undefined} aria-pressed={plane?.axis === t.axis} title={t.title} data-test={`place-plane-${t.axis}`} onClick={() => place(throughPart(t.axis))}>
              <PlaneTile axis={t.axis} />
              {t.label}
            </button>
          ))}
        </div>
      )}
      {radial && (
        <label className="field">
          <span>Rotation (deg)</span>
          <input type="number" step="any" data-test="place-rotation" value={typedAngle ?? radial.angleDeg} onChange={(e) => setTypedAngle(e.target.value)} onBlur={commitAngle} onKeyDown={(e) => e.key === 'Enter' && commitAngle()} />
        </label>
      )}
      <div className="field re-place-parallel" title="Parallel to a coordinate plane, or to a plane or section already made">
        <span data-test="place-parallel-label">{plane ? `Parallel to ${plane.axis === 'z' ? 'OXY' : plane.axis === 'x' ? 'OYZ' : 'OXZ'}` : referenceName ?? ''}</span>
        <button type="button" data-test="place-pick" className={pickArmed ? 'on' : undefined} aria-pressed={pickArmed} disabled={!!radial}
          title="Click a plane in the view to sketch on it" onClick={() => usePlacePick.getState().setArmed(!pickArmed)}>Pick ...</button>
      </div>
      {pickArmed && <label className="field" title="Or choose a plane or section from the list"><span>or</span><PlaneSelect value={draft.plane} testId="place-pick-list" placeholder="Choose …" onChange={(ref) => { usePlacePick.getState().setArmed(false); place(ref) }} /></label>}
      {planeTakesOffset(draft.plane) && !radial && (
        <div className="toolrow re-place-offset">
        <label className="field">
          <span>Offset</span>
          <input
            type="number"
            step="any"
            data-test="place-offset"
            value={typed ?? Number(len.toDisplay(offset).toFixed(len.decimals(3)))}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
          />
        </label>
        <span className="re-place-unit">{len.word()}</span>
        <button data-test="place-offset-apply" disabled={!!working || !canApplyOffset} onClick={commit}>Apply</button>
        </div>
      )}
      <PlaceHint lineActive={sectionLine.active} />
      <button className={sectionLine.active ? 'block on' : 'block'} aria-pressed={sectionLine.active} data-test="place-define-interactive" disabled={!!working || !useStore.getState().fileName} title="Click the start and the end of a section line on the part; the sketch plane stands upright through it" onClick={() => { if (sectionLine.active) { sectionLine.cancel(); useStore.getState().setStatus('') } else { sectionLine.start(); useStore.getState().setStatus('Click to define the start of the section line.') } }}>Define interactive</button>
      <label className="checkrow" title="Define interactive holds the section line to whichever of X or Y it runs nearest">
        <input type="checkbox" data-test="place-snap-xy" checked={sectionLine.snap} onChange={(e) => sectionLine.setSnap(e.target.checked)} />
        <span>Automatically snap to X or Y direction</span>
      </label>
      <hr className="re-place-rule" />
      <div className="toolrow re-place-ignore">
        <label className="checkrow" title="Create the sketch without extracting scan reference points. This does not hide the scan.">
          <input type="checkbox" data-test="place-ignore-scan" checked={ignoreScan} onChange={(e) => {
            run.current++; setWorking(null); appliedStack.current = null
            const on = e.target.checked; setIgnoreScan(on)
            const d = useReverse.getState().sketchDraft
            if (d) { const sketch = cloneSketch(d.sketch); if (on) sketch.referenceChains = []; else delete sketch.referenceChains; useReverse.getState().setSketch(sketch) }
          }} />
          <span>Ignore scan data</span>
        </label>
        <button data-test="place-flip" disabled={!!working} title="Turn the sketch plane to face the other way" onClick={() => { run.current++; setWorking(null); appliedStack.current = null; re.flipSketchOrientation() }}>Flip orientation</button>
      </div>
      <label className="checkrow" title="Draw on the cutting plane, or project its section onto the selected datum.">
        <input type="checkbox" data-test="place-on-slice" checked={onSlicingPlane} disabled={!!working} onChange={(e) => setOnSlicingPlane(e.target.checked)} />
        <span>Create sketch on slicing plane</span>
      </label>
      <label className="checkrow" title="Cut only across the surface marked on the part; with nothing marked, the whole cut">
        <input type="checkbox" data-test="place-through-selection" checked={sectionLine.throughSelection} onChange={(e) => sectionLine.setThroughSelection(e.target.checked)} />
        <span>Through selection only</span>
      </label>
      <label className="checkrow">
        <input type="checkbox" data-test="place-stacked" disabled={!!radial || ignoreScan} checked={stacked && !radial} onChange={(e) => {
          const on = e.target.checked; setStacked(on); appliedStack.current = null
          // On: the live effect collects once the box settles.
          if (!on) { run.current++; setWorking(null); setReferenceMessage(null); const d = useReverse.getState().sketchDraft; if (d) { const sketch = cloneSketch(d.sketch); delete sketch.referenceChains; useReverse.getState().setSketch(sketch) } }
        }} />
        <span>Stacked sections</span>
      </label>
      <div className="toolrow re-place-stack">
        <label className="field">
          <span>Sections</span>
          <input type="number" min={2} max={200} step={1} value={count} disabled={!stacked || !!radial || ignoreScan} data-test="place-stacked-count" onChange={(e) => { appliedStack.current = null; setCount(Number(e.target.value)) }} />
        </label>
        <button data-test="place-stacked-apply" disabled={!stacked || !!working || !!radial || ignoreScan || !useStore.getState().fileName} onClick={() => void createStacked()} title="Project all section points onto this one reference sketch. No primitives are fitted.">
          Apply
        </button>
      </div>
      {!!radial && <p className="hint" data-test="place-radial-stack-unavailable">Revolved stacked-section projection awaits reference verification. Single revolved sections are available.</p>}
      {stacked && !radial && upper !== null && lower !== null && <div className="toolrow re-place-stack-extent" data-test="place-stack-extent">
        <label className="field" title="The box's upper plane, measured from the sketch's plane along its normal. Drag its blue arrow in the view, or type it."><span>Upper plane</span><input type="number" step="any" aria-label="Upper plane distance" data-test="place-stack-upper" value={upperText ?? String(Number(len.toDisplay(upper - offset).toFixed(4)))} onBlur={() => setUpperText(null)} onChange={(e) => { setUpperText(e.target.value); const v = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(v)) { appliedStack.current = null; useStack.getState().setUpper(offset + len.fromDisplay(v)) } }} /></label>
        <label className="field" title="The box's lower plane, measured from the sketch's plane along its normal. Drag its yellow arrow in the view, or type it."><span>Lower plane</span><input type="number" step="any" aria-label="Lower plane distance" data-test="place-stack-lower" value={lowerText ?? String(Number(len.toDisplay(lower - offset).toFixed(4)))} onBlur={() => setLowerText(null)} onChange={(e) => { setLowerText(e.target.value); const v = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(v)) { appliedStack.current = null; useStack.getState().setLower(offset + len.fromDisplay(v)) } }} /></label>
        <span>{len.word()} from the sketch plane</span>
      </div>}
      {stacked && !radial && upper !== null && lower !== null && <div className="toolrow re-place-stack-snap" data-test="place-stack-snap" style={{ flexWrap: 'nowrap', alignItems: 'center' }} title="Put the sketch's plane on the stack's bottom section, its middle, or its top section. Dragging its green arrow snaps there too.">
        <span style={{ whiteSpace: 'nowrap' }}>Sketch plane on</span>
        <div style={{ display: 'flex', gap: 4, flex: 1, minWidth: 0 }}>
        {([['bottom', 'Bottom', lower], ['middle', 'Middle', (lower + upper) / 2], ['top', 'Top', upper]] as const).map(([key, label, at]) => (
          <button key={key} type="button" style={{ flex: '1 1 0', minWidth: 0, padding: '2px 4px' }} data-test={`place-stack-snap-${key}`} aria-pressed={Math.abs(offset - at) < 1e-6} className={Math.abs(offset - at) < 1e-6 ? 'on' : undefined} onClick={() => { run.current++; appliedStack.current = null; re.setSketchOffset(at) }}>{label}</button>
        ))}
        </div>
      </div>}
      <label className="checkrow" title="Sketch on the part's outline through the plane instead of the cut">
        <input type="checkbox" data-test="place-outline-mode" checked={sectionLine.outline} onChange={(e) => sectionLine.setOutline(e.target.checked)} />
        <span>Outline Mesh</span>
      </label>
      <label className="field">
        <span>Ignore small segments of</span>
        <input type="number" min={1} step={1} style={{ width: 56 }} data-test="place-outline-min" disabled={!sectionLine.outline} value={sectionLine.outlineMinPoints}
          onChange={(e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v) && v >= 1) sectionLine.setOutlineMinPoints(v) }} />
        <span>points</span>
      </label>
      <label className="checkrow" title="Hide the scan when the sketch editor opens; its reference points are kept."><input type="checkbox" data-test="place-hide-scan" checked={hideScan} onChange={(e) => setHideScan(e.target.checked)} /><span>Hide scan data when creating a sketch</span></label>
      {working && <p className="hint" data-test="place-working">{working}</p>}
      {referenceMessage && <p className="hint" data-test="place-reference-status" role="status">{referenceMessage}</p>}
      <div className="toolrow">
        <button data-test="place-create-stay" disabled={!!working || !useStore.getState().fileName} onClick={() => void createAndStay()} title="Keep one reference sketch without fitting primitives, and stay to place the next">
          Create &amp; Stay
        </button>
        <button className="primary" data-test="place-create" disabled={!!working} onClick={() => void create()}>Create</button>
      </div>
      <div className="toolrow">
        <button data-test="place-cancel" onClick={() => { run.current++; setWorking(null); re.discardSketch() }}>Cancel</button>
      </div>
    </section>
  )
}

/** QUICKSURFACE's Create Sketch hint, boxed in the view's bottom-right
 *  corner: "Click to define start of the section line" while the dialog is
 *  up, "Define the section plane for 2D Sketch" once Define interactive is on. */
export const PLACE_HINT = 'Click to define start of the section line'
export const PLACE_LINE_HINT = 'Define the section plane for 2D Sketch'
function PlaceHint({ lineActive }: { lineActive: boolean }) {
  const view = document.querySelector('.desktop-mid')
  const rect = view?.getBoundingClientRect()
  if (!rect) return null
  return createPortal(
    <div data-test="place-hint" title="Drag the yellow arrow to carry the plane through the part; the cut is outlined in yellow."
      style={{ position: 'fixed', ...cornerBoxPlace(rect), padding: '4px 8px', background: 'color-mix(in srgb, var(--panel, #1e2126) 88%, transparent)', border: '1px solid var(--line, #3a3f47)', color: 'var(--ink, #e8eaed)', fontSize: 12, pointerEvents: 'none', zIndex: 40 }}>
      {lineActive ? PLACE_LINE_HINT : PLACE_HINT}
    </div>,
    document.body,
  )
}
