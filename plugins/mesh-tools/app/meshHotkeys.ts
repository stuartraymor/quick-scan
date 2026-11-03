// SPDX-License-Identifier: AGPL-3.0-only
// Edit Scan's two keys from QUICKSURFACE's Additional tools: Ctrl + M smooths
// the selected area, Ctrl + D defeatures it. The plugin's hook fills these
// in once its session is up; the keyboard handler only calls them.

/** A Clipping Box, in the part's own coordinates. */
export type ClipBox = { min: [number, number, number]; max: [number, number, number] }

export const meshHotkeys: {
  smooth: (() => void) | null
  defeature: (() => void) | null
  removeDuplicates: (() => void) | null
  projectBoundaries: (() => void) | null
  saveSelection: ((name: string) => boolean) | null
  applySelection: ((name: string) => void) | null
  hide: ((which: 'selected' | 'unselected') => void) | null
  showAll: (() => void) | null
  swapHidden: (() => void) | null
  deselect: (() => void) | null
  clip: {
    set: (box: ClipBox | null) => void
    bounds: () => ClipBox | null
    screen: (p: [number, number, number]) => { x: number; y: number } | null
    deleteOutside: (box: ClipBox) => void
    hideOutside: (box: ClipBox) => void
  } | null
} = { clip: null, smooth: null, defeature: null, removeDuplicates: null, projectBoundaries: null, saveSelection: null, applySelection: null, hide: null, showAll: null, swapHidden: null, deselect: null }

/** Whether a key press is one of the two, run when it is. */
export function runMeshHotkey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, marked: number): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || marked === 0) return false
  const k = e.key.toLowerCase()
  // Deselect all (Ctrl + Q) is QUICKSURFACE's too.
  const run = k === 'm' ? meshHotkeys.smooth : k === 'd' ? meshHotkeys.defeature : k === 'q' ? meshHotkeys.deselect : null
  if (!run) return false
  run()
  return true
}
