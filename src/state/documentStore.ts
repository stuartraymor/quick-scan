// SPDX-License-Identifier: AGPL-3.0-only
// Which file the session is a document of — the one Save writes to without
// asking — and how it came to be one. One owner for what used to be a ref in
// useProject and a counter in the store (0.0.150 wrote an opened example over
// the project opened before it; 0.0.151 patched that with the counter). Every
// way a document starts goes through here, so Save can only ever write to a
// file this document was opened from or saved to.

import { create } from 'zustand'

/** How the document on screen began. */
export type DocumentOrigin =
  /** The app's start, or New Project. */
  | 'new'
  /** A project file opened — Save writes it back. */
  | 'project'
  /** A scan, example or image opened in place of the session: a new document, as in QUICKSURFACE. */
  | 'scan'
  /** A recovery checkpoint restored: its file is unknown, Save asks. */
  | 'recovered'

export interface DocumentState {
  origin: DocumentOrigin
  /** The File the project was opened from, when the desktop can write it back. */
  file: File | null
  /** The desktop's token for a file saved to or opened from Recent, else null. */
  token: string | null
  /** Counts every start of a document, for anything that keys off "a new one". */
  generation: number
  /** A document begins: nothing to write back to. */
  startNew: (origin: Exclude<DocumentOrigin, 'project'>) => void
  /** A project file was opened: Save writes it back. */
  openedProject: (file: File | null, token: string | null) => void
  /** The desktop wrote the document to a file it now holds a token for. */
  savedTo: (token: string | null) => void
}

export const useDocument = create<DocumentState>((set) => ({
  origin: 'new',
  file: null,
  token: null,
  generation: 0,
  startNew: (origin) => set((s) => ({ origin, file: null, token: null, generation: s.generation + 1 })),
  openedProject: (file, token) => set((s) => ({ origin: 'project', file, token, generation: s.generation + 1 })),
  savedTo: (token) => set({ origin: 'project', file: null, token }),
}))

/** What Save hands the desktop to write back to — nothing when it must ask. */
export const saveTarget = (): { file: File | null; token: string | null } => {
  const { origin, file, token } = useDocument.getState()
  return origin === 'project' ? { file, token } : { file: null, token: null }
}
