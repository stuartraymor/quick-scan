// SPDX-License-Identifier: AGPL-3.0-only
// Ctrl + mouse wheel in Extract primitives, as in QUICKSURFACE: the Magic
// Wand's sensitivity in 0.1° notches, any other tool's brush by a tenth.
import { beforeEach, describe, expect, it } from 'vitest'
import { ctrlWheelStep, EXTRACT_HINT_LINES } from '../src/ui/ExtractHints'
import { brushRange, useMark, WAND_MAX_DEG } from '../src/state/markStore'
import { useStore } from '../src/state/store'

beforeEach(() => {
  useStore.setState({ modelSize: 100 })
  useMark.setState({ gesture: 'wand', wandDegrees: 1, wandConnected: false, diameter: 8 })
})

describe('Ctrl + wheel while extracting', () => {
  it('turns the Magic Wand sensitivity, up grows it, held to its range', () => {
    ctrlWheelStep(-100)
    expect(useMark.getState().wandDegrees).toBeCloseTo(1.1)
    ctrlWheelStep(100)
    ctrlWheelStep(100)
    expect(useMark.getState().wandDegrees).toBeCloseTo(0.9)
    useMark.setState({ wandDegrees: WAND_MAX_DEG })
    ctrlWheelStep(-100)
    expect(useMark.getState().wandDegrees).toBe(WAND_MAX_DEG)
  })

  it('sizes the brush with any other tool, within the part-sized range', () => {
    useMark.setState({ gesture: 'brush' })
    ctrlWheelStep(-100)
    expect(useMark.getState().diameter).toBeCloseTo(8.8)
    for (let i = 0; i < 100; i++) ctrlWheelStep(100)
    expect(useMark.getState().diameter).toBeCloseTo(brushRange(100).min)
    expect(useMark.getState().wandDegrees).toBe(1)
  })

  it('shows the three hint lines QUICKSURFACE shows', () => {
    expect(EXTRACT_HINT_LINES).toHaveLength(3)
    expect(EXTRACT_HINT_LINES[1]).toMatch(/ALT/)
  })
})
