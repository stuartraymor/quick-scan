// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react'
import { create } from 'zustand'
import { runCommand } from '../../../src/commands/registry'
import { useStore } from '../../../src/state/store'
import { AUTO_QUADS_MAX, AUTO_QUADS_MIN, AUTO_SYMMETRIES, AUTO_TARGETS, type AutoSymmetry } from '../core/freeform/auto'
import { reEditorOpen, useReverse } from '../state/reStore'

export const useAutoFreeformDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>(set => ({
  open: false, setOpen: open => set({ open }),
}))

export function AutoFreeformDialog({ onClose }: { onClose: () => void }) {
  const [density, setDensity] = useState<keyof typeof AUTO_TARGETS | 'custom'>('medium')
  const [custom, setCustom] = useState('2000')
  const [symmetry, setSymmetry] = useState<AutoSymmetry>('none')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const count = density === 'custom' ? Number(custom) : AUTO_TARGETS[density]
  const valid = Number.isInteger(count) && count >= AUTO_QUADS_MIN && count <= AUTO_QUADS_MAX
  const close = () => { if (!working) onClose() }
  async function generate() {
    if (!valid || working) return
    const state = useReverse.getState(), scan = useStore.getState()
    if (!scan.fileName || scan.busy || state.building || state.playback !== null || reEditorOpen(state)) {
      setError('Import a scan and finish the current operation first.')
      return
    }
    setWorking(true)
    setError('')
    try {
      await runCommand('reverse.freeform.auto', { algorithm: 'basic', quads: count, symmetry }, text => useStore.getState().setStatus(text))
      useStore.getState().setStatus('Auto Freeform created.')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setWorking(false) }
  }
  return <div className="modalback" data-test="auto-freeform-dialog" onKeyDown={e => {
    e.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); close() }
  }}>
    <form className="modal" role="dialog" aria-modal="true" aria-labelledby="auto-freeform-title"
      style={{ width: 330, display: 'grid', gap: 12, padding: 14 }}
      onSubmit={e => { e.preventDefault(); void generate() }}>
      <header id="auto-freeform-title" style={{ fontWeight: 600 }}>Auto Freeform</header>
      <fieldset disabled={working} style={{ display: 'grid', gap: 10, border: 0, padding: 0, margin: 0 }}>
        <label>Algorithm <select aria-label="Algorithm" value="basic" disabled><option value="basic">Basic</option></select></label>
        <label>Target Quads Count <select autoFocus aria-label="Target Quads Count" value={density} onChange={e => setDensity(e.target.value as typeof density)}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="fine">Fine</option><option value="custom">Custom</option>
        </select></label>
        {density === 'custom' && <label>Quads <input aria-label="Quads" type="number" min={AUTO_QUADS_MIN} max={AUTO_QUADS_MAX} step="1" value={custom} onChange={e => setCustom(e.target.value)} /></label>}
        <label>Symmetry <select aria-label="Symmetry" value={symmetry} onChange={e => setSymmetry(e.target.value as AutoSymmetry)}>
          {AUTO_SYMMETRIES.map(s => <option key={s} value={s}>{s === 'none' ? 'None' : s.toUpperCase()}</option>)}
        </select></label>
      </fieldset>
      {error && <small role="alert">{error}</small>}
      {working && <small role="status">Creating freeform surface…</small>}
      <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" disabled={working} onClick={close}>Cancel</button>
        <button type="submit" data-test="auto-freeform-ok" disabled={!valid || working}>OK</button>
      </footer>
    </form>
  </div>
}
