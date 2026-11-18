// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { useLength } from '../../../src/app/useUnits'
import { useSketchPattern, type PatternPick } from '../state/sketchPatternStore'
import { useReverse } from '../state/reStore'
import { curveOf } from '../core/curveEval'
import { entityOf } from '../core/sketch'
import { MAX_INSTANCES, type CentreRef, type DirectionRef, type LinearDirection, type PatternMode, type PatternSpec } from '../core/sketchPatterns'

type FieldKind = 'length' | 'angle' | 'count'

/** A number of the panel: typed in the units shown (a length), degrees or a
 *  whole count. The text is the field's own while typed; every valid value
 *  is taken at once (the preview follows), and the field follows the value
 *  when it changes elsewhere (an arrow dragged, the units switched). */
function Field({ label, value, kind, testId, onValue, disabled, allowZero, allowNegative }: { label: string; value: number; kind: FieldKind; testId: string; onValue: (v: number) => void; disabled?: boolean; allowZero?: boolean; allowNegative?: boolean }) {
  const len = useLength()
  const ref = useRef<HTMLInputElement>(null)
  const shown = () => kind === 'length' ? String(Number(len.toDisplay(value).toFixed(6))) : String(Number(value.toFixed(6)))
  const [text, setText] = useState(shown)
  const unit = kind === 'length' ? len.word() : kind === 'angle' ? '°' : ''
  // A value changed elsewhere (an arrow dragged, units switched) replaces
  // the text; the field's own typing, which already gave this value, does not.
  useEffect(() => { const v = parse(text); if (v === null || Math.abs(v - value) > 1e-9 * Math.max(1, Math.abs(value))) setText(shown()) }, [value, unit]) // eslint-disable-line react-hooks/exhaustive-deps
  const parse = (t: string): number | null => {
    const n = Number(t)
    if (t.trim() === '' || !Number.isFinite(n)) return null
    if (kind === 'count') return Number.isInteger(n) && n >= 1 && n <= MAX_INSTANCES ? n : null
    if (!allowNegative && n < 0) return null
    if (!allowZero && n === 0) return null
    return kind === 'length' ? len.fromDisplay(n) : n
  }
  const bad = parse(text) === null
  return <label className="field">
    <span>{label}</span>
    <input ref={ref} data-test={testId} type="number" disabled={disabled} aria-invalid={bad} value={text}
      step={kind === 'count' ? 1 : kind === 'angle' ? 1 : len.step(1)} min={kind === 'count' ? 1 : undefined}
      onChange={(e) => { const t = e.currentTarget.value; setText(t); const v = parse(t); if (v !== null) onValue(v) }}
      onBlur={() => { if (bad) setText(shown()) }} />
    {unit && <span>{unit}</span>}
  </label>
}

const MODES: { mode: PatternMode; label: string; hint: string }[] = [
  { mode: 'linear', label: 'Linear', hint: 'Copies stepped along one or two directions (a row or a grid).' },
  { mode: 'circular', label: 'Circular', hint: 'Instances spread over a total angle about a centre.' },
  { mode: 'angular', label: 'Angular', hint: 'Copies turned by a fixed step about a pivot; by default the selection turns in place.' },
  { mode: 'alongCurve', label: 'Along curve', hint: 'Copies placed along a guide curve.' },
]

function refLabel(ref: DirectionRef): string {
  if (ref.kind === 'x') return 'Sheet X'
  if (ref.kind === 'y') return 'Sheet Y'
  const e = entityOf(useReverse.getState().sketchDraft?.sketch ?? { entities: [] } as never, ref.id)
  return e ? `${e.construction ? 'Construction line' : 'Line'} ${ref.id}` : 'missing line'
}
function centreLabel(ref: CentreRef): string {
  switch (ref.kind) {
    case 'origin': return 'Sheet origin'
    case 'selection': return 'Selection centre'
    case 'typed': return 'Typed'
    case 'point': return `Point ${ref.id}`
    case 'circle': return `Centre of ${ref.id}`
  }
}

function PickButton({ what, label, testId }: { what: Exclude<PatternPick, null>; label: string; testId: string }) {
  const picking = useSketchPattern((s) => s.picking)
  const arm = useSketchPattern((s) => s.arm)
  return <button data-test={testId} className={picking === what ? 'on' : undefined} aria-pressed={picking === what} onClick={() => arm(picking === what ? null : what)}>{picking === what ? 'Click on the sheet…' : label}</button>
}

