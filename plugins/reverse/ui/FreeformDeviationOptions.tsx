// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLength } from '../../../src/app/useUnits'
import { fromDisplay } from '../../../src/core/units'
import type { PreviewColouring } from '../core/freeform/previewDeviation'

/** New Freeform's analysis settings are a transaction, independent of CAD fitting. */
export function FreeformDeviationOptions({ tolerance, colouring, onApply, onClose }: {
  tolerance: number; colouring: PreviewColouring
  onApply(tolerance: number, colouring: PreviewColouring): void
  onClose(): void
}) {
  const length = useLength()
  // Analysis thresholds must not round to the general six-decimal length
  // input format when switching to inches or metres.
  const [draft, setDraft] = useState({ text: String(length.toDisplay(tolerance)), units: length.units })
  const mm = fromDisplay(Number(draft.text), draft.units)
  const text = draft.units === length.units ? draft.text : String(length.toDisplay(mm))
  const [draftColouring, setDraftColouring] = useState(colouring)
  const dialog = useRef<HTMLDialogElement>(null)
  const close = () => { dialog.current?.close(); onClose() }
  const valid = draft.text.trim() !== '' && Number.isFinite(mm) && mm > 0 && Number.isFinite(5 * mm)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    element.querySelector('input')?.select()
    return () => { element.close() }
  }, [])
  return createPortal(<dialog ref={dialog} className="ff-deviation-options" aria-label="Deviation Options"
    data-test="freeform-deviation-options" onCancel={e => { e.preventDefault(); close() }}
    onKeyDown={e => e.stopPropagation()}>
    <form onSubmit={e => { e.preventDefault(); if (valid) { onApply(mm, draftColouring); close() } }}>
      <header><span>Deviation Options</span><button type="button" aria-label="Close Deviation Options" onClick={close}>×</button></header>
      <label className="ff-deviation-value">Tolerance (+/-)
        <input autoFocus aria-label="Deviation tolerance" aria-invalid={!valid} type="number" step="any"
          value={text} onChange={e => setDraft({ text: e.target.value, units: length.units })} /> <span>{length.word()}</span>
      </label>
      <fieldset><legend>Colouring</legend>
        <label><input type="radio" name="freeform-colouring" checked={draftColouring === 'pass-fail'} onChange={() => setDraftColouring('pass-fail')} />Pass / Fail</label>
        <label><input type="radio" name="freeform-colouring" checked={draftColouring === 'gradient'} onChange={() => setDraftColouring('gradient')} />Gradient</label>
      </fieldset>
      {!valid && <small role="alert">Enter a positive, finite tolerance.</small>}
      <footer><button type="submit" data-test="deviation-options-ok" disabled={!valid}>OK</button><button type="button" onClick={close}>Cancel</button></footer>
    </form>
  </dialog>, document.body)
}
