// SPDX-License-Identifier: AGPL-3.0-only
import { useLength } from '../../../src/app/useUnits'

// Scan Data → Scale: the Scale Mesh dialog. As in QUICKSURFACE, the factor is
// typed as a value or as a percentage, Preview shows what it comes to, and OK
// is offered only once the preview is current.

import { useState } from 'react'
import { useStore } from '../../../src/state/store'

interface Props {
  /** The scan's extent now, mm (X, Y, Z), for the preview readout. */
  size: [number, number, number] | null
  onApply: (factor: number) => void
  onClose: () => void
}

export function ScaleDialog({ size, onApply, onClose }: Props) {
  const len = useLength()
  const [mode, setMode] = useState<'value' | 'percent'>('percent')
  const [text, setText] = useState('100')
  const [previewed, setPreviewed] = useState<string | null>(null)
  const wireframe = useStore((s) => s.wireframe)
  const raw = Number(text)
  const factor = mode === 'percent' ? raw / 100 : raw
  const valid = Number.isFinite(factor) && factor > 0
  const switchMode = (m: 'value' | 'percent') => {
    if (m === mode) return
    setMode(m)
    setText(m === 'percent' ? String(+(factor * 100).toFixed(6)) : String(+factor.toFixed(6)))
    setPreviewed(null)
  }
  const preview = () =>
    setPreviewed(size ? `New size ${size.map((v) => len.fmt(v * factor, 2, { bare: true })).join(' × ')} ${len.word()}` : `Scale × ${factor}`)
  return (
    <div className="modalback" data-test="scale-dialog" onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <form
        className="modal"
        style={{ width: 260, display: 'grid', gap: 10, padding: 14 }}
        onSubmit={(e) => { e.preventDefault(); if (valid && previewed) { onApply(factor); onClose() } }}
      >
        <header style={{ fontWeight: 600 }}>Scale Mesh</header>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <label><input type="radio" checked={mode === 'value'} onChange={() => switchMode('value')} /> As a value</label>
          <label><input type="radio" checked={mode === 'percent'} onChange={() => switchMode('percent')} /> As a percentage</label>
        </div>
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          Scale by
          <input type="number" step="any" min="0" value={text} aria-label="Scale by" style={{ width: 100 }}
            onChange={(e) => { setText(e.target.value); setPreviewed(null) }} />
        </label>
        <button type="button" disabled={!valid} onClick={preview} data-test="scale-preview">Preview</button>
        {previewed && <small data-test="scale-preview-text">{previewed}</small>}
        <label><input type="checkbox" data-test="scale-wireframe" checked={wireframe} onChange={(e) => useStore.getState().setWireframe(e.target.checked)} /> Show mesh wireframe</label>
        {!valid && <small role="alert">Enter a scale greater than zero.</small>}
        <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!valid || !previewed}>OK</button>
        </footer>
      </form>
    </div>
  )
}
