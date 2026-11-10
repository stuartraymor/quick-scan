// SPDX-License-Identifier: AGPL-3.0-only
import type { Vec2 } from '../../../src/core/flat/types'
import { cloneSketch } from '../core/sketch'
import type { FitOptions } from '../core/fitOptions'
import { fitChain, settle, toolIdle } from './reSketchDraft'
import { useReverse, type SketchDraft } from './reStore'

/** A temporary fit owns only the draft object it installed. It cannot roll back another editor's change. */
export function beginSketchAssist(chains: readonly Vec2[][]) {
  const base = useReverse.getState().sketchDraft
  if (!base) throw new Error('Open a sketch before using Sketch assist.')
  const source = chains.map(chain => chain.map(p => [...p] as Vec2))
  let owned: SketchDraft = base, options: FitOptions | null = null, closed = false
  const current = () => !closed && useReverse.getState().sketchDraft === owned
  return {
    preview(next: FitOptions) {
      if (!current()) throw new Error('The sketch changed. Reopen Sketch assist.')
      const sketch = cloneSketch(base.sketch), fitted = { ...base.fitted }
      let error: string | null = null
      for (let i=0;i<source.length;i++) if (!fitted[i]) error = fitChain(sketch,fitted,i,source[i],base.tolerance,next) ?? error
      const proposal = settle({ ...base, ...toolIdle(), sketch, fitted, selection: [], selectedConstraint: null })
      owned = { ...proposal, error: error ?? proposal.error }
      options = { ...next }
      useReverse.setState({ sketchDraft: owned })
      return owned
    },
    accept() {
      if (!current() || !options) throw new Error('The sketch changed. Preview again before accepting.')
      // Use the shared action for the final fit, including its fitted-chain undo bookkeeping.
      closed = true
      useReverse.setState({ sketchDraft: base })
      useReverse.getState().autoFit(source,'all',options)
    },
    cancel() {
      if (current()) useReverse.setState({ sketchDraft: base })
      closed = true
    },
  }
}
