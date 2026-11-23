// SPDX-License-Identifier: AGPL-3.0-only
// The sketch's right-click menu on a circle or an arc, and "Select other"
// where pieces or points lie on top of each other (1.2.26; the brief's Part
// 8.8 and test C16). It opens with the arrow, a relation or the Dimension
// tool in hand — the tools that pick — and only over the sketch; elsewhere
// the stage's own menu opens as before. A spline keeps its own menu
// (SketchSplineOverlay), which is mounted before this one and claims the
// click first.
//
// Circle and arc: Select centrepoint, Concentric with…, Equal radius with…,
// Fix/Unfix, Dimension diameter, Dimension radius, View relations — each
// enabled only when it can act, with the reason as its tooltip when not.
// "Select other" lists everything a click there could take, the one a plain
// click takes first; choosing one is that click, taking the chosen thing.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import type { Vec2 } from '../../../src/core/flat/types'
import { useReverse, type SketchDraft } from '../state/reStore'
import { useSketchPresentation } from '../state/sketchPresentation'
import { datumTraces } from '../core/datums'
import { entityOf, type SketchEntity } from '../core/sketch'
import { snapFlags } from '../../../src/state/snapFilterStore'
import { pickLabel, picksAt, pieceName, type PickChoice, type PickMode } from '../core/pickOther'
import type { DimPick } from '../core/draw'

const STILL_PX = 4

interface Item { label: string; test: string; enabled: boolean; run: () => void; title?: string }
interface MenuState { x: number; y: number; title: string; others: PickChoice[]; items: Item[]; spot: Vec2; reach: number }

/** What the tool in hand picks with, or null for a tool this menu leaves
 *  alone (the drawing tools, a spline being drawn). */
export function pickModeOf(d: SketchDraft): PickMode | null {
  if (d.tool === 'select') return d.pending.length > 0 ? null : 'select'
  if (d.tool === 'dimension') return 'dimension'
  if (d.tool === 'relation' && d.armedRelation) {
    if (d.armedRelation === 'coincident') return 'coincident'
    return d.armedRelation === 'concentric' ? 'concentric' : 'relation'
  }
  return null
}

const round = (e: SketchEntity | undefined): e is Extract<SketchEntity, { kind: 'circle' | 'arc' }> => e?.kind === 'circle' || e?.kind === 'arc'

/** The circle or arc menu's items for piece `id`, the click at `spot`
 *  standing for the piece where an action needs one. */
export function roundItems(d: SketchDraft, id: number, spot: Vec2, reach: number): Item[] {
  const re = useReverse
  const sketch = d.sketch
  const e = entityOf(sketch, id)
  if (!round(e)) return []
  const name = pieceName(e)
  const click = (prefer: DimPick) => re.getState().sketchClick(spot, reach, false, { datums: datumTraces(d.frame), prefer })
  const selectOnly = () => {
    re.getState().setSketchTool('select')
    useReverse.setState((s) => (s.sketchDraft ? { sketchDraft: { ...s.sketchDraft, selection: [id], selectedConstraint: null, error: null } } : {}))
  }
  const others = sketch.entities.filter((o) => o.id !== id && round(o))
  const sized = sketch.constraints.find((c) => (c.kind === 'radius' || c.kind === 'diameter' || c.kind === 'arcLength') && c.entity === id)
  const dimension = (kind: 'radius' | 'diameter') => {
    selectOnly()
    re.getState().dimensionSelection()
    const held = re.getState().sketchDraft?.dimMade ?? null
    const c = held === null ? null : re.getState().sketchDraft?.sketch.constraints.find((x) => x.id === held)
    if (c && c.kind !== kind && (c.kind === 'radius' || c.kind === 'diameter')) re.getState().setDimensionForm(held!, kind)
  }
  const tool = d.tool === 'relation' ? d.armedRelation : d.tool
  const centre: DimPick = { kind: 'point', anchor: { entity: id, at: 'center' } }
  const noOther = 'There is no other circle or arc in the sketch'
  return [
    {
      label: 'Select centrepoint',
      test: 'sketch-menu-centre',
      enabled: true,
      title: tool === 'dimension' ? `Take the centre of ${name} as the Dimension tool's pick` : `Pick the centre of ${name} for a Coincident relation: then click what it meets`,
      run: () => {
        if (tool !== 'dimension' && tool !== 'coincident') re.getState().armRelation('coincident')
        click(centre)
      },
    },
    {
      label: 'Concentric with…',
      test: 'sketch-menu-concentric',
      enabled: others.length > 0,
      title: others.length > 0 ? `Concentric, with ${name} picked: click the circle or arc to share its centre` : noOther,
      run: () => { re.getState().armRelation('concentric'); click({ kind: 'piece', id }) },
    },
    {
      label: 'Equal radius with…',
      test: 'sketch-menu-equal',
      enabled: others.length > 0,
      title: others.length > 0 ? `Equal, with ${name} picked: click the circle or arc to give its radius` : noOther,
      run: () => { re.getState().armRelation('equal'); click({ kind: 'piece', id }) },
    },
    {
      label: e.fixed ? 'Unfix' : 'Fix',
      test: 'sketch-menu-fix',
      enabled: true,
      title: e.fixed ? `Let ${name} move again` : `Hold ${name} where it lies`,
      run: () => { selectOnly(); re.getState().toggleFixedSelected() },
    },
    {
      label: 'Dimension diameter',
      test: 'sketch-menu-diameter',
      enabled: !sized,
      title: sized ? `${name} has a ${sized.kind === 'arcLength' ? 'length' : sized.kind} dimension already — change its form in its row` : `A diameter on ${name}, in hand to put down`,
      run: () => dimension('diameter'),
    },
    {
      label: 'Dimension radius',
      test: 'sketch-menu-radius',
      enabled: !sized,
      title: sized ? `${name} has a ${sized.kind === 'arcLength' ? 'length' : sized.kind} dimension already — change its form in its row` : `A radius on ${name}, in hand to put down`,
      run: () => dimension('radius'),
    },
    {
      label: 'View relations',
      test: 'sketch-menu-relations',
      enabled: true,
      title: `Select ${name} and list only its relations and dimensions`,
      run: () => {
        selectOnly()
        useSketchPresentation.getState().setRelationsOfSelection(true)
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => document.querySelector('[data-test=sketch-relations-selected-only]')?.scrollIntoView({ block: 'nearest' }))
      },
    },
  ]
}

