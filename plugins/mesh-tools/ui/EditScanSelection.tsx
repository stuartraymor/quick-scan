// SPDX-License-Identifier: AGPL-3.0-only
// The selection block of QUICKSURFACE's Edit Scan dialog, recorded live on
// 8.0.128: the selection tools Extract primitives has, the degrees slider,
// Select all connected triangles, and nine small tools in its order —
// Enlarge, Shrink, Isolate, Hide selected, Show all hidden, Make hidden
// visible and the visible hidden, Invert selection, Deselect all (Ctrl + Q)
// and Select all.

import { Icon } from '../../../src/ui/icons'
import { ExtractIcon, type ExtractIconName } from '../../../src/ui/ExtractIcon'
import { SELECTION_TOOLS, WandDegreesField, type Tool } from '../../../src/ui/ExtractPrimitives'
import { useMark, WAND_MAX_DEG, WAND_MIN_DEG } from '../../../src/state/markStore'
import { useShell } from '../../../src/state/shellStore'
import { meshHotkeys } from '../app/meshHotkeys'

export function EditScanSelection({ busy }: { busy: boolean }) {
  const m = useMark()
  const hidden = useShell((s) => s.hiddenTriangles)
  const none = busy || m.count === 0
  const on = (t: Tool) => (t.id === 'through' ? m.backfaces : m.gesture === t.id)
  const pick = (t: Tool) => (t.id === 'through' ? m.setBackfaces(!m.backfaces) : m.setGesture(t.id))
  const key = (test: string, icon: ExtractIconName | 'eye' | 'markInvert', title: string, run: () => void, disabled: boolean) => (
    <button data-test={`edit-scan-${test}`} disabled={disabled} title={title} onClick={run}>{icon === 'eye' || icon === 'markInvert' ? <Icon name={icon} size={20} /> : <ExtractIcon name={icon} size={20} />}</button>
  )
  return (
    <div className="group edit-scan-selection" data-test="edit-scan-selection">
      <div className="qs-iconrow" role="toolbar" aria-label="Selection tools">
        {SELECTION_TOOLS.map((t) => (
          <button key={String(t.id)} className={on(t) ? 'on' : undefined} aria-pressed={on(t)} disabled={busy} data-test={`edit-scan-tool-${t.id ?? 'navigate'}`} title={t.title} onClick={() => pick(t)}>
            <ExtractIcon name={t.icon} size={20} />
          </button>
        ))}
      </div>
      <div className="qs-degrees">
        <input type="range" min={WAND_MIN_DEG} max={WAND_MAX_DEG} step={0.01} value={m.wandDegrees} disabled={m.wandConnected} aria-label="Sensitivity in degrees" onChange={(e) => m.setWandDegrees(Number(e.target.value))} />
        <WandDegreesField />
        <span>degrees</span>
      </div>
      <label className="checkrow">
        <input type="checkbox" checked={m.wandConnected} onChange={(e) => m.setWandConnected(e.target.checked)} />
        <span>Select all connected triangles</span>
      </label>
      <div className="qs-iconrow" role="toolbar" aria-label="Selection options">
        {key('enlarge', 'enlarge', 'Enlarge currently selected area', () => m.resize(1), none)}
        {key('shrink', 'shrink', 'Shrink currently selected area', () => m.resize(-1), none)}
        {key('isolate', 'isolate', 'Isolate (leave selected and hide others)', () => meshHotkeys.hide?.('unselected'), none)}
        {key('hide', 'hide', 'Hide selected triangles', () => meshHotkeys.hide?.('selected'), none)}
        {key('show-all', 'show', 'Shows all hidden triangles if any', () => meshHotkeys.showAll?.(), busy || hidden === 0)}
        {key('swap-hidden', 'eye', 'Makes hidden triangles visible and the visible hidden', () => meshHotkeys.swapHidden?.(), busy || hidden === 0)}
        {key('invert', 'markInvert', 'Invert Selection', () => m.invert(), none)}
        {key('deselect', 'deselect', 'Deselect all selected triangles (Ctrl + Q)', () => meshHotkeys.deselect?.(), none)}
        {key('select-all', 'all', 'Select all triangles', () => { meshHotkeys.deselect?.(); m.invert() }, busy)}
      </div>
      <p className="qs-count">{m.count === 0 ? 'Nothing selected' : `${m.count.toLocaleString('en-US')} points selected`}</p>
    </div>
  )
}
