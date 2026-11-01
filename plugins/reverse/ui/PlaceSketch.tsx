// SPDX-License-Identifier: AGPL-3.0-only
// "Create Sketch": the stage before a sketch is drawn, as in QUICKSURFACE's 2D
// Sketch dialog. The plane is chosen (OXY / OYZ / OXZ) and carried through the
// part — by the offset typed here, or by dragging the yellow arrow on it in
// the 3D view — with the part cut open at it; Create then opens the sketch
// editor on that plane.

import { useState } from 'react'
import { useReverse } from '../state/reStore'
import { planeOffset, planeTakesOffset, type PlaneRef } from '../core/features'
import { useLength } from '../../../src/app/useUnits'

const TILES: { axis: 'z' | 'x' | 'y'; label: string; title: string }[] = [
  { axis: 'z', label: '(OXY)', title: 'A plane parallel to OXY — normal along Z' },
  { axis: 'x', label: '(OYZ)', title: 'A plane parallel to OYZ — normal along X' },
  { axis: 'y', label: '(OXZ)', title: 'A plane parallel to OXZ — normal along Y' },
]

const world = (plane: PlaneRef) => (plane.kind === 'world' ? plane : null)

export function PlaceSketch() {
  const draft = useReverse((s) => s.sketchDraft)
  const len = useLength()
  const [typed, setTyped] = useState<string | null>(null)
  if (!draft?.placing) return null
  const re = useReverse.getState()
  const plane = world(draft.plane)
  const offset = planeOffset(draft.plane)
  const place = (axis: 'z' | 'x' | 'y') => {
    // A new plane, the sketch drafted afresh on it, still placing.
    if (re.startSketchOn({ kind: 'world', axis, offset: 0 })) useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, placing: true } } : {}))
  }
  const commit = () => {
    const v = len.fromDisplay(Number(typed))
    setTyped(null)
    if (typed !== null && typed.trim() !== '' && Number.isFinite(v)) re.setSketchOffset(v)
  }
  const finish = () => useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, placing: false } } : {}))
  return (
    <section className="re-place" data-test="place-sketch" aria-label="Create Sketch">
      <h3>Create Sketch</h3>
      <div className="moderow">
        <button className="on" disabled title="Sketch a profile to extrude">For Extruded Surface</button>
        <button disabled title="Revolved-surface sketches start from the Revolve command in Quick Scan">For Revolved Surface</button>
      </div>
      <div className="moderow" data-test="place-planes">
        {TILES.map((t) => (
          <button key={t.axis} className={plane?.axis === t.axis ? 'on' : undefined} aria-pressed={plane?.axis === t.axis} title={t.title} data-test={`place-plane-${t.axis}`} onClick={() => place(t.axis)}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="hint">{plane ? `Parallel to ${plane.axis === 'z' ? 'OXY' : plane.axis === 'x' ? 'OYZ' : 'OXZ'}` : draft.name}</p>
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
      <p className="hint">Drag the yellow arrow in the view to carry the plane through the part. The part is cut open where the plane lies.</p>
      <div className="toolrow">
        <button className="primary" data-test="place-create" onClick={finish}>Create</button>
        <button data-test="place-cancel" onClick={() => re.discardSketch()}>Cancel</button>
      </div>
    </section>
  )
}
