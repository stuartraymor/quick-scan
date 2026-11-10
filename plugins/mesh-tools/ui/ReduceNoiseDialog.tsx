// SPDX-License-Identifier: AGPL-3.0-only
import { useLength } from '../../../src/app/useUnits'
import { useLengthDraft } from '../../../src/app/useLengthDraft'

// Scan Data → Reduce noise: QUICKSURFACE 8.0.128's Reduce Noise dialog,
// recorded live — Iterations, Apply on selection only, Apply on boundary
// edges, Preview, Deviation of original mesh with its range and Apply,
// Show mesh wireframe, Keep original mesh, Cancel and OK. Preview smooths
// the mesh (one undo step), Cancel takes it back, OK keeps it — or smooths
// it first when there was no preview.

import { useState } from 'react'
import { useStore } from '../../../src/state/store'
import { undo } from '../../../src/state/historyStore'
import { useMark } from '../../../src/state/markStore'
import { useMeshTools } from '../state/meshStore'

export function ReduceNoiseDialog({ onRun, onClose }: { onRun: (iterations: number, boundary: boolean, selectionOnly: boolean) => Promise<unknown>; onClose: () => void }) {
  const len = useLength()
  const wireframe = useStore((s) => s.wireframe)
  const marked = useMark((s) => s.count)
  const editing = useMeshTools((s) => s.editing)
  const [iterations, setIterations] = useState(1)
  const [selectionOnly, setSelectionOnly] = useState(false)
  const [boundary, setBoundary] = useState(true)
  const [previewed, setPreviewed] = useState(false)
  const [deviation, setDeviation] = useState(false)
  const [range, setRange, rangeMm] = useLengthDraft(0.05)
  const [keep, setKeep] = useState(false)
  // A change after a preview takes the preview back: what is shown is
  // always what OK would keep.
  const changed = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    if (previewed) { void undo(); setPreviewed(false) }
  }
  const run = async () => { await onRun(iterations, boundary, selectionOnly); setPreviewed(true) }
  const finish = () => { useMeshTools.getState().setCopyDeviation(false); useMeshTools.getState().setMapRange(null); onClose() }
  return (
    <div className="modalback" data-test="reduce-noise" onKeyDown={(e) => { if (e.key === 'Escape') { if (previewed) void undo(); finish() } }}>
      <div className="modal" style={{ width: 300, display: 'grid', gap: 8, padding: 14 }}>
        <header style={{ fontWeight: 600 }}>Reduce Noise</header>
        <span>Iterations</span>
        <div className="field">
          <input type="range" min={1} max={10} step={1} value={iterations} data-test="noise-iterations" onChange={(e) => changed(setIterations)(Number(e.target.value))} />
          <b>{iterations}</b>
        </div>
        <label className="checkrow">
          <input type="checkbox" checked={selectionOnly} disabled={marked === 0 && !selectionOnly} data-test="noise-selection" onChange={(e) => changed(setSelectionOnly)(e.target.checked)} />
          <span>Apply on selection only</span>
        </label>
        <label className="checkrow">
          <input type="checkbox" checked={boundary} data-test="noise-boundary" onChange={(e) => changed(setBoundary)(e.target.checked)} />
          <span>Apply on boundary edges</span>
        </label>
        <button data-test="noise-preview" disabled={editing || previewed} onClick={() => void run()}>{editing ? 'Smoothing…' : 'Preview'}</button>
        <label className="checkrow">
          <input type="checkbox" disabled={!previewed} checked={deviation} data-test="noise-deviation"
            onChange={(e) => { setDeviation(e.target.checked); useMeshTools.getState().setCopyDeviation(e.target.checked) }} />
          <span>Deviation of original mesh</span>
        </label>
        <div className="field">
          <input type="number" step="any" min={0} value={range} disabled={!previewed || !deviation} onChange={(e) => setRange(e.target.value)} style={{ width: 80 }} />
          <span>{len.word()}</span>
          <button disabled={!previewed || !deviation} onClick={() => useMeshTools.getState().setMapRange(rangeMm)}>Apply</button>
        </div>
        <label className="checkrow">
          <input type="checkbox" checked={wireframe} onChange={(e) => useStore.getState().setWireframe(e.target.checked)} />
          <span>Show mesh wireframe</span>
        </label>
        <label className="checkrow" title="Keep original mesh needs more than one mesh in a project, which Quick Scan does not hold yet — Ctrl+Z brings the original back">
          <input type="checkbox" checked={keep} disabled onChange={(e) => setKeep(e.target.checked)} />
          <span>Keep original mesh</span>
        </label>
        <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button data-test="noise-cancel" disabled={editing} onClick={() => { if (previewed) void undo(); finish() }}>Cancel</button>
          <button className="primary" data-test="noise-ok" disabled={editing} onClick={async () => { if (!previewed) await run(); finish() }}>OK</button>
        </footer>
      </div>
    </div>
  )
}
