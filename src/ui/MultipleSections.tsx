// SPDX-License-Identifier: AGPL-3.0-only
// Main → Multiple sections: QUICKSURFACE 8.0.128's dialog, recorded live —
// a stack of parallel cross sections at a spacing, square to OXY, OYZ, OXZ
// or a plane of the part, from an offset in one direction or both. Preview
// cuts them so they can be looked at, Create keeps them, Close without
// Create takes the previewed ones away. Each is an ordinary section of the
// part, cut by the same worker as one made on its own.

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../state/store'
import { useShell } from '../state/shellStore'
import { sectionDraftReady } from '../state/sectionModel'
import type { SectionPlaneRef } from '../core/section/frame'

type Direction = 'both' | 'positive' | 'negative'

/** The offsets of the stack: from `offset`, `spacing` apart, in the
 *  direction asked, across `[lo, hi]` — the part's span along the normal. */
export function sectionOffsets(offset: number, spacing: number, direction: Direction, lo: number, hi: number, max = 500): number[] {
  if (!(spacing > 0)) return [offset]
  const out: number[] = []
  // Stepped from the offset, kept where they cross the part: a stack
  // started off the part still lands on it.
  const steps = (from: number, step: number) => {
    const n0 = step > 0 ? Math.max(0, Math.ceil((lo - from) / step)) : Math.max(0, Math.ceil((from - hi) / -step))
    for (let i = n0; out.length < max; i++) {
      const o = from + i * step
      if (o < lo - 1e-9 || o > hi + 1e-9) break
      out.push(o)
    }
  }
  if (direction !== 'negative') steps(offset, spacing)
  if (direction !== 'positive') steps(direction === 'both' ? offset - spacing : offset, -spacing)
  return out.sort((a, b) => a - b)
}

/** Wait for the open section draft to be cut — or found to cut nothing. */
function settled(): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (ok: boolean) => { stop(); clearTimeout(timer); resolve(ok) }
    const check = () => {
      const d = useStore.getState().sectionDraft
      if (!d) return done(false)
      if (sectionDraftReady(d)) return done(true)
      if (d.status === 'failed' || (d.status === 'ready' && !sectionDraftReady(d))) return done(false)
    }
    const stop = useStore.subscribe(check)
    const timer = setTimeout(() => done(false), 15000)
    check()
  })
}

const AXES: { id: 'z' | 'x' | 'y'; label: string }[] = [
  { id: 'z', label: 'OXY' },
  { id: 'x', label: 'OYZ' },
  { id: 'y', label: 'OXZ' },
]

