// SPDX-License-Identifier: AGPL-3.0-only
// "Rebuild with AI": the steps that put an AI agent to work on the loaded
// scan, in one place — switch the connection on, add the connector to the AI
// app, leave notes on the part for the agent to read, and ask it to rebuild.
// The connection, the connector and the notes are ScanRuler's own (Settings →
// Agents, the scanruler-mcp server, the note pins); this only gathers them.

import { usePrefs } from '../state/prefsStore'
import { AGENT_STATUS, CONNECTOR_STEPS, useAgentLink } from '../commands/agentLink'
import { CopyButton } from './CopyButton'
import { useDismiss } from './useDismiss'

export const REBUILD_PROMPT =
  'Using the Quick Scan tools (the scanruler connector), rebuild the scan that is open in Quick Scan as a CAD model. ' +
  'First read my notes on the part and follow them. Work step by step: align the part, fit the primitives, sketch the sections, ' +
  'then extrude, revolve and fillet, comparing with the scan as you go. Answer each note when you have dealt with it, and leave me ' +
  'a note on the part whenever you need a decision.'

export function AiWizard({ open, onClose, onAddNote, noteDisabledReason }: {
  open: boolean
  onClose: () => void
  /** Pin a note on the part (the CAD plugin's note tool), or null when there is none. */
  onAddNote: (() => void) | null
  noteDisabledReason?: string
}) {
  const agentLink = usePrefs((s) => s.agentLink)
  const link = useAgentLink()
  useDismiss(open, onClose)
  if (!open) return null
  const copy = (text: string) => void navigator.clipboard?.writeText(text)
  return (
    <div className="modalback" data-test="ai-wizard" onClick={onClose}>
      <div className="modal ai-wizard" role="dialog" aria-label="Rebuild with AI" onClick={(e) => e.stopPropagation()}>
        <h2>Rebuild with AI</h2>
        <ol>
          <li>
            <b>Connect.</b> Quick Scan waits for your AI app on this computer (127.0.0.1); nothing is uploaded by Quick Scan itself.
            <div className="toolrow">
              <button className={agentLink ? 'withicon on' : 'primary'} data-test="ai-connect" onClick={() => usePrefs.getState().setAgentLink(!agentLink)}>
                {agentLink ? 'Connection on — switch off' : 'Switch the AI connection on'}
              </button>
              <span data-test="ai-status">{agentLink ? `${AGENT_STATUS[link.status]}${link.detail ? ` — ${link.detail}` : ''}` : 'Off'}</span>
            </div>
          </li>
          <li>
            <b>Add the connector to your AI app</b> (once). Then quit the app completely and open it again.
            <ul className="ai-steps">
              {CONNECTOR_STEPS.map((step) => (
                <li key={step.app}>
                  <span><b>{step.app}</b> — {step.how}:</span>
                  <code>{step.text}</code>
                  <CopyButton label="Copy" className="ghost" onCopy={() => copy(step.text)} />
                </li>
              ))}
            </ul>
          </li>
          <li>
            <b>Leave notes for the AI.</b> Click a face, an edge or the scan and write what it should know — "this bore is 10 mm H7",
            "keep this face flat". The AI reads them, answers them, and pins its own questions for you.
            <div className="toolrow">
              <button data-test="ai-add-note" disabled={!onAddNote || !agentLink} title={!agentLink ? 'Switch the AI connection on first' : noteDisabledReason} onClick={() => { onClose(); onAddNote?.() }}>
                Add a note on the part
              </button>
            </div>
          </li>
          <li>
            <b>Ask the AI to rebuild.</b> Paste this into your AI app's chat; reply to its notes to iterate.
            <code className="ai-prompt" data-test="ai-prompt">{REBUILD_PROMPT}</code>
            <CopyButton label="Copy prompt" className="ghost" onCopy={() => copy(REBUILD_PROMPT)} />
          </li>
        </ol>
        <p className="hint">Every step the AI takes is one step of Undo, so any of it can be taken back.</p>
        <div className="toolrow">
          <button data-test="ai-wizard-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
