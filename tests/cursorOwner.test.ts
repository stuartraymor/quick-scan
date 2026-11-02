// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest'
import { WandCursorOwner } from '../src/viewer/cursorOwner'
import { wandCursor } from '../src/viewer/wandCursor'

describe('Magic Wand cursor ownership', () => {
  it('follows activation, navigation, release, leave and re-entry', () => {
    const owner = new WandCursorOwner(), style = { cursor: '' }
    owner.update(style, true, false, false)
    expect(style.cursor).toBe(wandCursor)
    owner.update(style, true, true, false)
    expect(style.cursor).toBe('grabbing')
    owner.update(style, true, false, false)
    expect(style.cursor).toBe(wandCursor)
    expect(owner.update(style, false, false, false)).toBe(true)
    expect(style.cursor).toBe('')
    owner.update(style, true, false, false)
    expect(style.cursor).toBe(wandCursor)
    owner.update(style, false, false, false)
    expect(style.cursor).toBe('')
  })

  it('retains the gizmo pointer when the wand is cancelled over it', () => {
    const owner = new WandCursorOwner(), style = { cursor: '' }
    owner.update(style, true, false, true)
    expect(style.cursor).toBe('pointer')
    owner.update(style, false, false, true)
    expect(style.cursor).toBe('pointer')
  })

  it('does not overwrite a newer tool cursor when relinquishing ownership', () => {
    const owner = new WandCursorOwner(), style = { cursor: 'crosshair' }
    expect(owner.update(style, false, false, false)).toBe(false)
    expect(style.cursor).toBe('crosshair')
    owner.update(style, true, false, false)
    style.cursor = 'ew-resize'
    owner.update(style, false, false, false)
    expect(style.cursor).toBe('ew-resize')
  })
})
