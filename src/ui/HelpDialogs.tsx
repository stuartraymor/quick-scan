// SPDX-License-Identifier: AGPL-3.0-only
// The Help tab's text windows: Shortcuts, System Log and Change log. One window
// shape, as in QUICKSURFACE: a title, a read-only text area, and a row of
// buttons under it (Clear Log where the text can be cleared, Copy To
// Clipboard, Close).

import { useState } from 'react'
import changelog from '../../CHANGELOG.md?raw'
import { useSystemLog } from '../app/systemLog'

/** What the keyboard does in Quick Scan today. Only keys that are bound are
 *  listed; QUICKSURFACE's own list has more, and the ones missing here are
 *  tracked in the parity checklist rather than promised. */
export const SHORTCUTS = `Any mode
--------
A - Zoom all
T - Top view
M - Bottom view
F - Front view
K - Back view
L - Left view
R - Right view
I - Isometric view
0 to 9 - Standard and three-quarter views (0 isometric, 1 top, 2 bottom, 3 front, 4 back, 5 left, 6 right)
Arrow keys - Step through what lies under the cursor, one behind another
Ctrl + Z - Undo
Ctrl + Y - Redo


Main Mode
--------
Ctrl + O - Open document
Ctrl + S - Save current document
Ctrl + Q - Deselect mesh triangles
Enter or middle click - Confirm the pending operation
Escape - Cancel the pending operation


Extract Primitives
--------------------
P - Fit Plane
C - Fit Cylinder
O - Fit Cone
E - Fit Sphere
`

export type HelpDialogId = 'shortcuts' | 'log' | 'changelog'

export function HelpDialog({ id, onClose }: { id: HelpDialogId; onClose: () => void }) {
  const lines = useSystemLog((s) => s.lines)
  const clear = useSystemLog((s) => s.clear)
  const [copied, setCopied] = useState(false)
  const title = id === 'shortcuts' ? 'Shortcuts' : id === 'log' ? 'System Log' : 'Change log'
  const text = id === 'shortcuts' ? SHORTCUTS : id === 'log' ? (lines.length ? lines.join('\n') : 'No messages since Quick Scan started.') : changelog
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false))
  }
  return (
    <div className="modalback" data-test="help-dialog" onClick={onClose}>
      <div className="modal text-dialog" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <pre data-test="help-dialog-text" tabIndex={0}>{text}</pre>
        <div className="toolrow">
          {id === 'log' && <button data-test="help-dialog-clear" onClick={clear}>Clear Log</button>}
          <button data-test="help-dialog-copy" onClick={copy}>{copied ? 'Copied' : 'Copy To Clipboard'}</button>
          <button className="primary" data-test="help-dialog-close" autoFocus onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
