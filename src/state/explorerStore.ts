// SPDX-License-Identifier: AGPL-3.0-only
// The document browser's own state, shared by core rows and plugin rows: the
// row in focus (whose parents and dependents the card shows), the row being
// renamed in place, and a delete waiting for its confirmation. Plugins ask
// through these actions; the browser lists dependents and does the work, so
// every kind of object is deleted, isolated and confirmed the same way.
import { create } from 'zustand'

interface ExplorerState {
  /** Document-order key of the row last picked in Objects, History or the view. */
  focus: string | null
  setFocus: (key: string | null) => void
  /** Row key (a document-order key, or a plugin's own object key) in rename. */
  renaming: string | null
  setRenaming: (key: string | null) => void
  /** Keys asked to be deleted; the browser shows the dependents and asks. */
  deleting: readonly string[] | null
  requestDelete: (keys: readonly string[]) => void
  cancelDelete: () => void
}

export const useExplorer = create<ExplorerState>((set) => ({
  focus: null,
  setFocus: (focus) => set((s) => (s.focus === focus ? {} : { focus })),
  renaming: null,
  setRenaming: (renaming) => set({ renaming }),
  deleting: null,
  requestDelete: (keys) => set({ deleting: keys.length > 0 ? [...new Set(keys)] : null }),
  cancelDelete: () => set({ deleting: null }),
}))

type Isolate = (show: () => void, label: string) => boolean
let isolate: Isolate | null = null

/** The browser registers how to hide everything (scan, core and plugin
 *  objects) so "Hide All But This" is one step whatever the row's owner. */
export function registerExplorerIsolate(fn: Isolate): () => void {
  isolate = fn
  return () => { if (isolate === fn) isolate = null }
}

/** Hide every object, then run `show` for the one(s) to keep — one undo step. */
export function hideAllBut(show: () => void, label = 'Hide all but this'): boolean {
  return isolate ? isolate(show, label) : false
}

/** Whether the browser is up to show a delete's confirmation. */
export const explorerConfirms = (): boolean => isolate !== null

/** One History entry as the browser last drew it: its key, name, what it is
 *  built on and how to delete it. Published so deletes made elsewhere (the
 *  Elements panel, the agent) find the same dependents the browser lists. */
export interface ExplorerEntry { key: string; label?: string; parents?: readonly string[]; remove?: () => void }
let published: readonly ExplorerEntry[] = []
export function publishExplorerEntries(entries: readonly ExplorerEntry[]): void { published = entries }
export const explorerEntries = (): readonly ExplorerEntry[] => published
