// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react'
import { useLength } from '../../../src/app/useUnits'
import type { SketchChains } from '../app/useReverseWorkspace'
import { useReverse } from '../state/reStore'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'

export function SketchCornerTrimPanel({ chainsOf }: { chainsOf: () => SketchChains | null }) {
  const state = useSketchCornerTrim()
  const draft = useReverse((s) => s.sketchDraft)
  const len = useLength()
  const selection = draft?.selection.join(',') ?? ''
  useEffect(() => {
    if (state.open && draft?.selection.length === 2) useSketchCornerTrim.getState().previewSelected(chainsOf()?.chains.flat() ?? [])
  }, [state.open, selection, draft?.sketch])
  if (!state.open) return null
  const preview = state.preview?.ok ? state.preview : null
  return <section className="draftbox" data-test="sketch-corner-trim-panel" aria-label="Corner trim">
    <div className="sec-head">Corner trim</div>
    <div role="radiogroup" aria-label="Corner finishing mode">
      {([['trim', 'Corner Trim'], ['autoFillet', 'Auto Fillet'], ['fixedFillet', 'Fixed Size Fillet']] as const).map(([mode, label]) => <label key={mode} style={{ display: 'block', margin: '8px 0' }}>
        <input type="radio" name="sketch-corner-mode" checked={state.mode === mode} onChange={() => state.setMode(mode)} data-test={`corner-mode-${mode}`} /> {label}
      </label>)}
    </div>
    {state.mode === 'fixedFillet' && <label className="field"><span>Radius</span><input data-test="corner-radius" type="number" min={len.toDisplay(0.0001)} step={len.step(0.1)} value={Number.isFinite(state.radiusMm) ? len.toDisplay(state.radiusMm) : ''} onChange={(e) => state.setRadiusMm(e.currentTarget.value === '' ? NaN : len.fromDisplay(Number(e.currentTarget.value)))} /><span>{len.word()}</span></label>}
    {state.mode !== 'trim' && <label style={{ display: 'block', margin: '10px 0' }}><input type="checkbox" checked={state.addDimension} onChange={(e) => state.setAddDimension(e.currentTarget.checked)} data-test="corner-add-dimension" /> Automatically add dimension</label>}
    <p className="hint">Shift + left mouse drag: box one corner. Or select exactly two lines and preview. Green geometry is provisional until Apply.</p>
    {state.mode === 'autoFillet' && <p className="hint">Highlight the rounded section points as well as the two lines. The radius is fitted from those points.</p>}
    <button data-test="corner-preview-selected" onClick={() => state.previewSelected(chainsOf()?.chains.flat() ?? [])}>Preview selected lines</button>
    {preview?.radiusMm !== undefined && <p data-test="corner-preview-radius">Radius {len.fmt(preview.radiusMm, 4)}{preview.usedPoints !== undefined ? ` · ${preview.usedPoints} reference points · RMS ${len.fmt(preview.rms ?? 0, 4)}` : ''}</p>}
    {state.message && <p role="status" className="hint" data-test="corner-message">{state.message}</p>}
    <div className="toolrow"><button className="primary" disabled={!preview} onClick={() => state.apply()} data-test="corner-apply">Apply</button><button disabled={!draft?.history.length} onClick={() => state.undo()} data-test="corner-undo">Undo</button><button onClick={() => state.cancel()} data-test="corner-cancel">Back</button></div>
  </section>
}
