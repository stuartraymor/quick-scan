// SPDX-License-Identifier: AGPL-3.0-only
// Who sets the viewport's element picking: the viewport's own rule
// (useSceneSync) in the core workspaces, the plugin in a workspace whose
// runtime takes the element clicks (PluginRuntime.elementPick) — the Reverse
// engineer workspace sets it on while nothing of its own is open. Both
// writing it on the same change of workspace left whichever wrote last in
// charge: the core's write came after the plugin's and switched picking off,
// so a click on a plane element drawn over a body took the body's face
// (e2e-reverse-notes, fixed 0.0.154).
import { describe, expect, it } from 'vitest'
import { coreSetsElementPicks } from '../src/app/useSceneSync'

describe('element picking has one owner per workspace', () => {
  it('the viewport sets it in its own workspaces, and under a plugin that leaves element clicks to it', () => {
    expect(coreSetsElementPicks(null)).toBe(true)
    expect(coreSetsElementPicks({})).toBe(true)
    expect(coreSetsElementPicks({ elementPick: undefined })).toBe(true)
  })

  it('a plugin that takes the element clicks owns the switch', () => {
    expect(coreSetsElementPicks({ elementPick: () => {} })).toBe(false)
  })
})
