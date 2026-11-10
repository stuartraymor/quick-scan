// SPDX-License-Identifier: AGPL-3.0-only
import { useLength } from '../app/useUnits'
import { useLengthDraft } from '../app/useLengthDraft'

import { useEffect, useRef, useState } from 'react'
import type { SceneManager } from '../viewer/SceneManager'
import type { StandardView } from '../viewer/orthoViewport'
import { useNavigationView } from '../state/navigationViewStore'
import './navigation-corner.css'

export function NavigationCorner({ scene, open }: { scene: () => SceneManager | null; open: boolean }) {
  const len = useLength()
  const coordinates = useNavigationView(s => s.coordinates)
  const grid = useNavigationView(s => s.grid)
  const spacing = useNavigationView(s => s.spacing)
  const [pinned, setPinned] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [dialog, setDialog] = useState(false)
  const [enabled, setEnabled] = useState(grid)
  const [value, setValue, spacingMm] = useLengthDraft(spacing)
  const modal = useRef<HTMLDialogElement>(null)
  const visible = !dismissed && (open || pinned || dialog)
  useEffect(() => { if (!open) setDismissed(false) }, [open])
  useEffect(() => {
    if (dialog) modal.current?.showModal()
    else modal.current?.close()
  }, [dialog])
  const view = (v: StandardView) => scene()?.viewFrom(v)
  const valid = Number.isFinite(Number(value)) && Number(value) > 0
  return <div className={`navigation-corner${visible ? ' expanded' : ''}`} data-test="navigation-corner" onKeyDown={e => {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); setPinned(false); setDismissed(true)
      ;(e.target as HTMLElement).blur()
    }
  }}>
    <button className="navigation-home" aria-label="Isometric view" title="Isometric" onClick={() => view('iso')}><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"><path d="m2 7 6-5 6 5M4 6v8h3v-5h3v5h2V6" /></svg></button>
    <button className="navigation-toggle" aria-label="View navigation menu" aria-expanded={visible} onClick={() => { setDismissed(false); setPinned(!pinned) }}>▾</button>
    {visible && <>
      <div className="navigation-ring" aria-hidden="true" />
      <button className="navigation-orbit up" aria-label="Rotate view up" onClick={() => scene()?.orbitView('up')}>▲</button>
      <button className="navigation-orbit down" aria-label="Rotate view down" onClick={() => scene()?.orbitView('down')}>▼</button>
      <button className="navigation-orbit left" aria-label="Rotate view left" onClick={() => scene()?.orbitView('left')}>◀</button>
      <button className="navigation-orbit right" aria-label="Rotate view right" onClick={() => scene()?.orbitView('right')}>▶</button>
      <div className="navigation-menu" role="group" aria-label="View navigation">
        <button data-test="corner-fit" onClick={() => scene()?.fitToView()}>Zoom to Fit (A)</button>
        <div><button onClick={() => scene()?.rollView(-90)}>90° Left</button><button onClick={() => scene()?.rollView(90)}>90° Right</button></div>
        <div><button onClick={() => view('top')}>Top</button><button onClick={() => view('bottom')}>Bottom</button></div>
        <div><button onClick={() => view('left')}>Left</button><button onClick={() => view('right')}>Right</button></div>
        <div><button onClick={() => view('front')}>Front</button><button onClick={() => view('rear')}>Back</button></div>
        <button onClick={() => view('iso')}>Isometric</button>
        <button aria-pressed={coordinates} onClick={() => useNavigationView.getState().setCoordinates(!coordinates)}>{coordinates ? '✓ ' : ''}Coordinate System</button>
        <button aria-pressed={grid} onClick={() => { setEnabled(grid); setValue(String(len.toDisplay(spacing))); setDialog(true) }}>{grid ? '✓ ' : ''}Grid ...</button>
      </div>
    </>}
    <dialog ref={modal} className="navigation-grid-dialog" aria-labelledby="navigation-grid-title" onKeyDown={e => e.stopPropagation()} onCancel={() => setDialog(false)} onClose={() => setDialog(false)}>
      <form onSubmit={e => { e.preventDefault(); if (valid) { useNavigationView.getState().setGrid(enabled, spacingMm); setDialog(false) } }}>
        <header id="navigation-grid-title">Grid</header>
        <label><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Enable</label>
        <label>Spacing <input aria-label="Grid spacing" type="number" min="0" step="any" value={value} onChange={e => setValue(e.target.value)} /> {len.word()}</label>
        {!valid && <small role="alert">Enter a spacing greater than zero.</small>}
        <footer><button type="submit" disabled={!valid}>OK</button><button type="button" onClick={() => setDialog(false)}>Cancel</button></footer>
      </form>
    </dialog>
  </div>
}
