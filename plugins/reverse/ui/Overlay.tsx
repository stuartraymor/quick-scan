// SPDX-License-Identifier: AGPL-3.0-only
// What stands by the cursor over the 3D view — the selection's chip bar and
// card, a note's box — drawn at the page's top, not inside the panel that
// owns it: closed, the CAD tools panel is display: none, and everything in
// it went with it, so a face picked with the panel shut said nothing. The
// wrapper makes no box of its own (display: contents); it carries the
// panels' themed colours and type (`qs-overlay` in command-widgets.css).
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Overlay({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(<div className="qs-overlay">{children}</div>, document.body)
}
