// SPDX-License-Identifier: AGPL-3.0-only
// Edit Scan's two keys from QUICKSURFACE's Additional tools: Ctrl + M smooths
// the selected area, Ctrl + D defeatures it. The plugin's hook fills these
// in once its session is up; the keyboard handler only calls them.

export const meshHotkeys: { smooth: (() => void) | null; defeature: (() => void) | null; removeDuplicates: (() => void) | null } = { smooth: null, defeature: null, removeDuplicates: null }

/** Whether a key press is one of the two, run when it is. */
export function runMeshHotkey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, marked: number): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || marked === 0) return false
  const k = e.key.toLowerCase()
  const run = k === 'm' ? meshHotkeys.smooth : k === 'd' ? meshHotkeys.defeature : null
  if (!run) return false
  run()
  return true
}
