// SPDX-License-Identifier: AGPL-3.0-only
// The ribbon's Combine / Cut / Intersect and Circular / Linear pattern keys
// open their editor on that operation (audit 2026-11-07, W-02: all three
// boolean keys opened the editor on its default, and Linear pattern on
// circular).
import { beforeEach, describe, expect, it } from 'vitest'
import { useReverse } from '../state/reStore'

describe('feature drafts opened on an operation', () => {
  beforeEach(() => useReverse.setState({ featureDraft: null, bodies: [] } as never))

  it.each(['join', 'cut', 'intersect'] as const)('a boolean draft started with op %s keeps it', (op) => {
    useReverse.getState().startFeature('boolean', { op } as never)
    const d = useReverse.getState().featureDraft
    expect(d?.kind).toBe('boolean')
    expect((d as { op?: string }).op).toBe(op)
  })

  it('a boolean draft started without an op takes the default', () => {
    useReverse.getState().startFeature('boolean')
    expect((useReverse.getState().featureDraft as { op?: string }).op).toBeDefined()
  })

  it.each(['circular', 'linear'] as const)('a pattern draft started with mode %s keeps it', (mode) => {
    useReverse.getState().startFeature('pattern', { mode } as never)
    const d = useReverse.getState().featureDraft
    expect(d?.kind).toBe('pattern')
    expect((d as { mode?: string }).mode).toBe(mode)
  })
})