export function MultipleSections({ onClose }: { onClose: () => void }) {
  const elements = useStore((s) => s.elements)
  const planes = elements.filter((e) => e.fit?.kind === 'plane')
  const [ref, setRef] = useState<SectionPlaneRef>('z')
  const [offset, setOffset] = useState('0')
  const [spacing, setSpacing] = useState('10')
  const [direction, setDirection] = useState<Direction>('both')
  const [made, setMade] = useState<number[]>([])
  const [working, setWorking] = useState<string | null>(null)

  const span = (): [number, number] => {
    const s = useStore.getState()
    // The part's reach along the plane's normal, about the origin the
    // offsets count from: the scan's centre and its size, generously.
    const axis = typeof ref === 'string' ? 'xyz'.indexOf(ref) : -1
    const c = axis >= 0 ? s.modelCenter[axis] : 0
    return [c - s.modelSize, c + s.modelSize]
  }

  const cut = async (): Promise<number[]> => {
    const [lo, hi] = span()
    const offsets = sectionOffsets(Number(offset), Number(spacing), direction, lo, hi)
    const ids: number[] = []
    const st = useStore.getState
    for (let i = 0; i < offsets.length; i++) {
      setWorking(`Cutting section ${i + 1} of ${offsets.length}…`)
      // The cutter lets go of the last job a moment after it ends: a new
      // draft opened inside that moment would be taken for the old one.
      await new Promise((r) => setTimeout(r, 0))
      st().startSection()
      st().setSectionDraftRef(ref)
      st().setSectionDraftOffset(offsets[i])
      if (await settled()) {
        const id = st().commitSection()
        if (id !== null) ids.push(id)
      } else st().cancelSection()
    }
    setWorking(null)
    st().setStatus(ids.length > 0 ? `${ids.length} sections cut, ${spacing} mm apart.` : 'No section crosses the part — check the offset and the direction.')
    return ids
  }
  const discard = (ids: number[]) => ids.forEach((id) => useStore.getState().removeSection(id))

  const preview = async () => { discard(made); setMade(await cut()) }
  const create = async () => { if (made.length === 0) await cut(); setMade([]); onClose() }
  const close = () => { discard(made); setMade([]); onClose() }
  const changed = () => { if (made.length > 0) { discard(made); setMade([]) } }
  const soon = 'Not built in Quick Scan yet'

  return createPortal(
    <section className="qs-dialog multiple-sections" data-test="multiple-sections" aria-label="Multiple sections"
      style={{ position: 'fixed', left: 270, top: 230, width: 300, zIndex: 60 }}>
      <header><b>Multiple sections</b><button className="qs-x" title="Close" disabled={working !== null} onClick={close}>×</button></header>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {AXES.map((a) => (
          <button key={a.id} data-test={`sections-${a.label}`} className={ref === a.id ? 'on' : undefined} aria-pressed={ref === a.id} disabled={working !== null}
            onClick={() => { setRef(a.id); changed() }}>{a.label}</button>
        ))}
      </div>
      <select data-test="sections-parallel" value={String(ref)} disabled={working !== null} onChange={(e) => { const v = e.target.value; setRef(v === 'x' || v === 'y' || v === 'z' ? v : Number(v)); changed() }}>
        {AXES.map((a) => <option key={a.id} value={a.id}>Parallel to {a.label}</option>)}
        {planes.map((p) => <option key={p.id} value={p.id}>Parallel to {p.name}</option>)}
      </select>
      <label className="checkrow" title={soon}><input type="checkbox" disabled /><span>Curve guided</span></label>
      <label className="field"><span>Offset</span><input type="number" step="any" value={offset} data-test="sections-offset" onChange={(e) => { setOffset(e.target.value); changed() }} /><span>mm</span></label>
      <label className="field"><span>Spacing</span><input type="number" step="any" min="0" value={spacing} data-test="sections-spacing" onChange={(e) => { setSpacing(e.target.value); changed() }} /><span>mm</span></label>
      <label className="field"><span>Direction</span>
        <select value={direction} data-test="sections-direction" onChange={(e) => { setDirection(e.target.value as Direction); changed() }}>
          <option value="both">Both</option><option value="positive">Positive</option><option value="negative">Negative</option>
        </select>
      </label>
      <label className="field" title={soon}><span>Cloud Capture</span><input type="number" value={10} disabled /><span>mm</span></label>
      <label className="checkrow" title={soon}><input type="checkbox" disabled /><span>Through selection only</span></label>
      <label className="checkrow" title={soon}><input type="checkbox" disabled /><span>Close section curves</span></label>
      <p className="qs-step">Reconstructed Freeform curves</p>
      <label className="checkrow"><input type="radio" checked readOnly /><span>None</span></label>
      <label className="checkrow" title={soon}><input type="radio" disabled /><span>Approximate within 0.05 mm</span></label>
      <label className="checkrow" title={soon}><input type="radio" disabled /><span>Build with 10 points</span></label>
      <label className="checkrow" title={soon}><input type="radio" disabled /><span>Circle</span></label>
      {working && <p className="hint" data-test="sections-working">{working}</p>}
      <button data-test="sections-preview" disabled={working !== null || !(Number(spacing) > 0)} onClick={() => void preview()}>Preview</button>
      <footer style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="primary" data-test="sections-create" disabled={working !== null || !(Number(spacing) > 0)} onClick={() => void create()}>Create</button>
        <button data-test="sections-close" disabled={working !== null} onClick={close}>Close</button>
      </footer>
    </section>,
    document.body,
  )
}

/** Whether the dialog is up — Main's and CAD's Multiple sections key opens it. */
export function openMultipleSections(): void {
  useShell.getState().setMultipleSectionsOpen(true)
}
