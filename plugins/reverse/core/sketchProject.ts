// SPDX-License-Identifier: AGPL-3.0-only
// Batch projection of visible sketch features. Unsupported members block the
// entire operation rather than making an incomplete or approximate copy.
import type { SectionFrame } from '../../../src/core/section/frame'
import { type Feature } from './features'
import { projectSketchEntity } from './project'
import { addEntity, cloneSketch, type EntityInput, type Sketch } from './sketch'

export interface SketchProjectionTarget { featureId?: number; frame: SectionFrame; sketch: Sketch }
export interface SketchProjectionIssue { sketchId: number; entityId?: number; message: string }
export interface SketchProjectionPreview {
  entities: EntityInput[]
  sketches: { id: number; name: string; count: number }[]
  duplicates: number
  issues: SketchProjectionIssue[]
  fingerprint: string
}
export function visibleSketchProjection(features: readonly Feature[], target: SketchProjectionTarget): SketchProjectionPreview {
  const preview: SketchProjectionPreview = { entities: [], sketches: [], duplicates: 0, issues: [], fingerprint: '' }
  const existing = new Set(target.sketch.entities.flatMap(e => e.projected && e.source && 'sketch' in e.source ? [`${e.source.sketch}:${e.source.entity}`] : []))
  const activeIndex = target.featureId === undefined ? features.length : features.findIndex(f => f.id === target.featureId)
  const sources = features.filter(f => f.kind === 'sketch' && f.visible && !f.suppressed && f.id !== target.featureId)
  preview.fingerprint = JSON.stringify({ target, sources })
  if (target.featureId !== undefined && activeIndex < 0) {
    preview.issues.push({ sketchId: target.featureId, message: 'The sketch being edited is no longer in the model. Close this command and reopen the sketch.' })
    return preview
  }
  for (const feature of sources) {
    if (feature.kind !== 'sketch') continue
    let count = 0
    const remaining = feature.sketch.entities.filter(e => {
      if (existing.has(`${feature.id}:${e.id}`)) { preview.duplicates++; return false }
      return true
    })
    if (!remaining.length) continue
    if (target.featureId !== undefined && features.indexOf(feature) >= activeIndex) {
      preview.issues.push({ sketchId: feature.id, message: `${feature.name} comes after the sketch being edited. Move it earlier in History or hide it before projecting; its linked geometry cannot be used here in this order.` })
      continue
    }
    for (const entity of remaining) {
      const projected = projectSketchEntity(entity, feature.frame, target.frame)
      if (!projected) {
        const reason = entity.kind === 'circle' || entity.kind === 'arc'
          ? 'projects to an ellipse at this plane angle, which the sketch cannot represent'
          : entity.kind === 'spline' ? 'cannot be projected exactly onto this tilted plane' : 'cannot be represented on this plane'
        preview.issues.push({ sketchId: feature.id, entityId: entity.id, message: `${feature.name}: ${entity.kind} ${entity.id} ${reason}.` })
        continue
      }
      preview.entities.push({ ...projected, ...(entity.construction ? { construction: true } : {}), source: { sketch: feature.id, entity: entity.id } })
      existing.add(`${feature.id}:${entity.id}`); count++
    }
    if (count) preview.sketches.push({ id: feature.id, name: feature.name, count })
  }
  return preview
}
export function sketchWithVisibleProjection(target: Sketch, preview: SketchProjectionPreview): { sketch: Sketch; ids: number[] } | null {
  if (preview.issues.length || !preview.entities.length) return null
  const sketch = cloneSketch(target)
  return { sketch, ids: preview.entities.map(e => addEntity(sketch, JSON.parse(JSON.stringify(e)) as EntityInput)) }
}
