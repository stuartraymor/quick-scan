// SPDX-License-Identifier: AGPL-3.0-only
// The strip under the ribbon while End of Model stands before the end of
// History. The model is then only looked at: the ribbon's modelling tabs
// and the tool panel are inert, and an inert ribbon cannot show the tooltip
// that said why. So the reason is said here, in plain sight, with the one
// key that brings the tools back — the same step as End in History.
import { useDocumentOrder, documentHistoryToEnd } from '../state/documentOrderStore'
import { useStore } from '../state/store'

export function ModelRolledBar() {
  const rolled = useDocumentOrder((s) => s.rollbackAt !== null)
  const busy = useStore((s) => s.busy)
  if (!rolled) return null
  return <aside className="recovery-bar model-rolled-bar" data-test="model-rolled-bar" role="status" aria-label="Model rolled back">
    <span>The model is rolled back: End of Model in History stands before its last steps. It is only looked at — creating, editing and deleting are off until End of Model is at the end.</span>
    <button data-test="model-rolled-to-end" disabled={busy} onClick={() => documentHistoryToEnd()}>To End of Model</button>
  </aside>
}
