// SPDX-License-Identifier: AGPL-3.0-only
// Surfacing → Pipe: pick the path sketch, type the diameter, and the pipe
// opens as a Sweep — the circle drawn square to the path's start — whose
// preview and Create / OK are the sweep editor's own.

import { useState } from 'react'
import { create } from 'zustand'
import { useStore } from '../../../src/state/store'
import { DEFAULT_PIPE_DIAMETER_MM, pipeFrame, pipePaths, pipeSketch } from '../core/pipe'
import { useReverse } from '../state/reStore'

/** Whether the Pipe dialog is up. */
export const usePipeDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }))

/** Draws the pipe's circle as a sketch and opens the sweep along `pathId`. */
export function startPipe(pathId: number, diameter: number): boolean {
  const re = useReverse.getState()
  const path = re.features.find((f) => f.kind === 'sketch' && f.id === pathId)
  if (!path || path.kind !== 'sketch') return false
  const frame = pipeFrame(path)
  if (typeof frame === 'string') { useStore.getState().setError(frame); return false }
  re.startSketch({ kind: 'fitted', frame, label: 'Pipe profile' }, frame)
  useReverse.getState().setSketch(pipeSketch(diameter))
  useReverse.getState().setSketchName(`Pipe profile ⌀${diameter}`)
  const profile = useReverse.getState().commitSketch()
  if (profile === null) return false
  useReverse.getState().startFeature('sweep')
  useReverse.setState((s) => (s.featureDraft?.kind === 'sweep' ? { featureDraft: { ...s.featureDraft, profile, path: pathId } } : {}))
  useStore.getState().setStatus(`Pipe ⌀${diameter} mm along ${path.name} — check the preview, then Create.`)
  return true
}

export function PipeDialog({ onClose }: { onClose: () => void }) {
  const paths = pipePaths(useReverse((s) => s.features))
  const [pathId, setPathId] = useState<number | null>(paths[paths.length - 1]?.id ?? null)
  const [text, setText] = useState(String(DEFAULT_PIPE_DIAMETER_MM))
  const diameter = Number(text)
  const valid = Number.isFinite(diameter) && diameter > 0 && pathId !== null
  return (
    <div className="modalback" data-test="pipe-dialog" onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      <form
        className="modal"
        style={{ width: 280, display: 'grid', gap: 10, padding: 14 }}
        onSubmit={(e) => { e.preventDefault(); if (valid && startPipe(pathId!, diameter)) onClose() }}
      >
        <header style={{ fontWeight: 600 }}>Pipe</header>
        {paths.length === 0
          ? <small role="alert">Draw an open path in a 2D sketch first — lines, arcs or a spline end to end.</small>
          : <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              Path
              <select aria-label="Path" value={pathId ?? ''} onChange={(e) => setPathId(Number(e.target.value))}>
                {paths.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>}
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          Diameter (mm)
          <input type="number" step="any" min="0" value={text} aria-label="Diameter" style={{ width: 100 }} onChange={(e) => setText(e.target.value)} />
        </label>
        <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!valid} data-test="pipe-ok">OK</button>
        </footer>
      </form>
    </div>
  )
}
