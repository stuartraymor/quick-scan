// SPDX-License-Identifier: AGPL-3.0-only
// QUICKSURFACE's save warning: due at the minutes set, in its words.
import { describe, expect, it } from 'vitest'
import { saveWarningText } from '../src/ui/SaveWarning'

describe('save warning', () => {
  it('says nothing before it is due, then counts the minutes as QUICKSURFACE does', () => {
    expect(saveWarningText(4, 5)).toBeNull()
    expect(saveWarningText(25, 5)).toBe('The file has not been saved for 25 minutes.\nConsider saving the file.')
    expect(saveWarningText(1, 1)).toBe('The file has not been saved for 1 minute.\nConsider saving the file.')
  })
})
