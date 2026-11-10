// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useMemo, useRef } from 'react'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import { entityPolyline } from '../core/sketch'
import { duplicateSelected, offsetSelected } from '../core/sketchEdits'
import { useReverse } from '../state/reStore'
import { useSketchPresentation } from '../state/sketchPresentation'

/** Render proposed copies without touching the document, constraints or undo history. */
export function SketchEditPreview({ scene }: { scene: FlatScene | null }) {
 const draft = useReverse(s => s.sketchDraft)
 const { edit, duplicateDelta, offsetDistance } = useSketchPresentation()
 const result = useMemo(() => !draft || !edit ? null : edit === 'duplicate'
  ? duplicateSelected(draft.sketch, draft.selection, duplicateDelta)
  : offsetSelected(draft.sketch, draft.selection, offsetDistance),
 [draft?.sketch, draft?.selection, edit, duplicateDelta, offsetDistance])
 const svg = useRef<SVGSVGElement>(null), path = useRef<SVGPathElement>(null)
 useEffect(() => {
  const el = svg.current, host = el?.parentElement
  if (!scene || !el || !host || !result?.ok) return
  const ids = new Set(result.ids), entities = result.sketch.entities.filter(e => ids.has(e.id))
  let frame = 0
  const render = () => {
   const rect = host.getBoundingClientRect()
   el.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`)
   let curves = ''
   for (const entity of entities) {
    const polyline = entityPolyline(entity, 96)
    for (let i = 0; i < polyline.length; i++) {
     const p = scene.sheetScreenPoint(polyline[i]); if (!p) continue
     const x = p.x - rect.left, y = p.y - rect.top
     curves += entity.kind === 'point' ? `M${x-3},${y}h6M${x},${y-3}v6 ` : `${i ? 'L' : 'M'}${x},${y} `
    }
   }
   path.current?.setAttribute('d', curves)
   frame = requestAnimationFrame(render)
  }
  render()
  return () => cancelAnimationFrame(frame)
 }, [scene, result])
 return edit && draft && result?.ok ? <svg ref={svg} aria-label={`${edit} preview`} data-test="sketch-edit-preview" style={{position:'absolute',inset:0,width:'100%',height:'100%',zIndex:7,pointerEvents:'none'}}><path ref={path} fill="none" stroke="#ffff00" strokeWidth="2"/></svg> : null
}
