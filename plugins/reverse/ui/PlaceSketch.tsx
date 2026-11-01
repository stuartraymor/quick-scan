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

const world = (plane: PlaneRef) => (plane.kind === 'world' ? plane : null)
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

export function PlaceSketch({ chainsOf }: { chainsOf: () => { chains: Vec2[][] } | null }) {
  const draft = useReverse((s) => s.sketchDraft)
  const len = useLength()
  const [typed, setTyped] = useState<string | null>(null)
  const [stacked, setStacked] = useState(false)
  const [count, setCount] = useState(20)
  const [hideScan, setHideScan] = useState(false)
  const [working, setWorking] = useState<string | null>(null)
  if (!draft?.placing) return null
  const re = useReverse.getState()
  const plane = world(draft.plane)
  const offset = planeOffset(draft.plane)
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
      <h3>Create Sketch</h3>
      <div className="moderow">
        <button className="on" disabled title="Sketch a profile to extrude">For Extruded Surface</button>
        <button disabled title="Revolved-surface sketches start from the Revolve command in Quick Scan">For Revolved Surface</button>
      </div>
      <div className="moderow" data-test="place-planes">
        {TILES.map((t) => (
          <button key={t.axis} className={plane?.axis === t.axis ? 'on' : undefined} aria-pressed={plane?.axis === t.axis} title={t.title} data-test={`place-plane-${t.axis}`} onClick={() => place({ kind: 'world', axis: t.axis, offset: 0 })}>
            {t.label}
          </button>
        ))}
      </div>
      <label className="field" title="Parallel to a coordinate plane, or to a plane or section already made">
        <span>{plane ? `Parallel to ${plane.axis === 'z' ? 'OXY' : plane.axis === 'x' ? 'OYZ' : 'OXZ'}` : 'Parallel to'}</span>
        <PlaneSelect value={draft.plane} testId="place-pick" placeholder="Pick …" onChange={(ref) => place(ref)} />
      </label>
      {planeTakesOffset(draft.plane) && (
        <label className="field">
          <span>Offset ({len.word()})</span>
          <input
            type="number"
            step="any"
            data-test="place-offset"
            value={typed ?? Number(len.toDisplay(offset).toFixed(len.decimals(3)))}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
          />
        </label>
      )}
      <p className="hint">Drag the yellow arrow to carry the plane through the part; the cut is outlined in yellow.</p>
      <label className="checkrow">
        <input type="checkbox" data-test="place-stacked" checked={stacked} onChange={(e) => setStacked(e.target.checked)} />
        <span>Stacked sections</span>
      </label>
      {stacked && (
        <div className="toolrow">
          <label className="field">
            <span>Sections</span>
            <input type="number" min={2} max={200} step={1} value={count} data-test="place-stacked-count" onChange={(e) => setCount(Number(e.target.value))} />
          </label>
          <button data-test="place-stacked-apply" disabled={!!working || !useStore.getState().fileName} onClick={() => void createStacked()} title="Make that many sketches, evenly spaced through the part along the plane's normal, each fitted to its cut">
            Apply
          </button>
        </div>
      )}
      <label className="checkrow">
        <input type="checkbox" data-test="place-hide-scan" checked={hideScan} onChange={(e) => setHideScan(e.target.checked)} />
        <span>Hide scan data when creating a sketch</span>
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