function DirectionBox({ spec, which }: { spec: Extract<PatternSpec, { mode: 'linear' }>; which: 'd1' | 'd2' }) {
  const update = useSketchPattern((s) => s.update)
  const d = spec[which]
  const set = (next: Partial<LinearDirection>) => update({ ...spec, [which]: { ...d, ...next } })
  const n = which === 'd1' ? 1 : 2
  return <fieldset className="subbox" data-test={`pattern-${which}`}>
    <legend><label><input type="checkbox" data-test={`pattern-${which}-on`} checked={d.on} onChange={(e) => set({ on: e.currentTarget.checked })} /> Direction {n}</label></legend>
    {d.on && <>
      <div className="toolrow" role="radiogroup" aria-label={`Direction ${n} reference`}>
        <button role="radio" aria-checked={d.ref.kind === 'x'} className={d.ref.kind === 'x' ? 'on' : undefined} data-test={`pattern-${which}-x`} onClick={() => set({ ref: { kind: 'x' } })}>X</button>
        <button role="radio" aria-checked={d.ref.kind === 'y'} className={d.ref.kind === 'y' ? 'on' : undefined} data-test={`pattern-${which}-y`} onClick={() => set({ ref: { kind: 'y' } })}>Y</button>
        <PickButton what={which} label="Pick line" testId={`pattern-${which}-pick`} />
      </div>
      <p className="hint" data-test={`pattern-${which}-ref`}>Along: {refLabel(d.ref)}</p>
      <Field label="Instances" value={d.count} kind="count" testId={`pattern-${which}-count`} onValue={(v) => set({ count: v })} />
      <Field label="Spacing" value={d.spacing} kind="length" testId={`pattern-${which}-spacing`} allowNegative onValue={(v) => set({ spacing: v })} />
      <label><input type="checkbox" data-test={`pattern-${which}-flip`} checked={d.flip} onChange={(e) => set({ flip: e.currentTarget.checked })} /> Flip</label>
    </>}
  </fieldset>
}

