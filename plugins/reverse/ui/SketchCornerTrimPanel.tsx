// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from 'react'
import { useLength } from '../../../src/app/useUnits'
import type { SketchChains } from '../app/useReverseWorkspace'
import { useReverse } from '../state/reStore'
import { useSketchCornerTrim } from '../state/sketchCornerTrimStore'

type Fit = NonNullable<ReturnType<typeof useSketchCornerTrim.getState>['lastFit']>
type ScanFit = NonNullable<Fit['scanFit']>
function fitText(fit: Fit, len: ReturnType<typeof useLength>): string {
  const scan = fit.rms !== undefined ? ` · fitted to ${fit.usedPoints} scan points, ${len.fmt(fit.rms, 4)} RMS` : ''
  if (fit.unswept) return 'Sharp corner · the corner point was not painted'
  if (fit.shape === 'sharp') return `Sharp corner · the scan has no round here (${fit.usedPoints ?? 0} scan points between the lines)`
  return `Fillet R ${len.fmt(fit.radiusMm ?? NaN, 3)}${scan}`
}

/** How far the scan points the round was read from lie off the finished
 *  corner, against the sketch tolerance (Display › Analysis). */
function scanFitText(fit: ScanFit, len: ReturnType<typeof useLength>): string {
  const head = `Scan to corner: max ${len.fmt(fit.maxMm, 4)}, RMS ${len.fmt(fit.rmsMm, 4)} · tolerance ±${len.fmt(fit.toleranceMm, 4)}`
  return fit.exceeds ? `${head} · ${fit.over} of ${fit.points} points outside the tolerance` : `${head} · all ${fit.points} points within`
}

export function SketchCornerTrimPanel(_props: { chainsOf: () => SketchChains | null }) {
  const state = useSketchCornerTrim()
  const sketch = useReverse((s) => s.sketchDraft?.sketch)
  const len = useLength()
  // The last fillet's radius stays editable while it is the latest edit.
  const fillet = state.lastFillet && sketch && JSON.stringify(sketch) === state.lastFillet.madeKey ? state.lastFillet : null
  const shown = state.radiusPreview?.radiusMm ?? fillet?.radiusMm
  const [typed, setTyped] = useState<string | null>(null)
  useEffect(() => setTyped(null), [shown])
  const scanFit = state.radiusPreview ? state.radiusPreview.scanFit : state.lastFit?.scanFit
  if (!state.open) return null
  const takeTyped = () => {
    if (typed === null) return
    const v = Number(typed)
    setTyped(null)
    if (typed.trim() !== '' && Number.isFinite(v)) state.setFilletRadius(len.fromDisplay(v))
  }
  return <section className="draftbox" data-test="sketch-corner-trim-panel" aria-label="Corner trim">
    <div className="sec-head">Corner Trim</div>
    <div role="group" aria-label="Corner finishing mode">
      {([['trim', 'Corner Trim'], ['autoFillet', 'Auto Fillet'], ['fixedFillet', 'Fixed Size Fillet']] as const).map(([mode, label]) => <button key={mode} aria-pressed={state.mode === mode} className={state.mode === mode ? 'primary' : ''} style={{ display: 'block', width: '100%', margin: '6px 0' }} onClick={() => state.setMode(mode)} data-test={`corner-mode-${mode}`}>{label}</button>)}
    </div>
    <label className="field"><span>Radius</span><input disabled={state.mode !== 'fixedFillet'} data-test="corner-radius" type="number" min={len.toDisplay(0.0001)} step={len.step(0.1)} value={Number.isFinite(state.radiusMm) ? len.toDisplay(state.radiusMm) : ''} onChange={(e) => state.setRadiusMm(e.currentTarget.value === '' ? NaN : len.fromDisplay(Number(e.currentTarget.value)))} /><span>{len.word()}</span></label>
    <label style={{ display: 'block', margin: '10px 0' }}><input type="checkbox" disabled={state.mode === 'trim'} checked={state.addDimension} onChange={(e) => state.setAddDimension(e.currentTarget.checked)} data-test="corner-add-dimension" /> Automatically add dimension</label>
    <p className="hint">Hold the left mouse button and sweep across the corner: the area swept from where you pressed is filled, and the two lines, arcs or open curves it crosses are joined on release; painting over the point where two pieces would meet is enough, even short of their ends. Fillets round two lines, a line and an arc, or two arcs.</p>
    {state.mode === 'autoFillet' && <p className="hint">Hold left mouse down and paint over the corner point to get an automatic fillet: its radius is fitted to the scan section round the corner. Paint over the line ends only to join them sharp. Not for free-form corners.</p>}
    {state.mode === 'fixedFillet' && <p className="hint">Paint over the corner point to fillet at this radius; paint over the line ends only to join them sharp.</p>}
    {state.lastFit && <p className="hint" data-test="corner-last-fit">{fitText(state.lastFit, len)}</p>}
    {fillet && shown !== undefined && <>
      <label className="field" title="The radius of the fillet just made. Type a radius, or drag the square handle on the arc; each change is one undo step.">
        <span>Fillet radius</span>
        <input data-test="corner-fillet-radius" type="number" min={len.toDisplay(0.0001)} step={len.step(0.1)}
          value={typed ?? String(Number(len.toDisplay(shown).toFixed(len.decimals(4))))}
          onChange={(e) => setTyped(e.currentTarget.value)}
          onBlur={takeTyped}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); takeTyped() } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTyped(null) } }} />
        <span>{len.word()}</span>
      </label>
      <p className="hint">Drag the square handle on the arc to change the radius; the fillet stays tangent to both pieces.</p>
    </>}
    {scanFit && <p className={scanFit.exceeds ? 'hint warn' : 'hint'} data-test="corner-scan-fit" data-exceeds={scanFit.exceeds ? '1' : '0'}>{scanFitText(scanFit, len)}</p>}
    {state.message && <p role="status" className="hint" data-test="corner-message">{state.message}</p>}
    {state.pending && <div className="toolrow" data-test="corner-pending"><button className="primary" onClick={() => state.acceptPending()} data-test="corner-accept">Accept</button><button onClick={() => state.discardPending()} data-test="corner-discard">Discard</button></div>}
    <div className="toolrow"><button onClick={() => state.cancel()} data-test="corner-cancel">OK</button></div>
  </section>
}
