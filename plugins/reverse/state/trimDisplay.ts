// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'

import type { FeatureDraft, PreviewInfo } from './reTypes'
import type { Vec3 } from '../../../src/core/types'
export type TrimPickState = { removed?: { body: number; at: Vec3 }[]; corrections?: { at: Vec3; keep: boolean }[] }
export type TrimView = 'remaining' | 'removed' | 'all'
const initial = { view: 'remaining' as TrimView, wireframe: false, hidden: [] as number[], history: [] as TrimPickState[] }
export const useTrimDisplay = create(() => initial)
export const resetTrimDisplay = () => useTrimDisplay.setState(initial)

export function displayedTrimPieces(preview: PreviewInfo) {
  if (preview.status === 'ok') return preview.trim?.pieces
  if (preview.status === 'building') return preview.trimDisplay?.pieces
}

/** A pick changes which cut faces are kept. Their tessellations stay valid
 * until the inputs or the trim method change. Only the kernel confirms the result. */
export function previewAfterTrimEdit(draft: Extract<FeatureDraft, { kind: 'trim' }>, patch: Partial<FeatureDraft>, preview: PreviewInfo): PreviewInfo {
  const pieces = displayedTrimPieces(preview)
  if (!pieces || Object.keys(patch).some(key => key !== 'removed' && key !== 'corrections')) return { status: 'idle' }
  const manual = 'removed' in patch ? patch.removed : draft.removed
  if (Boolean(manual) !== Boolean(draft.removed)) return { status: 'idle' }

  // Programmatic picks and undo of an automatic correction may need the
  // kernel to identify a face. Keep the current drawing during that lookup.
  const waiting = { status: 'building', trimDisplay: { pieces, pickable: false } } as const
  if (preview.status === 'building' && !preview.trimDisplay?.pickable) return waiting
  const samePoint = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
  if (manual && draft.removed) {
    const previous = draft.removed
    const owners = new Map(pieces.flatMap(piece => piece.picks.map(i => [previous[i], piece] as const)))
    const indices = new Map<typeof pieces[number], number[]>()
    for (const [i, pick] of manual.entries()) {
      const owner = owners.get(pick) ?? pieces.find(p => p.body === pick.body && samePoint(p.at, pick.at))
      if (!owner) return waiting
      const picks = indices.get(owner) ?? []
      picks.push(i)
      indices.set(owner, picks)
    }
    return { status: 'building', trimDisplay: { pickable: true, pieces: pieces.map(p => ({
      ...p, picks: indices.get(p) ?? [], removed: indices.has(p),
    })) } }
  }
  const previous = draft.corrections ?? []
  const next = 'corrections' in patch ? patch.corrections ?? [] : previous
  if (!previous.every((edit, i) => edit === next[i])) return waiting
  const updated = pieces.slice()
  for (const edit of next.slice(previous.length)) {
    const index = updated.findIndex(p => samePoint(p.at, edit.at))
    if (index < 0) return waiting
    updated[index] = { ...updated[index], removed: !edit.keep }
  }
  return { status: 'building', trimDisplay: { pickable: true, pieces: updated } }
}
