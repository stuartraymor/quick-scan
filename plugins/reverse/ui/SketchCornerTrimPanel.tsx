// SPDX-License-Identifier: AGPL-3.0-only
import { useLength } from '../../../src/app/useUnits'
import type { SketchChains } from '../app/useReverseWorkspace'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'

export function SketchCornerTrimPanel(_props: { chainsOf: () => SketchChains | null }) {
  const state = useSketchCornerTrim()
  const len = useLength()
  if (!state.open) return null
  return <section className="draftbox" data-test="sketch-corner-trim-panel" aria-label="Corner trim">
    <div className="sec-head">Corner Trim</div>
    <div role="group" aria-label="Corner finishing mode">
      {([['trim', 'Corner Trim'], ['autoFillet', 'Auto Fillet'], ['fixedFillet', 'Fixed Size Fillet']] as const).map(([mode, label]) => <button key={mode} aria-pressed={state.mode === mode} className={state.mode === mode ? 'primary' : ''} style={{ display: 'block', width: '100%', margin: '6px 0' }} onClick={() => state.setMode(mode)} data-test={`corner-mode-${mode}`}>{label}</button>)}
    </div>
    <label className="field"><span>Radius</span><input disabled={state.mode !== 'fixedFillet'} data-test="corner-radius" type="number" min={len.toDisplay(0.0001)} step={len.step(0.1)} value={Number.isFinite(state.radiusMm) ? len.toDisplay(state.radiusMm) : ''} onChange={(e) => state.setRadiusMm(e.currentTarget.value === '' ? NaN : len.fromDisplay(Number(e.currentTarget.value)))} /><span>{len.word()}</span></label>
    <label style={{ display: 'block', margin: '10px 0' }}><input type="checkbox" disabled={state.mode === 'trim'} checked={state.addDimension} onChange={(e) => state.setAddDimension(e.currentTarget.checked)} data-test="corner-add-dimension" /> Automatically add dimension</label>
    <p className="hint">Hold the left mouse button and paint over two endpoints to join them on release.</p>
    {state.mode === 'autoFillet' && <p className="hint">Include the rounded reference points in the stroke to fit the radius.</p>}
    {state.message && <p role="status" className="hint" data-test="corner-message">{state.message}</p>}
    <div className="toolrow"><button onClick={() => state.cancel()} data-test="corner-cancel">OK</button></div>
  </section>
}
