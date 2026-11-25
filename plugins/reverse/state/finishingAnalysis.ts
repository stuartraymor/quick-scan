// SPDX-License-Identifier: AGPL-3.0-only
import { create } from 'zustand'
import type { FinishingStatistics } from '../viewer/finishingOverlay'
import type { PreviewColouring } from '../core/freeform/previewDeviation'

export const useFinishingAnalysis = create<{
  enabled: boolean
  tolerance: number
  colouring: PreviewColouring
  transparency: number
  reading: 'idle' | 'measuring' | 'ready' | 'unavailable'
  statistics: FinishingStatistics | null
}>(() => ({ enabled: false, tolerance: .01, colouring: 'gradient', transparency: 75, reading: 'idle', statistics: null }))
