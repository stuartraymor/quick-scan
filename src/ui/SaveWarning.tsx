// SPDX-License-Identifier: AGPL-3.0-only
// QUICKSURFACE's save warning, recorded live on 8.0.128: once the work has
// gone unsaved for the minutes set in Options → Other ("Show save warning
// if not saved for … minutes", 5 to start), a box in the bottom-right
// corner of the view says so, counting on until the project is saved.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePrefs } from '../state/prefsStore'
import { cornerBoxPlace } from './cornerBox'

/** The warning's words for `minutes` unsaved, or null before it is due. */
export function saveWarningText(minutes: number, after: number): string | null {
  return minutes >= after ? `The file has not been saved for ${minutes} minute${minutes === 1 ? '' : 's'}.\nConsider saving the file.` : null
}

export function SaveWarning({ dirty }: { dirty: boolean }) {
  const on = usePrefs((s) => s.saveWarn)
  const after = usePrefs((s) => s.saveWarnMinutes)
  const [since, setSince] = useState<number | null>(null)
  const [, tick] = useState(0)
  useEffect(() => { setSince(dirty ? (s) => s ?? Date.now() : null) }, [dirty])
  useEffect(() => {
    if (since === null) return
    const id = setInterval(() => tick((n) => n + 1), 15000)
    return () => clearInterval(id)
  }, [since])
  if (!on || since === null) return null
  const text = saveWarningText(Math.floor((Date.now() - since) / 60000), after)
  const view = document.querySelector('.desktop-mid')?.getBoundingClientRect()
  if (!text || !view) return null
  return createPortal(
    <div data-test="save-warning" role="status"
      style={{ position: 'fixed', ...cornerBoxPlace(view), whiteSpace: 'pre', padding: '6px 10px', background: 'color-mix(in srgb, var(--panel, #1e2126) 92%, transparent)', border: '1px solid var(--line, #3a3f47)', color: 'var(--ink, #e8eaed)', font: '13px/1.35 var(--ui-font, sans-serif)', pointerEvents: 'none', zIndex: 41 }}>
      {text}
    </div>,
    document.body,
  )
}
