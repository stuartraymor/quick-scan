// SPDX-License-Identifier: AGPL-3.0-only
import { useSketchMirror } from '../state/sketchMirrorStore'

export function SketchMirrorPanel() {
  const state = useSketchMirror()
  if (!state.open) return null
  const count = state.preview?.ok ? state.preview.ids.length : 0
  return <section className="draftbox" data-test="sketch-mirror-panel" aria-label="Mirror">
    <div className="sec-head">Mirror</div>
    <p className="hint" data-test="mirror-pieces">{state.ids.length} {state.ids.length === 1 ? 'piece' : 'pieces'} selected</p>
    <p className="hint" data-test="mirror-axis">Mirror line: {state.axis ? state.axis.label : 'not picked'}</p>
    <p className="hint">Click a line, construction line, sketch axis or plane trace on the sheet. The pieces may be any distance from it; the originals stay as they are and the copies are not joined to them.</p>
    {state.message && <p role="status" className="hint" data-test="mirror-message">{state.message}</p>}
    <div className="toolrow">
      <button className="primary" disabled={!count} onClick={() => state.accept()} data-test="mirror-accept">Accept{count ? ` (${count})` : ''}</button>
      <button onClick={() => state.cancel()} data-test="mirror-cancel">Cancel</button>
    </div>
  </section>
}
