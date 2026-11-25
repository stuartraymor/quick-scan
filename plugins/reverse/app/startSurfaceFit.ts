// SPDX-License-Identifier: AGPL-3.0-only
import { useExtract } from '../../../src/state/extractStore'
import { INTERACTIVE_SURFACE_FIT } from '../core/surfaceFit'
import type { TrimTool } from '../core/features'
import { trimToleranceFor, useReverse } from '../state/reStore'
import { reverseSession } from './reSession'

export function startSurfaceFit() {
  const selection = reverseSession()?.sceneRef.current?.paintedVertices()
  const { tiltDeg, coincidenceMm, autoConstrain } = useExtract.getState()
  useReverse.getState().startFeature('surface', {
    region: selection ? Uint32Array.from(new Set(selection)) : new Uint32Array(),
    fit: { ...INTERACTIVE_SURFACE_FIT, constraintTolerances: { tiltDeg, coincidenceMm } },
    useShapeExpansion: true, awaitingType: true,
    constrain: { mode: autoConstrain ? 'auto' : 'free' },
  })
}

/** Only offer the handoff between fits, after each committed sheet has built. */
export function fittedSheetsToTrim(state: ReturnType<typeof useReverse.getState>): number[] {
  const d = state.featureDraft
  if (d?.kind !== 'surface' || d.featureId !== undefined || d.region.length || !d.createdSheets?.length) return []
  return d.createdSheets.filter(id => state.bodies.some(b => b.id === id && b.surface))
}

export function trimFittedSheets(): void {
  const state = useReverse.getState()
  const ids = fittedSheetsToTrim(state)
  if (state.building || ids.length < 2) return
  const tools: TrimTool[] = ids.map(id => ({ kind: 'body', id }))
  state.startFeature('trim', { tools, removed: undefined, tolerance: trimToleranceFor(tools, state.results) })
}
