// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLength } from '../../../src/app/useUnits'
import { useStore } from '../../../src/state/store'
import { useFinishingAnalysis } from '../state/finishingAnalysis'
import { useReverse } from '../state/reStore'
import { FreeformDeviationOptions } from './FreeformDeviationOptions'
import './freeformControls.css'

export function FinishingAnalysis({ kind }: { kind: 'fillet' | 'chamfer' }) {
  const { enabled, tolerance, colouring, transparency, reading, statistics } = useFinishingAnalysis()
  const [options, setOptions] = useState(false)
  const hasScan = useStore(s => s.triangleCount > 0)
  const preview = useReverse(s => s.preview.status)
  const dragging = useReverse(s => s.gripHeld)
  const length = useLength()
  const set = useFinishingAnalysis.setState
  useEffect(() => () => { set({ reading: 'idle', statistics: null }) }, [kind, set])
  return <div className="analysis" data-test={`${kind}-analysis`}>
    <div className="toolrow">
      <label className="checkrow"><input type="checkbox" data-test="re-analysis-on" checked={enabled}
        onChange={e => set({ enabled: e.target.checked })} />Analysis</label>
      <button type="button" data-test="edge-analysis-options" onClick={() => setOptions(true)}>Options …</button>
    </div>
    <label className="field">Mesh Transparency
      <input type="range" min="0" max="100" value={transparency} data-test="edge-mesh-transparency"
        onChange={e => set({ transparency: Number(e.target.value) })} />
    </label>
    {enabled && (!hasScan || reading === 'unavailable') && <small role="status">
      {hasScan ? 'Deviation unavailable for this preview.' : 'Load a reference scan to measure deviation.'}
    </small>}
    {enabled && hasScan && reading === 'ready' && statistics && (preview === 'ok' || dragging) && <table
      className="finishing-statistics" data-test="finishing-statistics" title="Sampled on the proposed CAD finish. Positive follows the scan normals.">
      <caption>{preview === 'ok' ? 'Preview deviation from scan' : 'Preliminary deviation during drag'}</caption>
      <tbody>
        <tr><th scope="row">Signed range</th><td>{length.fmt(statistics.min, 4)} to {length.fmt(statistics.max, 4)}</td></tr>
        <tr><th scope="row">Mean absolute</th><td>{length.fmt(statistics.meanAbsolute, 4)}</td></tr>
        <tr><th scope="row">RMS</th><td>{length.fmt(statistics.rms, 4)}</td></tr>
        <tr><th scope="row">Outside tolerance</th><td>{statistics.measured - statistics.withinTolerance} of {statistics.measured} samples</td></tr>
        {statistics.total > statistics.measured && <tr><th scope="row">Unmeasured</th><td>{statistics.total - statistics.measured} samples</td></tr>}
      </tbody>
    </table>}
    {enabled && createPortal(<aside className="ff-viewport-legend" data-test="edge-analysis-legend"
      data-reading={reading} aria-label="Finishing deviation scale">
      <div className="ff-viewport-scale">
        {[5, 1, -1, -5].map((factor, i) => <span key={factor} style={{ top: ['0%', '35%', '65%', '100%'][i] }}>
          {length.fmt(factor * tolerance)}</span>)}
        <div className="ff-viewport-ramp" aria-hidden="true" />
      </div>
    </aside>, document.body)}
    {options && <FreeformDeviationOptions tolerance={tolerance} colouring={colouring}
      onApply={(tolerance, colouring) => set({ tolerance, colouring })} onClose={() => setOptions(false)} />}
  </div>
}
