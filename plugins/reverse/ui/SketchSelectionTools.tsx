// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import { dimensionFor } from '../core/draw'
import { datumTraces } from '../core/datums'
import { constraintEntities, entityOf, relationTakes, sketchBounds, splineJoint, type ConstraintKind, type SketchEntity } from '../core/sketch'
import { useReverse } from '../state/reStore'
import { useSketchBrush } from '../state/sketchBrushStore'
import { useSketchPresentation } from '../state/sketchPresentation'
import { SketchCommandIcon, type SketchCommandIconName } from './SketchCommandIcon'

/** Selection-owned actionable glyphs. Applied relation glyphs remain on the sheet. */
export function SketchSelectionTools({ scene }: { scene: FlatScene | null }) {
  const draft = useReverse(s => s.sketchDraft)
  const brush = useSketchBrush(s => s.open)
  const extra = useSketchPresentation(s => s.tool)
  const toolbar = useRef<HTMLDivElement>(null)
  const visible = Boolean(scene && draft?.tool === 'select' && draft.selection.length && !draft.imagePick && !draft.pattern && !brush && !extra)
  useEffect(() => {
    const el = toolbar.current, host = el?.parentElement
    if (!visible || !scene || !el || !host) return
    let frame = 0
    const position = () => {
      const d = useReverse.getState().sketchDraft
      const active = document.activeElement
      const textInput = active instanceof HTMLElement && (active.matches('input,textarea,select') || active.isContentEditable)
      const selected = d?.sketch.entities.filter(e => d.selection.includes(e.id)) ?? []
      if (!selected.length || textInput || d?.tool !== 'select') el.style.visibility = 'hidden'
      else {
        const bounds = sketchBounds({ entities: selected }), rect = host.getBoundingClientRect()
        const corners = bounds ? [bounds.min, bounds.max, [bounds.min[0], bounds.max[1]] as [number, number], [bounds.max[0], bounds.min[1]] as [number, number]] : []
        const projected = corners.map(p => scene.sheetScreenPoint(p)).filter((p): p is { x: number; y: number } => p !== null)
        if (!projected.length) el.style.visibility = 'hidden'
        else {
          const right = Math.max(...projected.map(p => p.x)) - rect.left, top = Math.min(...projected.map(p => p.y)) - rect.top
          const x = Math.max(8, Math.min(rect.width - el.offsetWidth - 8, right + 14))
          const y = Math.max(8, Math.min(rect.height - el.offsetHeight - 8, top - el.offsetHeight - 12))
          el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
          el.style.visibility = 'visible'
        }
      }
      frame = requestAnimationFrame(position)
    }
    frame = requestAnimationFrame(position)
    return () => cancelAnimationFrame(frame)
  }, [visible, scene])
  if (!visible || !draft) return null
  const pieces = draft.selection.map(id => entityOf(draft.sketch, id)).filter((e): e is SketchEntity => Boolean(e))
  if (pieces.length !== draft.selection.length) return null
  const constraints = draft.sketch.constraints
  const set = new Set(draft.selection)
  const hasUnary = (kind: ConstraintKind, id: number) => constraints.some(c => c.kind === kind && 'entity' in c && c.entity === id)
  const hasPair = (kind: ConstraintKind, a: number, b: number) => constraints.some(c => c.kind === kind && 'a' in c && 'b' in c && ((c.a === a && c.b === b) || (c.a === b && c.b === a)))
  const allLines = pieces.every(e => e.kind === 'line')
  const anyMovable = pieces.some(e => !e.fixed && !e.projected)
  const editable = pieces.filter(e => !e.projected)
  const fixed = editable.length > 0 && editable.every(e => e.fixed)
  const construction = pieces.every(e => e.construction)
  const actions: { icon: SketchCommandIconName; label: string; action: () => void; pressed?: boolean }[] = []
  if (editable.length) actions.push({ icon: 'fix', label: fixed ? 'Release fixed position' : 'Fix position', pressed: fixed, action: () => useReverse.getState().toggleFixedSelected() })
  actions.push({ icon: 'construction', label: construction ? 'Use in profile' : 'For construction', pressed: construction, action: () => useReverse.getState().toggleConstructionSelected() })
  if (anyMovable && allLines) {
    if (!pieces.every(e => hasUnary('horizontal', e.id)) && !pieces.some(e => hasUnary('vertical', e.id))) actions.push({ icon: 'horizontal', label: 'Make horizontal', action: () => useReverse.getState().addRelation('horizontal') })
    if (!pieces.every(e => hasUnary('vertical', e.id)) && !pieces.some(e => hasUnary('horizontal', e.id))) actions.push({ icon: 'vertical', label: 'Make vertical', action: () => useReverse.getState().addRelation('vertical') })
  }
  for (const kind of ['tangent', 'parallel', 'perpendicular', 'equal'] as const) {
    if (!anyMovable || pieces.length < 2 || (kind === 'tangent' && pieces.length !== 2)) continue
    const pairs = pieces.slice(1).map(e => [pieces[0], e])
    if (!pairs.every(pair => relationTakes(kind, pair))) continue
    if (kind === 'tangent') {
      const spline = pieces.find(e => e.kind === 'spline'), other = pieces.find(e => e !== spline)
      if (spline && other && !splineJoint(draft.sketch, spline.id, other.id)) continue
    }
    if (pairs.every(([a, b]) => hasPair(kind, a.id, b.id))) continue
    if (kind === 'parallel' && pairs.some(([a, b]) => hasPair('perpendicular', a.id, b.id))) continue
    if (kind === 'perpendicular' && pairs.some(([a, b]) => hasPair('parallel', a.id, b.id))) continue
    actions.push({ icon: kind, label: `Make ${kind}`, action: () => useReverse.getState().addRelation(kind) })
  }
  const dimension = pieces.length <= 2 ? dimensionFor(draft.sketch, { kind: 'piece', id: pieces[0].id }, pieces[1] ? { kind: 'piece', id: pieces[1].id } : null, datumTraces(draft.frame)) : null
  const alreadyDimensioned = dimension && constraints.some(c => c.kind === dimension.kind && constraintEntities(c).length === set.size && constraintEntities(c).every(id => set.has(id)))
  if (dimension && !alreadyDimensioned) actions.push({ icon: 'dimension', label: 'Dimensions', action: () => useReverse.getState().dimensionSelection() })
  return <div ref={toolbar} data-test="sketch-context-tools" role="toolbar" aria-label="Selected sketch geometry" style={{ position: 'absolute', left: 0, top: 0, visibility: 'hidden', zIndex: 8, display: 'flex', flexWrap: 'wrap', maxWidth: 'min(300px, calc(100% - 16px))', gap: 2, padding: 3, background: 'var(--panel, #f0f0f0)', border: '1px solid var(--line-strong, #aaa)', boxShadow: '0 2px 5px #0003', borderRadius: 2 }} onPointerDown={e => { e.preventDefault(); e.stopPropagation() }} onPointerUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onContextMenu={e => { e.preventDefault(); e.stopPropagation() }}>
    {actions.map(action => <button key={action.icon} type="button" data-test={`sketch-context-${action.icon}`} title={action.label} aria-label={action.label} aria-pressed={action.pressed} onClick={e => { e.preventDefault(); e.stopPropagation(); action.action() }} style={{ width: 30, height: 30, minWidth: 30, padding: 2, display: 'grid', placeItems: 'center', color: '#343434', border: action.pressed ? '1px solid #4e8cb9' : '1px solid transparent', background: action.pressed ? '#b7ddfa' : '#e3f1fc' }}><SketchCommandIcon name={action.icon}/></button>)}
  </div>
}
