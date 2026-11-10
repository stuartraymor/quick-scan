// SPDX-License-Identifier: AGPL-3.0-only
import { useLength } from '../../../src/app/useUnits'
import { useLengthDraft } from '../../../src/app/useLengthDraft'

// Scan Data → Reduce polygons: QUICKSURFACE 8.0.128's Polygon Reduction
// dialog, recorded live — Active Mesh, Current and New Number of Triangles,
// Reduce down to as triangles or a percentage, Preview, Deviation of
// original mesh with its range and Apply, Show mesh wireframe, Keep
// original mesh, Cancel and OK (offered once a preview is in). The
// reduction is Quick Scan's own, run to the triangle count asked for.

import { useState } from 'react'
import { useStore } from '../../../src/state/store'
import { useMeshTools } from '../state/meshStore'
import { count } from './meshFormat'

/** A target typed as triangles or as a share of the mesh, kept to what the
 *  mesh can be reduced to. */
export function reductionTarget(current: number, typed: number, as: 'triangles' | 'percent'): number {
  const n = as === 'percent' ? Math.round((current * typed) / 100) : Math.round(typed)
  return Math.min(Math.max(n, 4), current)
}

export function PolygonReductionDialog({ onPreview, onReplace, onClose }: { onPreview: () => Promise<unknown>; onReplace: () => Promise<unknown>; onClose: () => void }) {
  const name = useStore((s) => s.fileName)
  const current = useStore((s) => s.triangleCount)
  const len = useLength()
  const wireframe = useStore((s) => s.wireframe)
  const report = useMeshTools((s) => s.report)
  const running = useMeshTools((s) => s.status === 'running')
  const [target, setTarget] = useState(() => Math.round(current / 2))
  const [deviation, setDeviation] = useState(false)
  const [range, setRange, rangeMm] = useLengthDraft(0.05)
  const [keep, setKeep] = useState(false)
  const [previewed, setPreviewed] = useState(false)
  const percent = current > 0 ? Math.round((target / current) * 1000) / 10 : 0
  const preview = async () => {
    const m = useMeshTools.getState()
    // Held to the count asked for: the tolerance is set below anything the
    // reduction could meet, so the triangle limit is what stops it.
    m.setTolerance(1e-4)
    m.setMaxTriangles(target)
    m.setView('reduced')
    await onPreview()
    setPreviewed(useMeshTools.getState().report !== null)
  }
  const close = () => { useMeshTools.getState().setMapRange(null); onClose() }
  return (
    <div className="modalback" data-test="polygon-reduction" onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
      <div className="modal" style={{ width: 300, display: 'grid', gap: 8, padding: 14 }}>
        <header style={{ fontWeight: 600 }}>Polygon Reduction</header>
        <div className="kv"><span className="name">Active Mesh:</span><b>{name}</b></div>
        <div className="kv"><span className="name">Current Number of Triangles:</span><b>{count(current)}</b></div>
        <div className="kv"><span className="name">New Number of Triangles:</span><b data-test="reduction-new">{previewed && report ? count(report.triangles) : ''}</b></div>
        <span>Reduce down to</span>
        <label className="field">
          <input type="number" list="reduction-presets" min={4} max={current} value={target} data-test="reduction-triangles"
            onChange={(e) => { setTarget(reductionTarget(current, Number(e.target.value), 'triangles')); setPreviewed(false) }} />
          <datalist id="reduction-presets">{[75, 50, 25, 10].map((p) => <option key={p} value={Math.round((current * p) / 100)}>{p} %</option>)}</datalist>
          <span>triangles</span>
        </label>
        <label className="field">
          <input type="number" min={0} max={100} step="any" value={percent} data-test="reduction-percent"
            onChange={(e) => { setTarget(reductionTarget(current, Number(e.target.value), 'percent')); setPreviewed(false) }} />
          <span>%</span>
        </label>
        <button data-test="reduction-preview" disabled={running} onClick={() => void preview()}>{running ? 'Reducing…' : 'Preview'}</button>
        <label className="checkrow">
          <input type="checkbox" disabled={!previewed} checked={deviation} data-test="reduction-deviation"
            onChange={(e) => { setDeviation(e.target.checked); useMeshTools.getState().setView(e.target.checked ? 'deviation' : 'reduced'); if (e.target.checked) useMeshTools.getState().setMapRange(rangeMm) }} />
          <span>Deviation of original mesh</span>
        </label>
        <div className="field">
          <input type="number" step="any" min={0} value={range} disabled={!previewed || !deviation} onChange={(e) => setRange(e.target.value)} style={{ width: 80 }} />
          <span>{len.word()}</span>
          <button disabled={!previewed || !deviation} data-test="reduction-apply-range" onClick={() => useMeshTools.getState().setMapRange(rangeMm)}>Apply</button>
        </div>
        <label className="checkrow">
          <input type="checkbox" checked={wireframe} onChange={(e) => useStore.getState().setWireframe(e.target.checked)} />
          <span>Show mesh wireframe</span>
        </label>
        <label className="checkrow">
          <input type="checkbox" checked={keep} data-test="reduction-keep" onChange={(e) => setKeep(e.target.checked)} />
          <span>Keep original mesh</span>
        </label>
        <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={close}>Cancel</button>
          <button className="primary" data-test="reduction-ok" disabled={!previewed || running}
            onClick={() => { if (!keep) void onReplace(); close() }}>OK</button>
        </footer>
      </div>
    </div>
  )
}
