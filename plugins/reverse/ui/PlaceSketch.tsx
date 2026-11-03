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
import { planeOffset, planeTakesOffset, type PlaneRef } from '../core/features'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { PlaneSelect } from './PlaneSelect'
import { commandHost } from '../../../src/commands/host'
import { cloneSketch } from '../core/sketch'
import { collectExtrudedReference, ReferenceCancelled, type StackExtent } from '../core/stackedReference'
import { frameKey } from '../../../src/core/section/frame'
import type { Vec2 } from '../../../src/core/flat/types'

const TILES: { axis: 'z' | 'x' | 'y'; label: string; title: string }[] = [
  { axis: 'z', label: '(OXY)', title: 'A plane parallel to OXY — normal along Z' },
  { axis: 'x', label: '(OYZ)', title: 'A plane parallel to OYZ — normal along X' },
  { axis: 'y', label: '(OXZ)', title: 'A plane parallel to OXZ — normal along Y' },
]
const NOT_BUILT = 'Not built in Quick Scan yet'

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
async function chainsNow(chainsOf: () => { chains: Vec2[][]; key?: string } | null): Promise<Vec2[][] | null> {
  const version = useReverse.getState().chainsVersion
  const draft = useReverse.getState().sketchDraft
  const expected = draft ? `${JSON.stringify(draft.plane)}|${frameKey(draft.frame)}|${draft.level ?? 0}` : null
  for (let i = 0; i < 400; i++) {
    const s = useReverse.getState()
    if (s.sketchDraft !== draft) return null
    if (s.chainsStatus === 'failed') return null
    const chains = chainsOf()
    if (s.chainsStatus === 'ready' && chains && (chains.key === undefined || chains.key === expected) && (s.chainsVersion !== version || i > 2)) return chains.chains
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

export function PlaceSketch({ chainsOf }: { chainsOf: () => { chains: Vec2[][] } | null }) {
  const draft = useReverse((s) => s.sketchDraft)
  const len = useLength()
  const [typed, setTyped] = useState<string | null>(null)
  const [stacked, setStacked] = useState(false)
  const [count, setCount] = useState(20)
  const [hideScan, setHideScan] = useState(false)
  const [ignoreScan, setIgnoreScan] = useState(false)
  const [extent, setExtent] = useState<StackExtent | undefined>()
  const [working, setWorking] = useState<string | null>(null)
  const sectionLine = useSectionLine()
  const [referenceMessage, setReferenceMessage] = useState<string | null>(null)
  const run = useRef(0)
  const appliedStack = useRef<string | null>(null)
  const collectStack = useRef<(() => Promise<boolean>) | null>(null)
  const previousFrame = useRef<string | null>(null)
  const [typedAngle, setTypedAngle] = useState<string | null>(null)
  useEffect(() => () => { run.current++ }, [])
  const currentFrame = draft?.placing ? frameKey(draft.frame) : null
  useEffect(() => {
    const moved = previousFrame.current !== null && previousFrame.current !== currentFrame
    previousFrame.current = currentFrame
    if (!moved || !currentFrame || !stacked || ignoreScan || draft?.plane.kind === 'radial') return
    run.current++; setWorking(null); appliedStack.current = null
    // Moving the plane translates the bounded volume too. Recollect only
    // when the arrow settles; no per-slice feature/history revisions.
    const timer = setTimeout(() => { void collectStack.current?.() }, 220)
    return () => clearTimeout(timer)
  }, [currentFrame, stacked, ignoreScan])
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
  const place = (ref: PlaneRef) => {
    run.current++; setWorking(null); setExtent(undefined); setStacked(false); setReferenceMessage(null); appliedStack.current = null
    // A new plane, the sketch drafted afresh on it, still placing.
    if (re.startSketchOn(ref)) placing()
  }
  const commit = () => {
    run.current++; setWorking(null); appliedStack.current = null
    const v = len.fromDisplay(Number(typed))
    setTyped(null)
    if (typed !== null && typed.trim() !== '' && Number.isFinite(v)) re.setSketchOffset(v)
  }
  const stackKey = () => {
    const d = useReverse.getState().sketchDraft
    return JSON.stringify([d?.plane, d?.frame, count, extent ?? null])
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
    setWorking(`Stacked sections: 0 of ${count}`); setReferenceMessage(null)
    try {
      const result = await collectExtrudedReference(worker, d.frame, count, { extent, isCurrent: current, onProgress: (done, total) => { if (current()) setWorking(`Stacked sections: ${done} of ${total}`) } })
      if (!current()) return false
      const sketch = cloneSketch(d.sketch)
      sketch.referenceChains = result.chains
      useReverse.getState().setSketch(sketch)
      setExtent(result.extent)
      appliedStack.current = JSON.stringify([d.plane, d.frame, count, result.extent])
      const message = `${result.sections} sections · ${result.points.toLocaleString()} reference points in one sketch. No primitives fitted.`
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
  const create = async () => {
    if (!await prepareReference()) return
    if (hideScan) useReverse.getState().setSketchModelShown(false)
    useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, placing: false } } : {}))
  }
  const createAndStay = async () => {
    const d = useReverse.getState().sketchDraft
    if (!d || !await prepareReference()) return
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
      <label className="field" title="Parallel to a coordinate plane, or to a plane or section already made">
        <span>{plane ? `Parallel to ${plane.axis === 'z' ? 'OXY' : plane.axis === 'x' ? 'OYZ' : 'OXZ'}` : 'Parallel to'}</span>
        <PlaneSelect value={draft.plane} testId="place-pick" placeholder="Pick …" onChange={(ref) => place(ref)} />
      </label>
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
      <p className="hint">Drag the yellow arrow to carry the plane through the part; the cut is outlined in yellow.</p>
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
      <label className="checkrow" title={NOT_BUILT}>
        <input type="checkbox" data-test="place-on-slice" checked disabled readOnly />
        <span>Create sketch on slicing plane</span>
      </label>
      <label className="checkrow" title="Cut only across the surface marked on the part; with nothing marked, the whole cut">
        <input type="checkbox" data-test="place-through-selection" checked={sectionLine.throughSelection} onChange={(e) => sectionLine.setThroughSelection(e.target.checked)} />
        <span>Through selection only</span>
      </label>
      <label className="checkrow">
        <input type="checkbox" data-test="place-stacked" disabled={!!radial || ignoreScan} checked={stacked && !radial} onChange={(e) => {
          const on = e.target.checked; setStacked(on); appliedStack.current = null
          if (on) void createStacked()
          else { run.current++; setWorking(null); setExtent(undefined); setReferenceMessage(null); const d = useReverse.getState().sketchDraft; if (d) { const sketch = cloneSketch(d.sketch); delete sketch.referenceChains; useReverse.getState().setSketch(sketch) } }
        }} />
        <span>Stacked sections</span>
      </label>
      <div className="toolrow re-place-stack">
        <label className="field">
          <span>Sections</span>
          <input type="number" min={2} max={200} step={1} value={count} disabled={!stacked || !!working || !!radial || ignoreScan} data-test="place-stacked-count" onChange={(e) => { appliedStack.current = null; setCount(Number(e.target.value)) }} />
        </label>
        <button data-test="place-stacked-apply" disabled={!stacked || !!working || !!radial || ignoreScan || !useStore.getState().fileName} onClick={() => void createStacked()} title="Project all section points onto this one reference sketch. No primitives are fitted.">
          Apply
        </button>
      </div>
      {!!radial && <p className="hint" data-test="place-radial-stack-unavailable">Revolved stacked-section projection awaits reference verification. Single revolved sections are available.</p>}
      {stacked && !radial && extent && <div className="toolrow re-place-stack-extent" data-test="place-stack-extent">
        <label className="field"><span>Lower extent</span><input type="number" step="any" aria-label="Lower stack extent" value={Number(len.toDisplay(extent.min).toFixed(4))} disabled={!!working} onChange={(e) => { appliedStack.current = null; setExtent({ ...extent, min: len.fromDisplay(Number(e.target.value)) }) }} /></label>
        <label className="field"><span>Upper extent</span><input type="number" step="any" aria-label="Upper stack extent" value={Number(len.toDisplay(extent.max).toFixed(4))} disabled={!!working} onChange={(e) => { appliedStack.current = null; setExtent({ ...extent, max: len.fromDisplay(Number(e.target.value)) }) }} /></label>
        <span>{len.word()}</span>
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
