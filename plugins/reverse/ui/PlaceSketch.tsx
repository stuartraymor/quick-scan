// SPDX-License-Identifier: AGPL-3.0-only
// "Create Sketch": the stage before a sketch is drawn, as in QUICKSURFACE's 2D
// Sketch dialog (Pro 8.0.127 photos). The plane is chosen — OXY / OYZ / OXZ,
// or picked from the planes and sections already made — and carried through
// the part by the offset or by dragging the yellow arrow, with the scan's cut
// outlined in yellow where it lies. Create opens the sketch editor on that
// plane; Create & Stay makes the sketch from the cut there and stays, for the
// next; Stacked sections makes a run of them through the part at once.

import { useState } from 'react'
import { useReverse } from '../state/reStore'
import { planeOffset, planeTakesOffset, type PlaneRef } from '../core/features'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { PlaneSelect } from './PlaneSelect'
import { useRePrefs } from '../state/rePrefs'
import type { Vec2 } from '../../../src/core/flat/types'

const TILES: { axis: 'z' | 'x' | 'y'; label: string; title: string }[] = [
  { axis: 'z', label: '(OXY)', title: 'A plane parallel to OXY — normal along Z' },
  { axis: 'x', label: '(OYZ)', title: 'A plane parallel to OYZ — normal along X' },
  { axis: 'y', label: '(OXZ)', title: 'A plane parallel to OXZ — normal along Y' },
]
const SHARE_MM = 0.05
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
/** Where QUICKSURFACE's slicing plane starts: through the middle of the part,
 *  so the cut shows at once — not at the origin, which a scan may lie far off. */
