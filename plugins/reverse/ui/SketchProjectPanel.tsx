// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react'
import type { FlatScene } from '../../../src/viewer/FlatScene'
import { entityPolyline, type SketchEntity } from '../core/sketch'
import { useReverse } from '../state/reStore'
import { useSketchProject } from '../state/sketchProjectStore'

/** The shipped reference command projects all other visible sketches. This
 * confirmation previews that set; it is not the former edge-picking tool. */
export function SketchProjectPanel() {
  const s = useSketchProject()
  const features = useReverse(state => state.features), draft = useReverse(state => state.sketchDraft)
  useEffect(() => { if (s.open) s.refresh() }, [s.open, features, draft])
  if (!s.open || !draft) return null
  const preview = s.preview, count = preview?.entities.length ?? 0, problems = preview?.issues ?? []
  return <section className="sketch-project-panel" data-test="sketch-project-panel" role="region" aria-label="Project the other visible sketches" style={{ display: 'grid', gap: 8 }}>
    <p style={{ margin: 0 }}>This will project all visible sketches to this sketch. Do you want to continue?</p>
    {count > 0 && <p data-test="sketch-project-count" style={{ margin: 0 }}>{count} {count === 1 ? 'entity' : 'entities'} from {preview!.sketches.length} {preview!.sketches.length === 1 ? 'sketch' : 'sketches'}.</p>}
    {preview?.sketches.map(f => <div key={f.id}>{f.name}: {f.count}</div>)}
    {preview?.duplicates ? <p data-test="sketch-project-duplicates" style={{ margin: 0 }}>{preview.duplicates} already projected {preview.duplicates === 1 ? 'entity is' : 'entities are'} excluded.</p> : null}
    {problems.length > 0 && <div data-test="sketch-project-errors" role="alert">{problems.map((problem, i) => <p key={`${problem.sketchId}:${problem.entityId ?? i}`} style={{ margin: '0 0 6px' }}>{problem.message}</p>)}<p style={{ margin: 0 }}>No projection will be created while these issues remain.</p></div>}
    {!count && !problems.length && <p data-test="sketch-project-empty" style={{ margin: 0 }}>{preview?.duplicates ? 'All visible sketch geometry is already projected.' : 'No other visible sketches contain geometry to project.'}</p>}
    {s.message && <p role="status" data-test="sketch-project-message" style={{ margin: 0 }}>{s.message}</p>}
    <div className="toolrow"><button type="button" data-test="sketch-project-create" disabled={!count || problems.length > 0} onClick={() => s.apply()}>Create</button><button type="button" data-test="sketch-project-cancel" onClick={() => s.cancel()}>Cancel</button></div>
  </section>
}

/** Actual projected geometry on the sheet, before the confirmation is accepted. */
export function SketchProjectOverlay({ scene }: { scene: FlatScene | null }) {
  const open = useSketchProject(s => s.open), preview = useSketchProject(s => s.preview)
  const svg = useRef<SVGSVGElement>(null), path = useRef<SVGPathElement>(null), dots = useRef<SVGPathElement>(null)
  useEffect(() => {
    const el = svg.current, host = el?.parentElement
    if (!open || !scene || !el || !host || !preview) return
    let frame = 0
    const render = () => {
      const rect = host.getBoundingClientRect()
      el.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`)
      let curves = '', points = ''
      for (const entity of preview.entities) {
        const polyline = entityPolyline({ ...entity, id: 0 } as SketchEntity, 96)
        for (let i = 0; i < polyline.length; i++) {
          const p = scene.sheetScreenPoint(polyline[i]); if (!p) continue
          const x = p.x - rect.left, y = p.y - rect.top
          if (entity.kind === 'point') points += `M${x - 3},${y}h6M${x},${y - 3}v6 `
          else curves += `${i ? 'L' : 'M'}${x},${y} `
        }
      }
      path.current?.setAttribute('d', curves); dots.current?.setAttribute('d', points)
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [open, preview, scene])
  return open ? <svg ref={svg} aria-label="Visible sketch projection preview" data-test="sketch-project-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 7, pointerEvents: 'none' }}><path ref={path} fill="none" stroke="#008c45" strokeWidth="2.5" strokeDasharray="5 3"/><path ref={dots} fill="none" stroke="#008c45" strokeWidth="2"/></svg> : null
}
