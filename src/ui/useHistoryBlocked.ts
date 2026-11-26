// SPDX-License-Identifier: AGPL-3.0-only
import { useRef } from 'react'
import { historyBlocked, historyWatchers, useHistory } from '../state/historyStore'
import { useStore } from '../state/store'
import { useFlat } from '../state/flatStore'
import { useDeviation } from '../state/deviationStore'
import { useThickness } from '../state/thicknessStore'

export function useHistoryBlocked(){
  useHistory(s=>s.restoring)
  // Re-evaluate availability as computations and editors start or finish.
  useStore((s) => !!(s.busy || s.draft || s.dimDraft || s.alignDraft || s.sectionDraft))
  useFlat((s) => !!(s.imageBusy || s.draft || s.dimDraft || s.tool.kind !== 'none'))
  useDeviation((s) => s.alignStatus === 'running' || s.mapStatus === 'running' || s.nominalBusy)
  useThickness((s) => s.status === 'running')
  // What the plugins' histories hang on — the same hooks on every render,
  // those registered before the keys were first drawn.
  const watchers = useRef(historyWatchers()).current
  for (const watch of watchers) watch()
  return historyBlocked()
}
