// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform's own worker: one run of autoFreeform.ts, off the main
// thread, on a copy of the scan sent with the request. It answers with its
// progress as it goes and its outcome at the end. It is not asked to stop:
// the page ends the worker (autoClient.ts), which stops it at once, whatever
// it is in the middle of.

import { loadAutoTools } from './autoTools'
import { AutoError, type AutoOutcome, type AutoSettings, type AutoStage, runAutoFreeform } from './autoFreeform'

export interface AutoRequest {
  positions: Float32Array
  indices: Uint32Array
  settings: AutoSettings
}

export type AutoMessage =
  | { type: 'progress'; stage: AutoStage; overall: number }
  | { type: 'done'; outcome: AutoOutcome }
  | { type: 'error'; message: string; refused: boolean }

/** No oftener than this is progress sent, ms. */
const PROGRESS_EVERY_MS = 40

const scope = self as unknown as { onmessage: ((ev: MessageEvent<AutoRequest>) => void) | null; postMessage(message: AutoMessage, transfer?: Transferable[]): void }

scope.onmessage = async (ev) => {
  const { positions, indices, settings } = ev.data
  let last = 0
  let lastStage: AutoStage | null = null
  try {
    const tools = await loadAutoTools().catch(() => undefined)
    const outcome = runAutoFreeform({ positions, indices }, settings, (stage, overall) => {
      const now = performance.now()
      if (stage === lastStage && now - last < PROGRESS_EVERY_MS) return
      last = now
      lastStage = stage
      scope.postMessage({ type: 'progress', stage, overall })
    }, tools)
    const transfer: Transferable[] = [outcome.cage.positions.buffer, outcome.surface.positions.buffer, outcome.surface.normals.buffer, outcome.surface.indices.buffer, outcome.surface.signed.buffer, outcome.surface.edgeSegments.buffer]
    if (outcome.mirror) transfer.push(outcome.mirror.partner.buffer)
    scope.postMessage({ type: 'done', outcome }, transfer)
  } catch (e) {
    scope.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e), refused: e instanceof AutoError })
  }
}