export function SketchPatternPanel() {
  const st = useSketchPattern()
  const len = useLength()
  if (!st.open) return null
  const spec = st.spec
  const count = st.preview?.ok ? st.preview.ids.length : 0
  const copies = st.preview?.ok && st.ids.length ? Math.round(count / st.ids.length) : 0
  const sketch = useReverse.getState().sketchDraft?.sketch
  return <section className="draftbox" data-test="sketch-pattern-panel" aria-label="Duplicate / Pattern">
    <div className="sec-head">Duplicate / Pattern</div>
    <p className="hint" data-test="pattern-pieces">{st.ids.length} {st.ids.length === 1 ? 'piece' : 'pieces'} selected · instances include the original</p>
    <div className="moderow" role="radiogroup" aria-label="Pattern mode">
      {MODES.map((m) => <button key={m.mode} role="radio" title={m.hint} aria-checked={spec.mode === m.mode} className={spec.mode === m.mode ? 'on' : undefined} data-test={`pattern-mode-${m.mode}`} onClick={() => st.setMode(m.mode)}>{m.label}</button>)}
    </div>
    <p className="hint">{MODES.find((m) => m.mode === spec.mode)?.hint}</p>
    {spec.mode === 'linear' && <>
      <DirectionBox spec={spec} which="d1" />
      <DirectionBox spec={spec} which="d2" />
      <p className="hint">Drag an arrow's tip on the sheet to set its spacing.</p>
    </>}
    {spec.mode === 'circular' && <>
      <div className="toolrow">
        <button data-test="pattern-centre-origin" className={spec.centreRef.kind === 'origin' ? 'on' : undefined} onClick={() => st.update({ ...spec, centreRef: { kind: 'origin' } })}>Origin</button>
        <PickButton what="centre" label="Pick centre" testId="pattern-centre-pick" />
      </div>
      <p className="hint" data-test="pattern-centre">Centre: {centreLabel(spec.centreRef)}</p>
      <Field label="Instances" value={spec.count} kind="count" testId="pattern-count" onValue={(v) => st.update({ ...spec, count: v })} />
      <Field label="Total angle" value={spec.totalDeg} kind="angle" testId="pattern-total" onValue={(v) => st.update({ ...spec, totalDeg: v })} />
      <Field label="Increment" value={spec.count > 1 ? spec.totalDeg / (Math.abs(spec.totalDeg - 360) < 1e-9 ? spec.count : spec.count - 1) : 0} kind="angle" testId="pattern-increment" disabled={spec.count < 2}
        onValue={(v) => st.update({ ...spec, totalDeg: Math.min(360, v * (spec.count - 1)) })} />
      <div className="toolrow" role="radiogroup" aria-label="Turn direction">
        <button role="radio" aria-checked={spec.ccw} className={spec.ccw ? 'on' : undefined} data-test="pattern-ccw" onClick={() => st.update({ ...spec, ccw: true })}>CCW</button>
        <button role="radio" aria-checked={!spec.ccw} className={!spec.ccw ? 'on' : undefined} data-test="pattern-cw" onClick={() => st.update({ ...spec, ccw: false })}>CW</button>
      </div>
      <label><input type="checkbox" data-test="pattern-keep-orientation" checked={spec.keepOrientation} onChange={(e) => st.update({ ...spec, keepOrientation: e.currentTarget.checked })} /> Keep original orientation</label>
      <p className="hint">360° spreads the instances evenly with none on the original; less puts the last at the end of the span.</p>
    </>}
    {spec.mode === 'angular' && <>
      <div className="toolrow">
        <button data-test="pattern-pivot-selection" className={spec.pivotRef.kind === 'selection' ? 'on' : undefined} onClick={() => st.update({ ...spec, pivotRef: { kind: 'selection' } })}>In place</button>
        <button data-test="pattern-pivot-origin" className={spec.pivotRef.kind === 'origin' ? 'on' : undefined} onClick={() => st.update({ ...spec, pivotRef: { kind: 'origin' } })}>Origin</button>
        <PickButton what="pivot" label="Pick pivot" testId="pattern-pivot-pick" />
      </div>
      <p className="hint" data-test="pattern-pivot">Pivot: {centreLabel(spec.pivotRef)}</p>
      <Field label="Instances" value={spec.count} kind="count" testId="pattern-count" onValue={(v) => st.update({ ...spec, count: v })} />
      <Field label="Step" value={spec.stepDeg} kind="angle" testId="pattern-step" onValue={(v) => st.update({ ...spec, stepDeg: v })} />
      <Field label="Range" value={spec.stepDeg * Math.max(0, spec.count - 1)} kind="angle" testId="pattern-range" disabled={spec.count < 2} onValue={(v) => st.update({ ...spec, stepDeg: v / (spec.count - 1) })} />
      <label><input type="checkbox" data-test="pattern-flip" checked={spec.flip} onChange={(e) => st.update({ ...spec, flip: e.currentTarget.checked })} /> Flip (clockwise)</label>
      <label><input type="checkbox" data-test="pattern-keep-orientation" checked={spec.keepOrientation} onChange={(e) => st.update({ ...spec, keepOrientation: e.currentTarget.checked })} /> Keep original orientation</label>
    </>}
    {spec.mode === 'alongCurve' && <>
      <div className="toolrow"><PickButton what="curve" label="Pick guide curve" testId="pattern-curve-pick" /></div>
      <p className="hint" data-test="pattern-curve">Guide: {(() => {
        const g = spec.curve !== null && sketch ? entityOf(sketch, spec.curve) : undefined
        const c = g ? curveOf(g) : null
        return g && c ? `${g.kind} ${g.id}, length ${len.toDisplay(c.length).toFixed(3)} ${len.word()}` : 'not picked'
      })()}</p>
      <Field label="Instances" value={spec.count} kind="count" testId="pattern-count" onValue={(v) => st.update({ ...spec, count: v })} />
      <label><input type="checkbox" data-test="pattern-equal" checked={spec.equal} onChange={(e) => st.update({ ...spec, equal: e.currentTarget.checked })} /> Equal spacing (by arc length)</label>
      <Field label="Spacing" value={spec.spacing} kind="length" testId="pattern-spacing" disabled={spec.equal} onValue={(v) => st.update({ ...spec, spacing: v })} />
      <Field label="Start offset" value={spec.startOffset} kind="length" testId="pattern-start-offset" allowZero onValue={(v) => st.update({ ...spec, startOffset: v })} />
      <Field label="End offset" value={spec.endOffset} kind="length" testId="pattern-end-offset" allowZero onValue={(v) => st.update({ ...spec, endOffset: v })} />
      <label><input type="checkbox" data-test="pattern-reverse" checked={spec.reverse} onChange={(e) => st.update({ ...spec, reverse: e.currentTarget.checked })} /> Reverse (start from the other end)</label>
      <div className="toolrow" role="radiogroup" aria-label="Orientation">
        <button role="radio" aria-checked={spec.tangent} className={spec.tangent ? 'on' : undefined} data-test="pattern-tangent" onClick={() => st.update({ ...spec, tangent: true })}>Follow tangent</button>
        <button role="radio" aria-checked={!spec.tangent} className={!spec.tangent ? 'on' : undefined} data-test="pattern-keep" onClick={() => st.update({ ...spec, tangent: false })}>Keep original</button>
      </div>
      <p className="hint">The original stands for the first instance, at the start of the curve; the copies keep its offset from the curve.</p>
    </>}
    {st.message && <p role="status" className="hint" data-test="pattern-message">{st.message}</p>}
    <p className="hint" data-test="pattern-summary">{copies ? `${copies + 1} instances: ${count} new ${count === 1 ? 'piece' : 'pieces'}` : 'No copies yet'}</p>
    <div className="toolrow">
      <button className="primary" disabled={!count} onClick={() => st.accept()} data-test="pattern-accept">Accept{count ? ` (${count})` : ''}</button>
      <button onClick={() => st.cancel()} data-test="pattern-cancel">Cancel</button>
    </div>
  </section>
}
