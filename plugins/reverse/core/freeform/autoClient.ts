// SPDX-License-Identifier: AGPL-3.0-only
// Auto Freeform asked for from the page: a run in its own worker
// (autoWorker.ts), its progress as it goes, and a stop that takes effect at
// once — the worker is ended, wherever it is. Each run has a worker of its
// own, so a stopped run leaves nothing behind for the next.
//
// Where there are no workers of the page's own (the tests, a headless run)
// the same run is made in place, after a tick, and a stop only keeps its
// answer from being used.

import { AutoError, type AutoOutcome, type AutoSettings, type AutoStage, runAutoFreeform } from './autoFreeform'
import { loadAutoTools } from './autoTools'
import type { AutoMessage, AutoRequest } from './autoWorker'

/** The run was stopped by the user. */
export class AutoStopped extends Error {
  constructor() {
    super('Auto Freeform was stopped.')
    this.name = 'AutoStopped'
  }
}

export interface AutoRun {
  result: Promise<AutoOutcome>
  /** Stop the run: its promise is refused with AutoStopped. Nothing after it is done. */
  stop(): void
}

/** Whether this is a page with workers of its own. The headless engine (src/headless/engine.ts) and the tests stand a `Worker` in that reaches the mesh worker alone; that one is not the browser's. */
function hasWorkers(): boolean {
  return typeof Worker !== 'undefined' && typeof document !== 'undefined' && /\[native code\]/.test(Function.prototype.toString.call(Worker))
}

export type AutoProgressListener = (stage: AutoStage, overall: number) => void

export function startAutoFreeform(scan: { positions: Float32Array; indices: Uint32Array }, settings: AutoSettings, onProgress: AutoProgressListener = () => {}): AutoRun {
  let stopped = false
  let finish: (() => void) | null = null
  let refuse: ((e: Error) => void) | null = null
  const stop = () => {
    if (stopped) return
    stopped = true
    finish?.()
    refuse?.(new AutoStopped())
  }
  if (!hasWorkers()) {
    const result = new Promise<AutoOutcome>((resolve, reject) => {
      refuse = reject
      void loadAutoTools().catch(() => undefined).then((tools) => {
        if (stopped) return
        try {
          const outcome = runAutoFreeform(scan, settings, (stage, overall) => {
            if (!stopped) onProgress(stage, overall)
          }, tools)
          if (!stopped) resolve(outcome)
        } catch (e) {
          if (!stopped) reject(e instanceof Error ? e : new Error(String(e)))
        }
      })
    })
    return { result, stop }
  }
  const worker = new Worker(new URL('./autoWorker.ts', import.meta.url), { type: 'module' })
  finish = () => worker.terminate()
  const result = new Promise<AutoOutcome>((resolve, reject) => {
    refuse = reject
    worker.onmessage = (ev: MessageEvent<AutoMessage>) => {
      if (stopped) return
      const m = ev.data
      if (m.type === 'progress') {
        onProgress(m.stage, m.overall)
        return
      }
      worker.terminate()
      if (m.type === 'done') resolve(m.outcome)
      else reject(m.refused ? new AutoError(m.message) : new Error(m.message))
    }
    worker.onerror = (ev) => {
      if (stopped) return
      worker.terminate()
      reject(new Error(ev.message || 'Auto Freeform could not run.'))
    }
    // The scan stays the page's: the worker gets copies, handed over.
    const request: AutoRequest = { positions: scan.positions.slice(), indices: scan.indices.slice(), settings }
    worker.postMessage(request, [request.positions.buffer, request.indices.buffer])
  })
  return { result, stop }
}