export const throughPart = (axis: 'x' | 'y' | 'z'): PlaneRef => {
  const store = useStore.getState()
  const c = store.fileName ? store.modelCenter : [0, 0, 0]
  return { kind: 'world', axis, offset: c[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] }
}
const placing = () => useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, placing: true } } : {}))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Wait for the slice chains of the sketch draft as it stands now. */
async function chainsNow(chainsOf: () => { chains: Vec2[][] } | null): Promise<Vec2[][] | null> {
  const version = useReverse.getState().chainsVersion
  for (let i = 0; i < 400; i++) {
    const s = useReverse.getState()
    if (s.chainsStatus === 'failed') return null
    if (s.chainsStatus === 'ready' && (s.chainsVersion !== version || i > 2)) return chainsOf()?.chains ?? null
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
  const [working, setWorking] = useState<string | null>(null)
  const [typedAngle, setTypedAngle] = useState<string | null>(null)
  if (!draft?.placing) return null
  const re = useReverse.getState()
  const plane = world(draft.plane)
  const offset = planeOffset(draft.plane)
  const radial = draft.plane.kind === 'radial' ? draft.plane : null
  const radialAxis = radial && radial.axis.kind === 'world' ? radial.axis.axis : null
  const pendingOffset = typed !== null && typed.trim() !== '' ? len.fromDisplay(Number(typed)) : NaN
  const canApplyOffset = Number.isFinite(pendingOffset) && pendingOffset !== offset
  const commitAngle = () => {
    const v = Number(typedAngle)
    setTypedAngle(null)
    if (typedAngle !== null && typedAngle.trim() !== '' && Number.isFinite(v)) re.setSketchAngle(v)
  }
  const place = (ref: PlaneRef) => {
    // A new plane, the sketch drafted afresh on it, still placing.
    if (re.startSketchOn(ref)) placing()
  }
  const commit = () => {
    const v = len.fromDisplay(Number(typed))
    setTyped(null)
    if (typed !== null && typed.trim() !== '' && Number.isFinite(v)) re.setSketchOffset(v)
  }
  const create = () => {
    if (hideScan) useReverse.getState().setSketchModelShown(false)
    useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, placing: false } } : {}))
  }
  /** The sketch made from the cut where the plane lies — every chain fitted —
   *  and kept; a fresh one is started on the same plane. False when nothing
   *  of the scan lies on it. */
  const makeHere = async (): Promise<boolean> => {
    const chains = await chainsNow(chainsOf)
    if (!chains || chains.length === 0) return false
    const s = useReverse.getState()
    s.autoFit(chains, 'all', useRePrefs.getState().fitOptions, SHARE_MM)
    return s.commitSketch() !== null
  }
  const createAndStay = async () => {
    const d = useReverse.getState().sketchDraft
    if (!d) return
    setWorking('Creating the sketch…')
    try {
      const keepPlane = d.plane
      const made = await makeHere()
      useStore.getState().setStatus(made ? `${d.name} made from the cut — move the plane for the next one.` : 'Nothing of the scan lies on this plane — move it into the part.')
      if (useReverse.getState().sketchDraft === null && re.startSketchOn(keepPlane)) placing()
    } finally {
      setWorking(null)
    }
  }
  const createStacked = async () => {
    const d = useReverse.getState().sketchDraft
    if (!d || !planeTakesOffset(d.plane)) return
    const store = useStore.getState()
    const n = Math.max(2, Math.min(200, Math.round(count)))
    // Through the part along the plane's normal: the scan's bounding sphere,
    // a little inside its ends, in steps of equal length.
    const [nx, ny, nz] = d.frame.normal
    const c = store.modelCenter
    const at = c[0] * nx + c[1] * ny + c[2] * nz
    const base = planeOffset(d.plane) - ((d.frame.origin[0] * nx + d.frame.origin[1] * ny + d.frame.origin[2] * nz) - at)
    const reach = store.modelSize * 0.98
    const keepPlane = d.plane
    let made = 0
    setWorking(`Stacked sections: 0 of ${n}`)
    try {
      for (let i = 0; i < n; i++) {
        const off = base - reach + (2 * reach * (i + 0.5)) / n
        if (useReverse.getState().sketchDraft === null && re.startSketchOn(keepPlane)) placing()
        useReverse.getState().setSketchOffset(off)
        if (await makeHere()) made++
        setWorking(`Stacked sections: ${i + 1} of ${n}`)
      }
    } finally {
      setWorking(null)
      if (useReverse.getState().sketchDraft === null && re.startSketchOn(keepPlane)) placing()
      useStore.getState().setStatus(`Stacked sections: ${made} sketches made through the part.`)
    }
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
      <button className="block" data-test="place-define-interactive" disabled title={NOT_BUILT}>Define interactive</button>
      <label className="checkrow" title={NOT_BUILT}>
        <input type="checkbox" data-test="place-snap-xy" checked disabled readOnly />
        <span>Automatically snap to X or Y direction</span>
      </label>
      <hr className="re-place-rule" />
      <div className="toolrow re-place-ignore">
        <label className="checkrow" title="Put the scan away while the sketch is drawn, so the sketch is made on the plane alone">
          <input type="checkbox" data-test="place-hide-scan" checked={hideScan} onChange={(e) => setHideScan(e.target.checked)} />
          <span>Ignore scan data</span>
        </label>
        <button data-test="place-flip" disabled title={NOT_BUILT}>Flip orientation</button>
      </div>
      <label className="checkrow" title={NOT_BUILT}>
        <input type="checkbox" data-test="place-on-slice" checked disabled readOnly />
        <span>Create sketch on slicing plane</span>
      </label>
      <label className="checkrow" title={NOT_BUILT}>
        <input type="checkbox" data-test="place-through-selection" checked={false} disabled readOnly />
        <span>Through selection only</span>
      </label>
      <label className="checkrow">
        <input type="checkbox" data-test="place-stacked" checked={stacked} onChange={(e) => setStacked(e.target.checked)} />
        <span>Stacked sections</span>
      </label>
      <div className="toolrow re-place-stack">
        <label className="field">
          <span>Sections</span>
          <input type="number" min={2} max={200} step={1} value={count} disabled={!stacked || !!working} data-test="place-stacked-count" onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <button data-test="place-stacked-apply" disabled={!stacked || !!working || !useStore.getState().fileName} onClick={() => void createStacked()} title="Make that many sketches, evenly spaced through the part along the plane's normal, each fitted to its cut">
          Apply
        </button>
      </div>
      <label className="checkrow" title={NOT_BUILT}>
        <input type="checkbox" data-test="place-outline-mode" checked={false} disabled readOnly />
        <span>Outline Mode…</span>
      </label>
      {working && <p className="hint" data-test="place-working">{working}</p>}
      <div className="toolrow">
        <button data-test="place-create-stay" disabled={!!working || !useStore.getState().fileName} onClick={() => void createAndStay()} title="Make the sketch from the cut here, fitted, and stay to place the next">
          Create &amp; Stay
        </button>
        <button className="primary" data-test="place-create" disabled={!!working} onClick={create}>Create</button>
      </div>
      <div className="toolrow">
        <button data-test="place-cancel" disabled={!!working} onClick={() => re.discardSketch()}>Cancel</button>
      </div>
    </section>
  )
}