export function SketchPieceMenu({ scene }: { scene: FlatScene | null }) {
  const draftOpen = useReverse((s) => s.sketchDraft !== null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const anchor = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const host = anchor.current?.parentElement
    if (!draftOpen || !scene || !host) return
    let down: { x: number; y: number } | null = null
    // Windows sends the context menu on release, Linux and macOS on press:
    // then the menu waits for the release, and a drag (the view's pan) in
    // between drops it.
    let held: { x: number; y: number; open: MenuState } | null = null
    const pointerDown = (e: PointerEvent) => { if (e.button === 2) { down = { x: e.clientX, y: e.clientY }; held = null } }
    const pointerUp = (e: PointerEvent) => {
      if (e.button !== 2 || !held) return
      const h = held
      held = null
      if (Math.hypot(e.clientX - h.x, e.clientY - h.y) <= STILL_PX) setMenu(h.open)
    }
    const contextMenu = (e: MouseEvent) => {
      const d = useReverse.getState().sketchDraft
      const start = down
      down = null
      // A right-drag is the view's (pan), not a menu.
      if (!d || (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > STILL_PX)) return
      const mode = pickModeOf(d)
      if (!mode) return
      const spot = scene.sheetPoint(e.clientX, e.clientY)
      if (!spot) return
      const reach = 8 * scene.unitsPerScreenPx()
      const others = picksAt(d.sketch, spot, reach, datumTraces(d.frame), mode, snapFlags('pick'))
      const first = others[0] ?? null
      const piece = first?.piece != null ? entityOf(d.sketch, first.piece) : undefined
      if (piece?.kind === 'spline') return
      const items = round(piece) ? roundItems(d, piece.id, spot, reach) : []
      if (items.length === 0 && others.length < 2) return
      e.preventDefault(); e.stopImmediatePropagation()
      const open: MenuState = { x: e.clientX, y: e.clientY, title: first ? pickLabel(d.sketch, first.pick) : 'Sketch', others: others.length >= 2 ? others : [], items, spot, reach }
      if (e.buttons & 2) held = { x: e.clientX, y: e.clientY, open }
      else setMenu(open)
    }
    host.addEventListener('pointerdown', pointerDown, true)
    host.addEventListener('contextmenu', contextMenu, true)
    window.addEventListener('pointerup', pointerUp, true)
    return () => {
      host.removeEventListener('pointerdown', pointerDown, true)
      host.removeEventListener('contextmenu', contextMenu, true)
      window.removeEventListener('pointerup', pointerUp, true)
    }
  }, [draftOpen, scene])
  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => { if (!(e.target as HTMLElement | null)?.closest?.('[data-test=sketch-piece-menu]')) setMenu(null) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setMenu(null) } }
    window.addEventListener('pointerdown', close, true); window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', key, true) }
  }, [menu])
  // The menu belongs to the sketch as it stood: a change of tool or an
  // undo under it puts it away.
  useEffect(() => useReverse.subscribe((s, prev) => { if (s.sketchDraft?.tool !== prev.sketchDraft?.tool || s.sketchDraft?.sketch !== prev.sketchDraft?.sketch) setMenu(null) }), [])
  if (!draftOpen) return null
  if (!menu) return <span ref={anchor} hidden />
  const choose = (c: PickChoice) => {
    const d = useReverse.getState().sketchDraft
    setMenu(null)
    if (d) useReverse.getState().sketchClick(menu.spot, menu.reach, false, { datums: datumTraces(d.frame), prefer: c.pick })
  }
  return <>
    <span ref={anchor} hidden />
    {createPortal(
    <div className="contextmenu sketch-piece-menu" role="menu" data-test="sketch-piece-menu" style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 1000, minWidth: 200, background: 'var(--panel, #1f2328)', border: '1px solid var(--line, #444)', borderRadius: 4, padding: 4, boxShadow: '0 4px 14px rgba(0,0,0,0.4)' }}>
      <div className="hint" style={{ padding: '2px 8px 4px' }}>{menu.title}</div>
      {menu.items.map((it) => (
        <button key={it.test} role="menuitem" data-test={it.test} disabled={!it.enabled} title={it.title} style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => { setMenu(null); it.run() }}>
          {it.label}
        </button>
      ))}
      {menu.others.length > 0 && (
        <>
          <div className="hint" data-test="sketch-menu-others-head" style={{ padding: '6px 8px 2px', borderTop: menu.items.length ? '1px solid var(--line, #444)' : undefined }}>
            Select other — {menu.others.length} here
          </div>
          {menu.others.map((c, i) => (
            <button key={i} role="menuitem" data-test="sketch-menu-other" data-index={i} title={i === 0 ? 'What a plain click takes here' : 'Take this instead of the nearest'} style={{ display: 'block', width: '100%', textAlign: 'left' }} onClick={() => choose(c)}>
              {c.label}{i === 0 ? ' (nearest)' : ''}
            </button>
          ))}
        </>
      )}
    </div>,
    document.body,
  )}
  </>
}
